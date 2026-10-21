import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Script } from 'node:vm';

const raw = readFileSync(new URL(
  './manual/dc313-chrome-restart-witness.user.js',
  import.meta.url), 'utf8');
const exact = 'de934cb66047fd6144e6888939fd83b8d650781e';

test('full-browser-restart manual probe parses and pins immutable source', () => {
  assert.doesNotThrow(() => new Script(raw));
  assert.match(raw, /@version\s+0\.1\.0/);
  for (const name of [
    '04b-persistent-hmac-indexeddb.js',
    '04ba-persistent-hmac-validation.js',
    '04c-persistent-hmac-service.js'
  ]) assert.ok(raw.includes(exact +
    '/src/userscript/02-network-communication/' + name));
  assert.equal((raw.match(/^\/\/ @require /gm) ?? []).length, 3);
});

test('restart stages use one isolated namespace and no production key', () => {
  assert.match(raw, /dc313-restart-only-test-idb-v1/);
  assert.match(raw, /dc313-restart-only-baseline-v1/);
  assert.match(raw, /localStorage\.setItem\(key/);
  assert.match(raw, /localStorage\.getItem\(key/);
  assert.match(raw, /async function prepare/);
  assert.match(raw, /async function verify/);
  assert.match(raw, /now\.digest === before\.first\.digest/);
  assert.match(raw, /now\.generation === before\.first\.generation/);
  assert.match(raw, /JSON\.stringify\(now\.eventIds\)/);
  assert.doesNotMatch(raw, /console\.(log|warn|error)\(/);
  assert.doesNotMatch(raw, /indexedDB\.deleteDatabase/);
  assert.doesNotMatch(raw, /GM\.getValue|GM_getValue|GM\.setValue/);
});

test('manual restart flow is isolated from synthetic future-time rotations', () => {
  assert.doesNotMatch(raw, /25 \* hour \+ 1|fakeDate|now: \(\) =>/);
  assert.match(raw, /Exit ALL Chrome processes/);
  assert.match(raw, /GM_registerMenuCommand\('DC #313: prepare full Chrome restart'/);
  assert.match(raw, /GM_registerMenuCommand\('DC #313: verify full Chrome restart'/);
});
