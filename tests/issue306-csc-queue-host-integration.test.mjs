import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const bridge = readFileSync(new URL(
  '../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url
), 'utf8');
const manifest = JSON.parse(readFileSync(new URL(
  '../src/userscript-manifest.json', import.meta.url
), 'utf8'));
const navigation = readFileSync(new URL(
  '../src/userscript/04-conversation-rendering/08e-generic-browser-navigation.js',
  import.meta.url
), 'utf8');
const lifecycle = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/05-bootstrap-part2.js', import.meta.url
), 'utf8');
const request = readFileSync(new URL(
  '../src/userscript/03-agent-lifecycle/08-generation-request.js', import.meta.url
), 'utf8');
const xhr = readFileSync(new URL(
  '../src/userscript/03-agent-lifecycle/09-network-install-api-transition.js',
  import.meta.url
), 'utf8');

function extracted(name) {
  const start = bridge.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'Missing provider host method ' + name);
  const next = bridge.indexOf('\n  /**', start + 5);
  return bridge.slice(start, next > start ? next : undefined);
}

test('single capture ingress composes the verified #306 browser observer with #310 queue', () => {
  const paths = manifest.modules.flatMap(group => group.files);
  const ingress = paths.indexOf('src/userscript/02-network-communication/03-csc-canonical-ingress.js');
  const queue = paths.indexOf('src/userscript/02-network-communication/03-csc-plugin-backlog.js');
  const observer = paths.indexOf('src/userscript/04-conversation-rendering/08e-generic-browser-navigation.js');
  assert.ok(ingress >= 0 && queue > ingress && observer >= 0);
  assert.ok(observer < queue, 'Generic observer definition must exist before host binding');
  assert.match(bridge, /cscPluginQueueConnect\(host\)/);
  assert.match(bridge, /cscPluginQueueDisconnect\(host\)/);
  assert.match(bridge, /cscPluginQueueNavigation\(event\.url\)/);
  assert.doesNotMatch(bridge, /host\.(?:navigation|request|response)\(/);
  assert.doesNotMatch(request + xhr, /agentPluginObserve(?:NetworkRequest|FetchResponse|XhrResponse)/);
  assert.match(lifecycle, /disconnectChatGPTSubjectHost\(\)/);
  assert.match(lifecycle, /if \(event\.persisted\) reconnectChatGPTSubjectHost\(\)/);
});

test('provider host connects once, initial and A-B-A navigation enqueue once and dispose safely', () => {
  const events = [];
  const listeners = new Map();
  const browser = {
    location: { origin: 'https://chatgpt.com', href: 'https://chatgpt.com/' },
    history: {
      pushState(_data, _unused, url) {
        browser.location.href = new URL(url, browser.location.href).href;
      },
      replaceState(_data, _unused, url) {
        browser.location.href = new URL(url, browser.location.href).href;
      }
    },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  };
  let host = null;
  const context = {
    Reflect, URL, assert,
    agentPluginPageWindow: browser,
    chatGPTAgent: { version: () => ({}) },
    chatGPTSubjectHost: null,
    disconnectChatGPTNavigation: null,
    chatGPTPluginModule: {
      connectChatGPTSubjectHost() {
        host = {
          navigation() { throw Error('direct navigation forbidden'); },
          request() { throw Error('direct request forbidden'); },
          response() { throw Error('direct response forbidden'); },
          dispose() { events.push('dispose'); }
        };
        events.push('construct');
        return host;
      }
    },
    logDiagnostic: () => {},
    boundedDiagnosticText: String,
    errorMessage: String,
    cscPluginQueueConnect(value) {
      assert.equal(value, host);
      events.push('connect');
    },
    cscPluginQueueDisconnect(value) {
      assert.equal(value, host);
      events.push('disconnect');
    },
    cscPluginQueueNavigation(url) {
      events.push('nav:' + new URL(url).pathname);
    }
  };
  vm.runInNewContext(navigation + '\n' +
    extracted('reconnectChatGPTSubjectHost') + '\n' +
    extracted('disconnectChatGPTSubjectHost') + '\n' +
    'this.reconnect = reconnectChatGPTSubjectHost;' +
    'this.disconnect = disconnectChatGPTSubjectHost;', context);
  context.reconnect();
  browser.history.pushState(null, '', '/c/a');
  browser.history.pushState(null, '', '/c/a');
  browser.history.replaceState(null, '', '/c/b');
  browser.history.pushState(null, '', '/c/a');
  context.disconnect();
  assert.deepEqual(events, [
    'construct', 'connect', 'nav:/', 'nav:/c/a', 'nav:/c/b', 'nav:/c/a',
    'disconnect', 'dispose'
  ]);
  const length = events.length;
  browser.history.pushState(null, '', '/c/c');
  assert.equal(events.length, length);
  assert.equal(listeners.size, 0);
});

test('exact Core pin and no second network parsing in assembled CSC path', () => {
  const dep = manifest.dependencies.find(d => d.name === 'AIConversationCore');
  assert.equal(dep.commit, '80b3e1354005e381c4fc1a81a26be3c45b45dd30');
  assert.equal(dep.git_blob_sha1, '76dfc50ecaa0d7fdca9c110d97a61b3f74b13789');
  const compiled = readFileSync(new URL(
    '../chatgpt-conversation-markdown-export.user.js', import.meta.url
  ), 'utf8');
  assert.ok(compiled.includes(dep.commit));
  assert.ok(compiled.includes('cscPluginQueueConnect'));
  assert.ok(compiled.includes('cscPluginQueueNavigation'));
  assert.ok(compiled.includes('connectChatGPTSubjectHost'));
  assert.ok(compiled.includes('0.1.0-issue.1.29'));
});
