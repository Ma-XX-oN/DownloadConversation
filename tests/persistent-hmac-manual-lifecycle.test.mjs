import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Script } from 'node:vm';

const source = readFileSync(new URL(
  './manual/dc313-exact-hmac-indexeddb-lifecycle.user.js',
  import.meta.url), 'utf8');
const revision = '82087e235fad802e10250311f22218e866dde634';

test('new key_restart lifecycle probe is parseable immutable source', () => {
  assert.doesNotThrow(() => new Script(source));
  for (const file of [
    '04b-persistent-hmac-indexeddb.js',
    '04ba-persistent-hmac-validation.js',
    '04c-persistent-hmac-service.js',
    '04d-persistent-hmac-browser.js'
  ]) {
    const url = 'https://raw.githubusercontent.com/' +
      'Ma-XX-oN/DownloadConversation/' + revision +
      '/src/userscript/02-network-communication/' + file;
    assert.ok(source.includes('// @require      ' + url));
  }
  assert.equal((source.match(/^\/\/ @require /gm) ?? []).length, 4);
  assert.match(source, /\/\/ @match\s+https:\/\/chatgpt\.com\/\*/);
  assert.match(source, /\/\/ @version\s+0\.2\.0/);
});

test('probe is synthetic-only and cannot mutate production key store', () => {
  assert.match(source, /dc313-lifecycle-synthetic-only-v2/);
  assert.match(source, /dc313-lifecycle-baseline-v5/);
  assert.match(source, /dc313-hmac-lifecycle-probe-v5/);
  assert.match(source, /indexedDB\.open\(databaseName, version\)/);
  assert.match(source, /testId \+ ':' \+ name/);
  assert.doesNotMatch(source, /indexedDB\.deleteDatabase/);
  assert.doesNotMatch(source, /GM\.setValue|GM_setValue/);
});

test('actual Stage 1 and Stage 2 compare key_restart and Worker HMAC', () => {
  assert.match(source, /HMAC lifecycle stage 1 \(all participants\)/);
  assert.match(source, /HMAC lifecycle stage 2 \(after reload\)/);
  assert.match(source, /localStorage\.setItem\(baselineName/);
  assert.match(source, /localStorage\.getItem\(baselineName\)/);
  assert.match(source, /s\.provision\(token, worker\)/);
  assert.match(source, /pair\.local\.key_restart === peer\.key_restart/);
  assert.match(source, /persisted\.local\.key_restart === baseline\.key_restart/);
  assert.match(source, /overdue\.local\.key_restart !==/);
  assert.match(source, /manualService\.randomize\(true\)/);
  assert.match(source, /events\[1\]\?\.reason === 'overdue'/);
  assert.match(source, /events\[2\]\.reason === 'manual'/);
  assert.match(source, /draining\.local\.eventCount === 1/);
  assert.ok(source.indexOf('oldClock.value = future;') <
    source.indexOf('await oldService.complete(old.token);'));
  assert.doesNotMatch(source, /redaction_scope|redaction_key_generation/);
  assert.doesNotMatch(source, /discoverLegacyInstances/);
  assert.doesNotMatch(source, /older-probe-instances-active/);
});

test('only nonsecret synthetic data crosses probe UI', () => {
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\s*\(/);
  assert.doesNotMatch(source, /key_hex|privateKey|api[_-]?key/i);
  assert.match(source, /baselineSaved: pass/);
  assert.match(source, /crossInstanceCycleEventsAgree: journalsAgree\(manual\)/);
});
