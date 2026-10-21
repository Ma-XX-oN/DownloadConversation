import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = '../src/userscript/02-network-communication/';
const files = [
  '04b-persistent-hmac-indexeddb.js',
  '04ba-persistent-hmac-validation.js',
  '04c-persistent-hmac-service.js',
  '04d-persistent-hmac-browser.js'
];
const source = files.map(f => readFileSync(
  new URL(root + f, import.meta.url), 'utf8')).join('\n');
const create = vm.runInNewContext(source +
  '\ncommunicationPersistentHmacService;', {
    Uint8Array, Map, Set, Array, Number, Object, JSON
  });
const hour = 3600000;

/**
 * Ensure the first due interval is exactly 23 hours while generating
 * genuinely different keys and tokens from WebCrypto.
 * @returns {Object} Deterministic clock and coherent shared storage.
 */
function fixture() {
  let record = null;
  let gate = Promise.resolve();
  const crypto = {
    getRandomValues(bytes) {
      if (bytes.length === 4) return bytes.fill(0);
      return webcrypto.getRandomValues(bytes);
    }
  };
  const authority = {
    capability: 'linearizable-chatgpt-key-record-v2',
    async runExclusive(callback) {
      const prev = gate;
      let release;
      gate = new Promise(resolve => { release = resolve; });
      await prev;
      try { return await callback(); }
      finally { release(); }
    }
  };
  const storage = {
    async get(_key, fallback) {
      return record === null ? fallback : structuredClone(record);
    },
    async set(_key, value) { record = structuredClone(value); }
  };
  return {
    open(now) { return create({ storage, authority, crypto, now }); },
    read() { return structuredClone(record); }
  };
}

test('negative: frozen old admission clock backdates a draining commit', async () => {
  const f = fixture();
  const initialTime = Date.UTC(2026, 9, 21, 10);
  const first = f.open(() => initialTime);
  const initial = await first.admit();
  await first.complete(initial.token);
  const oldTime = initialTime + 60000;
  const frozen = f.open(() => oldTime);
  const old = await frozen.admit();
  const future = initialTime + 25 * hour + 1;
  assert.equal((await f.open(() => future).status()).state, 'draining');
  await frozen.complete(old.token);
  assert.equal(f.read().epoch, 2);
  assert.equal(f.read().issued_at_ms, oldTime);
  // This is the exact old probe bug: 23-hour expiry based on OLD time
  // means the first measurement at future schedules a SECOND cycle.
  const actual = await f.open(() => future).admit();
  assert.equal(actual.metadata.redaction_key_epoch, 3);
  assert.deepEqual(f.read().cycle_events.map(e => e.reason),
    ['initial', 'overdue', 'scheduled']);
  await f.open(() => future).status();
});

test('positive: moving the old admission clock before completion rotates once', async () => {
  const f = fixture();
  const initialTime = Date.UTC(2026, 9, 21, 10);
  const first = f.open(() => initialTime);
  const initial = await first.admit();
  await first.complete(initial.token);
  const clock = { value: initialTime + 60000 };
  const old = f.open(() => clock.value);
  const admitted = await old.admit();
  const future = initialTime + 25 * hour + 1;
  assert.equal((await f.open(() => future).status()).state, 'draining');
  clock.value = future;
  await old.complete(admitted.token);
  assert.equal(f.read().issued_at_ms, future);
  const next = await f.open(() => future).admit();
  assert.equal(next.metadata.redaction_key_epoch, 2);
  assert.equal(f.read().cycle_events.length, 2);
  assert.equal(f.read().cycle_events[1].reason, 'overdue');
});
