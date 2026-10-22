import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor/compressor');
const outputPath = path.join(root, 'tests/manual/dc317-standalone-writer-probe.user.js');
const templatePath = path.join(root, 'tests/manual/dc317-standalone-writer-probe.template.js');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const compressorManifest = JSON.parse(
  await readFile(path.join(vendor, 'manifest.json'), 'utf8'));
let compressor = await readFile(
  path.join(vendor, compressorManifest.bridge), 'utf8');
if (Buffer.byteLength(compressor) !== compressorManifest.bridge_bytes ||
    digest(compressor) !== compressorManifest.bridge_sha256) {
  throw new Error('Vendored compressor source differs from pinned manifest');
}
const wasmDirectory = path.join(vendor,
  compressorManifest.wasm_gzip_base64_directory);
const names = (await readdir(wasmDirectory))
  .filter(name => /^\d\d\.txt$/.test(name)).sort();
const b64 = (await Promise.all(names.map(name =>
  readFile(path.join(wasmDirectory, name), 'utf8')))).join('')
  .replace(/\s/g, '');
if (digest(Buffer.from(b64, 'base64')) !==
    compressorManifest.wasm_gzip_sha256 ||
    digest(gunzipSync(Buffer.from(b64, 'base64'))) !==
      compressorManifest.wasm_raw_sha256) {
  throw new Error('Vendored Zstd bytes fail pinned digest validation');
}
compressor = compressor
  .replace('__DC_COMPRESSOR_WASM_GZIP_BASE64__', b64)
  .replace('__DC_COMPRESSOR_EXTENSION__', compressorManifest.extension)
  .replace('__DC_COMPRESSOR_MIME_TYPE__', compressorManifest.mime_type)
  .replace('__DC_COMPRESSOR_LEVEL__',
    String(compressorManifest.compression_level));
if (/__DC_COMPRESSOR_[A-Z_]+__/.test(compressor)) {
  throw new Error('Unresolved compressor manifest substitution');
}
const diskRoot = path.join(root, 'src/userscript/02-network-communication');
const modules = [
  '04-csc-comm-disk-lock.js',
  '04-csc-comm-disk-manifest.js',
  '04-csc-comm-disk-copy.js',
  '04-csc-comm-disk-writer.js',
  '04-csc-comm-disk-writer-part2.js',
  '04-csc-comm-disk-bridge.js'
];
const nativeCode = (await Promise.all(modules.map(module =>
  readFile(path.join(diskRoot, module), 'utf8')))).join('\n');
const probe = await readFile(path.join(root,
  'src/userscript/06-image-export-tests/11-csc-comm-disk-probe.js'), 'utf8');
const workerScript = [
  "'use strict';",
  compressor,
  nativeCode,
  probe,
  'self.__dcWorkerCompressorBridge = self.__dcCompressor;',
  'self.__cscWriterLease = cscCommWriterLease(self);',
  'self.__cscWriterManifest = cscCommDiskManifest(self);',
  'self.__cscWriterCopy = cscCommDiskCopy();',
  'self.__cscDiskWriter = cscCommDiskWriter(self,',
  '  cscCommWorkerZstdCodec());',
  'cscCommDiskProbeEntrypoint();'
].join('\n');
const versionHeader = await readFile(path.join(root, 'src/userscript-header.js'),
  'utf8');
const match = versionHeader.match(/^\/\/ @version\s+([^\s]+)/m);
if (!match || !/^1\.11\.7-issue\.317\.\d+$/.test(match[1])) {
  throw new Error('Unexpected DC #317 source-version identity');
}
const output = (await readFile(templatePath, 'utf8'))
  .replace('__DC317_VERSION_JSON__', JSON.stringify(match[1]))
  .replace('__DC317_WORKER_SOURCE_JSON__', JSON.stringify(workerScript))
  .replace('__DC317_WASM_GZIP_BASE64_JSON__', JSON.stringify(b64));
if (/__DC317_\w+__/.test(output)) {
  throw new Error('Unresolved standalone-probe template substitution');
}
if (process.argv.slice(2).join(' ') === '--check') {
  const current = await readFile(outputPath, 'utf8');
  if (current !== output) {
    throw new Error('Standalone DC #317 probe is stale; rebuild explicitly');
  }
  console.log('Standalone DC #317 probe matches exact source and WASM bytes');
} else if (process.argv.length === 2) {
  await writeFile(outputPath, output, 'utf8');
  console.log('Generated standalone DC #317 probe with actual vendored Zstd');
} else {
  throw new Error('Usage: node scripts/build-issue317-standalone-probe.mjs [--check]');
}
