import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const manifest = JSON.parse(await readFile(
  new URL('../vendor/compressor/manifest.json', import.meta.url),
  'utf8'
));
const buildSource = await readFile(
  new URL('../scripts/build-userscript.mjs', import.meta.url),
  'utf8'
);
const runtimeSource = await readFile(
  new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url),
  'utf8'
);
const manifestSource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-manifest.js', import.meta.url),
  'utf8'
);
const recoverySource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-recovery.js', import.meta.url),
  'utf8'
);

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) output.push(absolute);
  }
  return output;
}

test('Issue 188 selected compressor package owns all implementation metadata', () => {
  assert.equal(manifest.name, 'zstd');
  assert.equal(manifest.extension, '.zst');
  assert.equal(manifest.mime_type, 'application/zstd');
  assert.equal(manifest.compression_level, 6);
  assert.equal(typeof manifest.bridge, 'string');
  assert.equal(typeof manifest.wasm_gzip_base64_directory, 'string');
  assert.ok(manifest.bridge_sha256);
  assert.ok(manifest.wasm_raw_sha256);
  assert.ok(manifest.wasm_gzip_sha256);
});

test('Issue 188 build machinery consumes compressor package metadata only', () => {
  assert.match(buildSource, /path\.join\(root, 'vendor', 'compressor'\)/);
  assert.match(buildSource, /path\.join\(vendor, manifest\.bridge\)/);
  assert.match(buildSource, /manifest\.wasm_gzip_base64_directory/);
  assert.match(buildSource, /manifest\.extension/);
  assert.match(buildSource, /manifest\.mime_type/);
  assert.match(buildSource, /manifest\.compression_level/);
  assert.doesNotMatch(buildSource, /vendor['"],\s*['"]direct-xz/);
  assert.doesNotMatch(buildSource, /liblzma\.mjs/);
});

test('Issue 188 runtime consumes extension, MIME and level from compressor interface', () => {
  assert.match(runtimeSource, /\._extension/);
  assert.match(runtimeSource, /\._mime_type/);
  assert.match(runtimeSource, /new compressor\.Encoder\(compressor\._compression_level\)/);
});

test('Issue 188 production userscript source contains no XZ-specific archive contract', async () => {
  const rootPath = path.resolve(new URL('../src/userscript/', import.meta.url).pathname);
  for (const file of await sourceFiles(rootPath)) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\bXZ\b/, `${file} must use compressor-neutral wording`);
    assert.doesNotMatch(source, /\.xz\b/i, `${file} must derive the compressor extension`);
    assert.doesNotMatch(source, /_dc_xz_/, `${file} must not use implementation-specific APIs`);
  }
});

test('Issue 188 communication storage has one named current schema', () => {
  const match = manifestSource.match(/const COMMUNICATION_LOG_SEGMENT_SCHEMA = (\d+);/);
  assert.ok(match, 'current segment schema constant is missing');
  assert.ok(Number(match[1]) > 2, 'segment schema must be bumped beyond the XZ storage schema');
  assert.match(manifestSource, /schema: COMMUNICATION_LOG_SEGMENT_SCHEMA/);
  assert.match(manifestSource, /parsed\?\.schema !== COMMUNICATION_LOG_SEGMENT_SCHEMA/);
});

test('Issue 188 stale or missing segment schema causes a private-directory reset', () => {
  assert.match(manifestSource, /if \(parsed\?\.schema !== COMMUNICATION_LOG_SEGMENT_SCHEMA\) return null;/);
  assert.match(manifestSource, /if \(error\?\.name === 'NotFoundError'\) return null;/);
  assert.match(recoverySource, /if \(!communicationLogSegmentManifest\)/);
  assert.match(recoverySource, /removeEntry\(directoryName, \{ recursive: true \}\)/);
  assert.match(recoverySource, /communicationLogCreateSegmentManifest\(\)/);
  assert.match(recoverySource, /communicationLogWriteSegmentManifest\(\)/);
});
