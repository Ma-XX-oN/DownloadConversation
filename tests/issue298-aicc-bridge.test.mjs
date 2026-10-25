import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { functionSourceFrom } from './helpers/userscript-source.mjs';
const bridge = await readFile(new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url), 'utf8');

test('registered Core last subscription uses no obsolete loader', async () => {
  assert.doesNotMatch(bridge, /core\\.loadAgent\\(/);
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
