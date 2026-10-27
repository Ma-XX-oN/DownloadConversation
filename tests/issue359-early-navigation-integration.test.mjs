import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const modules = [
  '../src/userscript/04-conversation-rendering/08e-generic-browser-navigation.js',
  '../src/userscript/02-network-communication/03-csc-provider-navigation-ingress.js'
].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

test('early URL observer preserves A to B to A and reload-style rebind', () => {
  const published = [];
  const listeners = new Map();
  const page = {
    location: { href: 'https://chatgpt.com/c/A' },
    listeners,
    history: {
      pushState(_state, _unused, url) { page.location.href = new URL(url, page.location.href).href; },
      replaceState(_state, _unused, url) { page.location.href = new URL(url, page.location.href).href; }
    },
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); }
  };
  const originalPush = page.history.pushState;
  const create = new Function(
    'assert', 'window', 'unsafeWindow', 'cscPluginQueueNavigation',
    modules + '\nreturn {' +
      'open:cscEnsureEarlyNavigationIngress,' +
      'close:cscDisposeEarlyNavigationIngress};'
  );
  const agent = create(assert, page, undefined, url => published.push(url));
  page.history.pushState({}, '', '/c/B');
  page.history.pushState({}, '', '/c/A');
  assert.deepEqual(published, [
    'https://chatgpt.com/c/A', 'https://chatgpt.com/c/B', 'https://chatgpt.com/c/A'
  ]);
  agent.close();
  assert.equal(page.history.pushState, originalPush);
  assert.equal(listeners.has('popstate'), false);
  page.history.pushState({}, '', '/c/C');
  assert.equal(published.length, 3);
  agent.open();
  assert.equal(published.at(-1), 'https://chatgpt.com/c/C');
  agent.close();
});
