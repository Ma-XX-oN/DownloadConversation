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

  function tab(data = {}, startedAt = 1000, supportsChannel = true) {
    const stored = new Map(Object.entries(data));
    const listeners = new Map();
    const diagnostics = [];
    const conversation = { id: 'conversation-a' };
    const context = {
      crypto: fakeCrypto,
      currentConversationId: () => conversation.id,
      communicationLogSegmentDirectoryHandle: { name: 'segments-a' },
      BroadcastChannel: supportsChannel ? Channel : undefined,
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
      setInterval,
      clearInterval,
      logConsoleDiagnostic: (...args) => diagnostics.push(args)
    };
    vm.runInNewContext(source + `
      this.recordingApi = {
        enable: recordingGroupEnable,
        disable: recordingGroupDisable,
        state: recordingGroupState,
        track: recordingGroupTrackConversation,
        chats: recordingGroupConversationIds,
        directories: recordingGroupDirectoryNames
      };`, context);
    return {
      api: context.recordingApi,
      storage: stored,
      diagnostics,
      navigate(id, directory = 'segments-a') {
        conversation.id = id;
        context.communicationLogSegmentDirectoryHandle.name = directory;
      },
      close() { listeners.get('pagehide')?.(); },
      restore() { listeners.get('pageshow')?.({ persisted: true }); }
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

test('back-forward cache restoration reclaims the unchanged recording UUID', async () => {
  const bus = harness();
  const original = bus.tab({}, 1000);
  assert.equal(await original.api.enable(), true);
  const initial = original.api.state().uuid;
  original.close();
  assert.equal(original.api.state().ready, false);
  original.restore();
  await new Promise(resolve => setTimeout(resolve, 680));
  assert.equal(original.api.state().uuid, initial);
  assert.equal(original.api.state().ready, true);
  original.close();
});

test('missing BroadcastChannel does not declare ownership ready', async () => {
  const bus = harness();
  const instance = bus.tab({}, 1000, false);
  assert.equal(await instance.api.enable(), false);
  assert.equal(instance.api.state().ready, false);
  assert.ok(instance.diagnostics.some(entry =>
    String(entry[1]).includes('BroadcastChannel unsupported')));
  instance.close();
});

test('single-tab group retains a distinct visited-chat inventory across reloads', async () => {
  const bus = harness();
  const first = bus.tab({}, 1000);
  await first.api.enable();
  const group = first.api.state().uuid;
  assert.equal(first.api.track(), group);
  first.navigate('conversation-b', 'segments-b');
  first.api.track();
  first.navigate('conversation-a');
  first.api.track();
  assert.deepEqual(Array.from(first.api.chats()), [
    'conversation-a', 'conversation-b'
  ]);
  assert.deepEqual(Array.from(first.api.directories()), [
    'segments-a', 'segments-b'
  ]);
  const saved = Object.fromEntries(first.storage);
  first.close();
  const restored = bus.tab(saved, 2000);
  await new Promise(resolve => setTimeout(resolve, 680));
  assert.equal(restored.api.state().uuid, group);
  assert.deepEqual(Array.from(restored.api.chats()), [
    'conversation-a', 'conversation-b'
  ]);
  assert.deepEqual(Array.from(restored.api.directories()), [
    'segments-a', 'segments-b'
  ]);
  restored.close();
});

test('duplicated tab starts an independent conversation inventory', async () => {
  const bus = harness();
  const first = bus.tab({}, 1000);
  await first.api.enable();
  first.api.track();
  const second = bus.tab(Object.fromEntries(first.storage), 2000);
  await new Promise(resolve => setTimeout(resolve, 1400));
  assert.notEqual(second.api.state().uuid, first.api.state().uuid);
  assert.deepEqual(Array.from(second.api.chats()), []);
  assert.deepEqual(Array.from(second.api.directories()), []);
  second.api.track();
  assert.deepEqual(Array.from(second.api.chats()), ['conversation-a']);
  first.close();
  second.close();
});

test('simultaneous restored copies never retain the same live group', async () => {
  const bus = harness();
  const copied = {
    'tm-downloadconversation-one-group-enabled': 'true',
    'tm-downloadconversation-one-group-uuid': 'group-original'
  };
  const first = bus.tab(copied, 1000);
  const second = bus.tab(copied, 2000);
  await new Promise(resolve => setTimeout(resolve, 2100));
  assert.equal(first.api.state().ready, true);
  assert.equal(second.api.state().ready, true);
  assert.notEqual(first.api.state().uuid, second.api.state().uuid);
  assert.equal(first.api.state().uuid, 'group-original');
  first.close();
  second.close();
});

test('old document releasing during refresh preserves the inherited group', async () => {
  const bus = harness();
  const previous = bus.tab({}, 1000);
  await previous.api.enable();
  const id = previous.api.state().uuid;
  const fresh = bus.tab(Object.fromEntries(previous.storage), 2000);
  previous.close();
  await new Promise(resolve => setTimeout(resolve, 680));
  assert.equal(fresh.api.state().uuid, id);
  assert.equal(fresh.api.state().ready, true);
  fresh.close();
});
