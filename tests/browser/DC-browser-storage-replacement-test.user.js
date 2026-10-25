// ==UserScript==
// @name         DC Browser Storage Replacement Tests
// @namespace    https://chatgpt.com/downloadconversation/tests/
// @version      0.2.0
// @description  Automatically verifies browser persistence and bidirectional cross-tab events.
// @match        https://chatgpt.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  const PREFIX = '__dc_browser_storage_probe_v2__';
  const tabId = crypto.randomUUID();
  const key = PREFIX + 'value';
  const crossTabPrefix = PREFIX + 'tab:';
  const resultId = PREFIX + 'result';
  const statuses = new Map();
  const setStatus = (label, value, detail = '') => {
    const prior = statuses.get(label);
    const current = value + (detail ? ': ' + detail : '');
    if (prior === current) return;
    statuses.set(label, current);
    console.info('[DC STORAGE TEST]', value, label, detail);
    render();
  };
  function render() {
    if (!document.body) return;
    let node = document.getElementById(resultId);
    if (!node) {
      node = document.createElement('pre');
      node.id = resultId;
      Object.assign(node.style, {
        position: 'fixed', right: '12px', bottom: '12px',
        zIndex: '2147483647', maxWidth: '75vw', maxHeight: '48vh',
        overflow: 'auto', background: '#172554', color: 'white',
        padding: '12px', borderRadius: '8px', font: '12px monospace',
        whiteSpace: 'pre-wrap'
      });
      document.body.appendChild(node);
    }
    node.textContent = [
      'DC browser storage replacement test v0.2.0',
      'Open two chatgpt.com tabs. No clicking required.',
      ...[...statuses].map(([name, status]) => status + ' ' + name)
    ].join('\n');
  }
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  async function checkPersistence() {
    try {
      const previous = localStorage.getItem(key);
      if (previous === null) {
        setStatus('localStorage reload retention', 'PENDING', 'refresh either tab once');
      } else {
        const parsed = JSON.parse(previous);
        setStatus('localStorage reload retention',
          parsed.marker === PREFIX ? 'PASS' : 'FAIL');
      }
      localStorage.setItem(key, JSON.stringify({
        marker: PREFIX, nested: { value: 7 }
      }));
      setStatus('localStorage JSON set/get',
        JSON.parse(localStorage.getItem(key)).nested.value === 7 ? 'PASS' : 'FAIL');
    } catch (error) {
      setStatus('localStorage', 'FAIL', String(error));
    }
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PREFIX + 'db', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('values');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = (mode, action) => new Promise((resolve, reject) => {
        const tx = db.transaction('values', mode);
        const req = action(tx.objectStore('values'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await transaction('readwrite',
        store => store.put({ nested: { n: 4 } }, 'sample'));
      const actual = await transaction('readonly', store => store.get('sample'));
      setStatus('IndexedDB put/get', actual?.nested?.n === 4 ? 'PASS' : 'FAIL');
      db.close();
    } catch (error) {
      setStatus('IndexedDB put/get', 'FAIL', String(error));
    }
  }

  function checkCrossTab() {
    let channel;
    try {
      channel = new BroadcastChannel(PREFIX + 'channel');
    } catch (error) {
      setStatus('BroadcastChannel', 'FAIL', String(error));
      return;
    }
    let receivedBroadcast = false;
    let receivedStorage = false;
    const peerIds = new Set();
    const update = () => {
      if (receivedBroadcast) setStatus('BroadcastChannel two-tab messaging', 'PASS');
      if (receivedStorage) setStatus('localStorage cross-tab change event', 'PASS');
    };
    const writeProbe = () => {
      try {
        localStorage.setItem(crossTabPrefix + tabId, JSON.stringify({
          from: tabId, nonce: crypto.randomUUID()
        }));
      } catch (error) {
        setStatus('localStorage cross-tab change event', 'FAIL', String(error));
      }
    };
    channel.onmessage = event => {
      const data = event.data;
      if (!data || data.from === tabId || data.kind !== 'HELLO') return;
      receivedBroadcast = true;
      peerIds.add(data.from);
      update();
      // The receiver writes its own unique key to guarantee a storage event
      // in the sender, regardless of timing of tab creation.
      writeProbe();
      if (data.reply !== true) {
        channel.postMessage({ kind: 'HELLO', from: tabId, reply: true });
      }
    };
    window.addEventListener('storage', event => {
      if (event.storageArea !== localStorage ||
          !event.key?.startsWith(crossTabPrefix) || !event.newValue) return;
      try {
        const data = JSON.parse(event.newValue);
        if (data.from === tabId || event.key !== crossTabPrefix + data.from) return;
        receivedStorage = true;
        update();
      } catch (error) {
        setStatus('localStorage cross-tab change event', 'FAIL', String(error));
      }
    });
    setStatus('BroadcastChannel two-tab messaging', 'PENDING', 'waiting for second tab');
    setStatus('localStorage cross-tab change event', 'PENDING', 'waiting for second tab');
    const announce = () => {
      if (receivedBroadcast && receivedStorage) {
        clearInterval(interval);
        return;
      }
      channel.postMessage({ kind: 'HELLO', from: tabId, reply: false });
      // Writing after discovery guarantees bidirectional notification.
      if (peerIds.size) writeProbe();
    };
    const interval = setInterval(announce, 1000);
    announce();
    setTimeout(() => {
      if (!receivedBroadcast) setStatus('BroadcastChannel two-tab messaging',
        'FAIL', 'no second tab seen within 20 seconds');
      if (!receivedStorage) setStatus('localStorage cross-tab change event',
        'FAIL', 'no cross-tab storage event within 20 seconds');
      // Remain listening; a newly opened second tab can still turn FAIL to PASS.
    }, 20000);
    window.addEventListener('pagehide', () => {
      clearInterval(interval);
      channel.close();
    }, { once: true });
  }
  checkPersistence();
  checkCrossTab();
})();
