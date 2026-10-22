import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = [
  '../src/userscript/02-network-communication/04b-persistent-hmac-indexeddb.js',
  '../src/userscript/02-network-communication/04ba-persistent-hmac-validation.js',
  '../src/userscript/02-network-communication/04c-persistent-hmac-service.js',
  '../src/userscript/02-network-communication/04d-persistent-hmac-browser.js'
].map(name => readFileSync(new URL(name, import.meta.url), 'utf8'))
  .join('\n');
const functions = vm.runInNewContext(source + '\n({ service: communicationPersistentHmacService, authority: communicationPersistentHmacChatgptAuthority });',
  { Uint8Array, Array, Map, Set, Object, Number, Error, JSON });
const create = functions.service;
const makeAuthority = functions.authority;
const secret = '🔐é';
function fixture() {
  let current = null;
  let failing = null;
  let gate = Promise.resolve();
  let random = 0;
  const events = [];
  const authority = {
    capability: 'linearizable-chatgpt-key-record-v2',
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
        key_restart: new Date(value.issued_at_ms).toISOString(), pending: value.pending.length });
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
test('missing or unverified same-origin authority fails closed before first mutation', async () => {
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
test('100 racing first-use sessions across chatgpt.com tabs converge to one persisted K', async () => {
  const f = fixture();
  const services = Array.from({ length: 100 }, () => f.open());
  const admissions = await Promise.all(services.map(s => s.admit()));
  assert.equal(f.randomCount, 102);
  const scopes = new Set(admissions.map(a => a.metadata.key_restart));
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
  for (const context of ['chatgpt.com', 'chatgpt.com', 'chatgpt.com']) {
    const service = f.open();
    const admitted = await service.admit();
    scopes.push(admitted.metadata.key_restart);
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
    state: 'DRAINING', key_restart: pending.metadata.key_restart, epoch: 1
  });
  await assert.rejects(() => second.admit(), /rotation-draining/);
  assert.equal(f.raw().phase, 'draining');
  await first.complete(pending.token);
  assert.equal(f.raw().phase, 'open');
  const after = await second.admit();
  const keyAfter = provision(second, after.token);
  assert.equal(after.metadata.redaction_key_epoch, 2);
  assert.notEqual(after.metadata.key_restart, pending.metadata.key_restart);
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
  f.setRaw({ format: 'dc-secret-key-record/3', key_hex: 'ab' });
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
  assert.equal(new Date(f.raw().issued_at_ms).toISOString(), a.metadata.key_restart);
  await s.complete(a.token);
  const next = await s.randomize(true);
  assert.equal(next.state, 'COMMITTED');
  assert.equal(f.raw().epoch, 2);
});

test('interrupted rotating storage, stale tab and malformed next record never mix keys', async () => {
  const f = fixture();
  const a = f.open();
  const first = await a.admit();
  const oldScope = first.metadata.key_restart;
  const b = f.open();
  assert.equal((await b.randomize(true)).state, 'DRAINING');
  await assert.rejects(() => f.open().admit(), /rotation-draining/);
  assert.equal((await f.open().recover()).state, 'DRAINING');
  await a.complete(first.token);
  assert.equal((await f.open().recover()).state, 'READY');
  assert.notEqual(new Date(f.raw().issued_at_ms).toISOString(), oldScope);
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
  assert.equal(status.redaction_key_storage, 'chatgpt-origin-indexeddb');
  assert.equal(JSON.stringify(status).includes(f.raw().key_hex), false);
  assert.throws(() => s.provision('unknown', { postMessage() {} }), /invalid-provision/);
  assert.throws(() => s.provision(a.token, { postMessage() { throw Error('error'); } }),
    /worker-provision-failed/);
  await s.complete(a.token);
  assert.throws(() => s.provision(a.token, { postMessage() {} }), /invalid-provision/);
  s.dispose();
  await assert.rejects(() => s.admit(), /disposed/);
});


test('native Web Locks adapter enforces chatgpt.com origin and exclusive lifetime', async () => {
  assert.equal(makeAuthority({ locks: { request() {} } },
    { origin: 'https://chat.openai.com' }), null);
  assert.equal(makeAuthority({ locks: { request() {} } },
    { origin: 'http://chatgpt.com' }), null);
  assert.equal(makeAuthority({}, { origin: 'https://chatgpt.com' }), null);
  let previous = Promise.resolve();
  let active = 0;
  let peak = 0;
  const observedNames = new Set();
  const browserNavigator = { locks: {
    async request(name, options, callback) {
      assert.equal(options.mode, 'exclusive');
      observedNames.add(name);
      const wait = previous;
      let release;
      previous = new Promise(resolve => { release = resolve; });
      await wait;
      try { return await callback({ mode: 'exclusive' }); }
      finally { release(); }
    }
  } };
  const origin = { origin: 'https://chatgpt.com' };
  const authorities = Array.from({ length: 100 }, () =>
    makeAuthority(browserNavigator, origin));
  assert.ok(authorities.every(a =>
    a.capability === 'exclusive-chatgpt-web-lock-only-v1'));
  await Promise.all(authorities.map((a, i) => a.runExclusive(async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    assert.equal(active, 1);
    active--;
    return i;
  })));
  assert.equal(peak, 1);
  assert.equal(observedNames.size, 1);
  const other = makeAuthority(browserNavigator, origin);
  origin.origin = 'https://chat.openai.com';
  await assert.rejects(() => other.runExclusive(() => {}),
    /origin-or-callback-invalid/);
});

