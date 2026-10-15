import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../src/userscript/02-network-communication/06-segment-storage.js', import.meta.url), 'utf8');
test('light-theme deferral uses a one-shot, bounded attribute gate', () => {
  const fn = source.slice(source.indexOf('async function communicationLogStorageAppendRecord'));
  assert.match(fn, /startupGateSettled/);
  assert.match(fn, /prefers-color-scheme: dark/);
  assert.match(fn, /getAttribute\('data-theme'\) === 'light'/);
  assert.match(fn, /attributeFilter: \['data-theme'\]/);
  assert.match(fn, /setTimeout\(release, 8000\)/);
  assert.match(fn, /addEventListener\('pagehide', release/);
  assert.match(fn, /observer.disconnect\(\)/);
  assert.doesNotMatch(fn, /subtree: true|setInterval/);
});
test('startup gate precedes JSON serialization and storage append', () => {
  const fn = source.slice(source.indexOf('async function communicationLogStorageAppendRecord'));
  assert.ok(fn.indexOf('await communicationLogStorageAppendRecord.startupGate') <
    fn.indexOf('JSON.stringify(record)'));
  assert.ok(fn.indexOf('JSON.stringify(record)') < fn.indexOf('communicationLogWritable.write(line)'));
});
