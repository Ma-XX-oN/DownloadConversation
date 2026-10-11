import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function filter(records, start, end) {
  const source = productionFunctionSource('communicationLogFilterJsonlBytes');
  const data = new TextEncoder().encode(
    records.map(record => JSON.stringify(record)).join('\n') + '\n'
  );
  const context = { TextDecoder, Uint8Array, data, lower: Date.parse(start), upper: Date.parse(end) };
  vm.runInNewContext(source + '\nthis.out = communicationLogFilterJsonlBytes(data, lower, upper);', context);
  return new TextDecoder().decode(context.out.bytes).trim().split('\n').map(JSON.parse);
}

test('date range keeps later in-range records even after a clock rollback', () => {
  const records = [
    { sequence: 1, timestamp: '2026-10-11T10:01:00.000Z' },
    { sequence: 2, timestamp: '2026-10-11T10:06:00.000Z' },
    { sequence: 3, timestamp: '2026-10-11T10:02:00.000Z' },
    { sequence: 4, timestamp: '2026-10-11T10:03:00.000Z' }
  ];
  const result = filter(records, '2026-10-11T10:00:00Z', '2026-10-11T10:04:00Z');
  assert.deepEqual(result.map(record => record.sequence), [1, 3, 4]);
});

test('range filtering never reorders or duplicates accepted communication records', () => {
  const records = [
    { sequence: 10, timestamp: '2026-10-11T10:03:00.000Z' },
    { sequence: 11, timestamp: '2026-10-11T10:01:00.000Z' },
    { sequence: 12, timestamp: '2026-10-11T10:02:00.000Z' }
  ];
  const result = filter(records, '2026-10-11T10:00:00Z', '2026-10-11T10:04:00Z');
  assert.deepEqual(result.map(record => record.sequence), [10, 11, 12]);
});
