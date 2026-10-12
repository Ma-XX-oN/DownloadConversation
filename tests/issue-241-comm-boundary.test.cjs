'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(
  'src/userscript/02-network-communication/06-comm-version-boundary.js', 'utf8'
);
const resolve = new Function(source +
  '\nreturn communicationLogResolveCommVersionAtBoundary;')();
const encode = value => new TextEncoder().encode(value);
const line = value => JSON.stringify(value) + '\n';
const stamp = n => `2026-10-12T00:00:0${n}.000Z`;
const first = encode(line({version:{comm:'v1'}}) +
  line({timestamp:stamp(1),version:{comm:'v2'}}));
const second = encode(line({version:{comm:'v2'}}) +
  line({timestamp:stamp(3),version:{comm:'v3'}}));
const future = encode(line({version:{comm:'v9'}}) +
  line({timestamp:stamp(4),message:'later'}));

test('inclusive transition and cross-fragment effective version', () => {
  assert.equal(resolve([first], stamp(1)), 'v2');
  assert.equal(resolve([first, second], stamp(2)), 'v2');
  assert.equal(resolve([first, second], stamp(3)), 'v3');
});
test('a future immutable fragment header cannot rewrite prior history', () => {
  assert.equal(resolve([first, second, future], stamp(2)), 'v2');
  assert.equal(resolve([future], stamp(2)), null);
});
test('legacy absence and an explicit null do not invent version', () => {
  assert.equal(resolve([encode(line({timestamp:stamp(1),message:'old'}))], stamp(2)), null);
  assert.equal(resolve([encode(line({version:{comm:null}}) +
    line({timestamp:stamp(1),message:'old'}))], stamp(2)), null);
});
test('ignores incomplete JSONL tail without applying future versions', () => {
  const incomplete = encode(line({version:{comm:'v1'}}) +
    JSON.stringify({timestamp:stamp(1),version:{comm:'v2'}}));
  assert.equal(resolve([incomplete], stamp(2)), null);
});
test('rejects invalid boundaries', () => {
  assert.throws(() => resolve([first], 'invalid'), /Invalid COMM/);
});
