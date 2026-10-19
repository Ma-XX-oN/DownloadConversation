import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../src/userscript/02-network-communication/04c-persistent-hmac-service.js',
  import.meta.url), 'utf8');

test('production factory refuses ordinary Web Locks plus GM writes', async () => {
  let writes = 0;
  const context = { crypto: webcrypto, Uint8Array, Map, Set,
    location: { origin: 'https://chatgpt.com' },
    navigator: { locks: { request: async (_name, _opts, fn) =>
      fn({ mode: 'exclusive' }) } },
    GM: { getValue: async (_key, fallback) => fallback,
      setValue: async () => { writes++; } }
  };
  const factory = vm.runInNewContext(source +
    '\ncommunicationPersistentHmacCurrentTabService;', context);
  await assert.rejects(() => factory().admit(),
    /shared-authority-unavailable/);
  assert.equal(writes, 0);
});

test('factory rejects only synchronous GM APIs without an acknowledged write', async () => {
  const context = { crypto: webcrypto, Uint8Array, Map, Set,
    location: { origin: 'https://chatgpt.com' },
    navigator: { locks: { request: async (_name, _options, fn) =>
      fn({ mode: 'exclusive' }) } },
    GM_getValue: (_key, fallback) => fallback,
    GM_setValue: (_key, _value) => undefined
  };
  const factory = vm.runInNewContext(source +
    '\ncommunicationPersistentHmacCurrentTabService;', context);
  await assert.rejects(() => factory().admit(), /storage-unavailable/);
});

test('factory blocks admission until asynchronous GM write is acknowledged', async () => {
  const records = new Map();
  let allowCommit;
  let reachedWrite;
  const writeEntered = new Promise(resolve => { reachedWrite = resolve; });
  const commitGate = new Promise(resolve => { allowCommit = resolve; });
  const context = { crypto: webcrypto, Uint8Array, Map, Set,
    location: { origin: 'https://chatgpt.com' },
    navigator: { locks: { request: async (_name, _options, fn) =>
      fn({ mode: 'exclusive' }) } },
    GM: {
      getValue: async (key, fallback) => records.get(key) ?? fallback,
      async setValue(key, value) {
        reachedWrite();
        await commitGate;
        records.set(key, structuredClone(value));
      }
    }
  };
  const factory = vm.runInNewContext(source +
    '\ncommunicationPersistentHmacCurrentTabService;', context);
  const service = factory();
  let admitted = false;
  const pending = service.admit().then(value => {
    admitted = true;
    return value;
  });
  await writeEntered;
  await Promise.resolve();
  assert.equal(admitted, false);
  allowCommit();
  const result = await pending;
  assert.equal(result.metadata.redaction_key_epoch, 1);
  await service.complete(result.token);
  service.dispose();
});

test('production factory refuses an unverified Web-Lock-plus-GM authority', async () => {
  const records = new Map();
  let gmWrites = 0;
  const context = { crypto: webcrypto, Uint8Array, Map, Set,
    location: { origin: 'https://chatgpt.com' },
    navigator: { locks: {
      request: (_name, _opts, fn) => fn({ mode: 'exclusive' })
    } },
    GM: {
      async getValue(key, fallback) { return records.get(key) ?? fallback; },
      async setValue(key, value) {
        gmWrites++;
        records.set(key, structuredClone(value));
      }
    }
  };
  const factory = vm.runInNewContext(source +
    '\ncommunicationPersistentHmacCurrentTabService;', context);
  const producer = factory();
  await assert.rejects(() => producer.admit(),
    /shared-authority-unavailable/);
  assert.equal(gmWrites, 0, 'must not publish a split-brain key');
  assert.equal(records.size, 0);
  producer.dispose();
});
