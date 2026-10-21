import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

function lifecycleHarness() {
  const context = { rendered: [] };
  vm.runInNewContext(`
    let agentFaviconProcessingObserved = false;
    let agentFaviconRingRenderedStep = 0;
    let agentStopwatchState = null;
    function agentFaviconRingStep() { return 0; }
    function agentFaviconRenderState(state) { this.rendered.push(state); return Promise.resolve(true); }
    ${productionFunctionSource('agentStopwatchStreamIsActive')}
    ${productionFunctionSource('agentFaviconObserveProcessing')}
    ${productionFunctionSource('agentFaviconObserveStreamStatus')}
    ${productionFunctionSource('agentFaviconHandleTerminal')}
    this.api = {
      processing: agentFaviconObserveProcessing,
      streamStatus: agentFaviconObserveStreamStatus,
      terminal: agentFaviconHandleTerminal,
      observed: () => agentFaviconProcessingObserved
    };
  `, context);
  return context;
}

test('processing then successful terminal renders yellow then light green', () => {
  const harness = lifecycleHarness();
  harness.api.processing();
  assert.equal(harness.api.observed(), true);
  harness.api.terminal({ kind: 'success', terminal_key: 'conversation-1:exchange-A' });
  assert.equal(harness.api.observed(), false);
  assert.deepEqual(harness.rendered, ['processing', 'completed']);
});

test('successful terminal without current-page processing does not infer green', () => {
  const harness = lifecycleHarness();
  harness.api.terminal({ kind: 'success', terminal_key: 'conversation-1:exchange-A' });
  assert.deepEqual(harness.rendered, []);
});

test('reload IS_STREAMING renders processing while NOT_STREAMING leaves original untouched', () => {
  const streaming = lifecycleHarness();
  streaming.api.streamStatus({ status: 'IS_STREAMING' });
  assert.deepEqual(streaming.rendered, ['processing']);
  assert.equal(streaming.api.observed(), true);

  const idle = lifecycleHarness();
  idle.api.streamStatus({ status: 'NOT_STREAMING' });
  assert.deepEqual(idle.rendered, []);
  assert.equal(idle.api.observed(), false);
});

test('terminal error replaces processing favicon with red', () => {
  const harness = lifecycleHarness();
  harness.api.processing();
  harness.api.terminal({ kind: 'error', terminal_key: 'conversation-1:exchange-A' });
  assert.equal(harness.api.observed(), false);
  assert.deepEqual(harness.rendered, ['processing', 'error']);
});

test('post-success terminal error replaces completed favicon with red', () => {
  const harness = lifecycleHarness();
  harness.api.processing();
  harness.api.terminal({ kind: 'success', terminal_key: 'conversation-1:exchange-A' });
  harness.api.terminal({ kind: 'error', terminal_key: 'conversation-1:exchange-A' });
  assert.deepEqual(harness.rendered, ['processing', 'completed', 'error']);
});

test('a new prompt after completed state returns favicon to processing', () => {
  const harness = lifecycleHarness();
  harness.api.processing();
  harness.api.terminal({ kind: 'success', terminal_key: 'conversation-1:exchange-A' });
  harness.api.processing();
  assert.deepEqual(harness.rendered, ['processing', 'completed', 'processing']);
});

test('favicon is wired to the existing request, terminal, and reload watchers', () => {
  const install = productionFunctionSource('installNetworkCapture');
  const reload = productionFunctionSource('agentStopwatchObserveConversationResponse');

  assert.match(install, /generationRequest[\s\S]*agentFaviconObserveProcessing/);
  assert.match(reload, /agentStopwatchFetchStreamStatus\(conversationId\)[\s\S]*agentFaviconObserveStreamStatus\(streamStatus\)/);
  assert.match(userscript,
    /const agentTerminalHandlers = Object\.freeze\(\[[\s\S]*agentSoundHandleTerminal,[\s\S]*agentStopwatchHandleTerminal,[\s\S]*agentFaviconHandleTerminal[\s\S]*\]\)/);
  assert.doesNotMatch(productionFunctionSource('agentFaviconHandleTerminal'), /agentTerminalClassifyKind|agentTerminalNormalize/,
    'favicon terminal consumer must not rediscover terminal state');
});
