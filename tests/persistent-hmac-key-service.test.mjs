import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../src/userscript/02-network-communication/04c-persistent-hmac-service.js',
  import.meta.url), 'utf8');
const create = vm.runInNewContext(source + '\ncommunicationPersistentHmacService;',
  { Uint8Array, Array, Map, Set, Object, Number, Error, JSON });
const secret = '🔐é';

function fixture() {
  let current = null;
  let failing = null;
  let gate = Promise.resolve();
  let random = 0;
  const events = [];
  const authority = {
    capability: 'linearizable-cross-origin-fenced-v1',
    async runExclusive(fn) {
      const prev = gate;
      let unlock;
      gate = new Promise(resolve => { unlock = resolve; });
      await prev;
      try { return await fn(); }
      finally { unlock(); }
    }
  };
  const storage = {
    async get(_key, fallback) {
      if (failing === 'read') throw Error('simulated storage fault');
      return current === null ? fallback : structuredClone(current);
    },
    async set(_key, value) {
      if (failing === 'write') throw Error('simulated storage fault');
      if (failing === 'ambiguous-write') {
        current = structuredClone(value);
        throw Error('simulated lost acknowledgement');
      }
      if (failing === 'silent-write') return;
      current = structuredClone(value);
      events.push({ phase: value.phase, epoch: value.epoch,
        generation: value.generation, pending: value.pending.length });
    }
  };
  const randomCrypto = {
    getRandomValues(bytes) {
      webcrypto.getRandomValues(bytes);
      random++;
      return bytes;
    }
  };
  return {
    open() { return create({ authority, storage, crypto: randomCrypto }); },
    raw() { return structuredClone(current); },
    setRaw(value) { current = structuredClone(value); },
    fail(value) { failing = value; },
    get events() { return events; },
    get randomCount() { return random; },
    authority, storage, randomCrypto
  };
}

function provision(service, token) {
  let payload;
  service.provision(token, { postMessage(item, transfers) {
    assert.equal(item.type, 'dc-hmac-key-v2');
    assert.equal(item.token, token);
    assert.equal(transfers.length, 1);
    payload = item.key_bytes.slice();
    assert.equal(payload.length, 32);
  } });
  return payload;
}

function digest(key, value) {
  const bytes = Buffer.from(value, 'utf8');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  return createHmac('sha256', key).update('DC-SECRET-ID-V1\0')
    .update(size).update(bytes).digest('hex').slice(0, 48);
}

test('unverified cross-origin authority fails closed before first storage mutation', async () => {
  const f = fixture();
  for (const authority of [null, undefined, { capability: 'web-locks-origin-only',
    runExclusive: f.authority.runExclusive }]) {
    const service = create({ storage: f.storage, authority,
      crypto: f.randomCrypto });
    await assert.rejects(() => service.admit(), /shared-authority-unavailable/);
  }
  assert.equal(f.raw(), null);
  assert.equal(f.randomCount, 0);
});

test('100 racing first-use sessions across two origins converge to one persisted K', async () => {
  const f = fixture();
  const services = Array.from({ length: 100 }, () => f.open());
  const admissions = await Promise.all(services.map(s => s.admit()));
  assert.equal(f.randomCount, 102);
  const scopes = new Set(admissions.map(a => a.metadata.redaction_scope));
  assert.equal(scopes.size, 1);
  assert.equal(f.raw().pending.length, 100);
  assert.equal(f.raw().epoch, 1);
  const keys = services.map((s, i) => provision(s, admissions[i].token));
  assert.equal(new Set(keys.map(key => digest(key, secret))).size, 1);
  assert.ok(admissions.every(a => !JSON.stringify(a).includes(f.raw().key_hex)));
  await Promise.all(services.map((s, i) => s.complete(admissions[i].token)));
  assert.equal(f.raw().pending.length, 0);
  services.forEach(s => s.dispose());
});

test('A→B→A, simulated browser restart, Unicode marker identity is stable', async () => {
  const f = fixture();
  const keyIds = [];
  const scopes = [];
  for (const context of ['chatgpt.com', 'chat.openai.com', 'chatgpt.com']) {
    const service = f.open();
    const admitted = await service.admit();
    scopes.push(admitted.metadata.redaction_scope);
    keyIds.push(digest(provision(service, admitted.token), secret));
    assert.equal(context.length > 0, true);
    await service.complete(admitted.token);
    service.dispose();
  }
  assert.equal(new Set(keyIds).size, 1);
  assert.equal(new Set(scopes).size, 1);
  assert.equal(f.randomCount, 5);
});

