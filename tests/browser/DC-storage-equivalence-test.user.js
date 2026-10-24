// ==UserScript==
// @name         DC Storage Equivalence Tests
// @namespace    https://chatgpt.com/downloadconversation/tests/
// @version      0.2.0
// @description  Tests no-grant browser storage migration, transactions, and two-tab notifications.
// @match        https://chatgpt.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  const prefix = '__dc_storage_equivalence_v1__';
  const tab = crypto.randomUUID();
  const channel = new BroadcastChannel(prefix + 'channel');
  const lines = new Map();
  const key = prefix + 'fixture';
  const notificationKey = prefix + 'notify:' + tab;
  const statusId = prefix + 'status';
  const seen = {write: false, remove: false, broadcast: false, transaction: false};
  const peers = new Set();
  let db;
  let paired = false;
  let running = false;

  function status(name, result, note = '') {
    const value = result + (note ? ' - ' + note : '');
    if (lines.get(name) === value) return;
    lines.set(name, value);
    console.info('[DC STORAGE EQUIVALENCE]', name, value);
    render();
  }
  function render() {
    if (!document.body) return;
    let box = document.getElementById(statusId);
    if (!box) {
      box = document.createElement('pre');
      box.id = statusId;
      Object.assign(box.style, {
        position: 'fixed', bottom: '10px', right: '10px', zIndex: '2147483647',
        maxHeight: '55vh', maxWidth: '85vw', overflow: 'auto',
        background: '#14213d', color: '#fff', padding: '14px',
        font: '12px monospace', whiteSpace: 'pre-wrap', borderRadius: '8px'
      });
      document.body.appendChild(box);
    }
    box.textContent = ['DC storage equivalence v0.2.0',
      'Open two ChatGPT tabs. No buttons or synchronized clicks.',
      ...[...lines].map(([name, result]) => result + ' ' + name)].join('\n');
  }
  if (!document.body) document.addEventListener('DOMContentLoaded', render, {once: true});

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
  }
  async function openDb() {
    return new Promise((resolve, reject) => {
      const op = indexedDB.open(prefix + 'db', 1);
      op.onupgradeneeded = () => op.result.createObjectStore('entries');
      op.onsuccess = () => resolve(op.result);
      op.onerror = () => reject(op.error);
    });
  }
  function txRead(name) {
    return request(db.transaction('entries', 'readonly').objectStore('entries').get(name));
  }
  function txPut(name, value) {
    return new Promise((resolve, reject) => {
      const t = db.transaction('entries', 'readwrite');
      t.objectStore('entries').put(value, name);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  function txIncrement(name) {
    return new Promise((resolve, reject) => {
      const t = db.transaction('entries', 'readwrite');
      const store = t.objectStore('entries');
      const r = store.get(name);
      r.onsuccess = () => store.put((r.result || 0) + 1, name);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function localTests() {
    try {
      const original = localStorage.getItem(key);
      status('reload retention', original ? (
        JSON.parse(original).marker === prefix ? 'PASS' : 'FAIL'
      ) : 'PENDING', original ? '' : 'refresh once');
      // A legacy-style JSON setting is migrated by reading and writing
      // unchanged nested data. This uses only a synthetic fixture.
      const fixture = {marker: prefix, enabled: true, volume: 0,
        nested: {title: 'Unicode é 日本語', flags: [false, true, null]}};
      localStorage.setItem(key, JSON.stringify(fixture));
      const back = JSON.parse(localStorage.getItem(key));
      status('existing-data representation (JSON fixture)',
        JSON.stringify(back) === JSON.stringify(fixture) ? 'PASS' : 'FAIL');
      localStorage.setItem(prefix + 'delete', 'temporary');
      localStorage.removeItem(prefix + 'delete');
      status('set / delete semantics',
        localStorage.getItem(prefix + 'delete') === null ? 'PASS' : 'FAIL');
    } catch (error) { status('localStorage fixtures', 'FAIL', String(error)); }

    try {
      db = await openDb();
      const value = {last_used: Date.now(), cache: {entries: [1, 2]},
        bytes: new Uint8Array([0, 127, 255])};
      await txPut('fixture', value);
      const copy = await txRead('fixture');
      status('IndexedDB structured objects and bytes',
        copy?.bytes instanceof Uint8Array &&
        copy.bytes[2] === 255 && copy.cache.entries[1] === 2 ? 'PASS' : 'FAIL');
      status('IndexedDB reload retention', 'PENDING', 'refresh to confirm');
      const prior = await txRead('persistent');
      if (prior) status('IndexedDB reload retention',
        prior.marker === prefix ? 'PASS' : 'FAIL');
      await txPut('persistent', {marker: prefix});
    } catch (error) { status('IndexedDB fixtures', 'FAIL', String(error)); }
  }

  window.addEventListener('storage', event => {
    if (!event.key?.startsWith(prefix + 'notify:')) return;
    const origin = event.key.slice((prefix + 'notify:').length);
    if (origin === tab) return;
    if (event.newValue === null) seen.remove = true;
    else if (event.newValue.startsWith(prefix)) seen.write = true;
    evaluate();
  });
  function evaluate() {
    if (seen.broadcast) status('BroadcastChannel discovery', 'PASS');
    if (seen.write) status('cross-tab write notification', 'PASS');
    if (seen.remove) status('cross-tab delete notification', 'PASS');
    if (seen.transaction) status('concurrent IndexedDB transaction', 'PASS');
  }
  let activePair = null;
  let localDone = false;
  let peerDone = false;
  let verifying = false;
  async function verifyPair() {
    if (!localDone || !peerDone || !activePair || verifying || seen.transaction) return;
    verifying = true;
    try {
      const value = await txRead('counter:' + activePair);
      status('concurrent IndexedDB transaction', value === 40 ? 'PASS' : 'FAIL',
        value === 40 ? 'both tabs committed 20 increments' : 'expected 40; received ' + value);
      if (value === 40) seen.transaction = true;
    } catch (error) {
      status('concurrent IndexedDB transaction', 'FAIL', String(error));
    } finally {
      verifying = false;
    }
  }
  async function pairTest(peer) {
    if (running || !db) return;
    running = true;
    paired = true;
    activePair = [tab, peer].sort().join(':');
    try {
      const countKey = 'counter:' + activePair;
      for (let i = 0; i < 20; i++) await txIncrement(countKey);
      localDone = true;
      channel.postMessage({kind: 'DONE', from: tab, to: peer, pair: activePair});
      status('concurrent IndexedDB transaction', 'PENDING', 'waiting for peer completion');
      await verifyPair();
    } catch (error) {
      status('concurrent IndexedDB transaction', 'FAIL', String(error));
    }
  }
  channel.onmessage = async event => {
    const d = event.data;
    if (!d || d.from === tab) return;
    if (d.kind === 'HELLO') {
      peers.add(d.from);
      seen.broadcast = true;
      evaluate();
      if (!paired && db) void pairTest(d.from);
      if (!d.reply) channel.postMessage({kind: 'HELLO', from: tab, reply: true});
    }
    if (d.kind === 'DONE' && d.to === tab && d.pair === activePair) {
      peerDone = true;
      await verifyPair();
    }
  };
  function sendStorageProbe() {
    localStorage.setItem(notificationKey, prefix + ':' + crypto.randomUUID());
    setTimeout(() => localStorage.removeItem(notificationKey), 75);
  }
  status('BroadcastChannel discovery', 'PENDING', 'open second tab');
  status('cross-tab write notification', 'PENDING', 'open second tab');
  status('cross-tab delete notification', 'PENDING', 'open second tab');
  status('concurrent IndexedDB transaction', 'PENDING', 'open second tab');
  localTests().then(() => {
    const ticker = setInterval(() => {
      if (seen.write && seen.remove && seen.broadcast && seen.transaction) {
        clearInterval(ticker);
        return;
      }
      channel.postMessage({kind: 'HELLO', from: tab, reply: false});
      if (peers.size) sendStorageProbe();
    }, 500);
    window.addEventListener('pagehide', () => {
      clearInterval(ticker);
      channel.close();
      db?.close();
    }, {once: true});
  });
})();
