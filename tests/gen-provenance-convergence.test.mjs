import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(
  new URL('../src/userscript/' + path, import.meta.url), 'utf8'
);
const bootstrap = read('01-runtime/01-bootstrap.js');
const restoration = read('01-runtime/01-bootstrap-restore.js');
const diagnostics = read('07-panel-launcher/01-panel-diagnostics.js');
const serializer = read('06-image-export-tests/05-modal-contract.js');
const pick = (source, begin, end) => {
  const i = source.indexOf(begin);
  const j = source.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'missing function boundary: ' + begin);
  return source.slice(i, j);
};
const assemble = [
  pick(serializer, '  function diagnosticEnabled(level) {', '  /**'),
  pick(diagnostics, '  function logDiagnostic(level, message, data = null) {',
    '  /**\n   * Handles inject styles.'),
  pick(serializer, '  function persistDiagnosticLog() {',
    '  /**\n   * Schedules a bounded diagnostic-log persistence write.'),
  pick(restoration, '  function restoreDiagnosticLog() {',
    '  restoreDiagnosticLog();')
].join('\n');

function scenario(options = {}) {
  const make = new Function('options', `
    const DIAGNOSTIC_LOG_STORAGE_KEY = 'gen';
    const MAX_DIAGNOSTIC_LOG_ITEMS = 10000;
    const MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS = 5000;
    const DIAGNOSTIC_LEVELS = { errors:0, warnings:1, debug:2, verbose:3 };
    const CORE_VERSION = 'core';
    let diagnosticsLevel = options.level || 'errors';
    let diagnosticLog = [];
    let diagnosticLogBaselineVersion = null;
    let VERSION = options.version || 'v1';
    let stored = options.stored ?? null;
    const sessionStorage = {
      getItem: () => stored,
      setItem: (key, value) => {
        assertKey(key);
        if (options.quota) throw Error('QuotaExceededError');
        stored = value;
      }
    };
    function assertKey(key) { if (key !== 'gen') throw Error('invalid key'); }
    function logConsoleDiagnostic() {}
    function redactDiagnosticSignedTokens(value) { return value; }
    function schedulePersistDiagnosticLog() {}
    function refreshDiagnosticLog() {}
    ${assemble}
    return {
      current: () => ({
        records: diagnosticLog, baseline: diagnosticLogBaselineVersion, stored
      }),
      version: value => { VERSION = value; },
      transition: value => logDiagnostic('lifecycle','dc-version-transition',
        { version:value }),
      ordinary: n => {
        for (let i = 0; i < n; i++) logDiagnostic('lifecycle','non-version',{ i });
      },
      save: persistDiagnosticLog,
      reload: () => {
        restoreDiagnosticLog();
        logDiagnostic('lifecycle','dc-version-transition',{version:VERSION});
      }
    };
  `);
  return make(options);
}

test('eviction, boundary persistence, upgrade and errors-only reload', () => {
  const app = scenario();
  app.transition('v1');
  app.ordinary(10000);
  assert.equal(app.current().records.length, 10000);
  assert.equal(app.current().baseline, 'v1');
  app.transition('v2');
  app.save();
  const snapshot = JSON.parse(app.current().stored);
  assert.equal(snapshot.records.length, 5000);
  assert.equal(snapshot.version_before_persisted, 'v1');
  assert.equal(snapshot.records.at(-1).data.version, 'v2');
  app.version('v3');
  app.reload();
  assert.equal(app.current().records.at(-1).data.version, 'v3');
  assert.equal(app.current().baseline, 'v1');
});

test('legacy plain array restores with unknown historical baseline', () => {
  const app = scenario({ stored: JSON.stringify([{ timestamp:'legacy',
    level:'debug', message:'legacy', data:null }]) });
  app.reload();
  assert.equal(app.current().baseline, null);
  assert.equal(app.current().records[0].message, 'legacy');
  assert.equal(app.current().records.at(-1).data.version, 'v1');
});

test('corrupt storage discards historical data and still starts fresh', () => {
  const app = scenario({ stored:'{invalid' });
  app.reload();
  assert.equal(app.current().baseline, null);
  assert.equal(app.current().records.length, 1);
});

test('quota failure preserves in-memory diagnostics', () => {
  const app = scenario({ quota:true });
  app.transition('v1');
  app.save();
  assert.equal(app.current().records.length, 1);
  assert.equal(app.current().records[0].data.version, 'v1');
  assert.equal(app.current().stored, null);
});

test('multiple changes in persisted tail survive boundary', () => {
  const app = scenario();
  app.transition('before');
  app.ordinary(6000);
  app.transition('inside-1');
  app.transition('inside-2');
  app.save();
  const value = JSON.parse(app.current().stored);
  assert.equal(value.version_before_persisted, 'before');
  assert.deepEqual(value.records.slice(-2).map(x => x.data.version),
    ['inside-1', 'inside-2']);
});
