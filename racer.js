// ==UserScript==
// @name         TypeRacer Racer
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  WR breaking auto-typer and captcha solver
// @author       https://github.com/atticup huge inspiration from ahm4dd (thanks bro <3)
// @match        https://play.typeracer.com/*
// @grant        GM_xmlhttpRequest
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    let interruptController = { reject: null };
    let currentCaptchaSession = 0;

    const state = {
        isActive: false,
        isTyping: false,
        isCaptchaVisible: false,
        wpm: 120,
        captchaWpm: 120,
        accuracy: 100,
        currentIndex: 0,
        raceText: '',
    };

    function logDebug(msg, type = "INFO") {
        const ts = new Date().toISOString().substring(11, 19);
        const formattedMsg = `[${ts}] [${type}] ${msg}`;
        console.log(formattedMsg);

        const consoleEl = document.getElementById("tr-bot-console");
        if (consoleEl) {
            const msgEl = document.createElement("div");
            msgEl.textContent = formattedMsg;
            msgEl.style.color = type === "ERROR" ? "#f44" : type === "WARN" ? "#fd0" : "#0f0";
            msgEl.style.marginBottom = "2px";
            consoleEl.appendChild(msgEl);
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    }

    function updateStatus(newStatus) {
        const statusElement = document.getElementById("tr-bot-status-text");
        if (statusElement) statusElement.textContent = newStatus;
        logDebug(`Status changed: ${newStatus}`, "STATE");
    }

    function triggerKeyboardEvent(el, eventType, char) {
        const keyCode = char.charCodeAt(0);
        const event = new KeyboardEvent(eventType, {
            key: char,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true,
        });
        el.dispatchEvent(event);
    }

    function setInputValue(element, currentText, newChar) {
        element.focus();
        const fullText = currentText + newChar;

        triggerKeyboardEvent(element, 'keydown', newChar);
        triggerKeyboardEvent(element, 'keypress', newChar);

        let valueSetter = Object.getOwnPropertyDescriptor(element.__proto__, 'value')?.set;
        if (!valueSetter && element.tagName.toLowerCase() === 'textarea') {
            valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        } else if (!valueSetter && element.tagName.toLowerCase() === 'input') {
            valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        }

        if (valueSetter) {
            valueSetter.call(element, fullText);
        } else {
            element.value = fullText;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        triggerKeyboardEvent(element, 'keyup', newChar);
    }

    async function startTyping() {
        if (!state.isActive || state.isTyping || state.isCaptchaVisible) return;

        const inputField = document.querySelector('.txtInput');
        if (!inputField) {
            logDebug("Input field not found", "ERROR");
            return;
        }

        const wordsTyped = document.querySelectorAll('.txtInput-unfocused > span[class=""]');
        let prefixLength = 0;
        if (wordsTyped.length > 0) {
            let currentTypedText = '';
            wordsTyped.forEach(span => { currentTypedText += span.textContent; });
            if (state.raceText.length > currentTypedText.length) {
                currentTypedText += ' ';
            }
            prefixLength = currentTypedText.length;
        }

        state.currentIndex = prefixLength + inputField.value.length;
        inputField.focus();
        state.isTyping = true;
        updateStatus('Typing...');

        for (let i = state.currentIndex; i < state.raceText.length; i++) {
            if (!state.isActive || state.isCaptchaVisible) {
                state.isTyping = false;
                updateStatus(state.isCaptchaVisible ? 'Solving...' : 'Paused');
                return;
            }

            state.currentIndex = i;
            const char = state.raceText[i];

            if (Math.random() * 100 > state.accuracy && char !== ' ' && state.raceText[i - 1] !== ' ') {
                logDebug(`Simulating typo at index ${i}`, "INFO");
                setInputValue(inputField, inputField.value, String.fromCharCode(97 + Math.floor(Math.random() * 26)));
                await new Promise(resolve => setTimeout(resolve, 150));

                const lastSpaceIndex = state.raceText.lastIndexOf(' ', state.currentIndex) + 1;
                const backspaceCount = inputField.value.length;
                const correctedValue = inputField.value.slice(0, -backspaceCount);

                await new Promise(resolve => setTimeout(resolve, 80 + Math.random() * 50));

                const prototype = Object.getPrototypeOf(inputField);
                const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
                valueSetter.call(inputField, correctedValue);
                inputField.dispatchEvent(new Event('input', { bubbles: true }));

                await new Promise(resolve => setTimeout(resolve, 150));

                i = lastSpaceIndex - 1;
                continue;
            }

            const delay = (60 / (state.wpm * 5)) * 1000 * (1 + (Math.random() - 0.5) * 0.4);
            await new Promise(resolve => setTimeout(resolve, delay));
            setInputValue(inputField, inputField.value, char);
        }

        state.isTyping = false;
        updateStatus('Finished');
    }

    function createInterruptiblePromise() {
        return new Promise((_, reject) => {
            interruptController.reject = reject;
        });
    }

    function waitForElement(selector, timeout = 3000) {
        logDebug(`Waiting for element: ${selector}`, "INFO");
        return new Promise((resolve, reject) => {
            const intervalTime = 100;
            const endTime = Date.now() + timeout;
            const intervalId = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(intervalId);
                    logDebug(`Found element: ${selector}`, "INFO");
                    resolve(element);
                } else if (Date.now() > endTime) {
                    clearInterval(intervalId);
                    logDebug(`Timeout waiting for: ${selector}`, "ERROR");
                    reject(new Error(`Element "${selector}" not found.`));
                }
            }, intervalTime);
        });
    }

    function getBase64FromUrl(url) {
        logDebug(`Fetching image blob from: ${url}`, "INFO");
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                onload: function(response) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        logDebug("Image converted to Base64 successfully.", "INFO");
                        resolve(reader.result);
                    };
                    reader.onerror = (e) => {
                        logDebug("FileReader error", "ERROR");
                        reject(e);
                    };
                    reader.readAsDataURL(response.response);
                },
                onerror: (e) => {
                    logDebug("Failed to fetch image blob.", "ERROR");
                    reject(e);
                }
            });
        });
    }

    async function solveCaptchaAPI(imageUrl) {
        logDebug("Initiating OCR req prompt...", "API");
        const base64Image = await getBase64FromUrl(imageUrl);

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://pfuner.xyz/v9/image/describer',
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({
                    imageBase64: base64Image,
                    prompt: "extract only the exact text visible in this image output nothing else no conversational filler, no quotes, no markdown, no descriptions. just the text pls :D"
                }),
                onload: function(response) {
                    logDebug("Received API response.", "API");
                    try {
                        const json = JSON.parse(response.responseText);
                        let rawResult = json.description || json.text || json.result || "";

                        let resultText = rawResult.replace(/\n/g, ' ').replace(/[^a-zA-Z0-9\s.,?!'"-]/g, '').replace(/\s+/g, ' ').trim();

                        if (resultText && resultText.length > 2) {
                            logDebug(`Extracted Text: "${resultText}"`, "API");
                            resolve(resultText);
                        } else {
                            logDebug(`Extracted string was too short or empty. RAW: ${response.responseText.substring(0, 100)}`, "ERROR");
                            reject(new Error("API returned insufficient text."));
                        }
                    } catch (e) {
                        logDebug(`API payload parsing failed.`, "ERROR");
                        reject(new Error("API JSON parse failure."));
                    }
                },
                onerror: () => {
                    logDebug("API Network failure.", "ERROR");
                    reject(new Error("API Network failure."));
                }
            });
        });
    }

    async function typeCaptchaText(element, text, session) {
        logDebug(`Typing CAPTCHA text: ${text}`, "INFO");
        const getDelay = () => (60 / (state.captchaWpm * 5)) * 1000 * (1 + (Math.random() - 0.5) * 0.3);

        for (const char of text) {
            if (!state.isActive || session !== currentCaptchaSession) {
                logDebug("CAPTCHA typing interrupted.", "WARN");
                throw new Error("CAPTCHA typing interrupted.");
            }
            await new Promise(resolve => setTimeout(resolve, getDelay()));
            setInputValue(element, element.value, char);
        }
    }

    async function handleCaptchaAppearance() {
        if (state.isCaptchaVisible) return;
        state.isCaptchaVisible = true;
        logDebug("CAPTCHA overlay detected in DOM.", "WARN");

        const session = ++currentCaptchaSession;

        try {
            const interruptPromise = createInterruptiblePromise();
            const race = (promise) => Promise.race([promise, interruptPromise]);

            const captchaImg = await race(waitForElement('img.challengeImg', 5000));
            const captchaInput = await race(waitForElement('textarea.challengeTextArea', 5000));
            const submitButton = await race(waitForElement('button.gwt-Button', 5000));

            const apiText = await race(solveCaptchaAPI(captchaImg.src));

            if (!document.querySelector(".txtInput")) {
                throw new Error("Race ended while solving CAPTCHA.");
            }

            if (apiText && state.isActive && session === currentCaptchaSession) {
                await typeCaptchaText(captchaInput, apiText, session);
                await new Promise(resolve => setTimeout(resolve, 500));

                logDebug("Clicking CAPTCHA submit button.", "INFO");
                if (state.isActive && session === currentCaptchaSession) submitButton.click();
            }

        } catch (error) {
            logDebug(`CAPTCHA handler aborted: ${error.message}`, "ERROR");

            state.isActive = false;
            const toggleButton = document.getElementById("tr-bot-toggle");
            if (toggleButton) {
                toggleButton.textContent = "Start";
                toggleButton.classList.remove("active");
            }

            updateStatus("Bot stopped (CAPTCHA Fail)");
        }
    }

    function handleCaptchaDismissal() {
        if (!state.isCaptchaVisible) return;
        logDebug("CAPTCHA overlay removed from DOM.", "INFO");
        state.isCaptchaVisible = false;
        currentCaptchaSession++;
        updateStatus('Resuming...');
        if (state.isActive) startTyping();
    }

    function extractRaceText() {
        const textSpans = document.querySelectorAll('[unselectable="on"]');
        if (!textSpans || textSpans.length === 0) return null;
        let fullText = '';
        textSpans.forEach(span => { fullText += span.textContent; });
        return fullText.replace(/\u00A0/g, ' ');
    }

    function resetForNewRace() {
        state.isTyping = false;
        state.currentIndex = 0;
        state.raceText = '';
        updateStatus(state.isActive ? 'Waiting for race' : 'Idle');
    }

    function joinNewRace() {
        const links = document.querySelectorAll('.raceAgainLink, a.gwt-Anchor');
        for (const link of links) {
            if (link.textContent.includes('Race Again') || link.textContent.includes('Enter a typing race') || link.textContent.includes('Join a race')) {
                logDebug("Joining new race...", "INFO");
                link.click();
                return;
            }
        }
        logDebug("Could not locate a new race button to click.", "WARN");
    }

    function handleRaceStart() {
        if (state.isTyping || state.isCaptchaVisible) return;
        resetForNewRace();
        const newText = extractRaceText();
        if (newText) {
            logDebug(`New race detected. Text length: ${newText.length}`, "INFO");
            state.raceText = newText;
            if (state.isActive) startTyping();
        }
    }

    function initializeObserver() {
        const observer = new MutationObserver(mutations => {
            const newRaceText = extractRaceText();
            if (newRaceText && newRaceText !== state.raceText && document.querySelector(".txtInput")) {
                handleRaceStart();
                return;
            }

            for (const mutation of mutations) {
                for (const addedNode of mutation.addedNodes) {
                    if (addedNode.nodeType === 1 && addedNode.querySelector('img[src*="challenge?"]')) {
                        handleCaptchaAppearance();
                        return;
                    }
                }
                for (const removedNode of mutation.removedNodes) {
                    if (removedNode.nodeType === 1 && removedNode.querySelector('img[src*="challenge?"]')) {
                        handleCaptchaDismissal();
                        return;
                    }
                }
                if (mutation.target.className && typeof mutation.target.className == "string" && mutation.target.className.includes("gameStatusLabel")) {
                    const statusText = mutation.target.textContent;
                    if (statusText.includes("The race has ended") || statusText.includes("You finished")) {
                        if (state.raceText !== "") {
                            logDebug("Race ended.", "INFO");
                            resetForNewRace();
                        }
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        logDebug("DOM Observer initialized.", "INFO");
    }

    function createUI() {
        const uiContainer = document.createElement("div");
        uiContainer.id = "tr-bot-ui";
        uiContainer.innerHTML = `
            <div class="tr-bot-title">TypeRacer API Bot</div>
            <div class="tr-bot-buttons">
                <button id="tr-bot-toggle">Start</button>
                <button id="tr-bot-clear">Clear & Next</button>
            </div>
            <div class="tr-bot-slider">
                <label for="tr-bot-wpm">Race WPM: <span id="tr-bot-wpm-value">${state.wpm}</span></label>
                <input type="range" id="tr-bot-wpm" min="30" max="1000" value="${state.wpm}">
            </div>
            <div class="tr-bot-slider">
                <label for="tr-bot-captcha-wpm">CAPTCHA WPM: <span id="tr-bot-captcha-wpm-value">${state.captchaWpm}</span></label>
                <input type="range" id="tr-bot-captcha-wpm" min="10" max="1000" value="${state.captchaWpm}">
            </div>
            <div class="tr-bot-slider">
                <label for="tr-bot-accuracy">Accuracy: <span id="tr-bot-accuracy-value">${state.accuracy}%</span></label>
                <input type="range" id="tr-bot-accuracy" min="80" max="100" value="${state.accuracy}">
            </div>
            <div class="tr-bot-status">Status: <span id="tr-bot-status-text">Idle</span></div>
            <div id="tr-bot-console"></div>
            <button id="tr-bot-copy-logs">Copy Logs</button>
        `;
        document.body.appendChild(uiContainer);

        const toggleButton = document.getElementById("tr-bot-toggle");
        const clearButton = document.getElementById("tr-bot-clear");
        const copyButton = document.getElementById("tr-bot-copy-logs");

        toggleButton.addEventListener("click", () => {
            state.isActive = !state.isActive;
            toggleButton.textContent = state.isActive ? "Stop" : "Start";
            toggleButton.classList.toggle("active", state.isActive);
            logDebug(`Bot ${state.isActive ? "Started" : "Stopped"}`, "STATE");
            if (state.isActive) {
                updateStatus("Waiting for race");
                if (document.querySelector(".txtInput") && state.raceText && !state.isTyping) {
                    startTyping();
                }
            } else {
                state.isTyping = false;
                currentCaptchaSession++;
                if (interruptController.reject) interruptController.reject(new Error("Operation stopped by user."));
                updateStatus("Paused");
            }
        });

        clearButton.addEventListener("click", () => {
            currentCaptchaSession++;
            if (interruptController.reject) interruptController.reject(new Error("Operation cleared by user."));

            state.isActive = true;
            toggleButton.textContent = "Stop";
            toggleButton.classList.add("active");

            logDebug("State manually cleared. Auto-queueing.", "STATE");
            resetForNewRace();
            joinNewRace();
        });

        copyButton.addEventListener("click", (e) => {
            const consoleEl = document.getElementById("tr-bot-console");
            const logText = Array.from(consoleEl.childNodes).map(node => node.textContent).join('\n');

            navigator.clipboard.writeText(logText).then(() => {
                const originalText = e.target.textContent;
                e.target.textContent = "Copied!";
                setTimeout(() => e.target.textContent = originalText, 1500);
            }).catch(err => {
                logDebug(`Clipboard write failed: ${err}`, "ERROR");
            });
        });

        document.getElementById("tr-bot-wpm").addEventListener("input", e => { state.wpm = parseInt(e.target.value, 10); document.getElementById("tr-bot-wpm-value").textContent = state.wpm; logDebug(`Race WPM set to ${state.wpm}`, "CONFIG"); });
        document.getElementById("tr-bot-captcha-wpm").addEventListener("input", e => { state.captchaWpm = parseInt(e.target.value, 10); document.getElementById("tr-bot-captcha-wpm-value").textContent = state.captchaWpm; logDebug(`CAPTCHA WPM set to ${state.captchaWpm}`, "CONFIG"); });
        document.getElementById("tr-bot-accuracy").addEventListener("input", e => { state.accuracy = parseInt(e.target.value, 10); document.getElementById("tr-bot-accuracy-value").textContent = `${state.accuracy}%`; logDebug(`Accuracy set to ${state.accuracy}%`, "CONFIG"); });
    }

    function injectStyles() {
        const css = `#tr-bot-ui{position:fixed;bottom:20px;right:20px;background-color:#2a2a2e;color:#e2e2e2;border:1px solid #444;border-radius:8px;padding:15px;font-family:Arial,sans-serif;font-size:14px;z-index:9999;box-shadow:0 4px 10px rgba(0,0,0,0.4);width:260px}.tr-bot-title{font-weight:700;font-size:18px;text-align:center;margin-bottom:12px;color:#5cf}.tr-bot-buttons{display:flex;gap:10px;margin-bottom:10px}.tr-bot-buttons button{flex:1;padding:10px;border:none;border-radius:5px;color:#fff;font-weight:700;cursor:pointer;transition:background-color .2s}#tr-bot-toggle{background-color:#2e7d32}#tr-bot-toggle:hover{background-color:#388e3c}#tr-bot-toggle.active{background-color:#c62828}#tr-bot-toggle.active:hover{background-color:#d32f2f}#tr-bot-clear{background-color:#1e88e5}#tr-bot-clear:hover{background-color:#2196f3}.tr-bot-slider{margin:12px 0}.tr-bot-slider label{display:block;margin-bottom:5px;font-size:12px}.tr-bot-slider input[type=range]{width:100%;cursor:pointer}.tr-bot-status{text-align:center;margin-top:8px;font-size:13px;color:#bbb}#tr-bot-console{height:120px;overflow-y:auto;background-color:#111;color:#0f0;font-family:monospace;font-size:10px;padding:5px;margin-top:10px;border:1px solid #555;border-radius:4px;word-wrap:break-word}#tr-bot-copy-logs{width:100%;margin-top:5px;padding:6px;background-color:#444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;transition:background-color .2s}#tr-bot-copy-logs:hover{background-color:#555}`;
        const styleElement = document.createElement("style");
        styleElement.innerText = css;
        document.head.appendChild(styleElement);
    }

    const loadingCheck = setInterval(() => {
        if (document.querySelector(".gameView")) {
            clearInterval(loadingCheck);
            injectStyles();
            createUI();
            initializeObserver();
            logDebug("Script Initialized successfully.", "SYSTEM");
        }
    }, 500);
})();
