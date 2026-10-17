// Synthetic protocol vectors only; no authentic recordings.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/redaction-marker-v1.json', import.meta.url), 'utf8'
));
const key = Buffer.from(fixture.test_hmac_key_hex, 'hex');
const pre = Buffer.from('DC-SECRET-ID-V1\0');
const markerPre = Buffer.from('DC-SECRET-MARKER-V1\0');

function makeMarker(item) {
  const raw = Buffer.from(item.original, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(raw.length);
  const id = createHmac('sha256', key).update(pre)
    .update(len).update(raw).digest('hex').slice(0, 48);
  const body = item.type + '/' + id +
    (item.params === null ? '' : '/' + item.params);
  const check = createHash('sha256').update(markerPre)
    .update(body, 'ascii').digest('hex').slice(0, 32);
  return { id, check, marker: '[' + check + '/' + body + ']' };
}

function parseMarker(text) {
  const full = /^\[([0-9a-f]{32})\/([UHBPJO])\/([0-9a-f]{48})(?:\/([a-z0-9,]{1,256}))?\]$/;
  const m = full.exec(text);
  if (!m || text.length > 342) return null;
  const [, check, type, id, params] = m;
  if ((type === 'U' || type === 'P') && params !== undefined) return null;
  if (type === 'H' && (!/^[1-9][0-9]{0,2}$/.test(params ?? '') ||
    Number(params) < 2 || Number(params) > 256 || Number(params) % 2)) return null;
  if (type === 'B' && (!/^[1-9][0-9]{0,2}$/.test(params ?? '') ||
    Number(params) < 4 || Number(params) > 256 || Number(params) % 4 === 1)) return null;
  if (type === 'O' && !/^[1234]{1,128}$/.test(params ?? '')) return null;
  if (type === 'J') {
    if (!/^[1-9][0-9]{0,2}(?:,[1-9][0-9]{0,2}){2}$/.test(params ?? '')) return null;
    const parts = params.split(',').map(Number);
    if (parts.some(n => n < 4 || n > 512 || n % 4 === 1) ||
      parts.reduce((a, b) => a + b, 0) > 1024) return null;
  }
  const body = type + '/' + id + (params === undefined ? '' : '/' + params);
  const wanted = createHash('sha256').update(markerPre)
    .update(body, 'ascii').digest('hex').slice(0, 32);
  return check === wanted ? { type, id, params: params ?? null } : null;
}

test('version, synthetic key and scope format', () => {
  assert.equal(fixture.format, 'dc-secret-marker/1');
  assert.equal(fixture.synthetic_only, true);
  assert.match(fixture.test_scope, /^[0-9a-f]{32}$/);
  assert.equal(key.length, 32);
});

test('independent HMAC, marker digest and Unicode lengths', () => {
  for (const vector of fixture.vectors) {
    assert.deepEqual(makeMarker(vector), {
      id: vector.id, check: vector.check, marker: vector.marker
    }, vector.name);
    assert.equal(Buffer.byteLength(vector.original, 'utf8'),
      vector.utf8_bytes, vector.name);
    assert.equal(vector.original.length, vector.utf16_units, vector.name);
    assert.deepEqual(parseMarker(vector.marker), {
      type: vector.type, id: vector.id, params: vector.params
    }, vector.name);
  }
});

test('all two-chunk marker splits preserve bytes and parsing', () => {
  for (const { marker } of fixture.vectors) {
    for (let i = 0; i <= marker.length; i++) {
      const chunks = [marker.slice(0, i), marker.slice(i)];
      assert.ok(parseMarker(chunks.join('')), String(i));
    }
  }
});

test('malformed, unknown and noncanonical strings fail validation', () => {
  for (const row of fixture.scenarios) {
    if (row.expected === 'REJECT' && row.marker) {
      assert.equal(parseMarker(row.marker), null, row.name);
    }
  }
  assert.equal(parseMarker('[redacted]'), null);
  assert.equal(parseMarker('[[plain]'), null);
  assert.equal(parseMarker('[abc/U/def]'), null);
});

test('rechecks canonical parameter shapes despite a correctly forged checksum', () => {
  const id = fixture.vectors[0].id;
  for (const [type, params] of [['H', '3'], ['H', '257'],
    ['B', '5'], ['J', '4,5,4'], ['O', '0'], ['U', '12']]) {
    const body = type + '/' + id + '/' + params;
    const sum = createHash('sha256').update(markerPre)
      .update(body, 'ascii').digest('hex').slice(0, 32);
    assert.equal(parseMarker('[' + sum + '/' + body + ']'), null);
  }
});

test('record lengths are not marker lengths', () => {
  for (const vector of fixture.vectors) {
    assert.notEqual(Buffer.byteLength(vector.marker), vector.utf8_bytes);
  }
});

test('synthetic JSON and SSE envelopes parse without marker rewriting', () => {
  const json = fixture.scenarios.find(row => row.name === 'json-string');
  const sse = fixture.scenarios.find(row => row.name === 'sse-data-json');
  assert.equal(JSON.parse(json.input).ordinary, '[ok]');
  assert.ok(sse.input.startsWith('data: '));
  assert.equal(JSON.parse(sse.input.slice(6).trim()).token, 'YWJjZA');
});

test('same secret yields same id; rotating key changes id', () => {
  const row = fixture.vectors[0];
  assert.equal(makeMarker(row).id, makeMarker(row).id);
  const raw = Buffer.from(row.original, 'utf8');
  const count = Buffer.alloc(4);
  count.writeUInt32BE(raw.length);
  const rotated = createHmac('sha256', Buffer.alloc(32, 42))
    .update(pre).update(count).update(raw).digest('hex').slice(0, 48);
  assert.notEqual(rotated, row.id);
});