test('failed Web Lock callback releases fence and no lock fails closed', async () => {
  let completed = 0;
  const navigator = { locks: {
    async request(name, options, callback) {
      completed++;
      return callback({ mode: 'exclusive' });
    }
  } };
  const authority = makeAuthority(navigator, { origin: 'https://chatgpt.com' });
  await assert.rejects(() => authority.runExclusive(() => {
    throw Error('abort');
  }), /abort/);
  await authority.runExclusive(() => { completed++; });
  assert.equal(completed, 3);
  navigator.locks.request = async (_name, _options, callback) => callback(null);
  await assert.rejects(() => authority.runExclusive(() => {}),
    /web-lock-not-acquired/);
});

test('disposed service waiting for native lock never admits or creates a key', async () => {
  const f = fixture();
  let unlock;
  const held = f.authority.runExclusive(() => new Promise(resolve => {
    unlock = resolve;
  }));
  await Promise.resolve();
  const service = f.open();
  const waiting = service.admit();
  service.dispose();
  unlock();
  await held;
  await assert.rejects(waiting, /disposed/);
  assert.equal(f.raw(), null);
  assert.equal(f.randomCount, 0);
});

test('dispose during admission commit releases an undisclosed pending token', async () => {
  const f = fixture();
  const service = f.open();
  const persist = f.storage.set;
  let disposedOnCommit = false;
  f.storage.set = async (name, value) => {
    await persist(name, value);
    if (!disposedOnCommit && value.pending.length === 1) {
      disposedOnCommit = true;
      service.dispose();
    }
  };
  await assert.rejects(() => service.admit(), /disposed/);
  assert.equal(disposedOnCommit, true);
  assert.equal(f.raw().phase, 'open');
  assert.equal(f.raw().pending.length, 0);
  const replacement = f.open();
  const newCapture = await replacement.admit();
  assert.equal(newCapture.metadata.redaction_key_epoch, 1);
  await replacement.complete(newCapture.token);
  replacement.dispose();
});

test('ambiguous pending-admission commit is reconciled without token leakage', async () => {
  const f = fixture();
  const s = f.open();
  const persist = f.storage.set;
  let lostAck = false;
  f.storage.set = async (name, value) => {
    await persist(name, value);
    if (!lostAck && value.pending.length === 1) {
      lostAck = true;
      throw Error('simulated lost acknowledgement after commit');
    }
  };
  await assert.rejects(() => s.admit(), /storage-write-failed/);
  assert.equal(lostAck, true);
  assert.equal(f.raw().pending.length, 0);
  const recovered = f.open();
  const admitted = await recovered.admit();
  assert.equal(admitted.metadata.redaction_key_epoch, 1);
  await recovered.complete(admitted.token);
  recovered.dispose();
  assert.equal(f.raw().pending.length, 0);
});

