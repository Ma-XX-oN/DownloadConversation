import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL(
  './manual/dc313-exact-hmac-indexeddb-lifecycle.user.js',
  import.meta.url), 'utf8');
const start = script.indexOf('  async function discoverLegacyInstances()');
const end = script.indexOf('  channel.onmessage = async event => {', start);
assert.ok(start > 0 && end > start);
const legacyFunctions = script.slice(start, end);
const oldChannels = {
  'dc313-hmac-lifecycle-probe-v1': 'v0.1.0 or v0.1.1',
  'dc313-hmac-lifecycle-probe-v2': 'v0.1.2'
};

/**
 * Execute the installed v0.1.3 probe's actual discovery functions.
 * @param {Object} peers - Channel name to synthetic responder IDs.
 * @returns {Object} Functions and broadcast witness.
 */
function fixture(peers) {
  const witness = { sent: [], closed: [] };
  class SyntheticBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
    }
    postMessage(message) {
      witness.sent.push({ name: this.name, message });
      // Legacy channel behaviour from installed 0.1.1/0.1.2: 'prepare'
      // elicits 'ready' while idle, with the same run and responder ID.
      if (message.type === 'prepare') {
        for (const from of peers[this.name] || []) {
          this.onmessage?.({ data: {
            type: 'ready', from, run: message.run
          } });
        }
        // An unrelated run may never count toward this scan.
        this.onmessage?.({ data: {
          type: 'ready', from: 'unrelated-run', run: 'other-run'
        } });
      }
    }
    close() { witness.closed.push(this.name); }
  }
  const context = {
    BroadcastChannel: SyntheticBroadcastChannel,
    tabId: 'leader-id',
    crypto: { randomUUID: () => 'legacy-discovery-run' },
    delay: async () => undefined,
    Map, Set, Object, Array, Error, JSON
  };
  const exposed = vm.runInNewContext(legacyFunctions +
    '\n({ discoverLegacyInstances, assertCurrentProbeOnly });', context);
  return { ...exposed, witness };
}

test('zero legacy peers permits lifecycle check with both channels scanned', async () => {
  const f = fixture({});
  await f.assertCurrentProbeOnly();
  assert.equal(f.witness.sent.length, 2);
  assert.deepEqual(new Set(f.witness.closed), new Set(Object.keys(oldChannels)));
  assert.deepEqual(new Set(f.witness.sent.map(x => x.message.type)),
    new Set(['prepare']));
});

test('one v0.1.1 responder is detected; no lifecycle PASS can be claimed', async () => {
  const f = fixture({ 'dc313-hmac-lifecycle-probe-v1': ['legacy-a'] });
  await assert.rejects(f.assertCurrentProbeOnly(),
    /older-probe-instances-active.*v0\.1\.0-or-v0\.1\.1.*:1/);
});

test('one v0.1.2 responder is detected independently', async () => {
  const f = fixture({ 'dc313-hmac-lifecycle-probe-v2': ['legacy-b'] });
  const result = await f.discoverLegacyInstances();
  assert.equal(result['v0.1.2'], 1);
  assert.equal(result['v0.1.0-or-v0.1.1'], 0);
});

test('four old responders plus two mixed-version responders cannot be ignored', async () => {
  const f = fixture({
    'dc313-hmac-lifecycle-probe-v1': ['a', 'b', 'c', 'd'],
    'dc313-hmac-lifecycle-probe-v2': ['e', 'f']
  });
  const observed = await f.discoverLegacyInstances();
  assert.equal(observed['v0.1.0-or-v0.1.1'], 4);
  assert.equal(observed['v0.1.2'], 2);
  await assert.rejects(f.assertCurrentProbeOnly(), /older-probe-instances-active/);
});

test('duplicate legacy notifications are counted once per instance', async () => {
  const f = fixture({
    'dc313-hmac-lifecycle-probe-v1': ['a', 'a', 'b', 'leader-id'],
    'dc313-hmac-lifecycle-probe-v2': ['c', 'c']
  });
  const observed = await f.discoverLegacyInstances();
  assert.equal(observed['v0.1.0-or-v0.1.1'], 2);
  assert.equal(observed['v0.1.2'], 1);
});

test('a silent or busy old instance cannot be detected by legacy probing', async () => {
  // This negative boundary is why no probe claims to enumerate all Chrome
  // tabs merely because its BroadcastChannel handshake saw zero responses.
  const f = fixture({
    'dc313-hmac-lifecycle-probe-v1': [],
    'dc313-hmac-lifecycle-probe-v2': []
  });
  const observed = await f.discoverLegacyInstances();
  assert.equal(observed['v0.1.0-or-v0.1.1'], 0);
  assert.equal(observed['v0.1.2'], 0);
});
