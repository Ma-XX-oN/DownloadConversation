// ==UserScript==
// @name         DC #313 Exact HMAC IndexedDB Lifecycle Probe
// @namespace    https://chatgpt.com/dc313-hmac-idb-lifecycle/
// @version      0.1.2
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
  const baselineName = 'dc313-lifecycle-baseline-v2';
  const databaseName = 'dc313-lifecycle-synthetic-only-v1';
  const channel = new BroadcastChannel('dc313-hmac-lifecycle-probe-v2');
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
      storage: scoped, authority, crypto,
      now: typeof time === 'function' ? time : () => time
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
      result: { version: '0.1.2', ...payload }
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
      // Only the frozen, leader-selected cohort may affect this run.
      if (!Array.isArray(msg.peers) || !msg.peers.includes(tabId)) {
        sessions.delete(msg.run);
        return;
      }
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
      if (!state || state.leader || typeof msg.from !== 'string') return;
      if (msg.type === 'ready') {
        if (!state.selected) state.ready.add(msg.from);
      } else if (state.selected?.has(msg.from) &&
          !state.done.has(msg.from) && !state.errors.has(msg.from)) {
        if (msg.type === 'done') state.done.set(msg.from, msg.outcome);
        else state.errors.set(msg.from, String(msg.error));
      }
    }
  };

  /**
   * @param {string} testId - Stable synthetic namespace.
   * @param {string} mode - One test operation.
   * @param {number} time - Common clock across every participant.
   * @returns {Promise<Object>} Leader and all frozen-cohort peer results.
   */
  async function participatingInstances(testId, mode, time) {
    const run = crypto.randomUUID();
    const state = {
      ready: new Set(), selected: null, done: new Map(),
      errors: new Map(), leader: null
    };
    sessions.set(run, state);
    try {
      channel.postMessage({ type: 'prepare', from: tabId, run });
      await delay(850);
      if (!state.ready.size) throw Error('at-least-one-peer-required');
      state.selected = new Set(state.ready);
      const peers = [...state.selected];
      channel.postMessage({
        type: 'start', from: tabId, run, testId, mode, time, peers
      });
      const local = await inspect(testId, mode, time);
      const started = Date.now();
      while (state.done.size + state.errors.size < peers.length &&
          Date.now() - started < 25000) await delay(50);
      if (state.errors.size) {
        throw Error('participant-errors:' +
          JSON.stringify([...state.errors.values()]));
      }
      const missing = peers.filter(id => !state.done.has(id));
      if (missing.length) {
        throw Error('participant-timeout:' + missing.length +
          ' missing out of ' + peers.length);
      }
      return {
        local, peers: peers.map(id => state.done.get(id)),
        participants: peers.length + 1
      };
    } finally { sessions.delete(run); }
  }

  /**
   * @param {Object} pair - Leader and all peer observations.
   * @returns {boolean} Same key identity for every participating instance.
   */
  function equalIdentity(pair) {
    return pair.peers.length > 0 && pair.peers.every(peer =>
      pair.local.generation === peer.generation &&
      pair.local.epoch === peer.epoch &&
      pair.local.fingerprint === peer.fingerprint);
  }

  /**
   * @param {Object} pair - Observations with committed public event journals.
   * @returns {boolean} All peers observed the exact same cycle event records.
   */
  function journalsAgree(pair) {
    return pair.peers.length > 0 && pair.peers.every(peer =>
      JSON.stringify(pair.local.events) === JSON.stringify(peer.events));
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
      const pair = await participatingInstances(testId, 'measure', time);
      const first = pair.local;
      const pass = equalIdentity(pair) && journalsAgree(pair) &&
        first.epoch === 1 &&
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
        status: pass ? 'PASS' : 'FAIL',
        participants: pair.participants,
        allInstancesShareKey: equalIdentity(pair),
        allCycleJournalsAgree: journalsAgree(pair),
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
      const persisted = await participatingInstances(baseline.testId, 'measure', now);
      const stable = equalIdentity(persisted) &&
        persisted.local.generation === baseline.generation &&
        persisted.local.fingerprint === baseline.fingerprint &&
        persisted.local.epoch === 1;
      if (!stable) throw Error('reload-persistent-key-mismatch');

      const future = Math.max(now + 100, baseline.time + 25 * hour + 1);
      // Hold an old capture across the automatic expiry boundary.
      const oldClock = { value: now };
      const oldService = service(baseline.testId, () => oldClock.value);
      const old = await oldService.admit();
      const draining = await participatingInstances(baseline.testId, 'status', future);
      const safeDrain = draining.local.phase === 'draining' &&
        draining.peers.every(peer => peer.phase === 'draining' &&
          peer.eventCount === 1) &&
        draining.local.eventCount === 1 &&
        draining.peers.length > 0;
      // Move the capture's clock forward before releasing the last admission.
      // Otherwise an old frozen `now` backdates the rotation commit and its
      // randomized deadline, so the later simulated `future` rotates again.
      oldClock.value = future;
      await oldService.complete(old.token);
      oldService.dispose();
      if (!safeDrain) throw Error('old-generation-drain-or-journal-failed');

      const overdue = await participatingInstances(baseline.testId, 'measure', future);
      const overdueChecks = {
        sameIdentity: equalIdentity(overdue),
        epochTwo: overdue.local.epoch === 2 &&
          overdue.peers.every(peer => peer.epoch === 2),
        differentGeneration: overdue.local.generation !==
          baseline.generation,
        changedHmac: overdue.local.fingerprint !== baseline.fingerprint,
        journalLengthTwo: overdue.local.events.length === 2,
        overdueReason: overdue.local.events[1]?.reason === 'overdue',
        journalsMatch: journalsAgree(overdue)
      };
      const duePass = Object.values(overdueChecks).every(Boolean);
      if (!duePass) {
        show('DC #313 HMAC lifecycle: reload and rotations', {
          status: 'FAIL', stage: 'overdue',
          realReloadPersistence: stable, pendingDrain: safeDrain,
          overdueChecks, localEpoch: overdue.local.epoch,
          peerEpochs: overdue.peers.map(peer => peer.epoch),
          localReasons: overdue.local.events.map(e => e.reason),
          peerReasons: overdue.peers.map(peer =>
            peer.events.map(e => e.reason))
        });
        return;
      }

      const manualService = service(baseline.testId, future + 1);
      const manualResult = await manualService.randomize(true);
      manualService.dispose();
      if (manualResult.state !== 'COMMITTED' ||
          manualResult.epoch !== 3) throw Error('manual-rotation-not-committed');
      const manual = await participatingInstances(baseline.testId, 'measure', future + 2);
      const manualPass = equalIdentity(manual) &&
        manual.local.epoch === 3 &&
        manual.local.fingerprint !== overdue.local.fingerprint &&
        manual.local.events.length === 3 &&
        manual.local.events[2].reason === 'manual' &&
        journalsAgree(manual) &&
        manual.peers.every(peer => peer.epoch === 3);
      show('DC #313 HMAC lifecycle: reload and rotations', {
        status: manualPass ? 'PASS' : 'FAIL',
        realReloadPersistence: stable, pendingDrain: safeDrain,
        simulatedOverdue25Hours: duePass,
        manualRotation: manualPass, finalEpoch: manual.local.epoch,
        crossInstanceCycleEventsAgree: journalsAgree(manual),
        participants: manual.participants, errors: []
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
    () => {
      const imports = [
        ['IndexedDB storage', typeof communicationPersistentHmacIndexedDbStorage],
        ['IndexedDB authority', typeof communicationPersistentHmacIndexedDbAuthority],
        ['HMAC record validation', typeof communicationPersistentHmacValidated],
        ['HMAC service', typeof communicationPersistentHmacService]
      ];
      const missing = imports.filter(item => item[1] !== 'function')
        .map(item => item[0]);
      show('DC #313 HMAC lifecycle readiness', {
        status: missing.length === 0 ? 'READY' : 'FAIL',
        missing, version: '0.1.2', isolate: databaseName,
        instructions: 'Stage 1 in one tab, reload participants, then stage 2.'
      });
    });
})();
