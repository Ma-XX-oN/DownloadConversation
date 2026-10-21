import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const probe = readFileSync(new URL(
  './manual/dc313-indexeddb-browser-probe.user.js', import.meta.url),
  'utf8');

test('installed-browser IndexedDB atomicity probe is inert until selected',
  () => {
    const menus = new Map();
    let opened = 0;
    const context = {
      location: { origin: 'https://chatgpt.com' },
      indexedDB: { open() { opened++; throw Error('not selected'); } },
      crypto: { randomUUID: () => 'synthetic-tab-id' },
      BroadcastChannel: class {
        constructor(name) {
          assert.equal(name, 'dc313-indexeddb-atomic-probe-v1');
        }
      },
      GM_registerMenuCommand: (name, fn) => menus.set(name, fn)
    };
    vm.runInNewContext(probe, context);
    assert.equal(opened, 0);
    assert.ok(menus.has('DC #313: test IndexedDB atomic two-tab storage'));
    assert.ok(menus.has('DC #313: show IndexedDB probe readiness'));
    assert.match(probe, /db\.transaction\('counter'/);
    assert.match(probe, /'readwrite'/);
    assert.match(probe, /tx\.oncomplete/);
    assert.doesNotMatch(probe, /GM_getValue|GM_setValue|GM\.getValue/);
    assert.doesNotMatch(probe, /key_hex|key_bytes|credentials/i);
  });

test('probe syntax, supported origin, and failure markers are bounded', () => {
  new vm.Script(probe);
  assert.match(probe, /@version\s+0\.1\.0/);
  assert.match(probe, /@match\s+https:\/\/chatgpt\.com\/\*/);
  assert.match(probe, /observed === 2 \* rounds/);
  assert.match(probe, /peersDone/);
  assert.match(probe, /Copy JSON/);
});
