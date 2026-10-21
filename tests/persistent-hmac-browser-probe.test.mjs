import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(
  './manual/dc313-production-key-browser-probe-v13.user.js',
  import.meta.url), 'utf8');

test('signed-in GM diagnostic is parseable and remains synthetic', () => {
  assert.match(source, /@match\s+https:\/\/chatgpt\.com\/\*/);
  assert.match(source, /@grant\s+GM\.getValue/);
  assert.match(source, /@grant\s+GM\.setValue/);
  assert.match(source, /@require\s+https:\/\/raw\.githubusercontent\.com\//);
  assert.match(source, /dc313-probe-exact:/);
  assert.match(source, /DC #313: diagnose GM cross-tab storage/);
  new vm.Script(source, { filename: 'dc313-browser-probe.user.js' });
});

test('diagnostic menu is registered and never auto-starts', () => {
  const menu = [];
  let operations = 0;
  const context = {
    location: { origin: 'https://chatgpt.com' },
    crypto: { randomUUID: () => 'synthetic-tab-unique' },
    BroadcastChannel: class { constructor() { this.onmessage = null; } },
    GM_registerMenuCommand: name => menu.push(name),
    GM_getValue: () => { operations++; },
    GM_setValue: () => { operations++; },
    GM: {
      getValue: async () => { operations++; },
      setValue: async () => { operations++; }
    },
    navigator: {},
    console: { warn() {}, info() {} }
  };
  vm.runInNewContext(source, context);
  assert.ok(menu.includes('DC #313: diagnose GM cross-tab storage'));
  assert.ok(menu.includes('DC #313: run two-tab test'));
  assert.equal(operations, 0);
});

async function runTwoTabDiagnostic(isolatedLocks, staleVisibility = false,
  staleAsyncCounters = false) {
  const shared = new Map(), sync = [new Map(), new Map()];
  const asyncReplicas = [new Map(), new Map()];
  const menus = [new Map(), new Map()], members = new Map(), tails = new Map();
  let counter = 0, done, listenerId = 0, staleReadApplied = false;
  const listeners = new Map();
  const response = new Promise(resolve => { done = resolve; });
  class Broadcast {
    constructor(name) {
      this.name = name;
      if (!members.has(name)) members.set(name, new Set());
      members.get(name).add(this);
      this.onmessage = null;
    }
    postMessage(data) {
      for (const other of members.get(this.name)) {
        if (other !== this) queueMicrotask(() => {
          other.onmessage?.({ data: structuredClone(data) });
        });
      }
    }
  }
  const createLocks = tails => ({
    async request(name, options, callback) {
      assert.equal(options.mode, 'exclusive');
      const previous = tails.get(name) ?? Promise.resolve();
      let release;
      const next = new Promise(resolve => { release = resolve; });
      tails.set(name, previous.then(() => next));
      await previous;
      try { return await callback({ mode: 'exclusive' }); }
      finally { release(); }
    }
  });
  const locks = createLocks(tails);
  const isolated = [createLocks(new Map()), createLocks(new Map())];
  for (let tab = 0; tab < 2; tab++) {
    const scope = tab;
    const context = {
      location: { origin: 'https://chatgpt.com' },
      crypto: { randomUUID: () => 'synthetic-' + scope + '-' + ++counter },
      navigator: { locks: isolatedLocks ? isolated[scope] : locks },
      BroadcastChannel: Broadcast,
      setTimeout: (callback, ms) => setTimeout(callback,
        ms >= 45000 ? ms : Math.min(8, ms)),
      clearTimeout,
      Date, Map, Set, Uint8Array,
      GM_getValue: (key, fallback) =>
        sync[scope].has(key) ? sync[scope].get(key) : fallback,
      GM_setValue: (key, value) =>
        sync[scope].set(key, structuredClone(value)),
      GM: {
        async getValue(key, fallback) {
          if (staleAsyncCounters &&
              key.startsWith('dc313-gm-diag:async:')) {
            return asyncReplicas[scope].get(key) ?? fallback;
          }
          if (staleVisibility && scope === 1 &&
              key.startsWith('dc313-gm-visibility:') &&
              !staleReadApplied && shared.has(key)) {
            staleReadApplied = true;
            return fallback;
          }
          return shared.has(key) ? structuredClone(shared.get(key)) : fallback;
        },
        async setValue(key, value) {
          if (staleAsyncCounters &&
              key.startsWith('dc313-gm-diag:async:')) {
            asyncReplicas[scope].set(key, structuredClone(value));
            return;
          }
          const previous = shared.get(key);
          shared.set(key, structuredClone(value));
          for (const listener of listeners.values()) {
            if (listener.key === key) {
              queueMicrotask(() => listener.callback(key, previous,
                structuredClone(value), listener.scope !== scope));
            }
          }
        }
      },
      GM_addValueChangeListener: (key, callback) => {
        const id = ++listenerId;
        listeners.set(id, { scope, key, callback });
        return id;
      },
      GM_removeValueChangeListener: id => { listeners.delete(id); },
      GM_registerMenuCommand: (name, callback) => menus[scope].set(name, callback),
      console: { warn() {}, info(label, output) {
        if (scope === 0 && label === 'DC #313 result') {
          const parsed = JSON.parse(output);
          if (parsed.test === 'GM cross-tab diagnostic' &&
              parsed.result.status !== 'RUNNING') done(parsed.result);
        }
      } }
    };
    vm.runInNewContext(source, context);
  }
  assert.ok(menus[0].has('DC #313: diagnose GM cross-tab storage'));
  menus[0].get('DC #313: diagnose GM cross-tab storage')();
  const report = await Promise.race([
    response,
    new Promise((_, reject) => setTimeout(() =>
      reject(Error('synthetic two-tab diagnostic timeout')), 9000))
  ]);
  return report;
}

test('two-tab diagnostic distinguishes stale sync values from shared async GM', async () => {
  const report = await runTwoTabDiagnostic(false);
  assert.equal(report.synchronousGM.expected, 48);
  assert.equal(report.synchronousGM.observed, 24);
  assert.equal(report.synchronousGM.status, 'FAIL');
  assert.equal(report.asynchronousGM.expected, 48);
  assert.equal(report.asynchronousGM.observed, 48);
  assert.equal(report.asynchronousGM.status, 'PASS');
  assert.deepEqual(report.asynchronousGM.errors, []);
  assert.equal(report.trace.peersReady, 1);
  assert.equal(report.trace.peersDone, 1);
  assert.equal(report.trace.local.step, 'complete');
  assert.equal(report.trace.peer.step, 'complete');
  assert.equal(report.visibility.status, 'PASS');
  assert.equal(report.visibility.peerSawLeaderWrite, true);
  assert.equal(report.visibility.leaderSawPeerWrite, true);
  assert.equal(report.visibility.peerSawLeaderWriteAfter300ms, true);
  assert.equal(report.visibility.peerSawLeaderWriteAfter1300ms, true);
  assert.equal(report.visibility.leaderSawPeerWriteAfter1500ms, true);
  assert.ok(report.visibility.peerRemoteEvents[0].some(
    event => event.remote && event.sawLeaderValue));
  assert.ok(report.visibility.leaderRemoteEvents.some(
    event => event.remote && event.sawPeerValue));
  assert.equal(report.exclusiveWebLock.status, 'PASS');
  assert.equal(report.exclusiveWebLock.peersAttemptedWhileHeld, 1);
  assert.equal(report.exclusiveWebLock.peersAcquiredEventually, 1);
  assert.equal(report.exclusiveWebLock.peersAcquiredWhileHeld, 0);
  assert.equal(report.status, 'ASYNC_PATH_PASS');
});

test('Chrome v0.9.2 failure signature rejects delayed GM replicas despite exclusive lock', async () => {
  const report = await runTwoTabDiagnostic(false, true, true);
  assert.equal(report.trace.peersReady, 1);
  assert.equal(report.trace.peersDone, 1);
  assert.equal(report.trace.peerErrors, 0);
  assert.equal(report.trace.local.step, 'complete');
  assert.equal(report.trace.peer.step, 'complete');
  for (const mode of [report.synchronousGM, report.asynchronousGM]) {
    assert.equal(mode.status, 'FAIL');
    assert.equal(mode.expected, 48);
    assert.equal(mode.observed, 24);
    assert.equal(mode.observedAfter500ms, 24);
    assert.equal(mode.local.firstRead, 0);
    assert.equal(mode.local.highestPriorRead, 23);
    assert.equal(mode.local.finishedRead, 24);
    assert.equal(mode.peer[0].firstRead, 0);
    assert.equal(mode.peer[0].highestPriorRead, 23);
    assert.equal(mode.peer[0].finishedRead, 24);
    assert.deepEqual(mode.errors, []);
  }
  assert.equal(report.visibility.status, 'FAIL');
  assert.equal(report.visibility.peerSawLeaderWrite, false);
  assert.equal(report.visibility.peerSawLeaderWriteAfter300ms, true);
  assert.equal(report.visibility.peerSawLeaderWriteAfter1300ms, true);
  assert.equal(report.visibility.leaderSawPeerWrite, true);
  assert.ok(report.visibility.peerRemoteEvents[0].some(
    event => event.remote && event.sawLeaderValue));
  assert.equal(report.exclusiveWebLock.status, 'PASS');
  assert.equal(report.exclusiveWebLock.peersAcquiredWhileHeld, 0);
  assert.equal(report.status, 'FAIL');
});

test('Web Lock diagnostic rejects isolated per-tab lock namespaces', async () => {
  const report = await runTwoTabDiagnostic(true);
  assert.equal(report.visibility.status, 'PASS');
  assert.equal(report.exclusiveWebLock.peers, 1);
  assert.equal(report.exclusiveWebLock.peersAttemptedWhileHeld, 1);
  assert.equal(report.exclusiveWebLock.peersAcquiredEventually, 1);
  assert.equal(report.exclusiveWebLock.peersAcquiredWhileHeld, 1);
  assert.equal(report.exclusiveWebLock.status, 'FAIL');
  assert.equal(report.status, 'FAIL');
});

test('visibility fails closed on first stale cross-tab read despite later GM events', async () => {
  const report = await runTwoTabDiagnostic(false, true);
  assert.equal(report.asynchronousGM.status, 'PASS');
  assert.equal(report.exclusiveWebLock.status, 'PASS');
  assert.equal(report.visibility.peerSawLeaderWrite, false);
  assert.equal(report.visibility.peerSawLeaderWriteAfter300ms, true);
  assert.equal(report.visibility.peerSawLeaderWriteAfter1300ms, true);
  assert.equal(report.visibility.status, 'FAIL');
  assert.equal(report.status, 'FAIL');
  assert.ok(report.visibility.peerRemoteEvents[0].some(
    event => event.remote && event.sawLeaderValue));
});

test('all probe outputs are selectable and Copy JSON works without screenshots', async () => {
  const menus = new Map(), elements = [];
  let clipboard = null;
  const create = tag => {
    const element = {
      tag, children: [], style: {}, attributes: {}, textContent: '',
      setAttribute(name, value) { this.attributes[name] = value; },
      appendChild(child) { this.children.push(child); elements.push(child); },
      append(...children) {
        this.children.push(...children);
        elements.push(...children);
      },
      remove() { this.removed = true; },
      focus() { this.focused = true; },
      select() { this.selected = true; }
    };
    elements.push(element);
    return element;
  };
  const document = {
    body: create('body'),
    createElement: create,
    getElementById(id) {
      return elements.find(el => el.id === id && !el.removed) ?? null;
    }
  };
  vm.runInNewContext(source, {
    location: { origin: 'https://chatgpt.com' },
    crypto: { randomUUID: () => 'synthetic-output-only' },
    BroadcastChannel: class { constructor() { this.onmessage = null; } },
    GM_registerMenuCommand: (name, fn) => menus.set(name, fn),
    GM_setClipboard: value => { clipboard = value; },
    document, Date, Map, Set,
    console: { warn() {}, info() {} }
  });
  assert.ok(menus.has('DC #313: show latest results'));
  menus.get('DC #313: show latest results')();
  const field = elements.find(el => el.tag === 'textarea');
  assert.ok(field);
  assert.equal(field.readOnly, true);
  assert.equal(field.selected, true);
  assert.equal(JSON.parse(field.value).result.status, 'NOT_RUN');
  const copy = elements.find(el =>
    el.tag === 'button' && el.textContent === 'Copy JSON');
  const download = elements.find(el =>
    el.tag === 'button' && el.textContent === 'Download JSON');
  assert.ok(copy);
  assert.ok(download);
  await copy.onclick();
  assert.deepEqual(JSON.parse(clipboard), JSON.parse(field.value));
  assert.match(elements.find(el =>
    el.attributes.role === 'status').textContent, /Copied/);
});

test('probe shows RUNNING immediately and reports a stalled lock by timeout', async () => {
  const menu = new Map(), outputs = [];
  const context = {
    location: { origin: 'https://chatgpt.com' },
    crypto: { randomUUID: () => 'synthetic-hung-lock' },
    BroadcastChannel: class { constructor() { this.onmessage = null; } },
    navigator: { locks: { request: () => new Promise(() => {}) } },
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 45000 ? 20 : ms),
    clearTimeout, Date, Map, Set,
    GM_registerMenuCommand: (name, action) => menu.set(name, action),
    GM_setValue: async () => {},
    GM_getValue: () => 0,
    GM: { getValue: async () => 0, setValue: async () => {} },
    console: { warn() {}, info(name, json) {
      if (name === 'DC #313 result') {
        outputs.push(JSON.parse(json).result);
      }
    } }
  };
  vm.runInNewContext(source, context);
  const fn = menu.get('DC #313: diagnose GM cross-tab storage');
  assert.equal(typeof fn, 'function');
  fn();
  assert.equal(outputs[0].status, 'RUNNING');
  await new Promise(resolve => setTimeout(resolve, 45));
  const last = outputs.at(-1);
  assert.equal(last.status, 'INCOMPLETE_TIMEOUT');
  assert.equal(last.trace.local.step, 'initial-lock-request');
  assert.match(last.phase, /synchronous GM counter/);
  assert.match(last.note, /Reload both tabs/);
  assert.ok(outputs.some(value =>
    value.status === 'RUNNING' && value.phase === 'synchronous GM counter'));
});

test('timeout trace isolates stalled GM write after successful lock', async () => {
  const menu = new Map(), outputs = [];
  const context = {
    location: { origin: 'https://chatgpt.com' },
    crypto: { randomUUID: () => 'synthetic-hung-gm' },
    BroadcastChannel: class { constructor() { this.onmessage = null; } },
    navigator: { locks: { request: async (_name, _opts, fn) =>
      fn({ mode: 'exclusive' }) } },
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 45000 ? 20 : ms),
    clearTimeout, Date, Map, Set,
    GM_registerMenuCommand: (name, action) => menu.set(name, action),
    GM_setValue: () => new Promise(() => {}),
    GM_getValue: () => 0,
    GM: { getValue: async () => 0, setValue: async () => {} },
    console: { warn() {}, info(name, json) {
      if (name === 'DC #313 result') outputs.push(JSON.parse(json).result);
    } }
  };
  vm.runInNewContext(source, context);
  menu.get('DC #313: diagnose GM cross-tab storage')();
  await new Promise(resolve => setTimeout(resolve, 45));
  const last = outputs.at(-1);
  assert.equal(last.status, 'INCOMPLETE_TIMEOUT');
  assert.equal(last.phase, 'synchronous GM counter');
  assert.equal(last.trace.local.step, 'initial-GM-write');
});

