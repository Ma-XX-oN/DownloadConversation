import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

function soundHarness(enabled = true) {
  const context = {
    emitted: [],
    document: { addEventListener() {} }
  };
  vm.runInNewContext(`
    let agentSoundsEnabled = ${enabled ? 'true' : 'false'};
    const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;
    const agentSoundTerminalKeys = new Set();
    function playAgentSound(kind) { this.emitted.push(kind); }
    function agentSoundHandleUserGesture() {}
    ${productionFunctionSource('agentSoundTerminalKey')}
    ${productionFunctionSource('agentSoundRememberTerminalKey')}
    ${productionFunctionSource('agentSoundClassifyTerminal')}
    ${productionFunctionSource('agentSoundObserveTerminal')}
    this.api = {
      classify: agentSoundClassifyTerminal,
      observe: agentSoundObserveTerminal
    };
  `, context);
  return context;
}

function capture(turnId = 'turn-1') {
  return {
    conversation_id: 'conversation-1',
    parent_message_id: 'parent-1',
    request_messages: [{
      id: `user-${turnId}`,
      metadata: {
        turn_exchange_id: turnId,
        working_turn_id: turnId
      }
    }],
    stream_messages: []
  };
}

test('Issue 135 persisted Sounds checkbox uses the shared preference binder', () => {
  assert.match(userscript, /AGENT_SOUNDS_STORAGE_KEY\s*=\s*'tm-conversation-recorder-agent-sounds'/);
  assert.match(userscript, /data-role="agent-sounds"[^>]*type="checkbox"[^>]*>\s*Sounds/);
  assert.match(userscript,
    /bindStoredCheckbox\(panel, 'agent-sounds', AGENT_SOUNDS_STORAGE_KEY, agentSoundsEnabled,/);
});

test('exact successful final Assistant terminal state is classified as success', () => {
  const { api } = soundHarness();
  const state = capture();
  state.stream_messages.push({
    id: 'assistant-final',
    author: { role: 'assistant' },
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true
  });
  assert.equal(api.classify(state, null), 'success');
});

test('intermediate finished records and arbitrary error text are not terminal sounds', () => {
  const { api } = soundHarness();
  const state = capture();
  state.stream_messages.push({
    id: 'assistant-analysis',
    author: { role: 'assistant' },
    channel: 'analysis',
    status: 'finished_successfully',
    end_turn: false,
    content: { content_type: 'text', parts: ['error conversation_too_large'] }
  });
  assert.equal(api.classify(state, null), null);
  assert.equal(api.classify(state, {
    type: 'tool_result',
    message: 'error: conversation_too_large'
  }), null);
});

test('known structured terminal generation errors classify as error without text scanning', () => {
  const { api } = soundHarness();
  const state = capture();
  assert.equal(api.classify(state, {
    result: 'error',
    error: {
      reason: 'request_failed',
      status_code: 500,
      message: 'You have reached the maximum length for this conversation.'
    }
  }), 'error');
  assert.equal(api.classify(state, {
    type: 'error',
    code: 'conversation_too_large'
  }), 'error');
  assert.equal(api.classify(state, {
    type: 'error',
    error: { code: 'conversation_too_large' }
  }), 'error');
});

test('terminal sound is edge-triggered per turn and distinct turns may sound again', () => {
  const harness = soundHarness();
  const first = capture('turn-1');
  first.stream_messages.push({
    id: 'assistant-1',
    author: { role: 'assistant' },
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true
  });
  harness.api.observe(first, null);
  harness.api.observe(first, null);
  assert.deepEqual(harness.emitted, ['success']);

  const retrySameTurn = capture('turn-1');
  retrySameTurn.stream_messages.push({
    id: 'assistant-1-retry',
    author: { role: 'assistant' },
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true
  });
  harness.api.observe(retrySameTurn, null);
  assert.deepEqual(harness.emitted, ['success']);

  const second = capture('turn-2');
  harness.api.observe(second, {
    result: 'error',
    error: { reason: 'request_failed', status_code: 500 }
  });
  harness.api.observe(second, {
    result: 'error',
    error: { reason: 'request_failed', status_code: 500 }
  });
  assert.deepEqual(harness.emitted, ['success', 'error']);
});

test('disabled Sounds preference suppresses both success and error sounds', () => {
  const harness = soundHarness(false);
  const state = capture();
  state.stream_messages.push({
    id: 'assistant-final',
    author: { role: 'assistant' },
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true
  });
  harness.api.observe(state, null);
  harness.api.observe(capture('turn-2'), {
    result: 'error',
    error: { reason: 'request_failed', status_code: 500 }
  });
  assert.deepEqual(harness.emitted, []);
});

test('sound detection is wired into the existing SSE parser and Web Audio has ding/buzz profiles', () => {
  const consumer = productionFunctionSource('consumeStreamTailSseChunk');
  assert.match(consumer, /streamTailApplyEvent\(capture, parsed\);[\s\S]*agentSoundObserveTerminal\(capture, parsed\)/);
  assert.match(consumer, /data === '\[DONE\]'[\s\S]*agentSoundObserveTerminal\(capture, null\)/);
  assert.doesNotMatch(userscript, /includes\(['"]conversation_too_large['"]\)/,
    'Terminal error detection must not scan raw text for an error word/code.');
  const play = productionFunctionSource('playAgentSound');
  assert.match(play, /createOscillator\(/);
  assert.match(play, /createGain\(/);
  assert.match(play, /kind === 'error'/);
  assert.match(play, /kind === 'success'/);
});
