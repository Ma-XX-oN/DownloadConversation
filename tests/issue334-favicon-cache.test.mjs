import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const implementation = readFileSync(new URL('../src/userscript/03-agent-lifecycle/03-favicon-cache-format.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/userscript/03-agent-lifecycle/03-favicon-cache.js', import.meta.url), 'utf8');

import { syntheticPack, catalogue } from './helpers/issue334-favicon-synthetic.mjs';

function harness(cat, pack) {
  const output = { warnings: [], requests: [] };
  const context = vm.createContext({
    console,
    Blob,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Map,
    Set,
    Promise,
    crypto: globalThis.crypto,
    indexedDB: { open() { throw Error('not needed for catalogue'); } },
    navigator: { locks: { request: () => Promise.resolve() } },
    setInterval: () => 0,
    Date,
    // Node tests check the pack's structural invariants. Browser tests use
    // genuine Chromium PNG decoding and reject valid-CRC invalid IDAT data.
    createImageBitmap: async blob => {
      const png = new DataView(await blob.arrayBuffer());
      return { width: png.getUint32(16), height: png.getUint32(20), close() {} };
    },
    logDiagnostic: (...args) => output.warnings.push(args),
    GM_xmlhttpRequest({ url, responseType, onload }) {
      output.requests.push(url);
      const data = url.endsWith('.json') ? JSON.stringify(cat) : pack.pack;
      const response = responseType === 'arraybuffer'
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : data;
      queueMicrotask(() => onload({ status: 200, response }));
    }
  });
  vm.runInContext(implementation, context);
  vm.runInContext('faviconCacheCatalogueUrl = "https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/main/assets/favicons/v1/catalogue.json";', context);
  return { context, output };
}

test('RED: frozen B V1 functions exist and select normalized numerical versions', async () => {
  const pair = syntheticPack();
  const { context } = harness(catalogue(pair, ['1.11.7', '1.12.0']), pair);
  assert.equal(await context.get_compatible_version_key('1.11.7-issue.999.1'), '1.11.7');
  assert.equal(await context.get_compatible_version_key('1.12.0-issue.1.300'), '1.12.0');
  assert.equal(await context.get_compatible_version_key('1.11.6'), null);
});

test('RED: duplicate dataset boundaries are rejected', async () => {
  const pair = syntheticPack();
  const { context } = harness(catalogue(pair, ['1.11.7', '1.11.7-issue.2']), pair);
  assert.equal(await context.get_compatible_version_key('1.11.9'), null);
});

test('RED: corrupted pack is rejected without partial validation', async () => {
  const pair = syntheticPack({ badOffset: true });
  const { context } = harness(catalogue(pair), pair);
  assert.equal(await context.faviconCacheValidatePack(pair.pack.buffer.slice(pair.pack.byteOffset, pair.pack.byteOffset + pair.pack.byteLength), catalogue(pair).datasets[0]).catch(() => null), null);
});

test('valid synthetic V1 binary pack verifies all 588 complete PNG records', async () => {
  const pair = syntheticPack();
  const { context } = harness(catalogue(pair), pair);
  const buffer = pair.pack.buffer.slice(pair.pack.byteOffset, pair.pack.byteOffset + pair.pack.byteLength);
  const result = await context.faviconCacheValidatePack(buffer, catalogue(pair).datasets[0]);
  assert.equal(result.spans.length, 588);
  assert.equal(result.variants.length, 1);
  assert.equal(result.spans[0].version, '1.11.7');
  assert.equal(result.spans.at(-1).pulse_index, 20);
});

test('damaged PNG/hash and manifest dimension mismatch fail closed', async () => {
  for (const options of [{ corrupt: true }, { badDimensions: true }, { badOffset: true }]) {
    const pair = syntheticPack(options);
    const { context } = harness(catalogue(pair), pair);
    const buffer = pair.pack.buffer.slice(pair.pack.byteOffset, pair.pack.byteOffset + pair.pack.byteLength);
    await assert.rejects(context.faviconCacheValidatePack(buffer, catalogue(pair).datasets[0]));
  }
  const pair = syntheticPack();
  const { context } = harness(catalogue(pair), pair);
  const tampered = Buffer.from(pair.pack);
  tampered[tampered.length - 3] ^= 0x80;
  const buffer = tampered.buffer.slice(tampered.byteOffset, tampered.byteOffset + tampered.byteLength);
  await assert.rejects(context.faviconCacheValidatePack(buffer, catalogue(pair).datasets[0]), /pack-hash/);
});

test('malformed versions fail safely and never infer a boundary', async () => {
  const pair = syntheticPack();
  const { context } = harness(catalogue(pair), pair);
  for (const version of ['1.11', '1.11.7.4', '01.11.7', '1.11.-1', '9007199254740993.0.0', '1.11.7+build']) {
    assert.equal(await context.get_compatible_version_key(version), null);
  }
  const before = await context.get_compatible_version_key('1.11.7-issue.1');
  const after = await context.get_compatible_version_key('1.11.7-issue.999.42');
  assert.equal(before, '1.11.7');
  assert.equal(after, before);
});

test('missing storage/Web Locks fails closed without network fetch', async () => {
  const pair = syntheticPack();
  const { context, output } = harness(catalogue(pair), pair);
  context.navigator.locks = undefined;
  assert.equal(await context.get_compatible_version_key('1.11.7'), null);
  assert.equal(await context.open_favicon_dataset('1.11.7'), null);
  assert.equal(output.requests.length, 0);
});