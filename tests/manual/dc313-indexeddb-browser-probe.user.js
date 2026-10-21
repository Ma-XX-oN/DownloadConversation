// ==UserScript==
// @name         DC #313 IndexedDB Atomic Two-Tab Probe
// @namespace    https://chatgpt.com/dc313-idb-probe/
// @version      0.1.0
// @description  Synthetic cross-tab IndexedDB transaction test; no private traffic.
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';
  if (location.origin !== 'https://chatgpt.com') return;
  const rounds = 24;
  const tab = crypto.randomUUID();
  const sessions = new Map();
  const channel = new BroadcastChannel('dc313-indexeddb-atomic-probe-v1');
  let running = false;

  /**
   * @returns {Promise<IDBDatabase>} Open isolated synthetic database.
   */
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('dc313-indexeddb-atomic-probe-v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('counter');
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('indexeddb-blocked'));
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }

  /**
   * @param {string} key - Synthetic run ID.
   * @param {'read'|'increment'|'reset'} mode - One atomic operation.
   * @returns {Promise<number>} Committed read/increment result.
   */
  async function counter(key, mode) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('counter',
          mode === 'read' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('counter');
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error || Error('transaction-aborted'));
        tx.onerror = () => reject(tx.error || Error('transaction-failed'));
        const request = store.get(key);
        request.onsuccess = () => {
          const current = request.result ?? 0;
          if (mode === 'read') result = current;
          else if (mode === 'reset') {
            store.put(0, key);
            result = 0;
          } else {
            store.put(current + 1, key);
            result = current + 1;
          }
        };
      });
    } finally { db.close(); }
  }

  /**
   * @param {string} key - Synthetic session key.
   * @returns {Promise<Object>} 24 atomic increments and observed range.
   */
  async function increments(key) {
    let first = null;
    let last = 0;
    for (let i = 0; i < rounds; i++) {
      const value = await counter(key, 'increment');
      if (first === null) first = value;
      last = value;
    }
    return { completed: rounds, first, last };
  }

  /**
   * @param {string} title - Result title.
   * @param {Object} result - Nonsecret JSON results.
   * @returns {void} Display copyable JSON.
   */
  function show(title, result) {
    const json = JSON.stringify({
      test: title, timestamp: new Date().toISOString(), result
    }, null, 2);
    console.info('DC #313 IndexedDB result', json);
    const publish = () => {
      document.getElementById('dc313-idb-output')?.remove();
      const panel = document.createElement('section');
      panel.id = 'dc313-idb-output';
      panel.style.cssText = 'position:fixed;inset:10%;z-index:2147483647;' +
        'padding:18px;background:#202124;color:white;font:14px system-ui;' +
        'border:2px solid #aaa;border-radius:10px;display:flex;' +
        'flex-direction:column;gap:12px;';
      const label = document.createElement('strong');
      label.textContent = 'DC #313: ' + title;
      const field = document.createElement('textarea');
      field.readOnly = true;
      field.value = json;
      field.style.cssText = 'flex:1;min-height:120px;background:white;' +
        'color:black;font:13px monospace;resize:vertical;';
      const actions = document.createElement('div');
      for (const [name, action] of [
        ['Copy JSON', () => GM_setClipboard(json, 'text')],
        ['Close', () => panel.remove()]
      ]) {
        const button = document.createElement('button');
        button.textContent = name;
        button.style.cssText = 'margin-right:10px;padding:7px 12px;color:black;';
        button.onclick = action;
        actions.appendChild(button);
      }
      panel.append(label, field, actions);
      document.body.appendChild(panel);
      field.select();
    };
    if (document.body) publish();
    else document.addEventListener('DOMContentLoaded', publish, { once: true });
  }

  /**
   * @param {number} ms - Waiting interval.
   * @returns {Promise<void>} Delay.
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  channel.onmessage = async event => {
    const data = event.data;
    if (!data || data.from === tab || typeof data.run !== 'string') return;
    if (data.type === 'prepare' && !running) {
      sessions.set(data.run, { leader: data.from });
      channel.postMessage({ type: 'ready', from: tab, run: data.run });
    } else if (data.type === 'start') {
      const state = sessions.get(data.run);
      if (!state || state.leader !== data.from || running) return;
      running = true;
      try {
        const outcome = await increments(data.run);
        channel.postMessage({ type: 'done', from: tab,
          run: data.run, outcome });
      } catch (error) {
        channel.postMessage({ type: 'error', from: tab,
          run: data.run, message: String(error) });
      } finally {
        running = false;
        sessions.delete(data.run);
      }
    } else if (['ready', 'done', 'error'].includes(data.type)) {
      const state = sessions.get(data.run);
      if (!state || state.leader) return;
      if (data.type === 'ready') state.ready.add(data.from);
      if (data.type === 'done') state.done.set(data.from, data.outcome);
      if (data.type === 'error') state.errors.push(data.message);
    }
  };

  /**
   * @returns {Promise<void>} Two actual tab transaction consistency check.
   */
  async function run() {
    if (running) return;
    running = true;
    const id = crypto.randomUUID();
    const state = { ready: new Set(), done: new Map(), errors: [] };
    sessions.set(id, state);
    show('IndexedDB two-tab test', { status: 'RUNNING', version: '0.1.0' });
    try {
      await counter(id, 'reset');
      channel.postMessage({ type: 'prepare', from: tab, run: id });
      await delay(900);
      if (state.ready.size !== 1) {
        throw Error('exactly one participating second tab required');
      }
      channel.postMessage({ type: 'start', from: tab, run: id });
      const local = await increments(id);
      const started = Date.now();
      while (state.done.size + state.errors.length < 1 &&
          Date.now() - started < 15000) await delay(50);
      const observed = await counter(id, 'read');
      show('IndexedDB two-tab test', {
        version: '0.1.0',
        status: state.done.size === 1 && state.errors.length === 0 &&
          observed === 2 * rounds ? 'PASS' : 'FAIL',
        expected: 2 * rounds, observed, local,
        peer: [...state.done.values()],
        peersReady: state.ready.size, peersDone: state.done.size,
        errors: state.errors
      });
    } catch (error) {
      show('IndexedDB two-tab test', {
        version: '0.1.0', status: 'FAIL', error: String(error)
      });
    } finally {
      sessions.delete(id);
      running = false;
    }
  }

  GM_registerMenuCommand('DC #313: test IndexedDB atomic two-tab storage', run);
  GM_registerMenuCommand('DC #313: show IndexedDB probe readiness',
    () => show('IndexedDB probe readiness', {
      version: '0.1.0', status: 'READY'
    }));
})();
