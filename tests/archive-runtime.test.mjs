import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { productionFunctionSource } from './helpers/userscript-source.mjs';

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

test('Issue 166 production archive bridge creates a real XZ in the JS runtime', async () => {
  globalThis.location ??= { href: 'https://chatgpt.com/c/test' };
  const begin = candidateUserscript.indexOf('// BEGIN bundled direct XZ lzma-rust2=0.16.2');
  const endMarker = '// END bundled direct XZ\n';
  const end = candidateUserscript.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin, 'generated directXz prelude must be present');
  const prelude = candidateUserscript.slice(begin, end + endMarker.length);
  const runtime = await readFile(
    new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url),
    'utf8'
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const create = await new AsyncFunction(
    `${prelude}\n${runtime}\nreturn createXzArchive;`
  )();
  const previousLocation = globalThis.location;
  globalThis.location = { href: import.meta.url };
  const source = new TextEncoder().encode('DownloadConversation archive smoke test\n');
  const archive = await create(source, 'diagnostic-log.txt');
  assert.ok(archive instanceof Uint8Array);
  assert.deepEqual(
    Array.from(archive.subarray(0, 6)),
    [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
    'archive must begin with the XZ signature'
  );
  assert.ok(archive.byteLength > 32, 'archive must contain a XZ header and payload');
});


test('Issue 166 production archive bridge round-trips exact member bytes', async () => {
  globalThis.location ??= { href: 'https://chatgpt.com/c/test' };
  const begin = candidateUserscript.indexOf('// BEGIN bundled direct XZ lzma-rust2=0.16.2');
  const endMarker = '// END bundled direct XZ\n';
  const end = candidateUserscript.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin);
  const prelude = candidateUserscript.slice(begin, end + endMarker.length);
  const runtime = await readFile(
    new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url),
    'utf8'
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const api = await new AsyncFunction(
    `${prelude}\n${runtime}\nreturn { createXzArchive, extractXzArchive };`
  )();
  const source = new TextEncoder().encode(
    'first complete JSONL record\\nsecond complete JSONL record\\n'
  );
  const archive = await api.createXzArchive(source, 'segment-000001.jsonl');
  const extracted = await api.extractXzArchive(archive);
  assert.deepEqual(Array.from(extracted), Array.from(source));
});


test('Issue 166 generated archive bridge is top-level in the DownloadConversation IIFE', () => {
  const safeBoundary = candidateUserscript.indexOf('// END Issue #163 WorkStack handoff transaction');
  const archiveState = candidateUserscript.indexOf('let directXzReady = false;');
  const diagnosticSave = candidateUserscript.indexOf('async function saveDiagnosticLog()');
  assert.ok(safeBoundary >= 0, 'known closed top-level boundary must exist');
  assert.ok(archiveState > safeBoundary,
    'archive bridge must not be injected into an earlier open production function');
  assert.ok(diagnosticSave > archiveState,
    'archive bridge must be initialized in shared IIFE scope before diagnostic Save');
});


test('Issue 166 production XZ is accepted by native xz and recovers exact bytes', async () => {
  const begin = candidateUserscript.indexOf('// BEGIN bundled direct XZ');
  const endMarker = '// END bundled direct XZ\n';
  const end = candidateUserscript.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin);
  const prelude = candidateUserscript.slice(begin, end + endMarker.length);
  const runtime = await readFile(new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url), 'utf8');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const create = await new AsyncFunction(`${prelude}\n${runtime}\nreturn createXzArchive;`)();
  const source = new TextEncoder().encode('{"type":"diagnostic"}\n');
  const archive = await create(source);
  const archivePath = path.join(candidateDir, 'diagnostic.xz');
  await writeFile(archivePath, archive);
  execFileSync('xz', ['-t', archivePath]);
  const decoded = execFileSync('xz', ['-dc', archivePath]);
  assert.deepEqual(Array.from(decoded), Array.from(source));
});
