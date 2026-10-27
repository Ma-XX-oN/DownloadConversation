import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const folder = '../src/userscript/02-network-communication/';
const sources = [
  '04-csc-comm-worker-processing.js',
  '04-csc-comm-worker-processing-part2.js',
  '04-csc-comm-worker-processing-part3.js',
  '04-csc-comm-disk-lock.js',
  '04-csc-comm-disk-manifest.js',
  '04-csc-comm-disk-copy.js',
  '04-csc-comm-disk-writer.js',
  '04-csc-comm-disk-writer-part2.js',
  '04-csc-comm-disk-bridge.js'
].map(name => readFileSync(new URL(folder + name, import.meta.url), 'utf8'));
const source = sources.join('\n');
const generate = new Function('assert', source +
  '\nreturn cscCommDiskWorkerSource;')(assert);

test('single dedicated Worker source composes processor and Writer without syntax errors', () => {
  const original = globalThis.__dcCompressor;
  globalThis.__dcCompressor = {
    init: function __dcCompressorInit() {},
    Encoder: function CompressorEncoder() {},
    decompress: function __dcCompressorDecompress() {},
    wasmGzipBase64: 'f'.repeat(64)
  };
  try {
    const worker = generate();
    assert.equal(typeof worker, 'string');
    assert.ok(worker.includes('cscCommWorkerProcessing'));
    assert.ok(worker.includes('cscCommDiskWriter'));
    assert.doesNotThrow(() => new Function(worker));
  } finally {
    if (original === undefined) delete globalThis.__dcCompressor;
    else globalThis.__dcCompressor = original;
  }
});
