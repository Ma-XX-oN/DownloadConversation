import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const candidateDir = await mkdtemp(path.join(tmpdir(), 'dc-compressor-candidate-'));
const candidatePath = path.join(candidateDir, 'candidate.user.js');
const compressorManifest = JSON.parse(await readFile(
  new URL('../vendor/compressor/manifest.json', import.meta.url),
  'utf8'
));

execFileSync(process.execPath, ['scripts/build-userscript.mjs', '--output', candidatePath], {
  cwd: root,
  stdio: 'pipe'
});
const candidateUserscript = await readFile(candidatePath, 'utf8');
execFileSync(process.execPath, ['scripts/verify-userscript-artifact.mjs', candidatePath], {
  cwd: root,
  stdio: 'pipe'
});

function productionCompressorPrelude() {
  const beginMarker = `// BEGIN bundled compressor name=${compressorManifest.name} `
    + `source=${compressorManifest.source_commit}\n`;
  const begin = candidateUserscript.indexOf(beginMarker);
  const endMarker = '// END bundled compressor\n';
  const end = candidateUserscript.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin, 'generated compressor prelude must be present');
  return candidateUserscript.slice(begin, end + endMarker.length);
}

async function productionArchiveApi() {
  const prelude = productionCompressorPrelude();
  const runtime = await readFile(
    new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url),
    'utf8'
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction(
    `${prelude}\n${runtime}\nreturn {\n`
      + '  createArchive, extractArchive, streamingArchiveWriterBegin,\n'
      + '  streamingArchiveWriterAppendBytes, streamingArchiveWriterAppendArchive,\n'
      + '  streamingArchiveWriterFinish, compressorExtension, compressorMimeType\n'
      + '};'
  )();
}

test('Issue 188 build exposes the generic compressor bridge only', () => {
  assert.match(candidateUserscript, /globalThis\.__dcCompressor\s*=/);
  assert.doesNotMatch(candidateUserscript, /globalThis\.__dcArchiveCodec\s*=/);
  assert.doesNotMatch(candidateUserscript, /globalThis\.__dcDirectXz\s*=/);
  assert.doesNotMatch(candidateUserscript, /\b_dc_xz_/);
});

test('Issue 188 caller-facing archive API remains compressor-neutral', () => {
  for (const name of [
    'createArchive',
    'extractArchive',
    'streamingArchiveWriterBegin',
    'streamingArchiveWriterAppendBytes',
    'streamingArchiveWriterAppendArchive',
    'streamingArchiveWriterFinish'
  ]) {
    assert.match(candidateUserscript, new RegExp(`\\b${name}\\b`));
  }
  for (const name of [
    'createXzArchive',
    'extractXzArchive',
    'streamingXzWriterBegin',
    'streamingXzWriterAppendBytes',
    'streamingXzWriterAppendArchive',
    'streamingXzWriterFinish'
  ]) {
    assert.doesNotMatch(candidateUserscript, new RegExp(`\\b${name}\\b`));
  }
});

test('Issue 188 compressor metadata is owned by the selected package', async () => {
  const api = await productionArchiveApi();
  assert.equal(api.compressorExtension(), compressorManifest.extension);
  assert.equal(api.compressorMimeType(), compressorManifest.mime_type);
  assert.equal(compressorManifest.name, 'zstd');
  assert.equal(compressorManifest.extension, '.zst');
  assert.equal(compressorManifest.mime_type, 'application/zstd');
  assert.equal(compressorManifest.compression_level, 6);
});

test('Issue 188 production compressor creates a real Zstandard frame', async () => {
  const api = await productionArchiveApi();
  const source = new TextEncoder().encode('DownloadConversation archive smoke test\n');
  const archive = await api.createArchive(source);
  assert.ok(archive instanceof Uint8Array);
  assert.deepEqual(Array.from(archive.subarray(0, 4)), [0x28, 0xb5, 0x2f, 0xfd]);
});

test('Issue 188 production compressor round-trips exact bytes', async () => {
  const api = await productionArchiveApi();
  const source = new TextEncoder().encode(
    'first complete JSONL record\nsecond complete JSONL record\n'
  );
  const archive = await api.createArchive(source);
  const extracted = await api.extractArchive(archive);
  assert.deepEqual(Array.from(extracted), Array.from(source));
});

test('Issue 188 streaming writer keeps one compressor open across appends', async () => {
  const api = await productionArchiveApi();
  const first = new TextEncoder().encode('first\n');
  const second = new TextEncoder().encode('second\n');
  const writer = await api.streamingArchiveWriterBegin();
  api.streamingArchiveWriterAppendBytes(writer, first);
  api.streamingArchiveWriterAppendBytes(writer, second);
  const archive = api.streamingArchiveWriterFinish(writer);
  const extracted = await api.extractArchive(archive);
  assert.deepEqual(
    Array.from(extracted),
    Array.from(new TextEncoder().encode('first\nsecond\n'))
  );
});

test('Issue 188 streaming writer can append an existing archive', async () => {
  const api = await productionArchiveApi();
  const source = new TextEncoder().encode('historical segment\n');
  const sourceArchive = await api.createArchive(source);
  const writer = await api.streamingArchiveWriterBegin();
  const appended = api.streamingArchiveWriterAppendArchive(writer, sourceArchive);
  assert.equal(appended, source.byteLength);
  const archive = api.streamingArchiveWriterFinish(writer);
  const extracted = await api.extractArchive(archive);
  assert.deepEqual(Array.from(extracted), Array.from(source));
});

test('Issue 188 compressor runtime is top-level in the DownloadConversation IIFE', () => {
  const safeBoundary = candidateUserscript.indexOf('// END Issue #163 WorkStack handoff transaction');
  const compressorState = candidateUserscript.indexOf('let compressorReady = false;');
  const diagnosticSave = candidateUserscript.indexOf('async function saveDiagnosticLog()');
  assert.ok(safeBoundary >= 0, 'known closed top-level boundary must exist');
  assert.ok(compressorState > safeBoundary, 'compressor runtime must follow the safe boundary');
  assert.ok(diagnosticSave > compressorState, 'compressor runtime must precede diagnostic Save');
});

const zstdAvailable = spawnSync('zstd', ['--version'], { stdio: 'ignore' }).status === 0;
test('Issue 188 production archive is accepted by native zstd', {
  skip: !zstdAvailable
}, async () => {
  const api = await productionArchiveApi();
  const source = new TextEncoder().encode('{"type":"diagnostic"}\n');
  const archive = await api.createArchive(source);
  const archivePath = path.join(candidateDir, `diagnostic${compressorManifest.extension}`);
  await writeFile(archivePath, archive);
  execFileSync('zstd', ['-t', archivePath], { stdio: 'pipe' });
  const decoded = execFileSync('zstd', ['-dc', archivePath]);
  assert.deepEqual(Array.from(decoded), Array.from(source));
});
