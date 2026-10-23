import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-control-plane.js',
  import.meta.url), 'utf8');

function tabsFixture() {
  const disk = new Map();
  const listeners = new Map();
  let lastId = 0;
  const tabs = [];
  function createTab() {
    const own = ++lastId;
    const events = [];
    const requests = [];
    const sandbox = {
      location: { origin: 'https://chatgpt.com' },
      VERSION: '1.11.13-issue.318.1',
      GM_getValue: (key, fallback) => disk.has(key) ? disk.get(key) : fallback,
      GM_setValue: (key, value) => {
        const previous = disk.get(key);
        disk.set(key, value);
        for (const entry of listeners.values()) {
          if (entry.key === key) {
            entry.callback(key, previous, value, entry.tabId !== own);
          }
        }
      },
      GM_addValueChangeListener: (key, callback) => {
        const id = ++lastId;
        listeners.set(id, { tabId: own, key, callback });
        return id;
      },
      GM_removeValueChangeListener: id => listeners.delete(id)
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(source + '\\nthis.controls = cscControlsCurrent();', ctx);
    const worker = {
      pause: async () => events.push('pause'),
      configure: async request => {
        requests.push(request);
        return { type: 'csc-comm-configured', schema: request.schema,
          request_id: request.request_id };
      },
      resume: async () => events.push('resume'),
      provisionTarget: { postMessage: () => {} },
      awaitKey: async token => ({ type: 'csc-comm-key-ready', token })
    };
    const t = { own, control: ctx.controls, worker, requests, events };
    tabs.push(t);
    return t;
  }
  return { disk, createTab, tabs, listeners };
}
async function settle() {
  for (let i = 0; i < 12; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}
const options = (mode, binary = false) => ({
  schema: 1, mode, binary, cross_origin: false,
  auth_headers: false, all: false
});

test('real shared GM adapter synchronizes versioned options into another VM tab',
  async () => {
    const f = tabsFixture();
    const a = f.createTab(), b = f.createTab();
    await Promise.all([a.control.init(), b.control.init()]);
    await Promise.all([a.control.bindWorker(a.worker),
      b.control.bindWorker(b.worker)]);
    await a.control.setOptions(options('everything', true), true);
    await settle();
    assert.equal(f.disk.get('dc-csc-capture-options-v1').binary, true);
    for (const t of [a, b]) {
      assert.equal(t.control.snapshot().settings.binary, true);
      assert.equal(t.control.snapshot().settings_applied, true);
      assert.equal(t.requests.at(-1).options.binary, true);
      assert.ok(t.events.includes('pause') && t.events.includes('resume'));
      t.control.dispose();
    }
    assert.equal(f.listeners.size, 0, 'listeners released on tab close');
  });

test('duplicate tab reload consumes persisted scope before Worker configuration',
  async () => {
    const f = tabsFixture();
    const a = f.createTab();
    await a.control.init();
    await a.control.setOptions(options('everything', true), true);
    a.control.dispose();
    const b = f.createTab();
    await b.control.bindWorker(b.worker);
    assert.equal(b.requests[0].options.mode, 'everything');
    assert.equal(b.requests[0].options.binary, true);
    assert.equal(b.control.snapshot().settings_applied, true);
    b.control.dispose();
  });

test('conflicting tab changes converge at last shared settings write',
  async () => {
    const f = tabsFixture();
    const a = f.createTab(), b = f.createTab();
    await Promise.all([a.control.init(), b.control.init()]);
    await Promise.all([a.control.bindWorker(a.worker),
      b.control.bindWorker(b.worker)]);
    await Promise.all([
      a.control.setOptions(options('everything', true), true),
      b.control.setOptions(options('replay-essentials'), false)
    ]);
    await settle();
    const disk = f.disk.get('dc-csc-capture-options-v1');
    for (const t of [a, b]) {
      assert.equal(t.control.snapshot().settings.mode, disk.mode);
      assert.equal(t.control.snapshot().settings.binary, disk.binary);
      assert.equal(t.control.snapshot().settings_applied, true);
      assert.equal(t.requests.at(-1).options.mode, disk.mode);
      t.control.dispose();
    }
  });

test('invalid cross-tab settings updates fail closed, never silently broaden',
  async () => {
    const f = tabsFixture();
    const a = f.createTab(), b = f.createTab();
    await Promise.all([a.control.init(), b.control.init()]);
    await Promise.all([a.control.bindWorker(a.worker),
      b.control.bindWorker(b.worker)]);
    f.disk.set('dc-csc-capture-options-v1',
      { schema: 999, mode: 'everything', all: true });
    for (const item of f.listeners.values()) {
      item.callback('dc-csc-capture-options-v1', options('replay-essentials'),
        f.disk.get('dc-csc-capture-options-v1'), true);
    }
    await settle();
    for (const t of [a, b]) {
      assert.equal(t.control.snapshot().settings_applied, false);
      assert.equal(t.control.snapshot().settings_state, 'failed');
      assert.equal(t.control.snapshot().settings.all, false);
      t.control.dispose();
    }
  });
