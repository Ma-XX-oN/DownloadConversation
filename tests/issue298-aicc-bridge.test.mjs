import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { functionSourceFrom } from './helpers/userscript-source.mjs';
const bridge = await readFile(new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url), 'utf8');

test('registered Core last subscription uses no obsolete loader', async () => {
  assert.equal(bridge.includes('core.loadAgent('), false);
  const subscriptions = [];
  const listeners = [];
  const logs = [];
  const agent = { version: () => ({ plugin: 'chatgpt-web', apiVersion: 1 }) };
  const session = { events: [] };
  const core = {
    recognizeAgentPlugin: () => ({ id: 'chatgpt-web' }),
    createAgent: () => ({ agent, session }),
    activityState: () => Object.freeze({ apiVersion: 1, clockDomain: 'unix-epoch-ms', latestIncomingAtMs: null }),
    observeActivity: (target, cb) => { subscriptions.push(target); cb(core.activityState(target)); return () => {}; }
  };
  const context = vm.createContext({
    window: { addEventListener: (type, fn) => listeners.push(type) },
    canonicalCore: () => core,
    currentConversationId: () => 'conversation-1',
    assert: (condition, msg) => { if (!condition) throw Error(msg); },
    agentTimingBindActivityObserver: (registry, target) => {
      assert.equal(registry, core);
      registry.observeActivity(target, () => {});
    },
    agentTimingUnbindActivityObserver: () => {},
    logDiagnostic: (...args) => logs.push(args),
    location: { href: 'https://chatgpt.com/c/1' }
  });
  const f = functionSourceFrom(bridge, 'ensureChatGPTCanonicalAgent');
  vm.runInContext(`let chatGPTAgent = null; let chatGPTCanonicalSession = null;
    ${f}
    globalThis.ensure = ensureChatGPTCanonicalAgent;`, context);
  assert.equal(await context.ensure(), agent);
  assert.equal(await context.ensure(), agent);
  assert.deepEqual(subscriptions, [agent]);
  assert.ok(listeners.includes('pagehide'));
  assert.ok(logs.some(x => x[1] === 'agent-plugin-ready'));
});

test('late provider registration binds Last after DOM ready with no polling', () => {
  const observers = [];
  const events = new Map();
  const inventory = [];
  const results = { creations: 0, binds: 0, disposal: 0 };
  const provider = {
    id: 'chatgpt-web', recognize: input => input.provider === 'chatgpt'
  };
  const core = {
    recognizeAgentPlugin: context => inventory.find(x => x.recognize(context)) ?? null,
    createAgent: () => {
      results.creations += 1;
      return { agent: {version: () => ({plugin: 'chatgpt-web', apiVersion: 1})},
        session: {events: []} };
    },
    activityState: () => Object.freeze({
      apiVersion: 1, clockDomain: 'unix-epoch-ms', latestIncomingAtMs: null
    }),
    observeActivity: () => () => {},
    observeAgentPluginRegistrations: cb => {
      observers.push(cb);
      cb(Object.freeze([...inventory]));
      return () => {
        const index = observers.indexOf(cb);
        if (index >= 0) observers.splice(index, 1);
        results.disposal += 1;
      };
    }
  };
  const document = {readyState: 'loading'};
  const context = vm.createContext({
    window: {
      addEventListener(name, fn) {
        if (!events.has(name)) events.set(name, []);
        events.get(name).push(fn);
      }
    },
    document,
    location: {href: 'https://chatgpt.com/c/a'},
    canonicalCore: () => core,
    currentConversationId: () => 'a',
    assert(condition, message) { if (!condition) throw Error(message); },
    agentTimingBindActivityObserver: (registeredCore, agent) => {
      assert.equal(registeredCore, core);
      assert.ok(agent);
      results.binds += 1;
    },
    agentTimingUnbindActivityObserver: () => {},
    logDiagnostic() {}
  });
  vm.runInContext(`
    let canonicalEventsBySourceRecord;
    let canonicalImageResourcesByRecordAndPart;
    ${bridge}
  `, context);
  assert.equal(results.creations, 0, 'unknown initial provider must not be fabricated');
  document.readyState = 'interactive';
  for (const callback of events.get('DOMContentLoaded') ?? []) callback();
  assert.equal(results.creations, 0, 'DOM ready must not manufacture a provider');
  inventory.push(provider);
  for (const observer of [...observers]) observer(Object.freeze([...inventory]));
  assert.equal(results.creations, 1, 'late registration must initialize exactly once');
  assert.equal(results.binds, 1, 'public AICC Last must bind exactly once');
  for (const observer of [...observers]) observer(Object.freeze([...inventory]));
  assert.equal(results.creations, 1);
  for (const callback of events.get('pagehide') ?? []) callback();
  assert.equal(results.disposal, 1);
  for (const observer of [...observers]) observer(Object.freeze([...inventory]));
  assert.equal(results.creations, 1, 'retired page cannot recreate agent');
});

test('provider-first registration auto-binds immediately after late script injection', () => {
  let created = 0;
  let subscribed = 0;
  let observerCalls = 0;
  const provider = {id: 'chatgpt-web'};
  const events = [];
  const core = {
    recognizeAgentPlugin: () => provider,
    createAgent: () => {
      created += 1;
      return {agent: {version: () => ({plugin: provider.id, apiVersion: 1})},
        session: {events: []}};
    },
    activityState: () => Object.freeze({
      apiVersion: 1, clockDomain: 'unix-epoch-ms', latestIncomingAtMs: null
    }),
    observeActivity: () => () => {},
    observeAgentPluginRegistrations(cb) {
      observerCalls += 1;
      cb(Object.freeze([provider]));
      return () => {};
    }
  };
  const context = vm.createContext({
    document: {readyState: 'complete'},
    window: {addEventListener: name => events.push(name)},
    location: {href: 'https://chatgpt.com/c/a'},
    canonicalCore: () => core, currentConversationId: () => 'a',
    assert(condition, msg) { if (!condition) throw Error(msg); },
    agentTimingBindActivityObserver: () => { subscribed += 1; },
    agentTimingUnbindActivityObserver: () => {},
    logDiagnostic() {}
  });
  vm.runInContext(`
    let canonicalEventsBySourceRecord;
    let canonicalImageResourcesByRecordAndPart;
    ${bridge}
  `, context);
  assert.equal(created, 1);
  assert.equal(subscribed, 1);
  assert.equal(observerCalls, 1);
  assert.equal(events.includes('DOMContentLoaded'), false);
});
