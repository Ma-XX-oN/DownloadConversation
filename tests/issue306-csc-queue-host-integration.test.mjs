import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const early = readFileSync(new URL('../src/userscript/02-network-communication/03-csc-provider-navigation-ingress.js', import.meta.url), 'utf8');
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
  assert.equal(paths[queue + 1], 'src/userscript/02-network-communication/03-csc-provider-navigation-ingress.js');
  assert.match(bridge, /cscPluginQueueConnect\(host\)/);
  assert.match(bridge, /cscPluginQueueDisconnect\(host\)/);
  assert.match(early, /cscPluginQueueNavigation\(event\.url\)/);
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
    location: browser.location,
    unsafeWindow: browser,
    chatGPTAgent: {
      version: () => ({}),
      connectChatGPTSubjectHost(...args) {
        return context.chatGPTPluginModule.connectChatGPTSubjectHost(...args);
      }
    },
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
  vm.runInNewContext(navigation + '\n' + early + '\n' +
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
    'nav:/', 'construct', 'connect', 'nav:/c/a', 'nav:/c/b', 'nav:/c/a',
    'disconnect', 'dispose'
  ]);
  const length = events.length;
  browser.history.pushState(null, '', '/c/c');
  assert.equal(events.length, length);
  assert.equal(listeners.size, 0);
});

test('exact Core pin and no second network parsing in assembled CSC path', () => {
  const dep = manifest.dependencies.find(d => d.name === 'AIConversationCore');
  assert.equal(dep.commit, '629c86284b7db5fb412bb083178eaee8c06f796c');
  assert.equal(dep.git_blob_sha1, '2279b31f7760222a1486f641636eaab74702de1f');
  // Do not test an obsolete committed main installer: rebuild this exact tree.
  const work = mkdtempSync(join(tmpdir(), 'dc297-rebased-'));
  try {
    const output = join(work, 'registered-host.user.js');
    execFileSync(process.execPath,
      ['scripts/build-userscript.mjs', '--output', output],
      { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
    const compiled = readFileSync(output, 'utf8');
    assert.ok(compiled.includes(dep.commit));
    assert.ok(compiled.includes('cscPluginQueueConnect'));
    assert.ok(compiled.includes('cscPluginQueueNavigation'));
    assert.ok(compiled.includes('connectChatGPTSubjectHost'));
    assert.ok(compiled.includes('core.createAgent'));
    assert.doesNotMatch(compiled, /import\\(blobUrl\\)/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('real CSC queue and browser bridge deliver one backend identity then restore A on A-B-A', async () => {
  const queue = readFileSync(new URL(
    '../src/userscript/02-network-communication/03-csc-plugin-backlog.js',
    import.meta.url
  ), 'utf8');
  const logs = [];
  const callbacks = new Map();
  const page = {
    location: { origin: 'https://chatgpt.com', href: 'https://chatgpt.com/' },
    history: {
      pushState(_state, _title, path) {
        page.location.href = new URL(path, page.location.href).href;
      },
      replaceState(_state, _title, path) {
        page.location.href = new URL(path, page.location.href).href;
      }
    },
    addEventListener(name, cb) { callbacks.set(name, cb); },
    removeEventListener(name, cb) {
      if (callbacks.get(name) === cb) callbacks.delete(name);
    }
  };
  let captured = null;
  let sequence = 0;
  let order = 0;
  const identity = [];
  const cache = new Map();
  const pending = new Map();
  let route = null;
  let active = null;
  const host = {
    navigation({ url }) {
      const next = new URL(url).pathname;
      if (route === next) return false;
      route = next;
      pending.clear();
      logs.push('nav:' + next);
      identity.push(cache.get(next) ?? null);
      return true;
    },
    request({ network_sequence }) {
      logs.push('req:' + network_sequence);
      pending.set(network_sequence, route);
      return true;
    },
    response({ network_sequence, status, body }) {
      logs.push('resp:' + network_sequence);
      const expected = pending.get(network_sequence);
      pending.delete(network_sequence);
      if (status !== 200 || expected !== route) return false;
      cache.set(route, body.title);
      identity.push(body.title);
      return true;
    },
    dispose() { logs.push('dispose'); }
  };
  const ctx = {
    assert, Reflect, URL, JSON, Object, Promise, setTimeout, clearTimeout,
    logDiagnostic() {},
    agentPluginPageWindow: page,
    location: page.location,
    unsafeWindow: page,
    chatGPTAgent: {
      version: () => ({}),
      connectChatGPTSubjectHost(...args) {
        return ctx.chatGPTPluginModule.connectChatGPTSubjectHost(...args);
      }
    },
    chatGPTSubjectHost: null, disconnectChatGPTNavigation: null,
    chatGPTPluginModule: {
      connectChatGPTSubjectHost() { return host; }
    },
    cscCaptureNow(transport, direction) {
      sequence++;
      order++;
      return {
        transport, direction, capture_order: order,
        network_sequence: sequence, capture_id: 'page:' + order,
        connection_id: 'nav:' + order, captured_at_epoch_ms: 1
      };
    },
    cscBindPluginIngress(callback) { captured = callback; },
    cancelReadableBodyQuietly: async () => {}
  };
  vm.runInNewContext(queue + '\n' + navigation + '\n' + early + '\n' +
    extracted('reconnectChatGPTSubjectHost') + '\n' +
    extracted('disconnectChatGPTSubjectHost') + '\n' +
    'this.api = { reconnectChatGPTSubjectHost, disconnectChatGPTSubjectHost,' +
    ' cscPluginQueueSnapshot };', ctx);
  assert.equal(typeof captured, 'function');
  const flush = async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
  };
  await flush();
  const a = '/c/11111111-1111-4111-8111-111111111111';
  const b = '/c/22222222-2222-4222-8222-222222222222';
  page.history.pushState(null, '', a);
  await flush();
  const request = Object.freeze({
    transport: 'fetch', direction: 'request',
    capture_order: ++order, network_sequence: ++sequence,
    capture_id: 'page:request', connection_id: 'requestA',
    method: 'GET', request_url: 'https://chatgpt.com/backend-api/conversation/A'
  });
  const response = Object.freeze({
    transport: 'fetch', direction: 'response',
    capture_order: ++order, network_sequence: ++sequence,
    capture_id: 'page:response', connection_id: 'requestA', status: 200
  });
  captured({ envelope: request, source: null, source_available: false });
  captured({
    envelope: response, source: { title: 'verified A' },
    source_available: true, source_incomplete: false
  });
  assert.equal(ctx.api.cscPluginQueueSnapshot().queued, 4,
    'Initial route, A route, request and response must wait for late host');
  ctx.api.reconnectChatGPTSubjectHost();
  await flush();
  page.history.pushState(null, '', b);
  page.history.pushState(null, '', a);
  await flush();
  assert.equal(identity.at(-1), 'verified A');
  assert.deepEqual(logs.filter(x => x.startsWith('req:')).length, 1);
  assert.deepEqual(logs.filter(x => x.startsWith('resp:')).length, 1);
  assert.equal(ctx.api.cscPluginQueueSnapshot().queued, 0);
  ctx.api.disconnectChatGPTSubjectHost();
  assert.equal(ctx.api.cscPluginQueueSnapshot().connected, false);
  assert.equal(logs.at(-1), 'dispose');
});
