import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const names = [
  'mergedLogValidateSelection', 'mergedLogRangeFilter',
  'mergedLogParseJsonl', 'mergedLogValidPosition',
  'mergedLogComparePosition', 'mergedLogInterleave', 'mergedLogJsonl'
];
const source = names.map(productionFunctionSource).join('\n\n');

function call(name, ...args) {
  const context = {
    TextDecoder, Uint8Array, Number, Date, JSON,
    args, recordingGroupState: () => ({ uuid: 'recording-1' })
  };
  vm.runInNewContext(source + '\nthis.result = ' + name + '(...args);', context);
  return structuredClone(context.result);
}

const timestamp = (minutes) =>
  '2026-10-11T15:' + String(minutes).padStart(2, '0') + ':00.000Z';
const event = (source, ordinal, minute, epoch = 1) => ({
  source, timestamp: timestamp(minute),
  capture_order: { epoch, ordinal, document: 'doc-1' },
  recording_group_uuid: 'group-1'
});

test('selected source and time bounds are required', () => {
  assert.deepEqual(call('mergedLogValidateSelection', {
    general: true, communication: false,
    start_timestamp: timestamp(1), end_timestamp: timestamp(2)
  }), { lower: Date.parse(timestamp(1)), upper: Date.parse(timestamp(2)),
    general: true, communication: false });
  assert.throws(() => call('mergedLogValidateSelection', {
    general: false, communication: false,
    start_timestamp: timestamp(1), end_timestamp: timestamp(2)
  }), /Select Gen or Comm/);
  assert.throws(() => call('mergedLogValidateSelection', {
    general: true, communication: true,
    start_timestamp: timestamp(3), end_timestamp: timestamp(2)
  }), /ordered/);
});

test('filtering keeps source order after repeated clock rollbacks', () => {
  const input = [event('g', 1, 2), event('g', 2, 9),
    event('g', 3, 4), event('g', 4, 1)];
  const kept = call('mergedLogRangeFilter', input,
    Date.parse(timestamp(2)), Date.parse(timestamp(5)));
  assert.deepEqual(kept.map(item => item.capture_order.ordinal), [1, 3]);
});

test('interleaving follows capture ordinals, never timestamps', () => {
  const general = [event('g', 1, 30), event('g', 3, 2),
    event('g', 6, 10)];
  const communication = [event('c', 2, 1),
    event('c', 4, 11), event('c', 5, 3)];
  const merged = call('mergedLogInterleave', general, communication);
  assert.equal(merged.ordering, 'capture-sequence');
  assert.deepEqual(merged.entries.map(e => e.record.capture_order.ordinal),
    [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(merged.entries.map(e => e.source),
    ['gen', 'comm', 'gen', 'comm', 'comm', 'gen']);
});

test('legacy events remain intact as explicitly uncertain source ranges', () => {
  const general = [event('g', 1, 9), {
    timestamp: timestamp(1), source: 'legacy'
  }];
  const comm = [event('c', 2, 2), event('c', 3, 4)];
  const merged = call('mergedLogInterleave', general, comm);
  assert.equal(merged.ordering, 'legacy-source-ranges');
  assert.deepEqual(merged.entries.map(e => e.source),
    ['gen', 'gen', 'comm', 'comm']);
});

test('JSONL export identifies sources, bounds, grouping and ordering', () => {
  const start_timestamp = timestamp(0);
  const end_timestamp = timestamp(59);
  const merge = call('mergedLogInterleave',
    [event('g', 1, 1)], [event('c', 2, 2)]);
  const text = call('mergedLogJsonl', merge, {
    start_timestamp, end_timestamp
  });
  assert.ok(text.endsWith('\n'));
  const lines = text.trimEnd().split('\n').map(JSON.parse);
  assert.equal(lines[0].ordering, 'capture-sequence');
  assert.equal(lines[0].group_uuid, 'recording-1');
  assert.equal(lines[0].start_timestamp, start_timestamp);
  assert.equal(lines[0].end_timestamp, end_timestamp);
  assert.deepEqual(lines.slice(1).map(r => r.source), ['gen', 'comm']);
});

test('communication JSONL parser keeps source order and skips torn tail', () => {
  const source = new TextEncoder().encode(
    '{"sequence":2,"timestamp":"' + timestamp(4) + '"}\n'
    + '{"sequence":1,"timestamp":"' + timestamp(2) + '"}\n'
    + '{"incomplete":'
  );
  const rows = call('mergedLogParseJsonl', source);
  assert.deepEqual(rows.map(row => row.sequence), [2, 1]);
});

test('different live documents without a shared group never claim exact ordering', () => {
  const general = [event('g', 1, 2)];
  const other = { ...event('c', 2, 1),
    capture_order: { epoch: 1, ordinal: 2, document: 'doc-2' },
    recording_group_uuid: null
  };
  const merged = call('mergedLogInterleave', general, [other]);
  assert.equal(merged.ordering, 'legacy-source-ranges');
  assert.deepEqual(merged.entries.map(row => row.source), ['gen', 'comm']);
});

test('restored documents in the same group retain verifiable epoch order', () => {
  const first = event('g', 3, 30);
  const second = { ...event('c', 1, 1, 2),
    capture_order: { epoch: 2, ordinal: 1, document: 'doc-2' }
  };
  const merged = call('mergedLogInterleave', [first], [second]);
  assert.equal(merged.ordering, 'capture-sequence');
  assert.deepEqual(merged.entries.map(row => row.source), ['gen', 'comm']);
});

test('malformed complete communication records fail instead of silently disappearing', () => {
  const complete = new TextEncoder().encode(
    '{"timestamp":"' + timestamp(1) + '"}\n' + '{"broken":}\n'
  );
  assert.throws(() => call('mergedLogParseJsonl', complete),
    /Malformed complete communication JSONL/);
});

test('inconsistent original source ordering remains unchanged and explicitly flagged', () => {
  const general = [event('g', 9, 1), event('g', 2, 3)];
  const communication = [event('c', 3, 2)];
  const result = call('mergedLogInterleave', general, communication);
  assert.equal(result.ordering, 'source-order-conflict');
  assert.deepEqual(result.entries.map(item => item.record.capture_order.ordinal),
    [9, 2, 3]);
});


test('merged exports use the mlog extension with the existing compressor', () => {
  const exporter = productionFunctionSource('saveMergedLogs');
  assert.match(exporter, /const suffix = '\.mlog' \+ compressorExtension\(\);/);
  assert.doesNotMatch(exporter, /\.merged\.log/);
});
