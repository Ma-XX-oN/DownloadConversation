import assert from 'node:assert/strict';
import test from 'node:test';

const at = (second) => new Date(Date.UTC(2026, 9, 12, 10, 0, second)).toISOString();
const transition = (second, version) => ({
  timestamp: at(second), level: 'lifecycle',
  message: 'dc-version-transition', data: { version }
});
const isTransition = entry => entry?.level === 'lifecycle'
  && entry.message === 'dc-version-transition'
  && entry.data !== null && typeof entry.data === 'object'
  && Object.hasOwn(entry.data, 'version')
  && (entry.data.version === null || typeof entry.data.version === 'string');
const effective = (baseline, entries, boundary) => entries.reduce(
  (current, entry) => isTransition(entry) && entry.timestamp <= boundary
    ? entry.data.version : current, baseline
);
const header = (gen, comm) => ({ version: { gen, comm } });
const isHeader = entry => entry !== null && typeof entry === 'object'
  && !Object.hasOwn(entry, 'timestamp')
  && entry.version !== null && typeof entry.version === 'object'
  && Object.hasOwn(entry.version, 'gen') && Object.hasOwn(entry.version, 'comm');

const cases = [
  ['startup at boundary', null, [transition(0, 'v1')], at(0), 'v1'],
  ['upgrade before boundary', 'v1', [transition(1, 'v2')], at(2), 'v2'],
  ['in-range upgrade after boundary', 'v1', [transition(2, 'v2')], at(1), 'v1'],
  ['evicted transition baseline', 'v2', [], at(3), 'v2'],
  ['reload persisted baseline', 'v1', [transition(1, 'v2')], at(3), 'v2'],
  ['legacy without provenance', null, [], at(3), null],
  ['explicit unknown transition', 'v1', [transition(1, null)], at(3), null],
  ['last transition wins', 'v1', [transition(1, 'v2'), transition(2, 'v3')], at(3), 'v3'],
  ['unrelated lifecycle ignored', null, [
    { ...transition(1, 'bad'), message: 'agent-lifecycle-state-changed' }
  ], at(3), null],
  ['malformed payload ignored', 'v1', [
    { ...transition(1, 'bad'), data: {} }
  ], at(3), 'v1']
];

for (const [name, baseline, events, boundary, expected] of cases) {
  test(name, () => assert.equal(effective(baseline, events, boundary), expected));
}

test('exact diagnostic predicate and timestamped ordinary shape', () => {
  const entry = transition(0, 'v1');
  assert.deepEqual(Object.keys(entry), ['timestamp', 'level', 'message', 'data']);
  assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
  assert.equal(isTransition(entry), true);
  assert.equal(isTransition({ ...entry, level: 'debug' }), false);
  assert.equal(isTransition({ ...entry, data: { version: 123 } }), false);
  assert.equal(isTransition({ ...entry, data: {} }), false);
});

test('memory and persisted rolling baselines survive eviction', () => {
  const records = Array.from({ length: 11000 }, (_, i) => ({
    timestamp: new Date(1730000000000 + i * 1000).toISOString(),
    level: 'debug', message: 'normal', data: { i }
  }));
  records[100] = { ...records[100], level: 'lifecycle',
    message: 'dc-version-transition', data: { version: 'v1' } };
  records[5500] = { ...records[5500], level: 'lifecycle',
    message: 'dc-version-transition', data: { version: 'v2' } };
  const memory = records.slice(-10000);
  const persisted = memory.slice(-5000);
  const beforeMemory = effective(null, records.slice(0, 1000), '9999');
  const beforePersisted = effective(beforeMemory, memory.slice(0, 5000), '9999');
  assert.equal(memory.length, 10000);
  assert.equal(persisted.length, 5000);
  assert.equal(beforeMemory, 'v1');
  assert.equal(beforePersisted, 'v2');
  assert.equal(effective(beforePersisted, persisted, '9999'), 'v2');
  assert.equal(records.length, 11000);
});

test('COMM fragment headers immutable and excluded from event counts/ranges', () => {
  const first = header('g1', 'c1');
  const frozenBytes = JSON.stringify(first);
  const fragments = [
    [first, { timestamp: at(0), kind: 'request' },
      { timestamp: at(1), kind: 'version-change', version: { comm: 'c2' } }],
    [header('g1', 'c2'), { timestamp: at(2), kind: 'request' }]
  ];
  const ordinary = fragments.flat().filter(record => !isHeader(record));
  assert.equal(fragments.every(fragment => isHeader(fragment[0])), true);
  assert.equal(fragments.every(fragment => !Object.hasOwn(fragment[0], 'timestamp')), true);
  assert.equal(ordinary.length, 3);
  assert.deepEqual(ordinary.map(item => item.timestamp), [at(0), at(1), at(2)]);
  assert.equal(JSON.stringify(first), frozenBytes);
});

test('combined export metadata once; nulls preserved; events unchanged', () => {
  const ordinary = [{ timestamp: at(1), kind: 'request' }];
  const output = [header(null, 'c1'), ...ordinary];
  assert.deepEqual(output[0], { version: { gen: null, comm: 'c1' } });
  assert.equal(output.filter(isHeader).length, 1);
  assert.deepEqual(output.filter(entry => !isHeader(entry)), ordinary);
});