test('diagnostic identifies a missing peer without assuming GM failure', async () => {
  const menu = new Map(), outputs = [];
  const storage = new Map();
  const context = {
    location: { origin: 'https://chatgpt.com' },
    crypto: { randomUUID: () => 'synthetic-no-peer' },
    BroadcastChannel: class { constructor() { this.onmessage = null; }
      postMessage() {} },
    navigator: { locks: { request: async (_name, _opts, fn) =>
      fn({ mode: 'exclusive' }) } },
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 45000 ? 100 : Math.min(ms, 5)),
    clearTimeout, Date, Map, Set,
    GM_registerMenuCommand: (name, action) => menu.set(name, action),
    GM_setValue: (key, value) => { storage.set(key, value); },
    GM_getValue: (key, fallback) => storage.get(key) ?? fallback,
    GM: { getValue: async () => null, setValue: async () => {} },
    console: { warn() {}, info(name, json) {
      if (name === 'DC #313 result') outputs.push(JSON.parse(json).result);
    } }
  };
  vm.runInNewContext(source, context);
  menu.get('DC #313: diagnose GM cross-tab storage')();
  await new Promise(resolve => setTimeout(resolve, 45));
  const last = outputs.at(-1);
  assert.equal(last.status, 'FAIL');
  assert.match(last.error, /no participating peer/);
  assert.equal(last.trace.peersReady, 0);
  assert.equal(last.trace.local.step, 'waiting-for-peer-ready');
});
