import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const read = path => readFileSync('src/userscript/' + path, 'utf8');
function block(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, 'Missing source block: ' + start);
  return source.slice(first, last);
}
const bootstrap = read('01-runtime/01-bootstrap.js');
const diagnostics = read('07-panel-launcher/01-panel-diagnostics.js');
const persistence = read('06-image-export-tests/05-modal-contract.js');
const actualFunctions = [
  block(persistence, '  function diagnosticEnabled(level) {', '  /**'),
  block(diagnostics, '  function logDiagnostic(level, message, data = null) {',
    '  /**\n   * Handles inject styles.'),
  block(persistence, '  function persistDiagnosticLog() {',
    '  /**\n   * Schedules a bounded diagnostic-log persistence write.'),
  block(bootstrap.slice(bootstrap.indexOf('  function restoreDiagnosticLog() {')),
    '  function restoreDiagnosticLog() {', '  restoreDiagnosticLog();')
].join('\n');
const setup = [
  "'use strict';",
  "const DIAGNOSTIC_LOG_STORAGE_KEY = 'gen251-startup';",
  'const MAX_DIAGNOSTIC_LOG_ITEMS = 10000;',
  'const MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS = 5000;',
  'const DIAGNOSTIC_LEVELS = { errors: 0, warnings: 1, debug: 2, verbose: 3 };',
  "let diagnosticsLevel = 'errors';",
  'let diagnosticLog = [];',
  'let diagnosticLogBaselineVersion = null;',
  "const VERSION = 'v1';",
  'function logConsoleDiagnostic() {}',
  'function redactDiagnosticSignedTokens(value) { return value; }',
  'function schedulePersistDiagnosticLog() {}',
  'function refreshDiagnosticLog() {}'
].join('\n');
const measurement = [
  'const samples = [];',
  'const startAppend = performance.now();',
  'for (let i = 0; i < 11000; i += 1) {',
  "  logDiagnostic('lifecycle', i === 0 ? 'dc-version-transition' : 'noop',",
  "    { version: 'v1', i });",
  '}',
  'const appendMs = performance.now() - startAppend;',
  "if (diagnosticLog.length !== 10000) throw new Error('Memory retention count');",
  'const fullLog = diagnosticLog.slice();',
  'for (let trial = 0; trial < 12; trial += 1) {',
  '  diagnosticLog = fullLog.slice();',
  '  const startWrite = performance.now();',
  '  for (let i = 0; i < 80; i += 1) persistDiagnosticLog();',
  '  const persistMs = performance.now() - startWrite;',
  '  const snapshot = JSON.parse(sessionStorage.getItem(DIAGNOSTIC_LOG_STORAGE_KEY));',
  "  if (snapshot.records.length !== 5000 || snapshot.version_before_persisted !== 'v1') {",
  "    throw new Error('Persisted baseline/record count');",
  '  }',
  '  const startRestore = performance.now();',
  '  for (let i = 0; i < 80; i += 1) {',
  '    restoreDiagnosticLog();',
  "    if (diagnosticLog.length !== 5000 || diagnosticLogBaselineVersion !== 'v1') {",
  "      throw new Error('Restore count or version');",
  '    }',
  '  }',
  '  const restoreMs = performance.now() - startRestore;',
  '  samples.push({ persistMs, restoreMs });',
  '}',
  'const median = values => {',
  '  const sorted = [...values].sort((a, b) => a - b);',
  '  return (sorted[5] + sorted[6]) / 2;',
  '};',
  "document.getElementById('result').textContent = JSON.stringify({",
  "  scope: 'GEN exact-source append, persist and restore on real Chrome sessionStorage',",
  '  environment: navigator.userAgent,',
  '  origin: location.origin,',
  '  recordCount: 5000,',
  '  retainedMemoryCount: fullLog.length,',
  '  appendMs,',
  '  trials: samples.length,',
  '  operationsPerTrial: { persist: 80, restore: 80 },',
  '  medianPersistMs: median(samples.map(row => row.persistMs)),',
  '  medianRestoreMs: median(samples.map(row => row.restoreMs)),',
  '  samples',
  '});'
].join('\n');
const html = '<!doctype html><meta charset="utf-8">' +
  '<pre id="result">waiting</pre><script>\n' +
  setup + '\n' + actualFunctions + '\n' + measurement + '\n</script>';
const candidates = [
  process.env.CHROME_BIN, '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/usr/bin/chromium'
].filter(Boolean);
const binary = candidates.find(path => {
  try {
    execFileSync(path, ['--version'], { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
});
assert.ok(binary, 'Chrome/Chromium binary missing');
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const { stdout, stderr } = await exec(binary, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--virtual-time-budget=30000', '--dump-dom', url
  ], { timeout: 120000, maxBuffer: 5 * 1024 * 1024 });
  const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
  assert.ok(match, 'Missing GEN browser result: ' + stderr.slice(-1500));
  const payload = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  assert.ok(payload.startsWith('{'), 'Browser did not complete: ' + payload.slice(0, 500));
  const result = JSON.parse(payload);
  assert.equal(result.recordCount, 5000);
  assert.equal(result.retainedMemoryCount, 10000);
  assert.equal(result.trials, 12);
  assert.equal(result.samples.length, 12);
  assert.ok(result.samples.every(s => s.persistMs >= 0 && s.restoreMs >= 0));
  console.log('GEN_BROWSER_STARTUP_JSON=' + JSON.stringify(result));
} finally {
  await new Promise(resolve => server.close(resolve));
}
