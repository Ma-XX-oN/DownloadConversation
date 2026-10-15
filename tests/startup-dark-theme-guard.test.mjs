import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/userscript/07-panel-launcher/04-startup-dark-theme-guard.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../src/userscript-manifest.json', import.meta.url), 'utf8'));
function fixture() {
  const events = [];
  const attrs = new Map([['data-theme', 'dark']]);
  const root = { getAttribute: name => attrs.get(name) ?? null };
  class Element { setAttribute(name, value) { attrs.set(name, value); } removeAttribute(name) { attrs.delete(name); } }
  Object.setPrototypeOf(root, Element.prototype);
  let callback;
  let timeout;
  let observer;
  const env = {
    Element, document: { documentElement: root },
    window: { matchMedia: () => ({matches: true}), addEventListener() {}, removeEventListener() {} },
    MutationObserver: class { constructor(fn) { callback = fn; observer = this; } observe() {} disconnect() {} },
    setTimeout: fn => { timeout = fn; return 1; }, clearTimeout() {},
    performance: {now: () => 1}, logDiagnostic: (...args) => events.push(args)
  };
  vm.runInNewContext(source, env);
  return {root, attrs, events, restore: () => timeout(), mutation: () => callback(), observer, Element};
}
test('guard preserves dark startup, respects native methods and releases', () => {
  const f = fixture();
  f.root.setAttribute('data-theme', 'light');
  assert.equal(f.root.getAttribute('data-theme'), 'dark');
  assert.ok(f.events.some(e => e[1] === 'theme-startup-light-prevented'));
  f.root.setAttribute('aria-label', 'example');
  assert.equal(f.root.getAttribute('aria-label'), 'example');
  f.restore();
  f.root.setAttribute('data-theme', 'light');
  assert.equal(f.root.getAttribute('data-theme'), 'light');
});
test('attribute observer repairs a bypassed light change', () => {
  const f = fixture();
  f.attrs.set('data-theme', 'light');
  f.mutation();
  assert.equal(f.root.getAttribute('data-theme'), 'dark');
});
test('guard is loaded before theme tracer and no overlay or polling is added', () => {
  const files = manifest.modules.flatMap(group => group.files);
  assert.ok(files.indexOf('src/userscript/07-panel-launcher/04-startup-dark-theme-guard.js') < files.indexOf('src/userscript/07-panel-launcher/05-bootstrap.js'));
  assert.doesNotMatch(source, /setInterval|subtree:\\s*true|position:\\s*fixed|createElement\\('div'\\)/);
});
