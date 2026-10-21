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
  'dc313-hmac-lifecycle-probe-v2': 'v0.1.2',
  'dc313-hmac-lifecycle-probe-v3': 'v0.1.3'
};

/**
 * Execute the installed v0.1.4 probe's actual discovery function.
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
    '\n({ discoverLegacyInstances });', context);
  return { ...exposed, witness };
}

test('zero legacy peers reports each supported old protocol', async () => {
  const f = fixture({});
  await f.discoverLegacyInstances();
  assert.equal(f.witness.sent.length, 3);
  assert.deepEqual(new Set(f.witness.closed), new Set(Object.keys(oldChannels)));
  assert.deepEqual(new Set(f.witness.sent.map(x => x.message.type)),
    new Set(['prepare']));
});

test('one v0.1.1 responder is reported without changing lifecycle result', async () => {
  const f = fixture({ 'dc313-hmac-lifecycle-probe-v1': ['legacy-a'] });
  const result = await f.discoverLegacyInstances();
  assert.equal(result['v0.1.0-or-v0.1.1'], 1);
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
  // Positive discovery is advisory; it is not a reject/fail condition.
  assert.equal(Object.values(observed).reduce((a,b)=>a+b,0),6);
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

test('v0.1.3 responders are independently reported from the v3 channel', async () => {
  const f = fixture({ 'dc313-hmac-lifecycle-probe-v3': ['legacy-v3'] });
  const result = await f.discoverLegacyInstances();
  assert.equal(result['v0.1.3'], 1);
  assert.equal(result['v0.1.2'], 0);
});

test('mixed-version legacy responders do not block shipped Stage 1', async () => {
  const a = script.indexOf('  async function begin() {');
  const b = script.indexOf('  async function afterReload() {', a);
  assert.ok(a > 0 && b > a);
  const code = script.slice(a, b);
  const report = [];
  const baseline = [];
  let lifecycleCalls = 0;
  const observation = {
    epoch: 1, generation: 'g1', fingerprint: 'fp1',
    deadline: 1700000000000 + 24 * 3600000,
    events: [{ id: 'cycle-1', reason: 'initial' }]
  };
  const context = {
    busy: false, hour: 3600000,
    crypto: { randomUUID: () => 'unique-test-only-key' },
    Date: { now: () => 1700000000000 },
    participatingInstances: async () => {
      lifecycleCalls++;
      return { local: observation, peers: [observation], participants: 2 };
    },
    equalIdentity: () => true,
    journalsAgree: () => true,
    localStorage: { setItem: (...args) => baseline.push(args) },
    baselineName: 'synthetic-test-baseline',
    show: (...args) => report.push(args),
    // Any accidental reintroduced gate must visibly fail this test.
    assertCurrentProbeOnly: () => {
      throw Error('legacy version mistakenly made a stage gate');
    },
    cryptoLegacy: { existingOldResponders: 5 },
    Error, JSON
  };
  const begin = vm.runInNewContext(code + '\n begin;', context);
  await begin();
  assert.equal(lifecycleCalls, 1);
  assert.equal(baseline.length, 1);
  assert.equal(report.length, 1);
  assert.equal(report[0][1].status, 'PASS');
  assert.equal(report[0][1].baselineSaved, true);
});
