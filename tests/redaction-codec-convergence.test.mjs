import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
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
