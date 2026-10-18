// ==UserScript==
// @name         DC #313 Exact Producer HMAC Browser Probe
// @namespace    https://chatgpt.com/dc313-probe/
// @version      0.5.0
// @description  Synthetic HMAC producer, Web Locks, GM and Worker acceptance; no conversation access.
// @match        https://chatgpt.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_registerMenuCommand
// @require      https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/dc329ed82eefd8a815d03b134e59c9e62f128a82/src/userscript/02-network-communication/04c-persistent-hmac-service.js
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';
  const origin = 'https://chatgpt.com';
  const lockName = 'dc313-browser-probe-v1';
  const storageName = 'dc313-probe-counter-v1';
  const channelName = 'dc313-tab-probe-channel-v1';
  const rounds = 24;
  const timeoutMs = 10000;
  const tabId = crypto.randomUUID();
  if (location.origin !== origin) return;
  const channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel(channelName) : null;
  const sessions = new Map();
  let inProgress = false;

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function read() {
    const count = await GM_getValue(storageName, 0);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw Error('probe storage invalid');
    }
    return count;
  }

  async function exclusive(fn) {
    if (typeof navigator.locks?.request !== 'function') {
      throw Error('native Web Locks unavailable in this userscript context');
    }
    return navigator.locks.request(lockName, { mode: 'exclusive' },
      async lock => {
        if (lock?.mode !== 'exclusive') throw Error('exclusive lock denied');
        return fn();
      });
  }

  async function increments() {
    for (let i = 0; i < rounds; i++) {
      await exclusive(async () => {
        const previous = await read();
        await delay(8);
        await GM_setValue(storageName, previous + 1);
        const actual = await read();
        if (actual !== previous + 1) {
          throw Error('write/readback mismatch');
        }
      });
    }
  }

  if (channel) channel.onmessage = async event => {
    const data = event.data;
    if (!data || data.from === tabId || typeof data.run !== 'string') return;
    if (data.type === 'prepare') {
      if (inProgress) return;
      sessions.set(data.run, { leader: data.from });
      channel.postMessage({ type: 'ready', run: data.run, from: tabId });
    } else if (data.type === 'start' &&
        sessions.get(data.run)?.leader === data.from) {
      inProgress = true;
      try {
        await increments();
        channel.postMessage({ type: 'done', run: data.run, from: tabId });
      } catch (error) {
        channel.postMessage({ type: 'error', run: data.run, from: tabId,
          error: String(error) });
      } finally {
        inProgress = false;
        sessions.delete(data.run);
      }
    } else if (data.type === 'ready' || data.type === 'done' ||
        data.type === 'error') {
      const state = sessions.get(data.run);
      if (!state || state.leader) return;
      if (data.type === 'ready') state.ready.add(data.from);
      else if (data.type === 'done') state.done.add(data.from);
      else state.errors.push({ tab: data.from, error: data.error });
    }
  };

  async function runProbe() {
    if (inProgress) return;
    inProgress = true;
    const run = crypto.randomUUID();
    const state = { ready: new Set(), done: new Set(), errors: [] };
    sessions.set(run, state);
    let result;
    try {
      if (!channel) throw Error('BroadcastChannel unavailable');
      await exclusive(async () => { await GM_setValue(storageName, 0); });
      channel.postMessage({ type: 'prepare', run, from: tabId });
      await delay(1200);
      const peers = [...state.ready];
      if (peers.length === 0) throw Error('No second participating tab; open another chatgpt.com tab.');
      channel.postMessage({ type: 'start', run, from: tabId });
      await increments();
      const started = Date.now();
      while (state.done.size + state.errors.length < peers.length &&
          Date.now() - started < timeoutMs) await delay(50);
      const total = await exclusive(read);
      const expected = rounds * (peers.length + 1);
      const pass = state.errors.length === 0 &&
        state.done.size === peers.length && total === expected;
      result = { status: pass ? 'PASS' : 'FAIL', peers: peers.length,
        roundsPerTab: rounds, expected, observed: total,
        responses: state.done.size, errors: state.errors };
    } catch (error) {
      result = { status: 'FAIL', reason: String(error) };
    } finally {
      sessions.delete(run);
      inProgress = false;
    }
    const text = 'DC #313 browser probe: ' + JSON.stringify(result);
    console.info(text);
    alert(text);
  }


  async function testWorkerKeyTransfer() {
    const result = { status: 'FAIL', kind: 'synthetic-worker-transfer' };
    let blobUrl = null;
    let worker = null;
    try {
      if (typeof Worker !== 'function' || typeof Blob !== 'function') {
        throw Error('Worker or Blob is unavailable');
      }
      const workerScript = `self.onmessage = event => {
        try {
          const bytes = event.data?.bytes;
          if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
            throw Error('synthetic 32-byte buffer missing');
          }
          self.postMessage({ success: true, count: bytes.length });
          bytes.fill(0);
        } catch (error) {
          self.postMessage({ success: false, error: String(error) });
        }
      };`;
      blobUrl = URL.createObjectURL(new Blob([workerScript],
        { type: 'text/javascript' }));
      worker = new Worker(blobUrl);
      const payload = crypto.getRandomValues(new Uint8Array(32));
      const acknowledgement = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Worker response timeout')),
          6000);
        worker.onmessage = event => {
          clearTimeout(timer);
          resolve(event.data);
        };
        worker.onerror = event => {
          clearTimeout(timer);
          reject(Error('Worker error: ' + String(event.message)));
        };
        worker.postMessage({ bytes: payload }, [payload.buffer]);
        if (payload.byteLength !== 0) {
          clearTimeout(timer);
          reject(Error('sender buffer was not transferred/detached'));
        }
      });
      if (!acknowledgement?.success || acknowledgement.count !== 32) {
        throw Error('Worker acknowledgement failed: ' +
          String(acknowledgement?.error ?? acknowledgement?.count));
      }
      result.status = 'PASS';
      result.transferredBytes = 32;
      result.senderDetached = true;
    } catch (error) {
      result.error = String(error);
    } finally {
      if (worker) worker.terminate();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
    const message = 'DC #313 Worker probe: ' + JSON.stringify(result);
    console.info(message);
    alert(message);
  }


  // All persisted test records use this probe userscript's own GM namespace.
  // No DownloadConversation recorder key, conversation or network log is read.
  const testStorage = Object.freeze({
    get: (name, fallback) => GM_getValue('dc313-probe-exact:' + name, fallback),
    set: (name, value) => GM_setValue('dc313-probe-exact:' + name, value)
  });
  function makeExactService() {
    return communicationPersistentHmacService({
      storage: testStorage,
      authority: communicationPersistentHmacChatgptAuthority(navigator, location),
      crypto
    });
  }

  async function workerReceipt(service, token) {
    const code = 'self.onmessage = e => {' +
      'const bytes=e.data.key_bytes;' +
      'if(e.data.type!=="dc-hmac-key-v2" ||' +
      '!(bytes instanceof Uint8Array) || bytes.length!==32)' +
      'throw Error("bad test key");' +
      'const n=bytes.length;bytes.fill(0);' +
      'self.postMessage({bytes:n,token:e.data.token});};';
    const url = URL.createObjectURL(new Blob([code],
      { type: 'text/javascript' }));
    const worker = new Worker(url);
    try {
      const reply = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('worker timeout')), 6000);
        worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
        worker.onerror = error => { clearTimeout(timer); reject(error); };
      });
      service.provision(token, worker);
      const ack = await reply;
      if (ack?.bytes !== 32 || ack.token !== token) {
        throw Error('worker key receipt mismatch');
      }
      return 32;
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }

  async function testExactProducer() {
    let first, second;
    let result = { status: 'FAIL', exactSource: 'dc329ed82eefd8a815d03b134e59c9e62f128a82' };
    try {
      first = makeExactService();
      second = makeExactService();
      const previous = await GM_getValue('dc313-probe-previous-scope', null);
      const [a, b] = await Promise.all([first.admit(), second.admit()]);
      const original = a.metadata.redaction_scope;
      if (original !== b.metadata.redaction_scope) throw Error('split first use');
      const restartPreviousScopeMatched = previous === null || previous === original;
      const workerBytes = await workerReceipt(first, a.token);
      const rotating = await second.randomize(true);
      if (rotating.state !== 'DRAINING') throw Error('rotation did not fence');
      await first.complete(a.token);
      await second.complete(b.token);
      const newAdmission = await second.admit();
      const newScope = newAdmission.metadata.redaction_scope;
      if (newScope === original || newAdmission.metadata.redaction_key_epoch !==
          a.metadata.redaction_key_epoch + 1) throw Error('rotation failed');
      await second.complete(newAdmission.token);
      await GM_setValue('dc313-probe-previous-scope', newScope);
      result = { status: restartPreviousScopeMatched ? 'PASS' : 'FAIL',
        generationStableAfterRestart: restartPreviousScopeMatched,
        priorSavedScopeFound: previous !== null,
        sharedScopeBeforeRotation: true,
        rotationDrained: true, workerBytes,
        newEpoch: newAdmission.metadata.redaction_key_epoch,
        newScopeDifferent: newScope !== original };
    } catch (error) { result.error = String(error); }
    finally { first?.dispose(); second?.dispose(); }
    const message = 'DC #313 exact producer probe: ' + JSON.stringify(result);
    console.info(message);
    alert(message);
  }


  // Diagnostic only. Do not treat a local GM_ readback as proof that another
  // tab has observed the committed storage write.
  const diagChannel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('dc313-gm-cross-tab-diag-v1') : null;
  const diagRuns = new Map();
  let diagActive = false;

  async function diagRead(mode, name) {
    const n = mode === 'async' ? await GM.getValue(name, 0)
      : GM_getValue(name, 0);
    if (!Number.isSafeInteger(n) || n < 0) {
      throw Error('invalid '+ mode +' GM counter');
    }
    return n;
  }
  async function diagWrite(mode, name, count) {
    if (mode === 'async') await GM.setValue(name, count);
    else await GM_setValue(name, count);
  }
  async function diagIncrements(mode, name) {
    let first = null, highest = -1;
    for (let i = 0; i < rounds; i++) {
      await exclusive(async () => {
        const previous = await diagRead(mode, name);
        if (first === null) first = previous;
        highest = Math.max(highest, previous);
        await delay(8);
        await diagWrite(mode, name, previous + 1);
        if (await diagRead(mode, name) !== previous + 1) {
          throw Error('local '+mode+' write readback mismatch');
        }
      });
    }
    return { firstRead: first, highestPriorRead: highest,
      finishedRead: await diagRead(mode, name) };
  }

  if (diagChannel) diagChannel.onmessage = async event => {
    const message = event.data;
    if (!message || message.from === tabId ||
        typeof message.run !== 'string') return;
    if (message.type === 'prepare') {
      if (diagActive) return;
      diagRuns.set(message.run, { leader: message.from,
        mode: message.mode, name: message.name });
      diagChannel.postMessage({ type: 'ready', run: message.run,
        from: tabId });
    } else if (message.type === 'start') {
      const state = diagRuns.get(message.run);
      if (!state || state.leader !== message.from || diagActive) return;
      diagActive = true;
      try {
        const detail = await diagIncrements(state.mode, state.name);
        diagChannel.postMessage({ type: 'done', run: message.run,
          from: tabId, detail });
      } catch (error) {
        diagChannel.postMessage({ type: 'error', run: message.run,
          from: tabId, error: String(error) });
      } finally {
        diagRuns.delete(message.run);
        diagActive = false;
      }
    } else if (['ready', 'done', 'error'].includes(message.type)) {
      const state = diagRuns.get(message.run);
      if (!state || state.leader) return;
      if (message.type === 'ready') state.ready.add(message.from);
      if (message.type === 'done') state.done.set(message.from,
        message.detail);
      if (message.type === 'error') state.errors.push({
        tab: message.from, error: message.error });
    }
  };

  async function diagPhase(mode) {
    const run = crypto.randomUUID();
    const name = 'dc313-gm-diag:' + mode + ':' + run;
    const state = { ready: new Set(), done: new Map(), errors: [] };
    diagRuns.set(run, state);
    try {
      await exclusive(async () => { await diagWrite(mode, name, 0); });
      diagChannel.postMessage({ type: 'prepare', run, from: tabId,
        mode, name });
      await delay(1200);
      const peers = [...state.ready];
      if (peers.length < 1) throw Error('no participating peer');
      diagChannel.postMessage({ type: 'start', run, from: tabId });
      const local = await diagIncrements(mode, name);
      const start = Date.now();
      while (state.done.size + state.errors.length < peers.length &&
        Date.now() - start < timeoutMs) await delay(50);
      const observed = await exclusive(() => diagRead(mode, name));
      await delay(500);
      const settled = await exclusive(() => diagRead(mode, name));
      return { mode, status: state.errors.length === 0 &&
        state.done.size === peers.length && observed ===
        rounds * (peers.length + 1) ? 'PASS' : 'FAIL',
        expected: rounds * (peers.length + 1), observed,
        observedAfter500ms: settled, local,
        peer: [...state.done.values()], errors: state.errors };
    } finally {
      diagRuns.delete(run);
    }
  }

  async function diagnoseCrossTabStorage() {
    if (diagActive || inProgress) return;
    diagActive = true;
    const report = { version: '0.5.0', status: 'FAIL' };
    try {
      if (!diagChannel) throw Error('BroadcastChannel unavailable');
      report.synchronousGM = await diagPhase('sync');
      if (typeof GM?.getValue !== 'function' ||
          typeof GM?.setValue !== 'function') {
        throw Error('GM async API unavailable');
      }
      report.asynchronousGM = await diagPhase('async');
      report.status = report.synchronousGM.status === 'PASS' &&
        report.asynchronousGM.status === 'PASS' ? 'PASS' : 'FAIL';
    } catch (error) { report.error = String(error); }
    finally { diagActive = false; }
    console.info('DC #313 GM cross-tab diagnostic', report);
    alert('DC #313 GM diagnostic: ' + JSON.stringify(report));
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('DC #313: diagnose GM cross-tab storage', () => {
      void diagnoseCrossTabStorage();
    });

    GM_registerMenuCommand('DC #313: RESET synthetic producer fixture', () => {
      void (async () => {
        const authority = communicationPersistentHmacChatgptAuthority(
          navigator, location);
        if (!authority) throw Error('native Web Lock unavailable');
        await authority.runExclusive(async () => {
          await GM_setValue('dc313-probe-exact:' +
            'downloadconversation:secret-marker-key-v2', null);
          await GM_setValue('dc313-probe-previous-scope', null);
        });
        alert('DC #313 synthetic fixture reset; real recorder keys untouched');
      })().catch(error => alert('DC #313 fixture reset FAIL: ' + error));
    });
    GM_registerMenuCommand('DC #313: exact producer + rotation + Worker', () => {
      void testExactProducer();
    });
    GM_registerMenuCommand('DC #313: Worker key transfer', () => {
      void testWorkerKeyTransfer();
    });
    GM_registerMenuCommand('DC #313: run two-tab test', () => {
      void runProbe();
    });
    GM_registerMenuCommand('DC #313: save restart marker', () => {
      void (async () => {
        const value = crypto.randomUUID();
        await GM_setValue('dc313-probe-restart-marker-v1', value);
        alert('DC #313 saved synthetic restart marker: ' + value);
      })().catch(error => alert('DC #313 save FAIL: ' + error));
    });
    GM_registerMenuCommand('DC #313: read restart marker', () => {
      void (async () => {
        const value = await GM_getValue('dc313-probe-restart-marker-v1', null);
        alert('DC #313 saved marker now: ' + String(value));
      })().catch(error => alert('DC #313 read FAIL: ' + error));
    });
  } else {
    console.warn('DC #313 probe: Tampermonkey menu API unavailable');
  }
})();
