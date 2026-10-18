import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../src/userscript/02-network-communication/04c-persistent-hmac-service.js',
  import.meta.url), 'utf8');

test('production factory uses GM storage under origin Web Locks', async () => {
  const records = new Map();
  let tail = Promise.resolve();
  const context = { crypto: webcrypto, Uint8Array, Map, Set,
    location: { origin: 'https://chatgpt.com' },
    navigator: { locks: { async request(_name, options, fn) {
      assert.equal(options.mode, 'exclusive');
      const before = tail;
      let done;
      tail = new Promise(resolve => { done = resolve; });
      await before;
      try { return await fn({ mode: 'exclusive' }); }
      finally { done(); }
    } } },
    GM_getValue: () => { throw Error('sync GM get disallowed'); },
    GM_setValue: () => { throw Error('sync GM set disallowed'); },
    GM: {
      async getValue(key, fallback) { return records.get(key) ?? fallback; },
      async setValue(key, value) { records.set(key, structuredClone(value)); }
    }
  };
  const factory = vm.runInNewContext(source +
    '\ncommunicationPersistentHmacCurrentTabService;', context);
  const a = factory(), b = factory();
  const [first, second] = await Promise.all([a.admit(), b.admit()]);
  assert.equal(first.metadata.redaction_scope,
    second.metadata.redaction_scope);
  await Promise.all([a.complete(first.token), b.complete(second.token)]);
  a.dispose();
  b.dispose();
  const again = factory(), after = await again.admit();
  assert.equal(after.metadata.redaction_scope, first.metadata.redaction_scope);
  await again.complete(after.token);
  again.dispose();
  context.location.origin = 'https://other.invalid';
  await assert.rejects(() => factory().admit(), /shared-authority-unavailable/);
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
