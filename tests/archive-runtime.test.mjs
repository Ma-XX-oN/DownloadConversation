import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { userscript } from './helpers/userscript-source.mjs';

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