test('failed second admission rollback cannot delete another tab pending capture', async () => {
  const f = fixture();
  const first = f.open();
  const held = await first.admit();
  const persist = f.storage.set;
  let injected = false;
  f.storage.set = async (name, value) => {
    await persist(name, value);
    if (!injected && value.pending.length === 2) {
      injected = true;
      throw Error('lost acknowledgement');
    }
  };
  const second = f.open();
  await assert.rejects(() => second.admit(), /storage-write-failed/);
  assert.equal(injected, true);
  assert.equal(f.raw().pending.length, 1);
  assert.equal(f.raw().pending[0], held.token);
  await first.complete(held.token);
  assert.equal(f.raw().pending.length, 0);
  first.dispose();
  second.dispose();
});

test('Randomize reconciles committed rotation after lost GM acknowledgement', async () => {
  const f = fixture();
  const s = f.open();
  const first = await s.admit();
  await s.complete(first.token);
  const persist = f.storage.set;
  let droppedAck = false;
  f.storage.set = async (name, value) => {
    await persist(name, value);
    if (!droppedAck && value.epoch === 2 && value.phase === 'open') {
      droppedAck = true;
      throw Error('lost GM set acknowledgement');
    }
  };
  const result = await s.randomize(true);
  assert.equal(droppedAck, true);
  assert.equal(result.state, 'COMMITTED');
  assert.equal(result.epoch, 2);
  assert.equal(f.raw().epoch, 2);
  assert.equal(result.key_restart, new Date(f.raw().issued_at_ms).toISOString());
  assert.notEqual(result.key_restart, first.metadata.key_restart);
  s.dispose();
});

test('Randomize rejects uncommitted failed write rather than invent new scope', async () => {
  const f = fixture();
  const s = f.open();
  const first = await s.admit();
  await s.complete(first.token);
  f.fail('write');
  await assert.rejects(() => s.randomize(true), /storage-write-failed/);
  assert.equal(f.raw().epoch, 1);
  assert.equal(new Date(f.raw().issued_at_ms).toISOString(), first.metadata.key_restart);
  f.fail(null);
  const result = await s.randomize(true);
  assert.equal(result.epoch, 2);
  s.dispose();
});

test('completion tolerates disposal while GM write is pending', async () => {
  const f = fixture(), s = f.open(), a = await s.admit();
  const original = f.storage.set;
  let proceed, reached;
  const pause = new Promise(resolve => { proceed = resolve; });
  const started = new Promise(resolve => { reached = resolve; });
  f.storage.set = async (key, item) => {
    if (item.pending.length === 0) { reached(); await pause; }
    await original(key, item);
  };
  const completion = s.complete(a.token);
  await started;
  s.dispose();
  proceed();
  await completion;
  assert.equal(f.raw().pending.length, 0);
});

test('complete reconciles committed GM write with lost acknowledgement', async () => {
  const f = fixture(), s = f.open(), a = await s.admit();
  const original = f.storage.set;
  f.storage.set = async (name, value) => {
    await original(name, value);
    if (value.pending.length === 0) throw Error('lost ack');
  };
  await s.complete(a.token);
  assert.equal(f.raw().pending.length, 0);
});

test('negative control: serialized locks do not make stale GM replicas coherent', async () => {
  // This fixture models the actual observed browser failure, not a successful
  // production acceptance criterion. Each tab reads back its own acknowledged
  // GM write while remote propagation is delayed indefinitely.
  const sharedLock = fixture().authority;
  const replicas = [new Map(), new Map()];
  const mkStorage = tab => ({
    async get(key, fallback) {
      const item = replicas[tab].get(key);
      return item === undefined ? fallback : structuredClone(item);
    },
    async set(key, value) {
      replicas[tab].set(key, structuredClone(value));
    }
  });
  const first = create({ authority: sharedLock, storage: mkStorage(0),
    crypto: webcrypto });
  const second = create({ authority: sharedLock, storage: mkStorage(1),
    crypto: webcrypto });
  const a = await first.admit();
  const b = await second.admit();
  try {
    // Both operations acquired the SAME exclusive authority sequentially
    // and passed their local post-write readback, yet established two keys.
    // Split-brain is proved by differing keyed digests, not by clock time.
    assert.equal(a.metadata.redaction_key_epoch, 1);
    assert.equal(b.metadata.redaction_key_epoch, 1);
    const firstKey = provision(first, a.token);
    const secondKey = provision(second, b.token);
    assert.notDeepEqual(firstKey, secondKey);
    assert.notEqual(digest(firstKey, secret), digest(secondKey, secret));
  } finally {
    await first.complete(a.token);
    await second.complete(b.token);
    first.dispose();
    second.dispose();
  }
});
