import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modules = [
  '04ba-persistent-hmac-validation.js',
  '04c-persistent-hmac-service.js'
];
const script = modules.map(file => readFileSync(new URL(
  '../src/userscript/02-network-communication/' + file, import.meta.url),
'utf8')).join('\n');
const build = vm.runInNewContext(script +
  '\ncommunicationPersistentHmacService;',
  { Uint8Array, Map, Set, Array, Number, Object, JSON, Error });
const hour = 3600000;

/**
 * Shared persistent record with explicit native-style exclusive admissions.
 * @returns {Object} Restarted service instances and independent state witness.
 */
function fixture() {
  let persisted = null;
  let tail = Promise.resolve();
  const clock = { value: Date.UTC(2026, 9, 21, 14) };
  const authority = {
    capability: 'linearizable-chatgpt-key-record-v2',
    async runExclusive(fn) {
      const prior = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await prior;
      try { return await fn(); }
      finally { release(); }
    }
  };
  const storage = {
    async get(_, fallback) {
      return persisted === null ? fallback : structuredClone(persisted);
    },
    async set(_, value) { persisted = structuredClone(value); }
  };
  return {
    clock,
    open() {
      return build({ authority, storage, crypto: webcrypto,
        now: () => clock.value });
    },
    persisted() { return structuredClone(persisted); },
    inject(value) { persisted = structuredClone(value); }
  };
}

test('unacknowledged capture after tab crash must not be erased on restart', async () => {
  const f = fixture();
  const first = f.open();
  const admission = await first.admit();
  const oldEpoch = admission.metadata.redaction_key_epoch;
  first.dispose(); // Simulate a real tab crash: no Worker terminal receipt.
  f.clock.value += 25 * hour + 1;
  const restart = f.open();
  const state = await restart.status();
  assert.equal(state.state, 'draining');
  assert.equal(state.redaction_key_epoch, oldEpoch);
  assert.equal(state.pending_count, 1);
  assert.equal(f.persisted().next.reason, 'overdue');
  await assert.rejects(restart.admit(), /rotation-draining/);
  assert.equal((await restart.recover()).state, 'DRAINING');
  assert.equal(f.persisted().epoch, 1);
  assert.equal((await restart.cycleEvents()).length, 1);
  await assert.rejects(restart.complete(admission.token),
    /unknown-admission/);
  await assert.rejects(restart.randomize(true), /rotation-draining/);
  assert.equal(f.persisted().pending.length, 1);
  restart.dispose();
});

test('verified-empty interrupted drain resumes one rotation, never duplicates', async () => {
  const f = fixture();
  const first = f.open();
  const admission = await first.admit();
  const initialJournal = await first.cycleEvents();
  assert.equal((await first.randomize(true)).state, 'DRAINING');
  const before = f.persisted();
  assert.equal(before.phase, 'draining');
  assert.equal(before.pending.length, 1);
  // Fixture represents independently verified terminal Worker receipt
  // already reflected in the durable record, but an interrupted commit.
  f.inject({ ...before, pending: [] });
  first.dispose();
  f.clock.value += 100;
  const restart = f.open();
  const observed = await restart.recover();
  assert.equal(observed.state, 'COMMITTED');
  assert.equal(observed.redaction_key_epoch, 2);
  assert.equal(f.persisted().pending.length, 0);
  const journal = await restart.cycleEvents();
  assert.equal(journal.length, 2);
  assert.equal(journal[0].id, initialJournal[0].id);
  assert.equal(journal[1].reason, 'manual');
  assert.equal(journal[1].epoch, 2);
  assert.equal((await restart.recover()).state, 'READY');
  assert.deepEqual(JSON.parse(JSON.stringify(await restart.cycleEvents())),
    JSON.parse(JSON.stringify(journal)));
  restart.dispose();
});
