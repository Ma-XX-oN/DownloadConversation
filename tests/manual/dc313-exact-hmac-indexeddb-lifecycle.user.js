// ==UserScript==
// @name         DC #313 Exact HMAC IndexedDB Lifecycle Probe
// @namespace    https://chatgpt.com/dc313-hmac-idb-lifecycle/
// @version      0.1.0
// @description  Synthetic isolated cross-tab/reload/rotation test of exact DC #313 source.
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @require      https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/de934cb66047fd6144e6888939fd83b8d650781e/src/userscript/02-network-communication/04b-persistent-hmac-indexeddb.js
// @require      https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/de934cb66047fd6144e6888939fd83b8d650781e/src/userscript/02-network-communication/04ba-persistent-hmac-validation.js
// @require      https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/de934cb66047fd6144e6888939fd83b8d650781e/src/userscript/02-network-communication/04c-persistent-hmac-service.js
// @require      https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/de934cb66047fd6144e6888939fd83b8d650781e/src/userscript/02-network-communication/04d-persistent-hmac-browser.js
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';
  if (location.origin !== 'https://chatgpt.com') return;
  const baselineName = 'dc313-lifecycle-baseline-v1';
  const databaseName = 'dc313-lifecycle-synthetic-only-v1';
  const channel = new BroadcastChannel('dc313-hmac-lifecycle-probe-v1');
  const tabId = crypto.randomUUID();
  const sessions = new Map();
  const hour = 3600000;
  let busy = false;

  /**
   * @param {string} testId - Synthetic test isolation UUID.
   * @param {number} time - Simulated wall clock for deterministic expiry.
   * @returns {Object} Exact production key lifecycle with isolated storage.
   */
  function service(testId, time) {
    const api = { open(_name, version) {
      return indexedDB.open(databaseName, version);
    } };
    const storage = communicationPersistentHmacIndexedDbStorage(api, location);
    const scoped = {
      get(name, fallback) { return storage.get(testId + ':' + name, fallback); },
      set(name, value) { return storage.set(testId + ':' + name, value); }
    };
    const authority = communicationPersistentHmacIndexedDbAuthority(
      navigator, location, scoped);
    return communicationPersistentHmacService({
      storage: scoped, authority, crypto, now: () => time
    });
  }

  /**
   * @param {Object} s - Production service and admitted token.
   * @param {string} token - Scoped admission token.
   * @returns {Promise<string>} HMAC of fixed synthetic test bytes.
   */
  async function syntheticFingerprint(s, token) {
    const code = [
      'self.onmessage = async function(event) {',
      '  const bytes = event.data.key_bytes;',
      '  try {',
      '    const key = await crypto.subtle.importKey("raw", bytes,',
      '      {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);',
      '    const message = new TextEncoder().encode("DC313-synthetic-only");',
      '    const signed = await crypto.subtle.sign("HMAC", key, message);',
      '    bytes.fill(0);',
      '    const fingerprint = Array.from(new Uint8Array(signed),',
      '      b => b.toString(16).padStart(2,"0")).join("");',
      '    self.postMessage({fingerprint});',
      '  } catch (error) {',
      '    bytes.fill(0);',
      '    self.postMessage({error:String(error)});',
      '  }',
      '};'
    ].join('\n');
    const url = URL.createObjectURL(new Blob([code],
      { type: 'text/javascript' }));
    let worker;
    try {
      worker = new Worker(url);
      const completion = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('worker-ack-timeout')),
          5000);
        worker.onmessage = event => {
          clearTimeout(timer);
          if (event.data?.error) reject(Error(event.data.error));
          else if (typeof event.data?.fingerprint !== 'string') {
            reject(Error('worker-missing-fingerprint'));
          } else resolve(event.data.fingerprint);
        };
        worker.onerror = error => {
          clearTimeout(timer);
          reject(Error('worker-error:' + error.message));
        };
      });
      s.provision(token, worker);
      return await completion;
    } finally {
      if (worker) worker.terminate();
      URL.revokeObjectURL(url);
    }
  }

  /**
   * @param {string} testId - Storage namespace for this run.
   * @param {string} mode - Measure a key or inspect a draining state.
   * @param {number} time - Shared simulated clock.
   * @returns {Promise<Object>} Nonsecret lifecycle observation.
   */
  async function inspect(testId, mode, time) {
    const s = service(testId, time);
    try {
      if (mode === 'status') {
        const state = await s.status();
        const events = await s.cycleEvents();
        return { phase: state.state, epoch: state.redaction_key_epoch,
          eventCount: events.length };
      }
      const admission = await s.admit();
      let fingerprint;
      try { fingerprint = await syntheticFingerprint(s, admission.token); }
      finally { await s.complete(admission.token); }
      const state = await s.status();
      const events = await s.cycleEvents();
      return {
        generation: admission.metadata.redaction_scope,
        epoch: admission.metadata.redaction_key_epoch,
        fingerprint,
        deadline: state.expires_at_ms,
        events: events.map(e => ({
          id: e.id, generation: e.generation, epoch: e.epoch,
          occurred_at_ms: e.occurred_at_ms, reason: e.reason
        }))
      };
    } finally { s.dispose(); }
  }

  /**
   * @param {number} ms - Delay.
   * @returns {Promise<void>} Resolved after delay.
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * @param {string} title - Result title.
   * @param {Object} payload - Synthetic-only JSON.
   * @returns {void} Display copyable report.
   */
  function show(title, payload) {
    const json = JSON.stringify({
      test: title, timestamp: new Date().toISOString(),
      result: { version: '0.1.0', ...payload }
    }, null, 2);
    const render = () => {
      document.getElementById('dc313-hmac-lifecycle-report')?.remove();
      const panel = document.createElement('section');
      panel.id = 'dc313-hmac-lifecycle-report';
      panel.style.cssText = 'position:fixed;inset:10%;z-index:2147483647;' +
        'background:#222;color:#fff;padding:16px;display:flex;' +
        'flex-direction:column;gap:10px;border:2px solid #aaa;';
      const label = document.createElement('strong');
      label.textContent = title;
      const field = document.createElement('textarea');
      field.readOnly = true;
      field.value = json;
      field.style.cssText = 'flex:1;min-height:180px;color:#000;' +
        'background:#fff;font:13px monospace;';
      const copy = document.createElement('button');
      copy.textContent = 'Copy JSON';
      copy.onclick = () => GM_setClipboard(json, 'text');
      const close = document.createElement('button');
      close.textContent = 'Close';
      close.onclick = () => panel.remove();
      panel.append(label, field, copy, close);
      document.body.appendChild(panel);
      field.select();
    };
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  channel.onmessage = async event => {
    const msg = event.data;
    if (!msg || msg.from === tabId || typeof msg.run !== 'string') return;
    if (msg.type === 'prepare' && !busy) {
      sessions.set(msg.run, { leader: msg.from });
      channel.postMessage({ type: 'ready', from: tabId, run: msg.run });
    } else if (msg.type === 'start') {
      const state = sessions.get(msg.run);
      if (!state || state.leader !== msg.from || busy) return;
      busy = true;
      try {
        const outcome = await inspect(msg.testId, msg.mode, msg.time);
        channel.postMessage({
          type: 'done', from: tabId, run: msg.run, outcome
        });
      } catch (error) {
        channel.postMessage({
          type: 'error', from: tabId, run: msg.run, error: String(error)
        });
      } finally {
        busy = false;
        sessions.delete(msg.run);
      }
    } else if (['ready', 'done', 'error'].includes(msg.type)) {
      const state = sessions.get(msg.run);
      if (!state || state.leader) return;
      if (msg.type === 'ready') state.ready.add(msg.from);
      if (msg.type === 'done') state.done.set(msg.from, msg.outcome);
      if (msg.type === 'error') state.errors.push(msg.error);
    }
  };

  /**
   * @param {string} testId - Stable synthetic namespace.
   * @param {string} mode - One test operation.
   * @param {number} time - Common clock across both tabs.
   * @returns {Promise<Object>} Local and peer results.
   */
  async function twoTabs(testId, mode, time) {
    const run = crypto.randomUUID();
    const state = { ready: new Set(), done: new Map(), errors: [] };
    sessions.set(run, state);
    try {
      channel.postMessage({ type: 'prepare', from: tabId, run });
      await delay(850);
      if (state.ready.size !== 1) {
        throw Error('expected-exactly-one-peer:' + state.ready.size);
      }
      channel.postMessage({
        type: 'start', from: tabId, run, testId, mode, time
      });
      const local = await inspect(testId, mode, time);
      const started = Date.now();
      while (state.done.size + state.errors.length < 1 &&
          Date.now() - started < 12000) await delay(50);
      if (state.errors.length) throw Error('peer:' + state.errors.join(';'));
      if (state.done.size !== 1) throw Error('peer-timeout');
      return { local, peer: [...state.done.values()][0] };
    } finally { sessions.delete(run); }
  }

  /**
   * @param {Object} pair - Paired key observations.
   * @returns {boolean} Exact same epoch, generation and HMAC fingerprint.
   */
  function equalIdentity(pair) {
    return pair.local.generation === pair.peer.generation &&
      pair.local.epoch === pair.peer.epoch &&
      pair.local.fingerprint === pair.peer.fingerprint;
  }

  /**
   * @returns {Promise<void>} Initial two-tab key and journal witness.
   */
  async function begin() {
    if (busy) return;
    busy = true;
    try {
      const testId = crypto.randomUUID();
      const time = Date.now();
      const pair = await twoTabs(testId, 'measure', time);
      const first = pair.local;
      const pass = equalIdentity(pair) && first.epoch === 1 &&
        first.events.length === 1 &&
        first.events[0].reason === 'initial' &&
        first.deadline - time >= 23 * hour &&
        first.deadline - time <= 25 * hour;
      if (pass) {
        // Stores only synthetic HMAC fingerprint and public generation.
        localStorage.setItem(baselineName, JSON.stringify({
          testId, time, generation: first.generation,
          fingerprint: first.fingerprint, deadline: first.deadline
        }));
      }
      show('DC #313 HMAC lifecycle: initial two-tab', {
        status: pass ? 'PASS' : 'FAIL', twoTabs: equalIdentity(pair),
        epoch: first.epoch, initialEvent: first.events[0]?.reason,
        deadlineInRange: first.deadline - time >= 23 * hour &&
          first.deadline - time <= 25 * hour,
        baselineSaved: pass, next: 'Reload both tabs; then run stage 2.'
      });
    } catch (error) {
      show('DC #313 HMAC lifecycle: initial two-tab', {
        status: 'FAIL', error: String(error)
      });
    } finally { busy = false; }
  }

  /**
   * @returns {Promise<void>} Actual reload, overdue and manual rotation.
   */
  async function afterReload() {
    if (busy) return;
    busy = true;
    try {
      const saved = localStorage.getItem(baselineName);
      if (!saved) throw Error('stage-1-baseline-missing');
      const baseline = JSON.parse(saved);
      const now = Date.now();
      const persisted = await twoTabs(baseline.testId, 'measure', now);
      const stable = equalIdentity(persisted) &&
        persisted.local.generation === baseline.generation &&
        persisted.local.fingerprint === baseline.fingerprint &&
        persisted.local.epoch === 1;
      if (!stable) throw Error('reload-persistent-key-mismatch');

      const future = Math.max(now + 100, baseline.time + 25 * hour + 1);
      // Hold an old capture across the automatic expiry boundary.
      const oldService = service(baseline.testId, now);
      const old = await oldService.admit();
      const draining = await twoTabs(baseline.testId, 'status', future);
      const safeDrain = draining.local.phase === 'draining' &&
        draining.peer.phase === 'draining' &&
        draining.local.eventCount === 1 &&
        draining.peer.eventCount === 1;
      await oldService.complete(old.token);
      oldService.dispose();
      if (!safeDrain) throw Error('old-generation-drain-or-journal-failed');

      const overdue = await twoTabs(baseline.testId, 'measure', future);
      const duePass = equalIdentity(overdue) &&
        overdue.local.epoch === 2 &&
        overdue.local.generation !== baseline.generation &&
        overdue.local.fingerprint !== baseline.fingerprint &&
        overdue.local.events.length === 2 &&
        overdue.local.events[1].reason === 'overdue' &&
        JSON.stringify(overdue.local.events) ===
          JSON.stringify(overdue.peer.events);
      if (!duePass) throw Error('overdue-cycle-or-journal-mismatch');

      const manualService = service(baseline.testId, future + 1);
      const manualResult = await manualService.randomize(true);
      manualService.dispose();
      if (manualResult.state !== 'COMMITTED' ||
          manualResult.epoch !== 3) throw Error('manual-rotation-not-committed');
      const manual = await twoTabs(baseline.testId, 'measure', future + 2);
      const manualPass = equalIdentity(manual) &&
        manual.local.epoch === 3 &&
        manual.local.fingerprint !== overdue.local.fingerprint &&
        manual.local.events.length === 3 &&
        manual.local.events[2].reason === 'manual' &&
        JSON.stringify(manual.local.events) ===
          JSON.stringify(manual.peer.events);
      show('DC #313 HMAC lifecycle: reload and rotations', {
        status: manualPass ? 'PASS' : 'FAIL',
        realReloadPersistence: stable, pendingDrain: safeDrain,
        simulatedOverdue25Hours: duePass,
        manualRotation: manualPass, finalEpoch: manual.local.epoch,
        crossTabCycleEventsAgree: manualPass, errors: []
      });
    } catch (error) {
      show('DC #313 HMAC lifecycle: reload and rotations', {
        status: 'FAIL', error: String(error)
      });
    } finally { busy = false; }
  }

  GM_registerMenuCommand('DC #313: HMAC lifecycle stage 1 (two tabs)', begin);
  GM_registerMenuCommand('DC #313: HMAC lifecycle stage 2 (after reload)',
    afterReload);
  GM_registerMenuCommand('DC #313: HMAC lifecycle probe readiness',
    () => show('DC #313 HMAC lifecycle readiness', {
      status: 'READY', version: '0.1.0', isolate: databaseName,
      instructions: 'Stage 1 in Tab 1; reload both; stage 2 in Tab 1.'
    }));
})();
