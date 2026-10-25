// ==UserScript==
// @name         DC Private CGP2 Provider - Two-Script Integration
// @namespace    https://chatgpt.com/downloadconversation/
// @version      0.1.0-issue.156.1
// @description  Loads the pinned private CGP2 classic provider for Download Conversation.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @require      https://github.com/Ma-XX-oN/Chat-Gpt-Plugin-2/raw/c9aeb2f48708dd27a8d672dbbc56333dc1c4a425/dist/chatgpt-plugin.js
// ==/UserScript==

(function () {
  'use strict';
  const plugin = globalThis.ChatGPTWebAgentPlugin;
  if (plugin?.id !== 'chatgpt-web' || plugin?.apiVersion !== 1
      || typeof plugin.create !== 'function') {
    console.error('[DC CGP2] Private provider dependency did not execute.');
    return;
  }
  globalThis.dispatchEvent(new CustomEvent('dc-cgp2-test-ready'));
  console.info('[DC CGP2] Private provider ready:', plugin.id);
})();