test('rotation fences new captures, drains old before new segment, then changes equality', async () => {
  const f = fixture();
  const first = f.open();
  const pending = await first.admit();
  const keyBefore = provision(first, pending.token);
  const second = f.open();
  assert.deepEqual(JSON.parse(JSON.stringify(await second.randomize(true))), {
    state: 'DRAINING', generation: pending.metadata.redaction_scope, epoch: 1
  });
  await assert.rejects(() => second.admit(), /rotation-draining/);
  assert.equal(f.raw().phase, 'draining');
  await first.complete(pending.token);
  assert.equal(f.raw().phase, 'open');
  const after = await second.admit();
  const keyAfter = provision(second, after.token);
  assert.equal(after.metadata.redaction_key_epoch, 2);
  assert.notEqual(after.metadata.redaction_scope, pending.metadata.redaction_scope);
  assert.notEqual(digest(keyBefore, secret), digest(keyAfter, secret));
  await second.complete(after.token);
});

test('two racing explicit rotations serialize: rejected attempt cannot skip epoch', async () => {
  const f = fixture();
  const s1 = f.open();
  const s2 = f.open();
  const a = await s1.admit();
  const attempts = await Promise.allSettled([s1.randomize(true), s2.randomize(true)]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(x => x.status === 'rejected').length, 1);
  await s1.complete(a.token);
  assert.equal(f.raw().epoch, 2);
  assert.equal((await s2.randomize(true)).epoch, 3);
  assert.equal(f.raw().epoch, 3);
  assert.equal(f.raw().phase, 'open');
});

test('unconfirmed rotation, storage outages, malformed data and writeback errors fail', async () => {
  const f = fixture();
  const s = f.open();
  await assert.rejects(() => s.randomize(false), /not-confirmed/);
  f.fail('read');
  await assert.rejects(() => s.admit(), /storage-read-failed/);
  f.fail(null);
  f.setRaw({ format: 'dc-secret-key-record/2', key_hex: 'ab' });
  await assert.rejects(() => s.admit(), /storage-corrupt/);
  assert.equal(f.raw().key_hex, 'ab');
  f.setRaw(null);
  f.fail('write');
  await assert.rejects(() => s.admit(), /storage-write-failed/);
  assert.equal(f.raw(), null);
  f.fail('silent-write');
  await assert.rejects(() => s.admit(), /storage-readback-failed/);
  assert.equal(f.raw(), null);
});

test('ambiguous acknowledged write remains fenced, read reconciliation does not invent success', async () => {
  const f = fixture();
  const s = f.open();
  f.fail('ambiguous-write');
  await assert.rejects(() => s.admit(), /storage-write-failed/);
  assert.ok(f.raw().key_hex);
  f.fail(null);
  const a = await s.admit();
  assert.equal(f.raw().generation, a.metadata.redaction_scope);
  await s.complete(a.token);
  const next = await s.randomize(true);
  assert.equal(next.state, 'COMMITTED');
  assert.equal(f.raw().epoch, 2);
});

test('interrupted rotating storage, stale tab and malformed next record never mix keys', async () => {
  const f = fixture();
  const a = f.open();
  const first = await a.admit();
  const oldScope = first.metadata.redaction_scope;
  const b = f.open();
  assert.equal((await b.randomize(true)).state, 'DRAINING');
  await assert.rejects(() => f.open().admit(), /rotation-draining/);
  assert.equal((await f.open().recover()).state, 'DRAINING');
  await a.complete(first.token);
  assert.equal((await f.open().recover()).state, 'READY');
  assert.notEqual(f.raw().generation, oldScope);
  const corrupt = f.raw();
  corrupt.next = { key_hex: 'ab', generation: 'g', epoch: 5 };
  corrupt.phase = 'draining';
  f.setRaw(corrupt);
  await assert.rejects(() => f.open().admit(), /storage-corrupt/);
});

test('admission provisioning and disposal never expose key via public status', async () => {
  const f = fixture();
  const s = f.open();
  const a = await s.admit();
  const status = await s.status();
  assert.equal(status.redaction_format, 'dc-secret-marker/2');
  assert.equal(status.redaction_key_storage, 'tampermonkey-script-installation');
  assert.equal(JSON.stringify(status).includes(f.raw().key_hex), false);
  assert.throws(() => s.provision('unknown', { postMessage() {} }), /invalid-provision/);
  assert.throws(() => s.provision(a.token, { postMessage() { throw Error('error'); } }),
    /worker-provision-failed/);
  await s.complete(a.token);
  assert.throws(() => s.provision(a.token, { postMessage() {} }), /invalid-provision/);
  s.dispose();
  await assert.rejects(() => s.admit(), /disposed/);
});
