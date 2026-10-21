// ==UserScript==
// @name         DC #313 Browser Process Restart HMAC Witness
// @namespace    https://chatgpt.com/dc313-browser-restart/
// @version      0.1.0
// @description  Synthetic-origin IndexedDB/Worker HMAC across Chrome closure.
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @require      https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/de934cb66047fd6144e6888939fd83b8d650781e/src/userscript/02-network-communication/04b-persistent-hmac-indexeddb.js
// @require      https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/de934cb66047fd6144e6888939fd83b8d650781e/src/userscript/02-network-communication/04ba-persistent-hmac-validation.js
// @require      https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/de934cb66047fd6144e6888939fd83b8d650781e/src/userscript/02-network-communication/04c-persistent-hmac-service.js
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';
  if (location.origin !== 'https://chatgpt.com') return;
  const key = 'dc313-restart-only-baseline-v1';
  const dbName = 'dc313-restart-only-test-idb-v1';
  const hour = 3600000;
  let running = false;

  /** @param {string} id - Test-only namespace. @returns {Object} Service. */
  function service(id) {
    const api = { open(_ignored, version) {
      return indexedDB.open(dbName, version);
    } };
    const raw = communicationPersistentHmacIndexedDbStorage(api, location);
    const scoped = {
      get(k, fallback) { return raw.get(id + ':' + k, fallback); },
      set(k, v) { return raw.set(id + ':' + k, v); }
    };
    return communicationPersistentHmacService({
      storage: scoped, crypto,
      authority: communicationPersistentHmacIndexedDbAuthority(
        navigator, location, scoped)
    });
  }

  /** @param {Object} s - Service. @param {string} token - Admission.
   * @returns {Promise<string>} Synthetic Worker HMAC fingerprint.
   */
  async function fingerprint(s, token) {
    const code = [
      'self.onmessage = async e => {',
      'const b = e.data.key_bytes;',
      'try {',
      'const k = await crypto.subtle.importKey("raw",b,',
      '  {name:"HMAC",hash:"SHA-256"},false,["sign"]);',
      'const sig = await crypto.subtle.sign("HMAC",k,',
      'new TextEncoder().encode("DC313-process-restart-only"));',
      'b.fill(0);',
      'self.postMessage({value:Array.from(new Uint8Array(sig),',
      'n=>n.toString(16).padStart(2,"0")).join("")});',
      '} catch(err) { b.fill(0); self.postMessage({error:String(err)}); }',
      '}'
    ].join('\n');
    const url = URL.createObjectURL(new Blob([code],
      { type: 'text/javascript' }));
    const worker = new Worker(url);
    try {
      const result = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error('Worker-timeout')), 5000);
        worker.onmessage = e => {
          clearTimeout(timeout);
          if (e.data?.error) reject(Error(e.data.error));
          else resolve(e.data?.value);
        };
        worker.onerror = e => {
          clearTimeout(timeout);
          reject(Error(e.message));
        };
      });
      s.provision(token, worker);
      return await result;
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }

  /**
   * @param {string} id - Isolated test key.
   * @returns {Promise<Object>} Nonsecret identity and journal.
   */
  async function inspect(id) {
    const s = service(id);
    try {
      const admission = await s.admit();
      let digest;
      try { digest = await fingerprint(s, admission.token); }
      finally { await s.complete(admission.token); }
      const status = await s.status();
      const cycles = await s.cycleEvents();
      return {
        digest, generation: admission.metadata.redaction_scope,
        epoch: admission.metadata.redaction_key_epoch,
        expires: status.expires_at_ms,
        pending: status.pending_count,
        eventIds: cycles.map(e => e.id),
        reasons: cycles.map(e => e.reason)
      };
    } finally { s.dispose(); }
  }

  /** @param {string} title - Report title.
   * @param {Object} result - Only nonsecret test output.
   */
  function show(title, result) {
    const json = JSON.stringify({
      test: title, timestamp: new Date().toISOString(),
      result: { version: '0.1.0', ...result }
    }, null, 2);
    const display = () => {
      document.getElementById('dc313-process-restart-report')?.remove();
      const panel = document.createElement('section');
      panel.id = 'dc313-process-restart-report';
      panel.style.cssText = 'position:fixed;inset:10%;z-index:2147483647;' +
        'display:flex;flex-direction:column;gap:8px;padding:16px;' +
        'background:#222;color:white;';
      const field = document.createElement('textarea');
      field.readOnly = true;
      field.value = json;
      field.style.cssText = 'flex:1;color:black;background:white;';
      const copy = document.createElement('button');
      copy.textContent = 'Copy JSON';
      copy.onclick = () => GM_setClipboard(json, 'text');
      const close = document.createElement('button');
      close.textContent = 'Close';
      close.onclick = () => panel.remove();
      panel.append(title, field, copy, close);
      document.body.appendChild(panel);
    };
    if (document.body) display();
    else document.addEventListener('DOMContentLoaded', display, { once: true });
  }

  async function prepare() {
    if (running) return;
    running = true;
    try {
      const id = crypto.randomUUID();
      const first = await inspect(id);
      const pass = first.epoch === 1 && first.pending === 0 &&
        first.reasons.length === 1 && first.reasons[0] === 'initial' &&
        first.expires - Date.now() >= 23 * hour - 60000 &&
        first.expires - Date.now() <= 25 * hour;
      if (pass) localStorage.setItem(key,
        JSON.stringify({ id, first }));
      show('DC #313: prepare full Chrome-process restart', {
        status: pass ? 'PASS' : 'FAIL', baselineSaved: pass,
        epoch: first.epoch, initialCycle: first.reasons[0],
        next: 'Exit ALL Chrome processes; relaunch, then verify.'
      });
    } catch (error) {
      show('DC #313: prepare full Chrome-process restart', {
        status: 'FAIL', error: String(error)
      });
    } finally { running = false; }
  }

  async function verify() {
    if (running) return;
    running = true;
    try {
      const saved = localStorage.getItem(key);
      if (!saved) throw Error('restart-baseline-not-found');
      const before = JSON.parse(saved);
      const now = await inspect(before.id);
      const pass = now.epoch === 1 && now.pending === 0 &&
        now.digest === before.first.digest &&
        now.generation === before.first.generation &&
        JSON.stringify(now.eventIds) ===
          JSON.stringify(before.first.eventIds) &&
        JSON.stringify(now.reasons) ===
          JSON.stringify(before.first.reasons);
      show('DC #313: verify full Chrome-process restart', {
        status: pass ? 'PASS' : 'FAIL', sameHmac: now.digest ===
          before.first.digest, sameGeneration: now.generation ===
          before.first.generation, sameEvents: JSON.stringify(now.eventIds) ===
          JSON.stringify(before.first.eventIds),
        epoch: now.epoch, pending: now.pending
      });
    } catch (error) {
      show('DC #313: verify full Chrome-process restart', {
        status: 'FAIL', error: String(error)
      });
    } finally { running = false; }
  }
  GM_registerMenuCommand('DC #313: prepare full Chrome restart', prepare);
  GM_registerMenuCommand('DC #313: verify full Chrome restart', verify);
})();
