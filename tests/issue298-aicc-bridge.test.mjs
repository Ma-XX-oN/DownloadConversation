import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { coreBundle } from './helpers/core-pin.mjs';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

test('DC canonical agent bridge binds exact AICC browser loader registry through V1 only', async () => {
  const browser = { URL };
  browser.globalThis = browser;
  vm.runInNewContext(coreBundle, browser);
  const core = browser.AIConversationCore;
  assert.equal(core.getVersion(), '1.1.0-issue.132.2');

  const observed = [];
  const diagnostics = [];
  let providerCreation = null;
  const context = vm.createContext({
    core,
    CORE_VERSION: core.getVersion(),
    assert(condition, message) {
      if (!condition) throw new Error(message);
    },
    canonicalCore() { return core; },
    currentConversationId() { return 'fixture-conversation'; },
    importAgentPluginModule: async descriptor => ({
      default: {
        id: descriptor.id,
        apiVersion: descriptor.apiVersion,
        create(creation) {
          providerCreation = creation;
          return {
            sendMessage() {},
            getResponse() {},
            getTurns() { return []; },
            currentState() { return {}; },
            observeState() { return () => {}; },
            commTraffic() {},
            version() {
              return {
                plugin: descriptor.id,
                apiVersion: descriptor.apiVersion,
                version: descriptor.version,
                ref: creation.ref
              };
            }
          };
        }
      }
    }),
    agentTimingBindActivityObserver(registry, agent) {
      observed.push({ registry, agent });
      assert.equal(registry.activityState(agent).apiVersion, 1);
      return registry.observeActivity(agent, () => {});
    },
    logDiagnostic(level, event, details) {
      diagnostics.push({ level, event, details });
    }
  });
  const bridge = productionFunctionSource('ensureChatGPTCanonicalAgent');
  vm.runInContext(`
    let chatGPTAgent = null;
    let chatGPTCanonicalSession = null;
    ${bridge}
    globalThis.ensure = ensureChatGPTCanonicalAgent;
  `, context);

  const first = await context.ensure();
  assert.ok(first);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].agent, first);
  assert.equal(providerCreation.conversationId, 'fixture-conversation');
  assert.equal(typeof providerCreation.core.publishActivityTimestamp, 'function');
  assert.equal(observed[0].registry.activityState(first).latestIncomingAtMs, null);

  const capturedAtReceipt = Date.now() - 1000;
  assert.equal(providerCreation.core.publishActivityTimestamp(capturedAtReceipt), true);
  assert.equal(
    observed[0].registry.activityState(first).latestIncomingAtMs,
    capturedAtReceipt
  );
  assert.equal(await context.ensure(), first);
  assert.equal(observed.length, 1, 'repeat ensure must not duplicate subscription');
  assert.ok(diagnostics.some(item => item.event === 'agent-plugin-ready'));
  assert.equal(diagnostics.some(item => item.event === 'aicc-last-activity-v1-unavailable'), false);
});
