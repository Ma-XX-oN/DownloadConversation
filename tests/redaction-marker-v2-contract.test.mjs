import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/redaction-marker-v2.json', import.meta.url), 'utf8'));
const digest = (key, value) => {
  const raw = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(raw.length);
  return createHmac('sha256', Buffer.from(key, 'hex'))
    .update(Buffer.from('DC-SECRET-ID-V1\0', 'utf8'))
    .update(length).update(raw).digest('hex').slice(0, 48);
};
const checksum = body => createHash('sha256')
  .update(Buffer.from('DC-SECRET-MARKER-V1\0', 'utf8'))
  .update(body, 'ascii').digest('hex').slice(0, 32);
const parseMarker = text => {
  const match = /^\[([0-9a-f]{32})\/([UHBPJO])\/([0-9a-f]{48})(?:\/([a-z0-9,]{1,256}))?\]$/
    .exec(text);
  if (!match || text.length > 342) return null;
  const [, check, type, id, params] = match;
  const body = type + '/' + id + (params === undefined ? '' : '/' + params);
  return checksum(body) === check ? { type, id, params } : null;
};
const validMetadata = cycle =>
  cycle.format === 'dc-secret-marker/2' &&
  cycle.storage === 'chatgpt-origin-indexeddb' &&
  Number.isSafeInteger(cycle.epoch) && cycle.epoch > 0 &&
  typeof cycle.key_restart === 'string' &&
  !Number.isNaN(Date.parse(cycle.key_restart)) &&
  new Date(cycle.key_restart).toISOString() === cycle.key_restart &&
  !('generation' in cycle) && !('scope' in cycle);

test('sole key identity is strictly ordered UTC timestamp, no random label', () => {
  assert.equal(fixture.format, 'dc-secret-marker/2');
  assert.equal(fixture.fixture_version, 3);
  assert.equal(fixture.synthetic_only, true);
  assert.equal(fixture.public_test_keys_only, true);
  assert.equal(fixture.cycles.length, 2);
  for (const cycle of fixture.cycles) {
    assert.ok(validMetadata({ ...cycle, format: fixture.format,
      storage: 'chatgpt-origin-indexeddb' }));
    assert.match(cycle.key_hex, /^[0-9a-f]{64}$/);
  }
  assert.ok(Date.parse(fixture.cycles[1].key_restart) >
    Date.parse(fixture.cycles[0].key_restart));
  const c = fixture.cycles[0];
  for (const bad of [
    { key_restart: 'bad' }, { key_restart: undefined },
    { key_restart: '2026-10-22T16:30:00.123+00:00' },
    { generation: 'f'.repeat(32) }, { scope: 'f'.repeat(32) },
    { epoch: 0 }, { format: 'dc-secret-marker/1' }
  ]) {
    assert.equal(validMetadata({ ...c, format: fixture.format,
      storage: 'chatgpt-origin-indexeddb', ...bad }), false);
  }
});

test('same HMAC under one key, rotated key changes marker, no V1 input', () => {
  assert.equal(Buffer.byteLength(fixture.secret), 10);
  assert.equal(fixture.secret.length, 5);
  const markers = [];
  for (const cycle of fixture.cycles) {
    const id = digest(cycle.key_hex, fixture.secret);
    const body = fixture.type + '/' + id + '/' + fixture.params;
    const check = checksum(body);
    assert.equal(id, cycle.id);
    assert.equal(check, cycle.check);
    const marker = '[' + check + '/' + body + ']';
    markers.push(marker);
    assert.equal(digest(cycle.key_hex, fixture.secret), id);
    for (let i = 0; i <= marker.length; i++) {
      assert.deepEqual(parseMarker(marker.slice(0, i) + marker.slice(i)),
        { type: fixture.type, id, params: fixture.params });
    }
    assert.equal(parseMarker(marker.replace(check, '0'.repeat(32))), null);
    assert.equal(parseMarker(marker.replace('/1234]', '/01234]')), null);
    assert.notEqual(checksum('O/' + id + '/4321'), check);
  }
  assert.notEqual(markers[0], markers[1]);
  assert.equal(parseMarker(markers[0].toUpperCase()), null);
  assert.equal(parseMarker('[redacted]'), null);
  assert.equal(parseMarker(markers[0].replace('/O/', '/Z/')), null);
});

test('synthetic types, width and contexts validate without V1 fixture', () => {
  const cycle = fixture.cycles[1];
  for (const [i, sample] of fixture.synthetic_inputs.entries()) {
    const vector = fixture.rotated_vectors[i];
    assert.equal(vector.type, sample.type);
    const id = digest(cycle.key_hex, sample.original);
    assert.equal(id, vector.id);
    const body = sample.type + '/' + id +
      (sample.params === null ? '' : '/' + sample.params);
    assert.equal(checksum(body), vector.check);
    const marker = '[' + vector.check + '/' + body + ']';
    assert.deepEqual(parseMarker(marker), {
      type: sample.type, id,
      params: sample.params === null ? undefined : sample.params
    });
  }
  const contexts = [
    'http.header.value', 'http.query.value', 'json.string',
    'sse.data.json.string', 'ws.text.json.string', 'text.plain', 'ws.binary'
  ];
  assert.deepEqual(fixture.channels.map(item => item.context), contexts);
  assert.equal(fixture.channels[5].expected, 'UNINSPECTED_OR_UNSUPPORTED');
  assert.equal(fixture.channels[6].expected, 'UNINSPECTED_OR_UNSUPPORTED');
});

test('synthetic marker transport preserves full exact text', () => {
  const cycle = fixture.cycles[0];
  const id = digest(cycle.key_hex, fixture.secret);
  const body = fixture.type + '/' + id + '/' + fixture.params;
  const marker = '[' + checksum(body) + '/' + body + ']';
  const json = JSON.stringify({ credential: marker });
  assert.equal(JSON.parse(json).credential, marker);
  const sse = 'data: ' + json + '\n\n';
  assert.equal(JSON.parse(sse.slice(6).trim()).credential, marker);
  const ws = JSON.stringify({ type: 'synthetic', value: marker });
  assert.equal(JSON.parse(ws).value, marker);
  const url = new URL('https://synthetic.invalid/?secret=' +
    encodeURIComponent(marker));
  assert.equal(url.searchParams.get('secret'), marker);
  const header = new Headers([['X-Synthetic-Credential', marker]]);
  assert.equal(header.get('x-synthetic-credential'), marker);
  const forgedId = 'f'.repeat(48);
  const forgedBody = 'O/' + forgedId + '/1234';
  const forged = '[' + checksum(forgedBody) + '/' + forgedBody + ']';
  assert.equal(parseMarker(forged).id, forgedId);
  assert.notEqual(parseMarker(forged).id, id);
  // Public checksum validates shape, never credential authenticity.
});
