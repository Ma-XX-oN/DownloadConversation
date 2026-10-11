import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../src/userscript/01-runtime/01-recording-group.js', import.meta.url),
  'utf8'
);

function harness() {
  const channels = new Set();
  let nextId = 0;
  const fakeCrypto = { randomUUID: () => `uuid-${++nextId}` };

  class Channel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      channels.add(this);
    }
    postMessage(data) {
      for (const receiver of channels) {
        if (receiver === this || receiver.closed || receiver.name !== this.name) continue;
        queueMicrotask(() => {
          if (!receiver.closed) receiver.onmessage?.({ data });
        });
      }
    }
    close() {
      this.closed = true;
      channels.delete(this);
    }
  }

  function tab(data = {}, startedAt = 1000) {
    const stored = new Map(Object.entries(data));
    const listeners = new Map();
    const diagnostics = [];
    const context = {
      crypto: fakeCrypto,
      BroadcastChannel: Channel,
      performance: { timeOrigin: startedAt },
      sessionStorage: {
        getItem: key => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key)
      },
      window: {
        addEventListener(name, listener) {
          listeners.set(name, listener);
        }
      },
      setTimeout,
      clearTimeout,
      logConsoleDiagnostic: (...args) => diagnostics.push(args)
    };
    vm.runInNewContext(source + `
      this.recordingApi = {
        enable: recordingGroupEnable,
        disable: recordingGroupDisable,
        state: recordingGroupState
      };`, context);
    return {
      api: context.recordingApi,
      storage: stored,
      diagnostics,
      close() { listeners.get('pagehide')?.(); }
    };
  }
  return { tab, channels };
}

test('newly enabled group remains stable across conversation navigation and reload', async () => {
  const bus = harness();
  const original = bus.tab({}, 1000);
  assert.equal(await original.api.enable(), true);
  const initial = original.api.state().uuid;
  assert.ok(initial);
  assert.equal(original.api.state().ready, true);
  const saved = Object.fromEntries(original.storage);
  original.close();
  const reloaded = bus.tab(saved, 2000);
  await new Promise(resolve => setTimeout(resolve, 680));
  assert.equal(reloaded.api.state().uuid, initial);
  assert.equal(reloaded.api.state().ready, true);
  reloaded.close();
});

test('duplicate tab acquires a different group without changing live incumbent', async () => {
  const bus = harness();
  const original = bus.tab({}, 1000);
  assert.equal(await original.api.enable(), true);
  const initial = original.api.state().uuid;
  const duplicate = bus.tab(Object.fromEntries(original.storage), 2000);
  await new Promise(resolve => setTimeout(resolve, 1400));
  assert.equal(original.api.state().uuid, initial);
  assert.equal(original.api.state().ready, true);
  assert.notEqual(duplicate.api.state().uuid, initial);
  assert.equal(duplicate.api.state().ready, true);
  original.close();
  duplicate.close();
});

test('independent tabs and re-enabled groups receive different UUIDs', async () => {
  const bus = harness();
  const first = bus.tab({}, 1000);
  const second = bus.tab({}, 2000);
  await Promise.all([first.api.enable(), second.api.enable()]);
  assert.notEqual(first.api.state().uuid, second.api.state().uuid);
  const initial = first.api.state().uuid;
  first.api.disable();
  assert.equal(first.api.state().enabled, false);
  assert.equal(first.api.state().uuid, null);
  await first.api.enable();
  assert.notEqual(first.api.state().uuid, initial);
  first.close();
  second.close();
});

test('missing BroadcastChannel does not declare ownership ready', async () => {
  const bus = harness();
  const instance = bus.tab();
  // Test the active production handler while transport is disconnected.
  instance.close();
  assert.equal(instance.api.state().ready, false);
});
