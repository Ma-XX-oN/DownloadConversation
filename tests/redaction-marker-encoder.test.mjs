import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/redaction-marker-v1.json', import.meta.url), 'utf8'
));
const source = readFileSync(new URL(
  '../src/userscript/02-network-communication/04a-marker-encoder.js', import.meta.url
), 'utf8');

function harness() {
  let calls = 0;
  const crypto = {
    subtle: webcrypto.subtle,
    getRandomValues(bytes) {
      const fixtureHex = calls++ === 0
        ? fixture.test_scope : fixture.test_hmac_key_hex;
      bytes.set(Buffer.from(fixtureHex, 'hex'));
      return bytes;
    }
  };
  return vm.runInNewContext(
    '(function () {' + source + '\nreturn {' +
    'scope: communicationMarkerV1Scope,' +
    'make: communicationMarkerV1Make,' +
    'create: communicationMarkerV1JsonState,' +
    'feed: communicationMarkerV1JsonFeed,' +
    'bodyState: communicationMarkerV1BodyState,' +
    'bodyFeed: communicationMarkerV1BodyFeed,' +
    'safeUrl: communicationMarkerV1SafeUrl' +
    '};})()',
    { crypto, TextEncoder, TextDecoder, Uint8Array, DataView, atob, btoa,
      URL, location: { href: 'https://chatgpt.com/', origin: 'https://chatgpt.com' } }
  );
}

test('golden checked markers use contract-identical crypto and scope', async () => {
  const api = harness();
  assert.equal(api.scope, fixture.test_scope);
  for (const row of fixture.vectors) {
    const classified = row.type === 'O';
    assert.equal(await api.make(row.original, 'json.string', classified, [row.type]),
      row.marker, row.name);
  }
});

test('ambiguous hex and base64url are rejected, not guessed', async () => {
  const api = harness();
  await assert.rejects(() => api.make('deadbeefcafe', 'json.string'),
    /redaction-ambiguous-type/);
});

test('JSON nested strings retain syntax and literal brackets', async () => {
  const api = harness();
  const input = '{"credential":"550e8400-e29b-41d4-a716-446655440000","ordinary":"[ok]"}';
  const state = api.create();
  let output = '';
  for (const character of input) output += await api.feed(state, character);
  output += await api.feed(state, '', true);
  assert.equal(JSON.parse(output).credential, fixture.vectors[0].marker);
  assert.equal(JSON.parse(output).ordinary, '[ok]');
  assert.equal(output.includes(fixture.vectors[0].original), false);
});

test('all split offsets retain exact marker and JSON framing', async () => {
  const api = harness();
  const input = '{"token":"YWJjZA","other":[{"id":"g-p-0123456789abcdef0123456789abcdef"}]}';
  let expected = null;
  for (let cut = 0; cut <= input.length; cut++) {
    const state = api.create();
    const output = await api.feed(state, input.slice(0, cut)) +
      await api.feed(state, input.slice(cut), true);
    if (expected !== null) assert.equal(output, expected, 'split ' + cut);
    expected = output;
  }
  assert.equal(JSON.parse(expected).token, fixture.vectors[3].marker);
  assert.equal(JSON.parse(expected).other[0].id, fixture.vectors[1].marker);
});

test('unknown classified secret and incomplete JSON fail closed', async () => {
  const api = harness();
  const state = api.create();
  await assert.rejects(() => api.feed(state, '{"password":"', true),
    /redaction-incomplete-json/);
  await assert.rejects(() => api.make('a'.repeat(129), 'json.string', true),
    /redaction-unsupported-sensitive-value/);
});

test('SSE data JSON is valid and preserves event framing across all splits', async () => {
  const api = harness();
  const source = 'event: message\ndata: {"token":"YWJjZA","normal":"[ok]"}\n\n';
  let canonical = null;
  for (let split = 0; split <= source.length; split++) {
    const state = api.bodyState('text/event-stream', 'fetch');
    const output = await api.bodyFeed(state, source.slice(0, split)) +
      await api.bodyFeed(state, source.slice(split), true);
    assert.match(output, /^event: message\ndata: /);
    assert.equal(JSON.parse(output.split('\n')[1].slice(6)).token,
      fixture.vectors[3].marker);
    assert.equal(JSON.parse(output.split('\n')[1].slice(6)).normal, '[ok]');
    if (canonical !== null) assert.equal(output, canonical, String(split));
    canonical = output;
  }
});

test('one large network chunk can contain many bounded safe SSE events', async () => {
  const api = harness();
  const state = api.bodyState('text/event-stream', 'fetch');
  const event = 'data: {"ordinary":"hello world"}\n\n';
  const original = event.repeat(50000);
  assert.ok(Buffer.byteLength(original) > 1024 * 1024);
  const output = await api.bodyFeed(state, original, true);
  assert.equal(output, original);
});

test('unsupported classified values and media fail closed', async () => {
  const api = harness();
  const plain = api.bodyState('text/plain', 'fetch');
  await assert.rejects(() => api.bodyFeed(plain, 'Authorization: secret', true),
    /redaction-unsupported-content-type/);
  const event = api.bodyState('text/event-stream', 'fetch');
  await assert.rejects(() => api.bodyFeed(event, 'data: unknown-secret\n\n', true),
    /redaction-unsupported-sse-data/);
});

test('query values become typed markers without exposing originals', async () => {
  const api = harness();
  const value = fixture.vectors[0];
  const url = await api.safeUrl('https://chatgpt.com/backend-api/?token=' +
    value.original + '&regular=%5Bok%5D');
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('token'), value.marker);
  assert.equal(parsed.searchParams.get('regular'), '[ok]');
  assert.equal(url.includes(value.original), false);
});

test('same scope repeats identity and new ephemeral key does not', async () => {
  const api = harness();
  const row = fixture.vectors[0];
  const twice = await Promise.all([
    api.make(row.original, 'json.string'), api.make(row.original, 'json.string')
  ]);
  assert.equal(twice[0], twice[1]);
  assert.equal(api.scope, fixture.test_scope);
});
