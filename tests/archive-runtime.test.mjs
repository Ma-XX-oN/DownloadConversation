import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const candidateDir = await mkdtemp(path.join(tmpdir(), 'dc-issue166-candidate-'));
const candidatePath = path.join(candidateDir, 'candidate.user.js');
execFileSync(process.execPath, ['scripts/build-userscript.mjs', '--output', candidatePath], {
  cwd: new URL('..', import.meta.url),
  stdio: 'pipe'
});
const candidateUserscript = await readFile(candidatePath, 'utf8');
execFileSync(process.execPath, ['scripts/verify-userscript-artifact.mjs', candidatePath], {
  cwd: new URL('..', import.meta.url),
  stdio: 'pipe'
});

function productionArchivePrelude() {
  const beginMarker = '// BEGIN bundled archive codec upstream-liblzma=';
  const begin = candidateUserscript.indexOf(beginMarker);
  const endMarker = '// END bundled archive codec\n';
  const end = candidateUserscript.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin,
    'generated upstream liblzma archive prelude must be present');
  return candidateUserscript.slice(begin, end + endMarker.length);
}

test('Issue 166 production archive bridge uses upstream liblzma rather than lzma-rust2', () => {
  assert.match(candidateUserscript,
    /\/\/ BEGIN bundled archive codec upstream-liblzma=/,
    'production archive bridge must identify the upstream liblzma build');
  assert.doesNotMatch(candidateUserscript,
    /\/\/ BEGIN bundled direct XZ lzma-rust2=/,
    'production archive bridge must not retain the Rust encoder');
  assert.match(candidateUserscript, /globalThis\.__dcArchiveCodec\s*=/,
    'production archive bridge must expose the codec-neutral module object');
  assert.doesNotMatch(candidateUserscript, /globalThis\.__dcDirectXz\s*=/,
    'production archive bridge must not expose the old XZ-specific object');
});

test('Issue 166 caller-facing archive API is codec-neutral', () => {
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
    assert.doesNotMatch(candidateUserscript, new RegExp(`\\b${name}\\b`),
      `${name} must not remain in caller-facing production code`);
  }
});

test('Issue 166 production archive bridge creates a real XZ in the JS runtime', async () => {
  globalThis.location ??= { href: 'https://chatgpt.com/c/test' };
  const prelude = productionArchivePrelude();
  const runtime = await readFile(
    new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url),
    'utf8'
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const create = await new AsyncFunction(
    `${prelude}\n${runtime}\nreturn createArchive;`
  )();
  const source = new TextEncoder().encode('DownloadConversation archive smoke test\n');
  const archive = await create(source);
  assert.ok(archive instanceof Uint8Array);
  assert.deepEqual(
    Array.from(archive.subarray(0, 6)),
    [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
    'archive must begin with the XZ signature'
  );
  assert.ok(archive.byteLength > 32, 'archive must contain a XZ header and payload');
});

test('Issue 166 production archive bridge round-trips exact bytes', async () => {
  globalThis.location ??= { href: 'https://chatgpt.com/c/test' };
  const prelude = productionArchivePrelude();
  const runtime = await readFile(
    new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url),
    'utf8'
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const api = await new AsyncFunction(
    `${prelude}\n${runtime}\nreturn { createArchive, extractArchive };`
  )();
  const source = new TextEncoder().encode(
    'first complete JSONL record\nsecond complete JSONL record\n'
  );
  const archive = await api.createArchive(source);
  const extracted = await api.extractArchive(archive);
  assert.deepEqual(Array.from(extracted), Array.from(source));
});

test('Issue 166 generated archive bridge is top-level in the DownloadConversation IIFE', () => {
  const safeBoundary = candidateUserscript.indexOf('// END Issue #163 WorkStack handoff transaction');
  const archiveState = candidateUserscript.indexOf('let archiveCodecReady = false;');
  const diagnosticSave = candidateUserscript.indexOf('async function saveDiagnosticLog()');
  assert.ok(safeBoundary >= 0, 'known closed top-level boundary must exist');
  assert.ok(archiveState > safeBoundary,
    'archive bridge must not be injected into an earlier open production function');
  assert.ok(diagnosticSave > archiveState,
    'archive bridge must be initialized in shared IIFE scope before diagnostic Save');
});

test('Issue 166 production archive is accepted by native xz and recovers exact bytes', async () => {
  const prelude = productionArchivePrelude();
  const runtime = await readFile(new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url), 'utf8');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const create = await new AsyncFunction(`${prelude}\n${runtime}\nreturn createArchive;`)();
  const source = new TextEncoder().encode('{"type":"diagnostic"}\n');
  const archive = await create(source);
  const archivePath = path.join(candidateDir, 'diagnostic.xz');
  await writeFile(archivePath, archive);
  execFileSync('xz', ['-t', archivePath]);
  const decoded = execFileSync('xz', ['-dc', archivePath]);
  assert.deepEqual(Array.from(decoded), Array.from(source));
});
