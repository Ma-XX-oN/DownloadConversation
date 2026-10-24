// ==UserScript==
// @name         DC CGP2 Grant-World Compatibility Test
// @namespace    https://chatgpt.com/downloadconversation/tests/
// @version      0.1.0
// @description  Verifies private CGP2 direct object references with DC's actual Tampermonkey GM grants.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @connect      github.com
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @sandbox      raw
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';
  const prefix = '[DC CGP2 GRANT-WORLD]';
  const resultId = 'dc-cgp2-grant-world-result';
  let completed = false;
  let timer = null;
  let timeout = null;

  function show(message, passed) {
    console[passed ? 'info' : 'error'](prefix, message);
    const render = () => {
      if (!document.body) return;
      const old = document.getElementById(resultId);
      if (old) old.remove();
      const node = document.createElement('div');
      node.id = resultId;
      node.textContent = message;
      Object.assign(node.style, {
        position: 'fixed', bottom: '12px', right: '12px',
        zIndex: '2147483647', padding: '12px 16px',
        background: passed ? '#14532d' : '#7f1d1d',
        color: 'white', font: 'bold 14px sans-serif',
        borderRadius: '8px', maxWidth: '75vw'
      });
      document.body.appendChild(node);
    };
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  function finish(message, passed) {
    if (completed) return;
    completed = true;
    clearInterval(timer);
    clearTimeout(timeout);
    globalThis.removeEventListener('dc-cgp2-test-ready', attempt);
    show(message, passed);
  }

  async function attempt() {
    if (completed || attempt.running) return;
    const plugin = globalThis.ChatGPTWebAgentPlugin;
    if (!plugin) return;
    attempt.running = true;
    try {
      if (typeof GM_getValue !== 'function'
          || typeof GM_setValue !== 'function'
          || typeof GM_xmlhttpRequest !== 'function'
          || typeof GM_addValueChangeListener !== 'function'
          || typeof GM_removeValueChangeListener !== 'function') {
        throw new Error('DC Tampermonkey GM grants are unavailable');
      }
      const absent = GM_getValue('__dc_cgp2_grant_world_nonexistent_v1__', 1234567);
      if (absent !== 1234567) throw new Error('GM_getValue failed');

      if (plugin.id !== 'chatgpt-web'
          || typeof plugin.create !== 'function'
          || typeof plugin.recognize !== 'function'
          || !plugin.recognize({ provider: 'chatgpt' })) {
        throw new Error('Private CGP2 plugin interface unavailable');
      }
      const options = { nested: { value: 10 } };
      const originalNested = options.nested;
      let callbackCalled = false;
      const submit = (request) => {
        callbackCalled = true;
        if (request.options !== options
            || request.options.nested !== originalNested) {
          throw new Error('Object reference was copied');
        }
        request.options.nested.value = 11;
        return { accepted: false, reason: 'TEST_ONLY' };
      };
      const agent = plugin.create({ ref: 'grant-world-test', submit });
      const reply = await agent.sendMessage('PROBE_ONLY_NOT_SENT', 0, options);
      if (!callbackCalled || options.nested.value !== 11
          || reply?.reason !== 'TEST_ONLY') {
        throw new Error('Direct callback or shared mutation failed');
      }
      finish('DC + CGP2 GM grants: PASS - same-world functions and object references; GM APIs available', true);
    } catch (error) {
      finish('DC + CGP2 GM grants: FAIL - ' + (error?.message || String(error)), false);
    } finally {
      attempt.running = false;
    }
  }

  globalThis.addEventListener('dc-cgp2-test-ready', attempt);
  timer = setInterval(attempt, 100);
  timeout = setTimeout(() => {
    finish('DC + CGP2 GM grants: FAIL - private plugin unavailable in granted script after 15 seconds', false);
  }, 15000);
  attempt();
})();
