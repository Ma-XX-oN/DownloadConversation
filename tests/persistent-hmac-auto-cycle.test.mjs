import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

const source = [
  '04b-persistent-hmac-indexeddb.js',
  '04ba-persistent-hmac-validation.js',
  '04c-persistent-hmac-service.js',
  '04d-persistent-hmac-browser.js'
].map(name => readFileSync(new URL(
  '../src/userscript/02-network-communication/' + name, import.meta.url),
'utf8')).join('\n');
const create = vm.runInNewContext(source +
  '\ncommunicationPersistentHmacService;', {
    Uint8Array, Map, Set, Date, Number, Array, Object, JSON
  });
const hourMs = 3600000;

function fixture() {
  const clock = { value: Date.UTC(2026, 9, 21, 12) };
  let record = null;
  let tail = Promise.resolve();
  const authority = {
    capability: 'linearizable-chatgpt-key-record-v2',
    async runExclusive(fn) {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      try { return await fn(); }
      finally { release(); }
    }
  };
  const storage = {
    async get(name, fallback) {
      return record === null ? fallback : structuredClone(record);
    },
    async set(name, value) { record = structuredClone(value); }
  };
  const open = () => create({
    storage, authority, crypto: webcrypto, now: () => clock.value
  });
  return { clock, open, raw: () => structuredClone(record) };
}

test('initial key receives a cryptographically randomized 23–25h expiry', async () => {
  const f = fixture();
  const s = f.open();
  const admission = await s.admit();
  const record = f.raw();
  assert.ok(record.expires_at_ms >= record.issued_at_ms + 23 * hourMs);
  assert.ok(record.expires_at_ms <= record.issued_at_ms + 25 * hourMs);
  assert.equal((await s.cycleEvents()).length, 1);
  assert.equal((await s.cycleEvents())[0].reason, 'initial');
  await s.complete(admission.token);
  f.clock.value = record.issued_at_ms + 23 * hourMs - 1;
  assert.equal((await f.open().status()).redaction_key_epoch, 1);
  f.clock.value = record.expires_at_ms - 1;
  assert.equal((await f.open().status()).redaction_key_epoch, 1);
  f.clock.value = record.expires_at_ms;
  assert.equal((await f.open().status()).redaction_key_epoch, 2);
  assert.equal((await f.open().cycleEvents(1))[0].reason, 'scheduled');
});

test('startup after 25h rotates once and both log streams share event ID', async () => {
  const f = fixture();
  const first = f.open();
  const admission = await first.admit();
  const previous = admission.metadata.key_restart;
  await first.complete(admission.token);
  f.clock.value += 25 * hourMs + 1;
  const restarted = f.open();
  const current = await restarted.status();
  assert.equal(current.redaction_key_epoch, 2);
  assert.notEqual(current.key_restart, previous);
  const committed = await restarted.cycleEvents();
  assert.equal(committed.length, 2);
  assert.equal(committed[1].reason, 'overdue');
  assert.equal(committed[1].occurred_at_ms, f.clock.value);
  const genRecords = committed.map(event => ({ stream: 'GEN', ...event }));
  const commRecords = committed.map(event => ({ stream: 'COMM', ...event }));
  assert.deepEqual(genRecords.map(e => e.id), commRecords.map(e => e.id));
  assert.deepEqual(genRecords.map(e => e.epoch),
    commRecords.map(e => e.epoch));
  assert.ok(!JSON.stringify(committed).includes(f.raw().key_hex));
  assert.equal((await restarted.status()).redaction_key_epoch, 2);
});

test('rotation drains in-flight captures without a mixed-generation record', async () => {
  const f = fixture();
  const old = f.open();
  const oldAdmission = await old.admit();
  const prior = f.raw();
  f.clock.value = prior.expires_at_ms;
  const another = f.open();
  assert.equal((await another.status()).state, 'draining');
  assert.equal((await another.cycleEvents()).length, 1);
  await assert.rejects(another.admit(), /rotation-draining/);
  await old.complete(oldAdmission.token);
  const event = (await another.cycleEvents(1))[0];
  assert.equal(event.epoch, 2);
  assert.equal(event.reason, 'scheduled');
  const next = await another.admit();
  assert.equal(next.metadata.redaction_key_epoch, 2);
  assert.notEqual(next.metadata.key_restart,
    oldAdmission.metadata.key_restart);
  await another.complete(next.token);
});

test('many overdue tabs converge and manual cycle creates distinct event', async () => {
  const f = fixture();
  const first = f.open();
  const before = await first.admit();
  await first.complete(before.token);
  f.clock.value += 25 * hourMs + 1;
  const tabs = Array.from({ length: 16 }, () => f.open());
  const next = await Promise.all(tabs.map(s => s.admit()));
  assert.equal(new Set(next.map(a => a.metadata.key_restart)).size, 1);
  assert.equal(f.raw().epoch, 2);
  await Promise.all(tabs.map((s, i) => s.complete(next[i].token)));
  assert.equal((await first.randomize(true)).state, 'COMMITTED');
  const committed = await first.cycleEvents(1);
  assert.equal(committed.length, 2);
  assert.equal(committed[0].reason, 'overdue');
  assert.equal(committed[1].reason, 'manual');
  assert.equal(committed[1].epoch, 3);
  assert.notEqual(committed[0].id, committed[1].id);
});
