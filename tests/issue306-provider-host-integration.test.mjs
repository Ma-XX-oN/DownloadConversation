import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const bridge = readFileSync(
  new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url),
  'utf8'
);
const navigation = readFileSync(
  new URL('../src/userscript/04-conversation-rendering/08e-generic-browser-navigation.js', import.meta.url),
  'utf8'
);
const names = [
  'ensureChatGPTCanonicalAgent', 'reconnectChatGPTSubjectHost',
  'agentPluginObserveNetworkRequest', 'agentPluginObserveFetchResponse',
  'agentPluginObserveXhrResponse', 'disconnectChatGPTSubjectHost'
];
const methods = names.map(name => {
  const start = bridge.indexOf('  ' + (name === 'ensureChatGPTCanonicalAgent' ||
    name === 'agentPluginObserveFetchResponse' ? 'async ' : '') + 'function ' + name + '(');
  assert.ok(start >= 0, 'Missing production method ' + name);
  const end = bridge.indexOf('\n  /**', start + 5);
  assert.ok(end > start);
  return bridge.slice(start, end);
}).join('\n');

/**
 * Builds a real production observer/bridge with a simulated provider transport.
 * @returns {Object} Test API with fake network, routes, and identity notifications.
 */
function fixture(withNavigation = true) {
  const listeners = new Map();
  const navListeners = new Map();
  const browser = {
    location: { href: 'https://chatgpt.com/', origin: 'https://chatgpt.com' },
    addEventListener(name, cb) { listeners.set(name, cb); },
    removeEventListener(name, cb) {
      if (listeners.get(name) === cb) listeners.delete(name);
    },
    navigation: {
      addEventListener(name, cb) { navListeners.set(name, cb); },
      removeEventListener(name, cb) {
        if (navListeners.get(name) === cb) navListeners.delete(name);
      }
    },
    history: {
      pushState(_state, _title, path) {
        browser.location.href = new URL(path, browser.location.href).href;
      },
      replaceState(_state, _title, path) {
        browser.location.href = new URL(path, browser.location.href).href;
      }
    }
  };
  const events = [];
  const instances = [];
  let witnessCalls = 0;
  const agent = {
    version: () => ({ plugin: 'chatgpt-web', version: 'provider-v1' }),
    publishSubjectIdentity(value) { events.push(value); }
  };
  const module = {
    connectChatGPTSubjectHost({ agent: connected, origin, conversationId }) {
      assert.equal(connected, agent);
      assert.equal(origin, 'https://chatgpt.com');
      assert.equal(conversationId, null);
      const cache = new Map();
      const pending = new Map();
      let lastSequence = -1;
      let route = null;
      let disposed = false;
      const host = {
        requests: [],
        responses: [],
        navigation({ url }) {
          if (disposed) return false;
          const next = new URL(url).pathname;
          if (next === route) return false;
          route = next;
          pending.clear();
          events.push(cache.get(route) ?? { route, status: 'unresolved' });
          return true;
        },
        request({ network_sequence, method, request_url }) {
          if (disposed || network_sequence <= lastSequence) return false;
          if (method !== 'GET') return false;
          lastSequence = network_sequence;
          pending.set(network_sequence, route);
          this.requests.push({ network_sequence, request_url, route });
          return true;
        },
        response({ network_sequence, status, body }) {
          this.responses.push({ network_sequence, status, body });
          const expected = pending.get(network_sequence);
          pending.delete(network_sequence);
          if (!expected || expected !== route || status !== 200) return false;
          const snapshot = { route, status: 'identified', title: body.title };
          cache.set(route, snapshot);
          events.push(snapshot);
          return true;
        },
        dispose() { disposed = true; pending.clear(); cache.clear(); },
        get disposed() { return disposed; }
      };
      instances.push(host);
      if (!withNavigation) delete host.navigation;
      return host;
    }
  };
  const context = {
    assert, Reflect, URL, Promise, JSON,
    agentPluginPageWindow: browser,
    chatGPTAgent: null,
    chatGPTCanonicalSession: null,
    chatGPTAgentPromise: null,
    chatGPTSubjectHost: null,
    disconnectChatGPTNavigation: null,
    chatGPTPluginModule: module,
    aicc127Runtime: {},
    aicc127NavigationChanged: () => { witnessCalls++; },
    importAgentPluginModule: async () => module,
    canonicalCore: () => ({ loadAgent: async () => ({
      agent, session: { events: [] }
    }) }),
    currentConversationId: () => null,
    logDiagnostic() {},
    cloneSafely: response => response.clone(),
    boundedDiagnosticText: String,
    errorMessage: e => String(e)
  };
  vm.runInNewContext(navigation + '\n' + methods + '\nthis.api = {ensureChatGPTCanonicalAgent, reconnectChatGPTSubjectHost, agentPluginObserveNetworkRequest, agentPluginObserveFetchResponse, agentPluginObserveXhrResponse, disconnectChatGPTSubjectHost};', context);
  return {
    api: context.api, events, instances, browser, listeners, navListeners,
    get witnessCalls() { return witnessCalls; },
    route(path) { browser.history.pushState({}, '', path); },
    pageRestore() { context.api.reconnectChatGPTSubjectHost(); }
  };
}

