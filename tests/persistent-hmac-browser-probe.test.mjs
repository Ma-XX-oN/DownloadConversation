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

test('two-tab diagnostic distinguishes stale sync values from shared async GM', async () => {
  const shared = new Map(), sync = [new Map(), new Map()];
  const menus = [new Map(), new Map()], members = new Map(), tails = new Map();
  let counter = 0, done;
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
  const locks = {
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
  };
  for (let tab = 0; tab < 2; tab++) {
    const scope = tab;
    const context = {
      location: { origin: 'https://chatgpt.com' },
      crypto: { randomUUID: () => 'synthetic-' + scope + '-' + ++counter },
      navigator: { locks },
      BroadcastChannel: Broadcast,
      setTimeout: (callback, ms) => setTimeout(callback, Math.min(8, ms)),
      Date, Map, Set, Uint8Array,
      GM_getValue: (key, fallback) =>
        sync[scope].has(key) ? sync[scope].get(key) : fallback,
      GM_setValue: (key, value) =>
        sync[scope].set(key, structuredClone(value)),
      GM: {
        async getValue(key, fallback) {
          return shared.has(key) ? structuredClone(shared.get(key)) : fallback;
        },
        async setValue(key, value) {
          shared.set(key, structuredClone(value));
        }
      },
      GM_registerMenuCommand: (name, callback) => menus[scope].set(name, callback),
      console: { warn() {}, info(label, output) {
        if (scope === 0 && label === 'DC #313 result') {
          const parsed = JSON.parse(output);
          if (parsed.test === 'GM cross-tab diagnostic') done(parsed.result);
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
  assert.equal(report.synchronousGM.expected, 48);
  assert.equal(report.synchronousGM.observed, 24);
  assert.equal(report.synchronousGM.status, 'FAIL');
  assert.equal(report.asynchronousGM.expected, 48);
  assert.equal(report.asynchronousGM.observed, 48);
  assert.equal(report.asynchronousGM.status, 'PASS');
  assert.deepEqual(report.asynchronousGM.errors, []);
  assert.equal(report.visibility.status, 'PASS');
  assert.equal(report.visibility.peerSawLeaderWrite, true);
  assert.equal(report.visibility.leaderSawPeerWrite, true);
  assert.equal(report.status, 'ASYNC_PATH_PASS');
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
