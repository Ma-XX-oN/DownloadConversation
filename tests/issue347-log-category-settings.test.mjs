import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {downloadConversationSource} from './helpers/userscript-source.mjs';

const settingsSource = readFileSync(
  new URL('../src/userscript/07-panel-launcher/01-log-category-settings.js', import.meta.url),
  'utf8'
);

function harness(storage = new Map()) {
  const inputs = ['favicon-stock', 'favicon-theme', 'favicon-write',
    'favicon-cache', 'other'].map(category => ({
    dataset: {logCategory: category},
    checked: false,
    listeners: {},
    addEventListener(kind, callback) { this.listeners[kind] = callback; }
  }));
  const trigger = {
    attrs: {}, focused: false, listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(kind, callback) { this.listeners[kind] = callback; },
    focus() { this.focused = true; }
  };
  const closeButton = {
    addEventListener(kind, callback) { this[kind] = callback; }
  };
  const popup = {
    hidden: true,
    contains(target) { return inputs.includes(target) || target === closeButton; },
    querySelectorAll(selector) {
      assert.equal(selector, 'input[data-log-category]');
      return inputs;
    },
    querySelector(selector) {
      if (selector === '[data-role="close-log-settings"]') return closeButton;
      if (selector === 'input') return inputs[0];
      return null;
    }
  };
  const panel = {
    listeners: {},
    querySelector(selector) {
      if (selector === '[data-role="log-settings"]') return trigger;
      if (selector === '[data-role="log-settings-popup"]') return popup;
      if (selector === '.tm-close') return {addEventListener() {}};
      return null;
    },
    addEventListener(kind, callback) { this.listeners[kind] = callback; }
  };
  const doc = {
    listeners: {},
    addEventListener(kind, callback) { this.listeners[kind] = callback; }
  };
  const ctx = vm.createContext({
    document: doc,
    localStorage: {
      getItem(k) { return storage.has(k) ? storage.get(k) : null; },
      setItem(k,v) { storage.set(k,v); }
    }
  });
  vm.runInContext(settingsSource + '\nthis.api = {'
    + 'category: diagnosticCategoryForEvent, enabled: diagnosticCategoryEnabled,'
    + 'bind: bindDiagnosticCategoryPopup };', ctx);
  return {storage, ctx, inputs, popup, trigger, closeButton, panel, doc};
}

test('gear opens logging dialog with persistent enabled-by-default options', () => {
  const h = harness();
  assert.match(downloadConversationSource,
    /data-role="save-log"[^\n]*data-role="reset-communication-log"[^\n]*data-role="log-settings"/);
  assert.match(downloadConversationSource,
    /data-role="log-settings-popup"[^>]*role="dialog"[^>]*hidden/);
  h.ctx.api.bind(h.panel);
  assert.ok(h.inputs.every(input => input.checked));
  h.trigger.listeners.click();
  assert.equal(h.popup.hidden, false);
  assert.equal(h.trigger.attrs['aria-expanded'], 'true');
  h.closeButton.click();
  assert.equal(h.popup.hidden, true);
  assert.equal(h.trigger.focused, true);
});

test('all five log categories toggle independently and persist across reloads', () => {
  const h = harness();
  h.ctx.api.bind(h.panel);
  const cache = h.inputs.find(x => x.dataset.logCategory === 'favicon-cache');
  cache.checked = false;
  cache.listeners.change();
  assert.equal(h.ctx.api.enabled('agent-favicon-cache-frame-requested'), false);
  assert.equal(h.ctx.api.enabled('agent-favicon-dc-assigned'), true);
  assert.equal(h.ctx.api.enabled('agent-favicon-stock-source-changed'), true);
  assert.equal(h.ctx.api.enabled('agent-favicon-app-theme-changed'), true);
  const reloaded = harness(h.storage);
  reloaded.ctx.api.bind(reloaded.panel);
  assert.equal(reloaded.inputs[3].checked, false);
  assert.equal(reloaded.inputs[2].checked, true);
  reloaded.inputs[3].checked = true;
  reloaded.inputs[3].listeners.change();
  assert.equal(reloaded.ctx.api.enabled('favicon-sequence-unavailable'), true);
});

test('event routing does not conflate app, browser theme and other diagnostics', () => {
  const h = harness();
  assert.equal(h.ctx.api.category('agent-favicon-browser-theme-changed'), 'favicon-theme');
  assert.equal(h.ctx.api.category('agent-favicon-app-theme-changed'), 'favicon-theme');
  assert.equal(h.ctx.api.category('agent-favicon-stock-link-removed'), 'favicon-stock');
  assert.equal(h.ctx.api.category('agent-favicon-dc-restored'), 'favicon-write');
  assert.equal(h.ctx.api.category('agent-favicon-cache-unavailable'), 'favicon-cache');
  assert.equal(h.ctx.api.category('fatal-export-error'), 'other');
  assert.match(downloadConversationSource,
    /function logDiagnostic\(level, message, data = null\) \{\s*if \(typeof diagnosticCategoryEnabled === 'function' &&\s*!diagnosticCategoryEnabled\(message\)\) return;/);
});

test('popup closes on Escape and outside pointer but not inside clicks', () => {
  const h = harness();
  h.ctx.api.bind(h.panel);
  h.trigger.listeners.click();
  h.doc.listeners.pointerdown({target: h.inputs[0]});
  assert.equal(h.popup.hidden, false);
  h.panel.listeners.keydown({
    key: 'Escape', stopPropagation() {}
  });
  assert.equal(h.popup.hidden, true);
  h.trigger.listeners.click();
  h.doc.listeners.pointerdown({target: {}});
  assert.equal(h.popup.hidden, true);
});

test('malformed or unknown persisted categories preserve safe existing defaults', () => {
  const raw = new Map([['tm-recorder-diagnostic-categories',
    '{"other":false,"favicon-write":false,"future":false}']]);
  const h = harness(raw);
  assert.equal(h.ctx.api.enabled('some-other-event'), false);
  assert.equal(h.ctx.api.enabled('agent-favicon-dc-assigned'), false);
  assert.equal(h.ctx.api.enabled('agent-favicon-cache-frame-requested'), true);
  raw.set('tm-recorder-diagnostic-categories', '{bad');
  assert.equal(harness(raw).ctx.api.enabled('some-other-event'), true);
});
