import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL(
  '../src/userscript/01-runtime/' + path, import.meta.url
), 'utf8');
const bootstrap = read('01-bootstrap.js');
const restoration = read('01-bootstrap-restore.js');
const start = restoration.indexOf('  function restoreDiagnosticLog() {');
const end = restoration.indexOf('\n  restoreDiagnosticLog();', start);
assert.ok(start >= 0 && end > start);
const functionSource = restoration.slice(start, end);

function boot(version, stored = null) {
  const calls = [];
  const context = {
    DIAGNOSTIC_LOG_STORAGE_KEY: 'test-log',
    MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS: 5000,
    diagnosticLog: [],
    diagnosticLogBaselineVersion: null,
    sessionStorage: { getItem: () => stored === null ? null : JSON.stringify(stored) },
    logDiagnostic: (...args) => calls.push(args)
  };
  vm.runInNewContext(functionSource + '\nrestoreDiagnosticLog();'
    + '\nlogDiagnostic("lifecycle", "dc-version-transition", {version: ' 
    + JSON.stringify(version) + '});', context);
  return { entries: context.diagnosticLog, baseline: context.diagnosticLogBaselineVersion,
    calls };
}

test('one shared GEN baseline declaration exists before the restore segment', () => {
  assert.equal(bootstrap.split('let diagnosticLogBaselineVersion = null;').length - 1, 1);
});
test('fresh startup records one lifecycle version without inventing history', () => {
  const result = boot('v1');
  assert.equal(result.entries.length, 0);
  assert.equal(result.baseline, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0][0], 'lifecycle');
  assert.equal(result.calls[0][1], 'dc-version-transition');
  assert.equal(result.calls[0][2].version, 'v1');
});
test('legacy plain array restores records but not an invented version', () => {
  const result = boot('v5', [{timestamp:'2026-10-12T00:00:00Z',message:'legacy'}]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.baseline, null);
});
test('versioned snapshot restores prior effective version', () => {
  const result = boot('v5', {version_before_persisted:'v2',
    records:[{message:'retained'}]});
  assert.equal(result.baseline, 'v2');
  assert.equal(result.entries.length, 1);
});
