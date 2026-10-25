import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { functionSourceFrom } from './helpers/userscript-source.mjs';
import { coreBundle } from './helpers/core-pin.mjs';

const source = await readFile(
  new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url),
  'utf8'
);

test('DC #298 binds Last through registered Core agent without loadAgent', async () => {
  assert.doesNotMatch(source, /\bcore\.loadAgent\(/);
  assert.match(source, /core\.createAgent\(/);
  let published;
  const coreRealm = { URL, setTimeout, clearTimeout };
  coreRealm.globalThis = coreRealm;
  vm.runInNewContext(coreBundle, coreRealm);
  const core = coreRealm.AIConversationCore;
  assert.equal(core.getVersion(), '1.1.2-issue.132.3');
  core.registerAgentPlugin({
    id: 'test-chatgpt', name: 'ChatGPT', iconUrl: 'https://example.test/icon.png',
    apiVersion: 1, recognize: input => input?.provider === 'chatgpt',
    create(context) {
      published = context.core.publishActivityTimestamp;
      return { sendMessage() {}, getResponse() {}, getTurns() { return []; },
        currentState() { return {}; }, observeState() { return () => {}; },
        commTraffic() {}, version() { return { plugin: 'test-chatgpt', apiVersion: 1 }; } };
    }
  });
  const seen = [];
  const ctx = vm.createContext({
    core, window: { addEventListener() {} }, CORE_VERSION: core.getVersion(),
    location: { href: 'https://chatgpt.com/c/fixture' },
    currentConversationId: () => 'fixture',
    canonicalCore: () => core,
    assert(condition, message) { if (!condition) throw Error(message); },
    agentTimingBindActivityObserver(registry, agent) {
      seen.push({ registry, agent });
      assert.equal(registry.activityState(agent).latestIncomingAtMs, null);
    },
    agentTimingUnbindActivityObserver() {},
    logDiagnostic() {}
  });
  vm.runInContext(`let chatGPTAgent = null; let chatGPTCanonicalSession = null;
    ${functionSourceFrom(source, 'ensureChatGPTCanonicalAgent')}
    globalThis.ensure = ensureChatGPTCanonicalAgent;`, ctx);
  const agent = await ctx.ensure();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].agent, agent);
  const stamp = Date.now() - 2500;
  assert.equal(published(stamp), true);
  assert.equal(core.activityState(agent).latestIncomingAtMs, stamp);
  assert.equal(await ctx.ensure(), agent);
  assert.equal(seen.length, 1);
});

test('startup subscribes to Core registration events, not a polling loader', () => {
  assert.match(source, /observeAgentPluginRegistration/);
  assert.match(source, /queueMicrotask\(agentTimingInstallRegistrationBinding\)/);
  assert.doesNotMatch(source, /setInterval.*agent.*plugin/s);
});
