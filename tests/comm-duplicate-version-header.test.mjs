import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL('../src/userscript/02-network-communication/06-segment-duplicate.js',
    import.meta.url), 'utf8'
);
const filter = runInNewContext(
  `${source}\ncommunicationLogFilterJsonlBytes`,
  { TextDecoder, Uint8Array, Date, JSON, Number, Object }
);
const encode = text => new TextEncoder().encode(text);
const decode = bytes => new TextDecoder().decode(bytes);
const t0 = '2026-10-12T10:00:00Z';
const t1 = '2026-10-12T11:00:00Z';
const t2 = '2026-10-12T12:00:00Z';
const header = '{"version":{"gen":"v1","comm":"v1"}}\n';
const event = (time, n) => JSON.stringify({ timestamp: time, n }) + '\n';

test('preserves exact original header on mid-fragment range', () => {
  const result = filter(encode(header + event(t0, 0) + event(t1, 1)),
    Date.parse(t1), Date.parse(t1));
  assert.equal(decode(result.bytes), header + event(t1, 1));
  assert.equal(result.start_timestamp, t1);
  assert.equal(result.end_timestamp, t1);
});

test('preserves exactly one header when range selects whole fragment', () => {
  const input = header + event(t0, 0) + event(t1, 1);
  assert.equal(decode(filter(encode(input), null, null).bytes), input);
});

test('legacy headerless fragment remains headerless', () => {
  const input = event(t0, 0) + event(t1, 1);
  assert.equal(decode(filter(encode(input), Date.parse(t1), null).bytes),
    event(t1, 1));
});

test('empty selected event range omits orphan metadata', () => {
  const result = filter(encode(header + event(t0, 0)), Date.parse(t2), null);
  assert.equal(result.bytes.byteLength, 0);
  assert.equal(result.start_timestamp, null);
  assert.equal(result.end_timestamp, null);
});

test('upper-bound scan retains later in-range records after a clock reversal', () => {
  const input = header + event(t0, 0) + event(t2, 2) + event(t1, 1);
  assert.equal(decode(filter(encode(input), null, Date.parse(t1)).bytes),
    header + event(t0, 0) + event(t1, 1));
});

test('malformed leading line cannot license a later header', () => {
  const input = 'INVALID\n' + header + event(t1, 1);
  assert.equal(decode(filter(encode(input), null, null).bytes),
    event(t1, 1));
});

test('timestamp-free metadata does not shift selected timestamp range', () => {
  const result = filter(encode(header + event(t1, 1)), null, null);
  assert.equal(result.start_timestamp, t1);
  assert.equal(result.end_timestamp, t1);
});

test('malformed event line is excluded while genuine header survives', () => {
  const result = filter(encode(header + 'INVALID\n' + event(t1, 1)),
    null, null);
  assert.equal(decode(result.bytes), header + event(t1, 1));
});

test('non-header version update remains outside header treatment', () => {
  const update = JSON.stringify({
    timestamp: t1, version: { gen: 'v2', comm: 'v2' }
  }) + '\n';
  const result = filter(encode(header + event(t0, 0) + update),
    Date.parse(t1), null);
  assert.equal(decode(result.bytes), header + update);
});
