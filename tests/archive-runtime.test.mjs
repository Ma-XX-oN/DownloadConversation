import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

test('Issue 166 production archive bridge creates a real 7z in the JS runtime', async () => {
  const begin = userscript.indexOf('// BEGIN bundled stream7z 26.03 direct API source=');
  const endMarker = '// END bundled stream7z 26.03 direct API\n';
  const end = userscript.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin, 'generated stream7z prelude must be present');
  const prelude = userscript.slice(begin, end + endMarker.length);
  const runtime = await readFile(
    new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url),
    'utf8'
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const create = await new AsyncFunction(
    `${prelude}\n${runtime}\nreturn create7zArchive;`
  )();
  const source = new TextEncoder().encode('DownloadConversation archive smoke test\n');
  const archive = await create(source, 'diagnostic-log.txt');
  assert.ok(archive instanceof Uint8Array);
  assert.deepEqual(
    Array.from(archive.subarray(0, 6)),
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    'archive must begin with the 7z signature'
  );
  assert.ok(archive.byteLength > 32, 'archive must contain a 7z header and payload');
});


test('Issue 166 generated diagnostic Save and archive bridge share the shipped runtime scope', () => {
  const iifeStart = userscript.indexOf('\n(() => {');
  const create = userscript.indexOf('async function create7zArchive(', iifeStart);
  const save = userscript.indexOf('async function saveDiagnosticLog(', create);
  const iifeEnd = userscript.lastIndexOf('})();');
  assert.ok(iifeStart >= 0 && create > iifeStart);
  assert.ok(save > create && save < iifeEnd);
  const saveSource = productionFunctionSource('saveDiagnosticLog');
  assert.match(saveSource, /await create7zArchive\(/);
});

test('Issue 166 production archive bridge round-trips exact member bytes', async () => {
  const begin = userscript.indexOf('// BEGIN bundled stream7z 26.03 direct API source=');
  const endMarker = '// END bundled stream7z 26.03 direct API\n';
  const end = userscript.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin);
  const prelude = userscript.slice(begin, end + endMarker.length);
  const runtime = await readFile(
    new URL('../src/userscript/01-runtime/03-archive.js', import.meta.url),
    'utf8'
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const api = await new AsyncFunction(
    `${prelude}\n${runtime}\nreturn { create7zArchive, extract7zArchive };`
  )();
  const source = new TextEncoder().encode(
    'first complete JSONL record\\nsecond complete JSONL record\\n'
  );
  const archive = await api.create7zArchive(source, 'segment-000001.jsonl');
  const extracted = await api.extract7zArchive(archive);
  assert.deepEqual(Array.from(extracted), Array.from(source));
});
