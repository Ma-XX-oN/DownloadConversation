import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../src/userscript/06-image-export-tests/05-modal-contract.js', import.meta.url),
  'utf8'
);
const start = source.indexOf('  function persistDiagnosticLog() {');
const end = source.indexOf('\n  /**\n   * Schedules a bounded diagnostic-log persistence write.', start);
assert.ok(start >= 0 && end > start);
const fn = source.slice(start, end);
const entry = (version, timestamp = '2026-10-12T12:00:00Z') => ({
  timestamp, level: 'lifecycle', message: 'dc-version-transition',
  data: { version }
});
const ordinary = i => ({ timestamp: new Date(1700000000000 + i).toISOString(),
  level: 'debug', message: 'other', data: { i } });

function persist(records, baseline = null, options = {}) {
  let writes = 0;
  let bytes = null;
  const ctx = {
    diagnosticLog: records,
    diagnosticLogBaselineVersion: baseline,
    MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS: 5000,
    DIAGNOSTIC_LOG_STORAGE_KEY: 'diagnostic',
    sessionStorage: { setItem: (key, value) => {
      assert.equal(key, 'diagnostic');
      writes++;
      if (options.throwQuota) throw Error('QuotaExceededError');
      bytes = value;
    } }
  };
  vm.runInNewContext(fn + '\npersistDiagnosticLog()', ctx);
  return { writes, snapshot: bytes === null ? null : JSON.parse(bytes), bytes };
}

for (const count of [0, 4999, 5000, 5001, 10000]) {
  test('retains correct last 5000 from ' + count, () => {
    const events = Array.from({ length: count }, (_, i) => ordinary(i));
    const output = persist(events, 'old');
    assert.equal(output.writes, 1);
    assert.equal(output.snapshot.records.length, Math.min(count, 5000));
    assert.equal(output.snapshot.version_before_persisted, 'old');
    if (count > 5000) {
      assert.equal(output.snapshot.records[0].data.i, count - 5000);
    }
    assert.equal(events.length, count);
  });
}

test('prior transition in discarded prefix sets effective version', () => {
  const events = Array.from({ length: 5001 }, (_, i) => ordinary(i));
  events[0] = entry('new');
  const output = persist(events, 'old');
  assert.equal(output.snapshot.version_before_persisted, 'new');
  assert.equal(output.snapshot.records.length, 5000);
});

test('transition in persisted window remains in window, baseline unchanged', () => {
  const events = Array.from({ length: 5001 }, (_, i) => ordinary(i));
  events[1] = entry('new');
  const output = persist(events, 'old');
  assert.equal(output.snapshot.version_before_persisted, 'old');
  assert.equal(output.snapshot.records[0].data.i, 1);
  assert.equal(output.snapshot.records[0].data.version, 'new');
});

test('multiple prior upgrades resolve last valid and nullable change', () => {
  const events = Array.from({ length: 5003 }, (_, i) => ordinary(i));
  events[0] = entry('v1');
  events[1] = entry(null);
  events[2] = entry('v3');
  const output = persist(events, null);
  assert.equal(output.snapshot.version_before_persisted, 'v3');
});

test('nonmatching lifecycle metadata never changes baseline', () => {
  const events = Array.from({ length: 5001 }, (_, i) => ordinary(i));
  events[0] = { ...entry('bogus'), message: 'agent-lifecycle-state-changed' };
  assert.equal(persist(events, null).snapshot.version_before_persisted, null);
});

test('quota failure does not mutate source, throw or commit partial payload', () => {
  const events = [entry('v1'), ordinary(1)];
  const original = JSON.stringify(events);
  const output = persist(events, null, { throwQuota: true });
  assert.equal(output.writes, 1);
  assert.equal(output.snapshot, null);
  assert.equal(JSON.stringify(events), original);
});

test('snapshot is written atomically in one setItem operation', () => {
  const output = persist([entry('v1')], null);
  assert.equal(output.writes, 1);
  assert.deepEqual(Object.keys(output.snapshot).sort(),
    ['records', 'version_before_persisted']);
});

test('serializer uses existing debounce and no mutation of legacy records', () => {
  assert.match(source, /function schedulePersistDiagnosticLog\(\)/);
  assert.match(source, /DIAGNOSTIC_PERSIST_DELAY_MS/);
  assert.doesNotMatch(fn, /diagnosticLog\.(?:splice|shift|pop|push)\(/);
});
