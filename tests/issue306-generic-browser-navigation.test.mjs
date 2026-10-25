import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../src/userscript/04-conversation-rendering/08e-generic-browser-navigation.js', import.meta.url),
  'utf8'
);

/**
 * Creates an isolated browser-like History and Navigation API event fixture.
 * @param {boolean} withNavigation - Include the modern Navigation API.
 * @returns {Object} Browser, event controls and observed values.
 */
function fixture(withNavigation = true) {
  const listeners = new Map();
  const navListeners = new Map();
  const emitted = [];
  const browser = {
    location: { href: 'https://example.test/a' },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
    history: {
      pushState(_state, _title, url) {
        if (url === 'throw') throw new Error('native failure');
        browser.location.href = new URL(url, browser.location.href).href;
      },
      replaceState(_state, _title, url) {
        browser.location.href = new URL(url, browser.location.href).href;
      }
    }
  };
  if (withNavigation) browser.navigation = {
    addEventListener(name, callback) { navListeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (navListeners.get(name) === callback) navListeners.delete(name);
    }
  };
  const originalPush = browser.history.pushState;
  const originalReplace = browser.history.replaceState;
  const context = { assert, Reflect };
  vm.runInNewContext(source + '\nthis.observe = observeGenericBrowserNavigation;', context);
  return {
    browser, emitted, listeners, navListeners,
    connect: () => context.observe(browser, event => emitted.push(event.url)),
    route(url) {
      browser.location.href = new URL(url, browser.location.href).href;
      navListeners.get('currententrychange')?.();
    },
    pop(url) {
      browser.location.href = new URL(url, browser.location.href).href;
      listeners.get('popstate')?.();
    },
    originals() {
      return browser.history.pushState === originalPush
        && browser.history.replaceState === originalReplace;
    }
  };
}

test('initial route, Navigation API and History API events deduplicate', () => {
  const f = fixture();
  const dispose = f.connect();
  f.route('/b');
  f.browser.history.pushState({}, '', '/b');
  f.browser.history.replaceState({}, '', '/c');
  f.route('/c');
  f.pop('/a');
  assert.deepEqual(f.emitted, [
    'https://example.test/a', 'https://example.test/b',
    'https://example.test/c', 'https://example.test/a'
  ]);
  dispose();
});

test('History-only fallback handles A to B to A without a request', () => {
  const f = fixture(false);
  const dispose = f.connect();
  f.browser.history.pushState(null, '', '/b');
  f.browser.history.replaceState(null, '', '/a');
  f.pop('/a');
  assert.deepEqual(f.emitted, [
    'https://example.test/a', 'https://example.test/b', 'https://example.test/a'
  ]);
  dispose();
});

test('fast transitions retain order and never infer identity from unknown URLs', () => {
  const f = fixture();
  const dispose = f.connect();
  f.browser.history.pushState(null, '', '/b');
  f.browser.history.pushState(null, '', '/unknown?item=1');
  f.browser.history.pushState(null, '', '/a');
  assert.deepEqual(f.emitted.slice(1), [
    'https://example.test/b', 'https://example.test/unknown?item=1',
    'https://example.test/a'
  ]);
  dispose();
});

test('native exceptions preserve route, notification state and return semantics', () => {
  const f = fixture(false);
  const dispose = f.connect();
  assert.throws(() => f.browser.history.pushState(null, '', 'throw'), /native failure/);
  assert.deepEqual(f.emitted, ['https://example.test/a']);
  dispose();
});

test('disposal removes listeners and restores exact original methods', () => {
  const f = fixture();
  const dispose = f.connect();
  assert.equal(f.originals(), false);
  dispose();
  dispose();
  assert.equal(f.originals(), true);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.navListeners.size, 0);
  f.browser.history.pushState(null, '', '/b');
  assert.deepEqual(f.emitted, ['https://example.test/a']);
});

test('new page connection can rebind independently with no leaked listeners', () => {
  const first = fixture();
  const close = first.connect();
  close();
  const second = fixture();
  const dispose = second.connect();
  second.route('/b');
  assert.deepEqual(second.emitted, [
    'https://example.test/a', 'https://example.test/b'
  ]);
  assert.deepEqual(first.emitted, ['https://example.test/a']);
  dispose();
});

test('two independent tabs do not exchange navigation or recording identities', () => {
  const one = fixture();
  const two = fixture();
  const closeOne = one.connect();
  const closeTwo = two.connect();
  one.route('/b');
  assert.deepEqual(one.emitted, ['https://example.test/a', 'https://example.test/b']);
  assert.deepEqual(two.emitted, ['https://example.test/a']);
  closeOne();
  closeTwo();
});

test('failed Navigation API registration restores History API and popstate listener', () => {
  const f = fixture();
  f.browser.navigation.addEventListener = () => {
    throw new Error('navigation permission denied');
  };
  assert.throws(() => f.connect(), /navigation permission denied/);
  assert.equal(f.originals(), true);
  assert.equal(f.listeners.size, 0);
  f.browser.history.pushState(null, '', '/b');
  assert.deepEqual(f.emitted, []);
});

test('failed initial publication cleans up an otherwise completed registration', () => {
  const f = fixture();
  const sourceWithFailure = source +
    '\nthis.observe = observeGenericBrowserNavigation;';
  const context = { assert, Reflect };
  vm.runInNewContext(sourceWithFailure, context);
  assert.throws(() => context.observe(f.browser, () => {
    throw new Error('subscriber rejected initial route');
  }), /subscriber rejected initial route/);
  assert.equal(f.originals(), true);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.navListeners.size, 0);
});

test('a failed History API assignment does not leak the successful first wrapper', () => {
  const f = fixture(false);
  const original = f.browser.history.replaceState;
  Object.defineProperty(f.browser.history, 'replaceState', {
    configurable: true,
    get() { return original; },
    set() { throw new Error('history is readonly'); }
  });
  assert.throws(() => f.connect(), /history is readonly/);
  assert.equal(f.originals(), true);
  assert.equal(f.listeners.size, 0);
});
