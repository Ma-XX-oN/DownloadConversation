import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/userscript/01-runtime/01-bootstrap-restore.js', import.meta.url),
  'utf8'
);
const beginning = source.indexOf('  function restoreDiagnosticLog() {');
const ending = source.indexOf('\n  restoreDiagnosticLog();', beginning);
assert(beginning >= 0 && ending > beginning);
const restore = source.slice(beginning, ending);

function reload(raw, version = '3') {
  const context = vm.createContext({
    raw,
    diagnosticLog: [{ message: 'stale' }],
    diagnosticLogBaselineVersion: 'stale',
    DIAGNOSTIC_LOG_STORAGE_KEY: 'diagnostics',
    MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS: 5000,
    sessionStorage: { getItem: () => raw }
  });
  vm.runInContext(restore + '\nrestoreDiagnosticLog();', context);
  // #235's startup event uses the normal logger; it is not a restore mutation.
  const calls = [];
  const logDiagnostic = (...args) => calls.push(args);
  logDiagnostic('lifecycle', 'dc-version-transition', { version });
  return {
    entries: JSON.parse(JSON.stringify(context.diagnosticLog)),
    baseline: context.diagnosticLogBaselineVersion,
    calls
  };
}

test('absent storage leaves unknown baseline and records startup', () => {
  const result = reload(null);
  assert.deepEqual(result.entries, []);
  assert.equal(result.baseline, null);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0], ['lifecycle', 'dc-version-transition', { version: '3' }]);
});

test('legacy array never substitutes the current version for unknown history', () => {
  const result = reload(JSON.stringify([{ message: 'previous' }]));
  assert.equal(result.entries.length, 1);
  assert.equal(result.baseline, null);
});

test('versioned snapshot restores exact historical baseline', () => {
  const result = reload(JSON.stringify({
    version_before_persisted: '1',
    records: [{ level: 'lifecycle', message: 'dc-version-transition', data: { version: '2' } }]
  }));
  assert.equal(result.baseline, '1');
  assert.equal(result.entries[0].data.version, '2');
});

test('malformed, incomplete and invalid storage cannot restore partial metadata', () => {
  for (const raw of ['{', '{"records":[]}', '{"records":"x","version_before_persisted":null}',
    '{"records":[],"version_before_persisted":42}', '{"records":[null],"version_before_persisted":"1"}']) {
    const result = reload(raw);
    assert.equal(result.entries.length, 0);
    assert.equal(result.baseline, null);
  }
});

test('trimmed snapshots advance baseline through omitted transitions', () => {
  const records = [
    { level: 'lifecycle', message: 'dc-version-transition', data: { version: '2' } },
    { level: 'lifecycle', message: 'dc-version-transition', data: { version: '3' } },
    ...Array.from({ length: 5000 }, (_, i) => ({ message: String(i) }))
  ];
  const result = reload(JSON.stringify({ records, version_before_persisted: '1' }));
  assert.equal(result.entries.length, 5000);
  assert.equal(result.baseline, '3');
});

test('invalid discriminators do not change a trimmed baseline', () => {
  const records = [
    { level: 'warnings', message: 'dc-version-transition', data: { version: 'X' } },
    ...Array.from({ length: 5000 }, () => ({ message: 'normal' }))
  ];
  const result = reload(JSON.stringify({ records, version_before_persisted: null }));
  assert.equal(result.baseline, null);
});

test('bootstrap emits exactly one ordinary startup transition after restore', () => {
  const startup = source.slice(source.indexOf('  restoreDiagnosticLog();'));
  assert.match(startup, /restoreDiagnosticLog\(\);\s*\/\/ #234 provenance:[^\n]*\n[^\n]*\n\s*logDiagnostic\('lifecycle', 'dc-version-transition', \{ version: VERSION \}\)/);
  assert.equal(source.match(/logDiagnostic\('lifecycle', 'dc-version-transition', \{ version: VERSION \}\)/g)?.length, 1);
});

test('session storage access failures preserve unknown historical provenance', () => {
  const context = vm.createContext({
    diagnosticLog: [{ message: 'stale' }],
    diagnosticLogBaselineVersion: 'stale',
    DIAGNOSTIC_LOG_STORAGE_KEY: 'diagnostics',
    MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS: 5000,
    sessionStorage: { getItem() { throw new Error('blocked'); } }
  });
  vm.runInContext(restore + '\nrestoreDiagnosticLog();', context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.diagnosticLog)), []);
  assert.equal(context.diagnosticLogBaselineVersion, null);
});
