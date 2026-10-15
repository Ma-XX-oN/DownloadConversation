import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/userscript/07-panel-launcher/01-panel-diagnostics.js', import.meta.url),
  'utf8'
);
const start = source.indexOf('  function logDiagnostic(');
const end = source.indexOf('\n  }\n', start) + 4;
assert.ok(start >= 0 && end > start, 'diagnostic append implementation exists');
const factory = new Function(
  'diagnosticLog', 'MAX_DIAGNOSTIC_LOG_ITEMS',
  'diagnosticLogBaselineVersion', 'diagnosticEnabled',
  'redactDiagnosticSignedTokens', 'logConsoleDiagnostic',
  'schedulePersistDiagnosticLog', 'refreshDiagnosticLog',
  source.slice(start, end) +
  ';return { logDiagnostic, baseline: () => diagnosticLogBaselineVersion };'
);

function fixture(limit = 10000, accepts = () => true) {
  const log = [];
  let persisted = 0;
  let refreshed = 0;
  const instance = factory(
    log, limit, null, accepts, value => value, () => {},
    () => persisted++, () => refreshed++
  );
  return { ...instance, log, counts: () => [persisted, refreshed] };
}

function transition(runtime, version) {
  runtime.logDiagnostic('lifecycle', 'dc-version-transition', { version });
}

test('9999, 10000 and 10001 records keep latest 10000 and boundary baseline', () => {
  const runtime = fixture();
  transition(runtime, 'old');
  for (let i = 1; i < 9999; i++) runtime.logDiagnostic('debug', 'normal');
  assert.equal(runtime.log.length, 9999);
  assert.equal(runtime.baseline(), null);
  runtime.logDiagnostic('debug', 'at-boundary');
  assert.equal(runtime.log.length, 10000);
  assert.equal(runtime.baseline(), null);
  runtime.logDiagnostic('debug', 'overflow');
  assert.equal(runtime.log.length, 10000);
  assert.equal(runtime.baseline(), 'old');
  assert.equal(runtime.log[0].message, 'normal');
  assert.equal(runtime.counts()[0], 10001);
  assert.equal(runtime.counts()[1], 10001);
});

test('multiple upgrades and null transitions advance baseline only on eviction', () => {
  const runtime = fixture(2);
  transition(runtime, 'v1');
  transition(runtime, 'v2');
  assert.equal(runtime.baseline(), null);
  transition(runtime, null);
  assert.equal(runtime.baseline(), 'v1');
  assert.deepEqual(runtime.log.map(item => item.data.version), ['v2', null]);
  runtime.logDiagnostic('debug', 'ordinary');
  assert.equal(runtime.baseline(), 'v2');
  runtime.logDiagnostic('debug', 'ordinary-again');
  assert.equal(runtime.baseline(), null);
});

test('non-version evictions and discriminator failures never alter baseline', () => {
  const runtime = fixture(1);
  const invalid = [
    ['debug', 'dc-version-transition', { version: 'wrong' }],
    ['lifecycle', 'other', { version: 'wrong' }],
    ['lifecycle', 'dc-version-transition', { version: 3 }],
    ['lifecycle', 'dc-version-transition', {}],
    ['lifecycle', 'dc-version-transition', null]
  ];
  for (const [level, message, data] of invalid) {
    runtime.logDiagnostic(level, message, data);
    runtime.logDiagnostic('debug', 'eviction');
    assert.equal(runtime.baseline(), null);
  }
  transition(runtime, 'correct');
  runtime.logDiagnostic('debug', 'eviction');
  assert.equal(runtime.baseline(), 'correct');
  runtime.logDiagnostic('debug', 'later');
  assert.equal(runtime.baseline(), 'correct');
});

test('filtering preserves append side effects and ignores rejected levels', () => {
  const runtime = fixture(1, level => level === 'lifecycle');
  runtime.logDiagnostic('debug', 'not retained');
  assert.equal(runtime.log.length, 0);
  assert.deepEqual(runtime.counts(), [0, 0]);
  transition(runtime, 'v1');
  runtime.logDiagnostic('lifecycle', 'ordinary');
  assert.equal(runtime.baseline(), 'v1');
  assert.deepEqual(runtime.counts(), [2, 2]);
});

test('startup version shape is ordinary timestamped diagnostic', () => {
  const runtime = fixture(1);
  transition(runtime, '1.2.3');
  const entry = runtime.log[0];
  assert.deepEqual(Object.keys(entry), ['timestamp', 'level', 'message', 'data']);
  assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
  assert.deepEqual(entry.data, { version: '1.2.3' });
});

test('no all-record scan is needed on append without eviction', () => {
  const runtime = fixture(10000);
  const entry = new Proxy({ level: 'debug', message: 'normal', data: null }, {
    get(_target, property) {
      if (property === 'level' || property === 'message') {
        throw new Error('scanned retained entry');
      }
      return Reflect.get(_target, property);
    }
  });
  runtime.log.push(entry);
  runtime.logDiagnostic('debug', 'new entry');
  assert.equal(runtime.log.length, 2);
  assert.equal(runtime.baseline(), null);
});
