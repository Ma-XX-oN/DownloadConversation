import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = name => readFileSync(new URL(
  '../src/userscript/' + name, import.meta.url
), 'utf8');
const bootstrap = read('01-runtime/01-bootstrap.js');
const restoration = read('01-runtime/01-bootstrap-restore.js');
const diagnostics = read('07-panel-launcher/01-panel-diagnostics.js');
const persistence = read('06-image-export-tests/05-modal-contract.js');

function block(source, from, until) {
  const start = source.indexOf(from);
  const end = source.indexOf(until, start);
  assert.ok(start >= 0 && end > start, 'Source boundary must exist: ' + from);
  return source.slice(start, end);
}

const functions = [
  block(persistence, '  function diagnosticEnabled(level) {', '  /**'),
  block(diagnostics, '  function logDiagnostic(level, message, data = null) {',
    '  /**\n   * Handles inject styles.'),
  block(persistence, '  function persistDiagnosticLog() {',
    '  /**\n   * Schedules a bounded diagnostic-log persistence write.'),
  block(restoration, '  function restoreDiagnosticLog() {',
    '  restoreDiagnosticLog();')
].join('\n');

function harness({ storage = null, level = 'errors' } = {}) {
  const context = {
    DIAGNOSTIC_LOG_STORAGE_KEY: 'diagnostic',
    MAX_DIAGNOSTIC_LOG_ITEMS: 10000,
    MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS: 5000,
    DIAGNOSTIC_LEVELS: { errors: 0, warnings: 1, debug: 2, verbose: 3 },
    diagnosticsLevel: level,
    diagnosticLog: [],
    diagnosticLogBaselineVersion: null,
    VERSION: 'v1',
    CORE_VERSION: 'core',
    sessionStorage: {
      getItem() { return storage; },
      setItem(_, value) { storage = value; }
    },
    logConsoleDiagnostic() {},
    redactDiagnosticSignedTokens(value) { return value; },
    schedulePersistDiagnosticLog() {},
    refreshDiagnosticLog() {}
  };
  vm.runInNewContext(functions + '\nthis.methods = {' +
    'append: logDiagnostic, persist: persistDiagnosticLog,' +
    'restore: restoreDiagnosticLog}', context);
  // Execute the actual initialisation path once per simulated page lifetime.
  context.methods.restore();
  context.methods.append('lifecycle', 'dc-version-transition',
    { version: context.VERSION });
  return {
    context,
    records: () => context.diagnosticLog,
    baseline: () => context.diagnosticLogBaselineVersion,
    storage: () => storage,
    append: (...args) => context.methods.append(...args),
    persist: () => context.methods.persist()
  };
}

test('integrated 10000 eviction, 5000 snapshot, cross-reload upgrades', () => {
  const first = harness();
  for (let i = 0; i < 10000; i++) first.append('lifecycle', 'noop', { i });
  assert.equal(first.records().length, 10000);
  assert.equal(first.baseline(), 'v1');
  first.append('lifecycle', 'dc-version-transition', { version: 'v2' });
  first.persist();
  const saved = JSON.parse(first.storage());
  assert.equal(saved.records.length, 5000);
  assert.equal(saved.version_before_persisted, 'v1');
  assert.equal(saved.records.at(-1).data.version, 'v2');
  const second = harness({ storage: first.storage(), level: 'errors' });
  assert.equal(second.baseline(), 'v1');
  assert.equal(second.records().length, 5001);
  assert.equal(second.records().at(-1).data.version, 'v1');
  assert.equal(second.records().at(-2).data.version, 'v2');
});

test('legacy arrays preserve historical unknown baseline', () => {
  const old = [{ timestamp: '2026-01-01T00:00:00Z',
    level: 'debug', message: 'old', data: null }];
  const state = harness({ storage: JSON.stringify(old) });
  assert.equal(state.baseline(), null);
  assert.equal(state.records().length, 2);
  assert.equal(state.records()[0].message, 'old');
});

test('malformed snapshots recover with current startup entry only', () => {
  const state = harness({ storage: '{broken' });
  assert.equal(state.baseline(), null);
  assert.equal(state.records().length, 1);
  assert.equal(state.records()[0].message, 'dc-version-transition');
});

test('in-window transitions are retained and not converted to metadata', () => {
  const state = harness();
  state.append('lifecycle', 'dc-version-transition', { version: 'v2' });
  state.persist();
  const snapshot = JSON.parse(state.storage());
  assert.equal(snapshot.version_before_persisted, null);
  assert.equal(snapshot.records.length, 2);
  assert.deepEqual(snapshot.records.map(row => row.data.version), ['v1', 'v2']);
});