test('production bridge forwards initial navigation and restores A on A-B-A without network', async () => {
  const f = fixture();
  await f.api.ensureChatGPTCanonicalAgent();
  const a = '/c/11111111-1111-4111-8111-111111111111';
  const b = '/c/22222222-2222-4222-8222-222222222222';
  f.route(a);
  const host = f.instances[0];
  const accepted = f.api.agentPluginObserveNetworkRequest({
    sequence: 41, method: 'GET', url: 'https://chatgpt.com/backend-api/conversations/a'
  });
  assert.equal(accepted, host);
  f.api.agentPluginObserveXhrResponse({
    status: 200, responseType: 'json', response: { title: 'verified A' }
  }, { sequence: 41 }, accepted);
  f.route(b);
  f.route(a);
  assert.equal(f.events.at(-1).title, 'verified A');
  assert.equal(host.requests.length, 1, 'Return to A must not request network.');
  assert.equal(host.responses.length, 1);
  f.api.disconnectChatGPTSubjectHost();
});

test('network sequences remain unique across ABA and old response never changes current route', async () => {
  const f = fixture();
  await f.api.ensureChatGPTCanonicalAgent();
  f.route('/a');
  const host = f.instances[0];
  const a = f.api.agentPluginObserveNetworkRequest({
    sequence: 50, method: 'GET', url: '/backend-api/conversations/a'
  });
  f.route('/b');
  assert.equal(f.api.agentPluginObserveNetworkRequest({
    sequence: 50, method: 'GET', url: '/backend-api/conversations/b'
  }), null);
  f.route('/a');
  assert.equal(host.response({
    network_sequence: 50, status: 200, body: { title: 'late B' }
  }), false);
  const next = f.api.agentPluginObserveNetworkRequest({
    sequence: 51, method: 'GET', url: '/backend-api/conversations/a'
  });
  assert.equal(next, a);
  f.api.disconnectChatGPTSubjectHost();
});

test('pagehide disposal and pageshow restore use same Core agent with new host', async () => {
  const f = fixture();
  const agent = await f.api.ensureChatGPTCanonicalAgent();
  f.api.disconnectChatGPTSubjectHost();
  assert.equal(f.instances[0].disposed, true);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.navListeners.size, 0);
  f.pageRestore();
  assert.equal(f.instances.length, 2);
  assert.equal(f.instances[1].disposed, false);
  assert.equal(await f.api.ensureChatGPTCanonicalAgent(), agent);
  f.api.disconnectChatGPTSubjectHost();
});

test('a completed fetch clone is forwarded only to original active provider host', async () => {
  const f = fixture();
  await f.api.ensureChatGPTCanonicalAgent();
  f.route('/a');
  const accepted = f.api.agentPluginObserveNetworkRequest({
    sequence: 17, method: 'GET', url: '/backend-api/conversations/a'
  });
  const response = {
    status: 200,
    clone() {
      return { json: async () => ({ title: 'verified fetch' }) };
    }
  };
  await f.api.agentPluginObserveFetchResponse(response, { sequence: 17 }, accepted);
  assert.equal(f.events.at(-1).title, 'verified fetch');
  f.api.disconnectChatGPTSubjectHost();
  f.pageRestore();
  const before = f.events.length;
  await f.api.agentPluginObserveFetchResponse(response, { sequence: 17 }, accepted);
  assert.equal(f.events.length, before);
  f.api.disconnectChatGPTSubjectHost();
});

test('older Core catalogue provider leaves existing agent export usable', async () => {
  const f = fixture(false);
  const agent = await f.api.ensureChatGPTCanonicalAgent();
  assert.equal(agent.version().plugin, 'chatgpt-web');
  assert.equal(f.instances[0].disposed, true);
  assert.equal(f.api.agentPluginObserveNetworkRequest({
    sequence: 1, method: 'GET', url: '/backend-api/conversations/a'
  }), null);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.navListeners.size, 0);
  f.api.disconnectChatGPTSubjectHost();
});

test('assembled userscript contains exact public Core catalogue pin for private provider 1.29', () => {
  const generated = readFileSync(
    new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
    'utf8'
  );
  for (const expected of [
    '80b3e1354005e381c4fc1a81a26be3c45b45dd30',
    '76dfc50ecaa0d7fdca9c110d97a61b3f74b13789',
    'db7e3450aac94eb2990fba0de54d090e377dafa3',
    'c731721005aefbc14a61bfc97270d7270aa80ea0',
    '0.1.0-issue.1.29'
  ]) {
    assert.ok(generated.includes(expected), 'Assembled Core/provider pin missing: ' + expected);
  }
});

test('shared browser History fallback forwards route to active AICC live witness once', async () => {
  const f = fixture();
  await f.api.ensureChatGPTCanonicalAgent();
  const before = f.witnessCalls;
  f.route('/c/11111111-1111-4111-8111-111111111111');
  assert.equal(f.witnessCalls, before + 1);
  f.api.disconnectChatGPTSubjectHost();
  f.route('/c/22222222-2222-4222-8222-222222222222');
  assert.equal(f.witnessCalls, before + 1, 'Disposed host cannot notify witness.');
});
