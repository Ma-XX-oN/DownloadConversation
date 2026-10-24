import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const bridge = await readFile(new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url), 'utf8');
function harness(core) {
  const context = { canonicalCore: () => core, assert: (ok, message) => assert.ok(ok, message),
    currentConversationId: () => 'conversation-366', logDiagnostic() {},
    canonicalEnrichRecoveredImages: event => event };
  vm.runInNewContext(bridge + '\nthis.ready = ensureChatGPTCanonicalAgent;', context);
  return context;
}
test('registered agent and Core session are acquired once without transport or polling', async () => {
  const agent = { version: () => ({plugin: 'independent', apiVersion: 1}) };
  let calls = 0;
  const h = harness({ recognizeAgentPlugin: input => {
    assert.equal(input.provider, 'chatgpt'); return {id: 'independent'};
  }, createAgent(id, context) {
    assert.equal(id, 'independent'); assert.equal(context.conversationId, 'conversation-366');
    calls++; return {agent, session: {events: []}};
  }});
  assert.equal(await h.ready(), agent);
  assert.equal(await h.ready(), agent);
  assert.equal(calls, 1);
});
test('missing registration fails immediately and a later registration can be retried', async () => {
  let descriptor = null;
  const agent = {version: () => ({plugin: 'late', apiVersion: 1})};
  const h = harness({recognizeAgentPlugin: () => descriptor,
    createAgent: () => ({agent, session: {events: []}})});
  await assert.rejects(h.ready(), /registered provider/);
  descriptor = {id: 'late'};
  assert.equal(await h.ready(), agent);
});
test('factory failure leaves readiness retryable; incomplete association is never cached', async () => {
  let loaded = {agent: {version: () => ({})}, session: null};
  const h = harness({recognizeAgentPlugin: () => ({id: 'fixture'}), createAgent: () => loaded});
  await assert.rejects(h.ready(), /canonical session/);
  loaded = {agent: {version: () => ({})}, session: {events: []}};
  assert.equal(await h.ready(), loaded.agent);
});
test('production has no provider global, catalogue, Blob import or retry timer', () => {
  assert.doesNotMatch(bridge, /ChatGPTWebAgentPlugin|loadAgent|getAgentPluginArtifact|importAgentPluginModule|setTimeout|30000|new Blob/);
});
