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


test('Issue 166 generated diagnostic Save resolves and executes the generated archive bridge', async () => {
  const begin = userscript.indexOf('// BEGIN bundled stream7z 26.03 direct API source=');
  const endMarker = '// END bundled stream7z 26.03 direct API\n';
  const end = userscript.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin);
  const prelude = userscript.slice(begin, end + endMarker.length);

  const runtimeStart = userscript.indexOf('  let stream7zModulePromise = null;');
  const createStart = userscript.indexOf('  async function create7zArchive(', runtimeStart);
  const runtimeEnd = userscript.indexOf('\n\n  /**', createStart + 3);
  assert.ok(runtimeStart >= 0 && createStart > runtimeStart && runtimeEnd > createStart);
  const generatedRuntime = userscript.slice(runtimeStart, runtimeEnd);

  const diagnosticText = productionFunctionSource('diagnosticLogText');
  const saveDiagnostic = productionFunctionSource('saveDiagnosticLog');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = await new AsyncFunction(
    'assert',
    `${prelude}
${generatedRuntime}
const PANEL_ID = 'test-panel';
const diagnosticLog = [{ line: 'diagnostic archive integration' }];
const diagnosticLogLine = entry => entry.line;
const button = {
  disabled: false,
  title: '',
  setAttribute(name, value) { this[name] = value; },
  removeAttribute(name) { delete this[name]; }
};
class HTMLButtonElement {}
Object.setPrototypeOf(button, HTMLButtonElement.prototype);
const document = { querySelector() { return button; } };
const sanitizeFileName = value => value;
const conversationTitle = () => 'integration';
let downloaded = null;
let status = '';
const downloadBlob = async (blob, name) => {
  downloaded = { bytes: new Uint8Array(await blob.arrayBuffer()), name };
};
const setStatus = value => { status = value; };
const logDiagnostic = () => {};
${diagnosticText}
${saveDiagnostic}
return async () => {
  await saveDiagnosticLog();
  return { downloaded, status };
};`
  )(assert);

  const result = await run();
  assert.equal(result.downloaded.name, 'DownloadConversation_integration_diagnostic-log.7z');
  assert.deepEqual(
    Array.from(result.downloaded.bytes.subarray(0, 6)),
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]
  );
  assert.match(result.status, /Diagnostic log saved as .*\.7z\./);
});
