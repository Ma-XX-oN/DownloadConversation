import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/redaction-marker-v2.json', import.meta.url), 'utf8'));
const v1 = JSON.parse(readFileSync(
  new URL('./fixtures/redaction-marker-v1.json', import.meta.url), 'utf8'));
assert.equal(v1.format, 'dc-secret-marker/1');
const digest = (key, value) => {
  const raw = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(raw.length);
  return createHmac('sha256', Buffer.from(key, 'hex'))
    .update(Buffer.from('DC-SECRET-ID-V1\0', 'utf8'))
    .update(length).update(raw).digest('hex').slice(0, 48);
};
const checksum = (body) => createHash('sha256')
  .update(Buffer.from('DC-SECRET-MARKER-V1\0', 'utf8'))
  .update(body, 'ascii').digest('hex').slice(0, 32);
const parseMarker = (text) => {
  const match = /^\[([0-9a-f]{32})\/([UHBPJO])\/([0-9a-f]{48})(?:\/([a-z0-9,]{1,256}))?\]$/
    .exec(text);
  if (!match) return null;
  const [, check, type, id, params] = match;
  const body = type + '/' + id + (params === undefined ? '' : '/' + params);
  return checksum(body) === check ? { type, id, params } : null;
};
const validMetadata = (g) => Number.isSafeInteger(g.epoch) &&
  g.epoch > 0 && /^[0-9a-f]{32}$/.test(g.scope) &&
  g.scope === g.generation;
assert.equal(fixture.format, 'dc-secret-marker/2');
assert.equal(fixture.synthetic_only, true);
assert.equal(Buffer.byteLength(fixture.secret), 10);
assert.equal(fixture.secret.length, 5);
const markers = [];
for (const generation of fixture.generations) {
  const metadata = { ...generation, generation: generation.scope };
  assert.ok(validMetadata(metadata));
  const id = digest(generation.key_hex, fixture.secret);
  const body = fixture.type + '/' + id + '/' + fixture.params;
  const check = checksum(body);
  assert.equal(id, generation.id);
  assert.equal(check, generation.check);
  const marker = '[' + check + '/' + body + ']';
  markers.push(marker);
  const reload = digest(generation.key_hex, fixture.secret);
  assert.equal(reload, id);
  for (let i = 0; i <= marker.length; i++) {
    assert.deepEqual(parseMarker(marker.slice(0, i) + marker.slice(i)),
      { type: fixture.type, id, params: fixture.params });
  }
  assert.equal(parseMarker(marker.replace(check, '0'.repeat(32))), null);
  assert.equal(parseMarker(marker.replace('/1234]', '/01234]')), null);
  assert.notEqual(checksum('O/' + id + '/4321'), check);
}
assert.notEqual(markers[0], markers[1]);
assert.notEqual(fixture.generations[0].scope, fixture.generations[1].scope);
assert.equal(validMetadata({ epoch: 0, scope: fixture.generations[0].scope,
  generation: fixture.generations[0].scope }), false);
assert.equal(validMetadata({ epoch: 1, scope: fixture.generations[0].scope,
  generation: fixture.generations[1].scope }), false);
assert.equal(validMetadata({ epoch: 1, scope: undefined,
  generation: fixture.generations[0].scope }), false);
assert.equal(fixture.scenarios.length, 10);
for (const vector of v1.vectors) {
  assert.equal(digest(v1.test_hmac_key_hex, vector.original), vector.id);
  const body = vector.type + '/' + vector.id +
    (vector.params === null ? '' : '/' + vector.params);
  assert.equal(checksum(body), vector.check);
  assert.deepEqual(parseMarker(vector.marker), {
    type: vector.type, id: vector.id,
    params: vector.params === null ? undefined : vector.params
  });
}
assert.equal(parseMarker('[redacted]'), null);
assert.equal(parseMarker(markers[0].replace('/O/', '/Z/')), null);
console.log('PASS: V2 independent HMAC/checksum, reload, rotation, Unicode, splits and negatives');
