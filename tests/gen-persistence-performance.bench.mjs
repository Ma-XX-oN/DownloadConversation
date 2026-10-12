import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const ref = process.argv[2] || 'HEAD';
const source = path => ref === 'HEAD'
  ? readFileSync('src/userscript/' + path, 'utf8')
  : execFileSync('git', ['show', ref + ':src/userscript/' + path],
      { encoding: 'utf8' });
const bootstrap = source('01-runtime/01-bootstrap.js');
const diagnostics = source('07-panel-launcher/01-panel-diagnostics.js');
const persistence = source('06-image-export-tests/05-modal-contract.js');

function block(text, start, end) {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'Missing source boundary ' + start);
  return text.slice(first, last);
}
const code = [
  block(persistence, '  function diagnosticEnabled(level) {', '  /**'),
  block(diagnostics, '  function logDiagnostic(level, message, data = null) {',
    '  /**\n   * Handles inject styles.'),
  block(persistence, '  function persistDiagnosticLog() {',
    '  /**\n   * Schedules a bounded diagnostic-log persistence write.')
].join('\n');
const restoreStart = bootstrap.indexOf('  function restoreDiagnosticLog() {');
const restoreCode = restoreStart < 0 ? '' :
  block(bootstrap.slice(restoreStart),
    '  function restoreDiagnosticLog() {', '  restoreDiagnosticLog();');

function harness(storage = { raw: null }) {
  const context = {
    DIAGNOSTIC_LOG_STORAGE_KEY: 'benchmark',
    MAX_DIAGNOSTIC_LOG_ITEMS: 10000,
    MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS: 5000,
    DIAGNOSTIC_LEVELS: { errors: 0, warnings: 1, debug: 2, verbose: 3 },
    diagnosticsLevel: 'errors',
    diagnosticLog: [],
    diagnosticLogBaselineVersion: null,
    VERSION: 'v1',
    CORE_VERSION: 'core',
    sessionStorage: {
      getItem() { return storage.raw; },
      setItem(_, raw) { storage.raw = raw; }
    },
    logConsoleDiagnostic() {},
    redactDiagnosticSignedTokens(value) { return value; },
    schedulePersistDiagnosticLog() {},
    refreshDiagnosticLog() {}
  };
  vm.runInNewContext(code + '\n' + restoreCode +
    '\nthis.api = {append: logDiagnostic, persist: persistDiagnosticLog,' +
    ' restore: typeof restoreDiagnosticLog === "function" ? ' +
    'restoreDiagnosticLog : null}', context);
  return { context, storage, ...context.api };
}

const samples = [];
for (let trial = 0; trial < 12; trial++) {
  const app = harness();
  const start = performance.now();
  for (let i = 0; i < 11000; i++) {
    app.append('lifecycle', i === 0 ? 'dc-version-transition' : 'noop',
      { version: 'v1', i });
  }
  const appendMs = performance.now() - start;
  assert.equal(app.context.diagnosticLog.length, 10000);
  const before = performance.now();
  for (let i = 0; i < 80; i++) app.persist();
  const persistMs = performance.now() - before;
  const decoded = JSON.parse(app.storage.raw);
  const records = Array.isArray(decoded) ? decoded : decoded.records;
  assert.equal(records.length, 5000);
  let restoreMs = null;
  if (app.restore) {
    const startRestore = performance.now();
    for (let i = 0; i < 80; i++) {
      const fresh = harness(app.storage);
      fresh.restore();
      assert.equal(fresh.context.diagnosticLog.length, 5000);
    }
    restoreMs = performance.now() - startRestore;
  }
  samples.push({ appendMs, persistMs, restoreMs,
    bytes: Buffer.byteLength(app.storage.raw) });
}
const median = values => {
  const sorted = values.filter(value => value !== null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const fields = Object.keys(samples[0]);
const medians = Object.fromEntries(fields.map(key =>
  [key, median(samples.map(row => row[key]))]));
process.stdout.write(JSON.stringify({
  ref, environment: 'Node VM with synchronous in-memory sessionStorage stub',
  trials: samples.length, operationsPerTrial: {
    append: 11000, persist: 80, restore: restoreCode ? 80 : 0
  }, medians, samples
}, null, 2) + '\n');
