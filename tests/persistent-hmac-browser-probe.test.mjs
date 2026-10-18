import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(
  './manual/dc313-production-key-browser-probe-v13.user.js',
  import.meta.url), 'utf8');

test('signed-in GM diagnostic is parseable and remains synthetic', () => {
  assert.match(source, /@match\s+https:\/\/chatgpt\.com\/\*/);
  assert.match(source, /@grant\s+GM\.getValue/);
  assert.match(source, /@grant\s+GM\.setValue/);
  assert.match(source, /@require\s+https:\/\/raw\.githubusercontent\.com\//);
  assert.match(source, /dc313-probe-exact:/);
  assert.match(source, /DC #313: diagnose GM cross-tab storage/);
  new vm.Script(source, { filename: 'dc313-browser-probe.user.js' });
});

test('diagnostic menu is registered and never auto-starts', () => {
  const menu = [];
  let operations = 0;
  const context = {
    location: { origin: 'https://chatgpt.com' },
    crypto: { randomUUID: () => 'synthetic-tab-unique' },
    BroadcastChannel: class { constructor() { this.onmessage = null; } },
    GM_registerMenuCommand: name => menu.push(name),
    GM_getValue: () => { operations++; },
    GM_setValue: () => { operations++; },
    GM: {
      getValue: async () => { operations++; },
      setValue: async () => { operations++; }
    },
    navigator: {},
    console: { warn() {}, info() {} }
  };
  vm.runInNewContext(source, context);
  assert.ok(menu.includes('DC #313: diagnose GM cross-tab storage'));
  assert.ok(menu.includes('DC #313: run two-tab test'));
  assert.equal(operations, 0);
});
