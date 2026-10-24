// ==UserScript==
// @name         DC Browser Storage Replacement Tests
// @namespace    https://chatgpt.com/downloadconversation/tests/
// @version      0.1.0
// @description  Tests standard browser storage and cross-tab notifications as replacements for GM value APIs.
// @match        https://chatgpt.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  const PREFIX = '__dc_browser_storage_probe_v1__';
  const channelName = PREFIX + 'channel';
  const resultId = PREFIX + 'result';
  const tabId = crypto.randomUUID();
  const key = PREFIX + 'value';
  const results = [];
  function show() {
    if (!document.body) return;
    let element = document.getElementById(resultId);
    if (!element) {
      element = document.createElement('pre');
      element.id = resultId;
      Object.assign(element.style, {
        position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647',
        maxWidth: '75vw', maxHeight: '45vh', overflow: 'auto',
        background: '#172554', color: 'white', padding: '12px',
        borderRadius: '8px', font: '12px monospace', whiteSpace: 'pre-wrap'
      });
      document.body.appendChild(element);
    }
    element.textContent = ['DC browser storage tests (no GM grants)', ...results].join('\n');
  }
  function report(name, pass, detail = '') {
    const line = (pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : '');
    results.push(line);
    console[pass ? 'info' : 'error']('[DC BROWSER STORAGE]', line);
    show();
  }
  if (!document.body) document.addEventListener('DOMContentLoaded', show, { once: true });
  const run = async () => {
    // localStorage: immediate read/write, JSON round trip, and reload persistence.
    try {
      const previous = localStorage.getItem(key);
      if (previous !== null) {
        const prior = JSON.parse(previous);
        report('localStorage reload retention', prior?.marker === PREFIX);
      } else {
        report('localStorage first-run baseline', true, 'reload to test retention');
      }
      const value = { marker: PREFIX, tabId, nested: { value: 7 } };
      localStorage.setItem(key, JSON.stringify(value));
      const roundtrip = JSON.parse(localStorage.getItem(key));
      report('localStorage JSON set/get', roundtrip.nested.value === 7);
    } catch (e) { report('localStorage', false, e.message); }

    // IndexedDB: structured values and transaction persistence.
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PREFIX + 'db', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('values');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transact = (mode, action) => new Promise((resolve, reject) => {
        const tx = db.transaction('values', mode);
        const req = action(tx.objectStore('values'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const sample = { marker: PREFIX, nested: { n: 4 } };
      await transact('readwrite', store => store.put(sample, 'sample'));
      const actual = await transact('readonly', store => store.get('sample'));
      report('IndexedDB put/get', actual?.nested?.n === 4);
      db.close();
    } catch (e) { report('IndexedDB', false, e.message); }

    // Cross-tab: open this exact page in a second tab, press Run in both tabs.
    let channel = null;
    let peerSeen = false;
    let storageSeen = false;
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = event => {
        if (event.data?.from === tabId) return;
        if (event.data?.type === 'PING') {
          peerSeen = true;
          channel.postMessage({ type: 'PONG', from: tabId });
        }
        if (event.data?.type === 'PONG') peerSeen = true;
      };
      window.addEventListener('storage', event => {
        if (event.key === PREFIX + 'cross-tab' && event.newValue?.includes('sender')) {
          storageSeen = true;
        }
      });
      const runButton = document.createElement('button');
      runButton.textContent = 'Run cross-tab checks (click in both tabs)';
      Object.assign(runButton.style, {position:'fixed',bottom:'180px',right:'12px',
        zIndex:'2147483647',padding:'8px',background:'#fef08a',color:'#111827'});
      const insert = () => { if (document.body) document.body.appendChild(runButton); };
      if (document.body) insert();
      else document.addEventListener('DOMContentLoaded', insert, {once:true});
      runButton.onclick = () => {
        peerSeen = false;
        storageSeen = false;
        channel.postMessage({ type: 'PING', from: tabId });
        localStorage.setItem(PREFIX + 'cross-tab', JSON.stringify({ sender: tabId, at: Date.now() }));
        setTimeout(() => {
          report('BroadcastChannel two-tab messaging', peerSeen,
            peerSeen ? '' : 'no responding peer; run in another tab');
          report('localStorage cross-tab change event', storageSeen,
            storageSeen ? '' : 'no event from another tab; run in another tab');
        }, 1500);
      };
      report('BroadcastChannel creation', true, 'two-tab checks require two tabs');
    } catch (e) { report('BroadcastChannel', false, e.message); }
  };
  run();
})();
