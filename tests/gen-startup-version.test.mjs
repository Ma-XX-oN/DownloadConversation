import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../src/userscript/01-runtime/01-bootstrap.js', import.meta.url),
  'utf8'
);
const declaration = 'let diagnosticLogBaselineVersion = null;';
const start = source.indexOf('  function restoreDiagnosticLog() {');
const end = source.indexOf('\n  /**\n   * Handles assert.', start);
assert.ok(start !== -1 && end > start);
const startup = source.slice(start, end);

function boot(version, persisted = null, level = 'errors') {
  const recorded = [];
  const context = {
    VERSION: version,
    CORE_VERSION: 'core',
    DIAGNOSTIC_LOG_STORAGE_KEY: 'test-log',
    MAX_DIAGNOSTIC_LOG_ITEMS: 10000,
    MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS: 5000,
    diagnosticLogBaselineVersion: null,
    diagnosticLog: [],
    sessionStorage: {
      getItem: () => persisted === null ? null : JSON.stringify(persisted)
    },
    logDiagnostic: (category, message, data) => {
      // Contract-faithful isolated #236 append double: exact provenance event
      // bypasses errors-only filtering and uses the ordinary append path.
      if (category !== 'lifecycle' || message !== 'dc-version-transition') {
        if (level === 'errors') return;
      }
      const entry = { timestamp: new Date().toISOString(),
        level: category, message, data };
      recorded.push(entry);
      context.diagnosticLog.push(entry);
    },
    logConsoleDiagnostic: () => {}
  };
  vm.runInNewContext(startup, context);
  return { recorded, records: context.diagnosticLog };
}

test('one shared baseline declaration, null for legacy history', () => {
  assert.equal(source.split(declaration).length - 1, 1);
  assert.match(source, /let diagnosticLog = \[\];\s*\/\*\*[^]*?let diagnosticLogBaselineVersion = null;/);
});

test('fresh startup appends exactly one normal lifecycle transition', () => {
  const result = boot('1.2.3');
  assert.equal(result.recorded.length, 1);
  assert.deepEqual({ level: result.records[0].level,
    message: result.records[0].message, data: { version: result.records[0].data.version } },
  { level: 'lifecycle', message: 'dc-version-transition',
    data: { version: '1.2.3' } });
  assert.ok(Number.isFinite(Date.parse(result.records[0].timestamp)));
});

test('restored GEN record order preserved, startup record is last', () => {
  const prior = [{ timestamp: '2026-01-01T00:00:00.000Z',
    level: 'debug', message: 'old', data: null }];
  const result = boot('1.2.3', prior);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].message, 'old');
  assert.equal(result.records[1].data.version, '1.2.3');
});

test('changed installed version is read at each initialisation', () => {
  assert.equal(boot('v-old').recorded[0].data.version, 'v-old');
  assert.equal(boot('v-new').recorded[0].data.version, 'v-new');
});

test('errors-only does not suppress lifecycle in the isolated append contract', () => {
  assert.equal(boot('v-new', [], 'errors').recorded.length, 1);
});

test('startup uses shared API, not a direct array append', () => {
  assert.match(startup, /logDiagnostic\('lifecycle', 'dc-version-transition', \{ version: VERSION \}\)/);
  assert.doesNotMatch(startup, /diagnosticLog\.(?:push|unshift|splice)\(/);
  assert.equal(startup.match(/logDiagnostic\('lifecycle', 'dc-version-transition'/g)?.length, 1);
});

test('legacy corrupt storage still emits version transition', () => {
  const result = boot('v-new', 'invalid-array');
  assert.equal(result.recorded.length, 1);
});
