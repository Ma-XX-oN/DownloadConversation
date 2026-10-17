import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { diskHarnessSource } from './helpers/userscript-source.mjs';
import { SecretMarkerDecoder, decodeText, measureLogicalLength } from './vendor/rwf673-secret-marker-decoder.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/redaction-marker-v1.json', import.meta.url), 'utf8'));
const source = ['../src/userscript/02-network-communication/04a-marker-encoder.js',
  '../src/userscript/02-network-communication/04b-marker-encoder-stream.js']
  .map(p => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
function makeProducer() {
  let calls = 0;
  const crypto = { subtle: webcrypto.subtle, getRandomValues(bytes) {
    bytes.set(Buffer.from(calls++ === 0 ? fixture.test_scope : fixture.test_hmac_key_hex, 'hex'));
    return bytes;
  } };
  return vm.runInNewContext('(function(){' + source + '\nreturn {' +
    'scope:communicationMarkerV1Scope,make:communicationMarkerV1Make,' +
    'jsonState:communicationMarkerV1JsonState,jsonFeed:communicationMarkerV1JsonFeed,' +
    'bodyState:communicationMarkerV1BodyState,bodyFeed:communicationMarkerV1BodyFeed' +
    '};})()', { crypto, TextEncoder, TextDecoder, Uint8Array, DataView,
      atob, btoa, URL, location: { href: 'https://chatgpt.com/', origin: 'https://chatgpt.com' } });
}
test('golden vectors from producer through checked decoder', async () => {
  const p = makeProducer();
  assert.equal(p.scope, fixture.test_scope);
  const decoder = new SecretMarkerDecoder({ redaction_format: fixture.format, redaction_scope: p.scope });
  for (const v of fixture.vectors) {
    const checked = await p.make(v.original, 'json.string', v.type === 'O', [v.type]);
    assert.equal(checked, v.marker);
    const value = decoder.decodeMarker(checked);
    assert.deepEqual(measureLogicalLength(value), [v.utf8_bytes, v.utf16_units]);
    assert.equal(decoder.decodeMarker(checked), value);
  }
});

test('JSON HTTP, fetch, XHR and WebSocket producer output round-trips synthetically', async () => {
  const producer = makeProducer();
  for (const transport of ['fetch', 'xhr', 'websocket']) {
    const frame = JSON.stringify({ token: fixture.vectors[0].original,
      nested: [fixture.vectors[1].original, '[ordinary]'], count: 3 });
    const state = producer.bodyState('application/json', transport);
    let encoded = '';
    for (const fragment of frame) encoded += await producer.bodyFeed(state, fragment);
    encoded += await producer.bodyFeed(state, '', true);
    assert.equal(encoded.includes(fixture.vectors[0].original), false);
    assert.equal(encoded.includes(fixture.vectors[1].original), false);
    const metadata = { redaction_format: fixture.format, redaction_scope: producer.scope };
    const parsed = JSON.parse(encoded);
    const decoded = JSON.parse(decodeText(encoded, metadata));
    assert.equal(parsed.token, fixture.vectors[0].marker);
    assert.equal(parsed.nested[1], '[ordinary]');
    assert.equal(decoded.nested[1], '[ordinary]');
    assert.deepEqual(measureLogicalLength(decoded.token),
      [fixture.vectors[0].utf8_bytes, fixture.vectors[0].utf16_units]);
  }
});

test('synthetic SSE framing, out-of-order playback and every marker split', async () => {
  const producer = makeProducer();
  const event = 'event: message\ndata: ' +
    JSON.stringify({ token: fixture.vectors[3].original, note: '[ok]' }) +
    '\n\ndata: [DONE]\n\n';
  const state = producer.bodyState('text/event-stream', 'fetch');
  const encoded = await producer.bodyFeed(state, event, true);
  assert.equal(encoded.includes(fixture.vectors[3].original), false);
  const metadata = { redaction_format: fixture.format, redaction_scope: producer.scope };
  let expected = null;
  for (let split = 0; split <= encoded.length; split++) {
    const decoder = new SecretMarkerDecoder(metadata);
    const result = decoder.feed(encoded.slice(0, split)) +
      decoder.feed(encoded.slice(split), true);
    if (expected !== null) assert.equal(result, expected, 'split ' + split);
    expected = result;
  }
  assert.ok(expected.endsWith('data: [DONE]\n\n'));
  assert.equal(JSON.parse(expected.split('\n')[1].slice(6)).note, '[ok]');
  const decoder = new SecretMarkerDecoder(metadata);
  const reversed = [fixture.vectors[3], fixture.vectors[0]].reverse();
  const first = reversed.map(row => decoder.decodeMarker(row.marker));
  const second = reversed.map(row => decoder.decodeMarker(row.marker));
  assert.deepEqual(first, second);
});

test('literal brackets survive while checked collisions and forged markers fail', async () => {
  const producer = makeProducer();
  const state = producer.jsonState('json.string');
  const malformed = fixture.scenarios.find(row => row.name === 'invalid-checksum').marker;
  const safe = await producer.jsonFeed(state,
    JSON.stringify({ note: '[plain] ' + malformed }), true);
  assert.equal(JSON.parse(safe).note, '[plain] ' + malformed);
  const collision = JSON.stringify({ note: fixture.vectors[0].marker });
  await assert.rejects(() => producer.jsonFeed(producer.jsonState('json.string'),
    collision, true), /redaction-literal-marker-collision/);
  const decoder = new SecretMarkerDecoder({
    redaction_format: fixture.format, redaction_scope: producer.scope
  });
  assert.throws(() => decoder.decodeMarker(malformed));
  assert.throws(() => new SecretMarkerDecoder({
    redaction_format: 'dc-secret-marker/2', redaction_scope: producer.scope
  }), /UNSUPPORTED_REDACTION_FORMAT/);
});

test('independent recorder scope rotates synthetic identity on reload', async () => {
  const producer = makeProducer();
  const row = fixture.vectors[0];
  const first = await producer.make(row.original, 'json.string', false, ['U']);
  assert.equal(first, await producer.make(row.original, 'json.string', false, ['U']));
  const otherScope = 'ffeeddccbbaa99887766554433221100';
  const left = new SecretMarkerDecoder({
    redaction_format: fixture.format, redaction_scope: producer.scope
  }).decodeMarker(first);
  const right = new SecretMarkerDecoder({
    redaction_format: fixture.format, redaction_scope: otherScope
  }).decodeMarker(first);
  assert.notEqual(left, right);
});

test('unsupported media, ambiguous type and incomplete streams reject source secrets', async () => {
  const producer = makeProducer();
  await assert.rejects(() => producer.bodyFeed(
    producer.bodyState('text/plain', 'fetch'), fixture.vectors[0].original, true
  ), /redaction-unsupported-content-type/);
  await assert.rejects(() => producer.make('deadbeefcafe', 'json.string'),
    /redaction-ambiguous-type/);
  await assert.rejects(() => producer.bodyFeed(
    producer.bodyState('application/json', 'xhr'),
    '{"token":"' + fixture.vectors[0].original, true
  ), /redaction-incomplete-json/);
});

test('real recorder stream preserves raw byte_count and writes only synthetic chunks', async () => {
  let calls = 0;
  const crypto = { subtle: webcrypto.subtle, getRandomValues(bytes) {
    bytes.set(Buffer.from(calls++ === 0 ? fixture.test_scope : fixture.test_hmac_key_hex, 'hex'));
    return bytes;
  } };
  const context = { crypto, TextEncoder, TextDecoder, Uint8Array, DataView,
    COMMUNICATION_LOG_BODY_CHUNK_CHARS: 256 * 1024,
    URL, atob, btoa, Blob, location: {
      href: 'https://chatgpt.com/', origin: 'https://chatgpt.com'
    } };
  vm.runInNewContext(diskHarnessSource() + `
    this.__integrationRecords = [];
    communicationLogRecord = async (type, data) => {
      this.__integrationRecords.push({ type, data });
    };
    this.__integrationStream = communicationLogStreamBody;
    this.__integrationScope = communicationMarkerV1Scope;
    this.__integrationSafeUrl = communicationMarkerV1SafeUrl;
  `, context);
  const original = JSON.stringify({ token: fixture.vectors[0].original,
    note: '[brackets]', emoji: '😀' });
  const bytes = new TextEncoder().encode(original);
  let offset = 0;
  const body = { getReader() { return {
    async read() {
      if (offset >= bytes.length) return { done: true };
      const end = Math.min(bytes.length, offset + 7);
      const value = bytes.slice(offset, end);
      offset = end;
      return { done: false, value };
    },
    releaseLock() {}
  }; } };
  const result = await context.__integrationStream(body, 'communication_response_chunk',
    { transport: 'fetch', content_type: 'application/json' });
  assert.equal(result.byte_count, bytes.byteLength);
  assert.ok(result.chunk_count > 0);
  const encoded = context.__integrationRecords.map(row => row.data.data).join('');
  assert.equal(encoded.includes(fixture.vectors[0].original), false);
  const reconstructed = JSON.parse(decodeText(encoded, {
    redaction_format: result.redaction_format, redaction_scope: result.redaction_scope
  }));
  assert.equal(reconstructed.note, '[brackets]');
  assert.equal(reconstructed.emoji, '😀');
  assert.equal(Buffer.byteLength(encoded) === result.byte_count, false);
  const url = await context.__integrationSafeUrl(
    'https://chatgpt.com/?token=' + fixture.vectors[0].original + '&ordinary=%5Bok%5D');
  assert.equal(new URL(url).searchParams.get('token'), fixture.vectors[0].marker);
  assert.equal(url.includes(fixture.vectors[0].original), false);
});
