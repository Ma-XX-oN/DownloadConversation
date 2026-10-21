import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Script } from 'node:vm';

const source = readFileSync(new URL(
  './manual/dc313-exact-hmac-indexeddb-lifecycle.user.js',
  import.meta.url), 'utf8');
const revision = 'de934cb66047fd6144e6888939fd83b8d650781e';

test('installed lifecycle probe is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Script(source));
});

test('installed lifecycle probe requires four immutable exact producer modules', () => {
  for (const file of [
    '04b-persistent-hmac-indexeddb.js',
    '04ba-persistent-hmac-validation.js',
    '04c-persistent-hmac-service.js',
    '04d-persistent-hmac-browser.js'
  ]) {
    const full = 'https://raw.githubusercontent.com/' +
      'Ma-XX-oN/DownloadConversation/' + revision +
      '/src/userscript/02-network-communication/' + file;
    assert.ok(source.includes('// @require      ' + full));
  }
  assert.equal((source.match(/^\/\/ @require /gm) ?? []).length, 4);
  assert.match(source, /\/\/ @match\s+https:\/\/chatgpt\.com\/\*/);
  assert.match(source, /\/\/ @version\s+0\.1\.4/);
});

test('probe keeps synthetic key records isolated from production IndexedDB', () => {
  assert.match(source, /const databaseName = 'dc313-lifecycle-synthetic-only-v1'/);
  assert.match(source, /indexedDB\.open\(databaseName, version\)/);
  assert.match(source, /testId \+ ':' \+ name/);
  assert.doesNotMatch(source, /indexedDB\.deleteDatabase/);
  assert.doesNotMatch(source, /GM\.setValue|GM_setValue/);
});

test('probe tests reload, shared secret identity, draining and both cycle types', () => {
  assert.match(source, /HMAC lifecycle stage 1 \(all participants\)/);
  assert.match(source, /HMAC lifecycle stage 2 \(after reload\)/);
  assert.match(source, /localStorage\.setItem\(baselineName/);
  assert.match(source, /localStorage\.getItem\(baselineName\)/);
  assert.match(source, /s\.provision\(token, worker\)/);
  assert.match(source, /peer\.fingerprint/);
  assert.match(source, /draining\.local\.eventCount === 1/);
  assert.match(source, /baseline\.time \+ 25 \* hour \+ 1/);
  assert.match(source, /events\[1\]\?\.reason === 'overdue'/);
  assert.ok(source.includes('const oldClock = { value: now };'));
  assert.ok(source.includes(
    "now: typeof time === 'function' ? time : () => time"));
  const advance = source.indexOf('oldClock.value = future;');
  const complete = source.indexOf('await oldService.complete(old.token);');
  assert.ok(advance > 0 && complete > advance,
    'capture clock advances before the pending drain commits');
  assert.match(source, /participatingInstances\(/);
  assert.match(source, /state.selected = new Set\(state.ready\)/);
  assert.match(source, /peers: peers.map\(id => state.done.get\(id\)\)/);
  assert.doesNotMatch(source, /expected-exactly-one-peer/);
  assert.doesNotMatch(source, /older-probe-instances-active/);
  assert.match(source, /dc313-hmac-lifecycle-probe-v1/);
  assert.match(source, /dc313-hmac-lifecycle-probe-v2/);
  assert.match(source, /dc313-hmac-lifecycle-probe-v3/);
  assert.match(source, /dc313-hmac-lifecycle-probe-v4/);
  assert.doesNotMatch(source, /assertCurrentProbeOnly/);
  assert.match(source, /legacyInstances: legacy/);
  assert.match(source, /status: missing.length === 0 \? 'READY' : 'FAIL'/);
    assert.match(source, /overdueChecks/);
  assert.match(source, /manualService\.randomize\(true\)/);
  assert.match(source, /events\[2\]\.reason === 'manual'/);
});

test('probe exposes only nonsecret PASS or FAIL metadata', () => {
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\s*\(/);
  assert.doesNotMatch(source, /key_hex|privateKey|api[_-]?key/i);
  assert.match(source, /baselineSaved: pass/);
  assert.match(source, /crossInstanceCycleEventsAgree: journalsAgree\(manual\)/);
});
