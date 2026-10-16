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
), 'utf8') + '\n' + readFileSync(new URL(
  '../src/userscript/02-network-communication/04b-marker-encoder-stream.js', import.meta.url
), 'utf8');

function harness(testKey = fixture.test_hmac_key_hex, testScope = fixture.test_scope) {
  let calls = 0;
  const crypto = {
    subtle: webcrypto.subtle,
    getRandomValues(bytes) {
      const fixtureHex = calls++ === 0
        ? testScope : testKey;
      bytes.set(Buffer.from(fixtureHex, 'hex'));
      return bytes;
    }
  };
  return vm.runInNewContext(
    '(function () {' + source + '\nreturn {' +
    'scope: communicationMarkerV1Scope,' +
    'registry: communicationMarkerV1Registry,' +
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

test('nested key context never inherits a sibling or ancestor secret label', async () => {
  const api = harness();
  const state = api.create();
  const source = '{"token":"YWJjZA","nested":{"ordinary":"hello world"},"other":"[ok]"}';
  const result = await api.feed(state, source, true);
  const output = JSON.parse(result);
  assert.equal(output.token, fixture.vectors[3].marker);
  assert.equal(output.nested.ordinary, 'hello world');
  assert.equal(output.other, '[ok]');
});

test('noncanonical malformed objects, arrays and trailing comma fail closed', async () => {
  const api = harness();
  const invalid = ['{"token":"YWJjZA",}', '{"token":"YWJjZA" garbage}',
    '{"x":[1,]}', '{"x":tru}', '{"x":1 "y":2}', '{"x":1} trailing'];
  for (const source of invalid) {
    await assert.rejects(() => api.feed(api.create(), source, true),
      /redaction-(?:invalid|incomplete)/, source);
  }
});

test('unknown sensitive values never survive as raw body text', async () => {
  const api = harness();
  const input = '{"password":"opaque credential that is not a registered shape"}';
  await assert.rejects(() => api.feed(api.create(), input, true),
    /redaction-unsupported-sensitive-value/);
});

test('valid checked source markers fail collision check; invalid checks remain ordinary', async () => {
  const api = harness();
  const checked = '{"ordinary":"' + fixture.vectors[0].marker + '"}';
  await assert.rejects(() => api.feed(api.create(), checked, true),
    /redaction-literal-marker-collision/);
  const invalid = fixture.scenarios.find(x => x.name === 'invalid-checksum').marker;
  const result = await api.feed(api.create(), '{"ordinary":"' + invalid + '"}', true);
  assert.equal(JSON.parse(result).ordinary, invalid);
});

test('SSE [DONE] terminal sentinel is preserved without redaction', async () => {
  const api = harness();
  const data = 'data: {"token":"YWJjZA"}\n\ndata: [DONE]\n\n';
  const output = await api.bodyFeed(api.bodyState('text/event-stream', 'fetch'), data, true);
  assert.equal(output.split('data: [DONE]').length, 2);
  assert.equal(output.includes(fixture.vectors[3].original), false);
  assert.ok(output.includes(fixture.vectors[3].marker));
});

test('URL sensitive unknown format drops the complete URL', async () => {
  const api = harness();
  const result = await api.safeUrl('https://chatgpt.com/x?token=unrecognised.secret');
  assert.equal(result, '[redaction-failed-url]');
  assert.equal(result.includes('unrecognised.secret'), false);
});

test('JSON token scanning holds secrets across every two-chunk split', async () => {
  const api = harness();
  const original = '{"nested":{"credential":"550e8400-e29b-41d4-a716-446655440000"}}';
  for (let split = 0; split <= original.length; split++) {
    const state = api.create();
    const first = await api.feed(state, original.slice(0, split));
    const second = await api.feed(state, original.slice(split), true);
    const output = JSON.parse(first + second);
    assert.equal(output.nested.credential, fixture.vectors[0].marker, String(split));
    assert.equal((first + second).includes(fixture.vectors[0].original), false);
  }
});

test('registry exposes sparse applicable contexts and no universal text detector', () => {
  const api = harness();
  for (const type of ['U', 'H', 'B', 'P', 'J', 'O']) {
    assert.equal(api.registry[type].contexts['json.string'], true);
    assert.equal(api.registry[type].contexts['text.plain'], undefined);
    assert.equal(api.registry[type].contexts['ws.text.plain'], undefined);
  }
  assert.equal(api.registry.U.identify(fixture.vectors[0].original, 'json.string').type, 'U');
  assert.equal(api.registry.U.identify(fixture.vectors[0].original, 'text.plain'), null);
});

test('simulated reload rotates scope and HMAC identity with no equality inference', async () => {
  const first = harness();
  const second = harness('a4'.repeat(32), 'ffeeddccbbaa99887766554433221100');
  const value = fixture.vectors[0].original;
  const left = await first.make(value, 'json.string');
  const right = await second.make(value, 'json.string');
  assert.notEqual(first.scope, second.scope);
  assert.notEqual(left, right);
  assert.equal(await first.make(value, 'json.string'), left);
  assert.equal(await second.make(value, 'json.string'), right);
});

test('URL fragments are omitted because V1 has no fragment-inspection context', async () => {
  const api = harness();
  const result = await api.safeUrl('https://chatgpt.com/backend-api?q=%5Bok%5D#token=private-fragment-secret');
  assert.equal(result.includes('private-fragment-secret'), false);
  assert.equal(new URL(result).hash, '');
});

test('noncanonical JWT Base64URL pad bits fail closed in sensitive JSON value', async () => {
  const api = harness();
  const parts = fixture.vectors[4].original.split('.');
  parts[0] = parts[0].slice(0, -1) + '1';
  const source = JSON.stringify({ jwt: parts.join('.') });
  await assert.rejects(() => api.feed(api.create(), source, true),
    /redaction-unsupported-sensitive-value/);
});
