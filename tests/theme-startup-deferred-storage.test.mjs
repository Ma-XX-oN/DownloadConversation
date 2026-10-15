import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../src/userscript/02-network-communication/06-segment-storage.js', import.meta.url), 'utf8');
test('light-theme gate is bounded, scoped and released on pagehide', () => {
  const start = source.indexOf('function communicationLogStartupThemeGate()');
  const end = source.indexOf('async function communicationLogStorageAppendRecord', start);
  const gate = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(gate, /prefers-color-scheme: dark/);
  assert.match(gate, /getAttribute\('data-theme'\) !== 'light'/);
  assert.match(gate, /attributeFilter: \['data-theme'\]/);
  assert.match(gate, /setTimeout\(done, 8000\)/);
  assert.match(gate, /window.addEventListener\('pagehide', done/);
  assert.match(gate, /observer.disconnect\(\)/);
  assert.doesNotMatch(gate, /subtree: true|setInterval/);
});
test('serialization and persistence are ordered after the bounded gate', () => {
  const fn = source.slice(source.indexOf('async function communicationLogStorageAppendRecord'));
  assert.ok(fn.indexOf('await communicationLogStartupThemeGate()') < fn.indexOf('JSON.stringify(record)'));
  assert.ok(fn.indexOf('JSON.stringify(record)') < fn.indexOf('communicationLogWritable.write(line)'));
});
