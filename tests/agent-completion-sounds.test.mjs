import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

function soundHarness(volume = 10, playbackResults = [true]) {
  const context = {
    emitted: [],
    playbackResults: [...playbackResults],
    diagnostics: [],
    performance: { now: () => 1000 },
    document: { addEventListener() {} }
  };
  vm.runInNewContext(`
    let agentSoundVolume = ${volume};
    let agentSoundAudioContext = null;
    let agentSoundPendingTerminal = null;
    const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;
    const agentSoundTerminalKeys = new Set();
    function playAgentSound(kind) {
      this.emitted.push(kind);
      return this.playbackResults.length ? this.playbackResults.shift() : true;
    }
    function agentSoundHandleUserGesture() {}
    function logDiagnostic(level, name, details) { this.diagnostics.push({ level, name, details }); }
    ${productionFunctionSource('agentSoundRememberTerminalKey')}
    ${productionFunctionSource('agentSoundRememberPendingTerminal')}
    ${productionFunctionSource('agentSoundClearPendingTerminal')}
    ${productionFunctionSource('agentSoundRetryPendingTerminal')}
    ${productionFunctionSource('agentTerminalIsPollingTimeout')}
    ${productionFunctionSource('agentTerminalHasFinishedAssistant')}
    ${productionFunctionSource('agentTerminalIsConversationTurnComplete')}
    ${productionFunctionSource('agentTerminalSuccessfulFinal')}
    ${productionFunctionSource('agentTerminalExchangeId')}
    ${productionFunctionSource('agentTerminalKey')}
    ${productionFunctionSource('agentTerminalClassifyKind')}
    ${productionFunctionSource('agentTerminalNormalize')}
    ${productionFunctionSource('agentSoundHandleTerminal')}
    this.api = {
      classify(capture, event) { return agentTerminalNormalize(capture, event)?.kind ?? null; },
      observe(capture, event) {
        const terminal = agentTerminalNormalize(capture, event);
        if (terminal) agentSoundHandleTerminal(terminal);
      },
      retry() { return agentSoundRetryPendingTerminal(); },
      keys: () => [...agentSoundTerminalKeys],
      pending: () => agentSoundPendingTerminal ? { ...agentSoundPendingTerminal } : null
    };
  `, context);
  return context;
}

function playbackHarness(volume, state = 'running') {
  const ramps = [];
  const oscillatorStarts = [];
  const context = {
    ramps,
    oscillatorStarts,
    diagnostics: [],
    window: {},
  };
  vm.runInNewContext(`
    let agentSoundVolume = ${volume};
    let agentSoundAudioContext = {
      state: ${JSON.stringify(state)},
      currentTime: 10,
      destination: {},
      createOscillator() {
        return {
          type: '',
          frequency: {
            setValueAtTime() {},
            linearRampToValueAtTime() {}
          },
          connect() {},
          start(at) { thisContext.oscillatorStarts.push(at); },
          stop() {}
        };
      },
      createGain() {
        return {
          connect() {},
          gain: {
            setValueAtTime(value, at) { thisContext.ramps.push({ type: 'set', value, at }); },
            exponentialRampToValueAtTime(value, at) { thisContext.ramps.push({ type: 'exp', value, at }); }
          }
        };
      }
    };
    const thisContext = this;
    function errorMessage(error) { return String(error?.message ?? error); }
    function logDiagnostic(level, name, details) { this.diagnostics.push({ level, name, details }); }
    ${productionFunctionSource('agentSoundAudioReady')}
    ${productionFunctionSource('playAgentSound')}
    this.result = playAgentSound('success');
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

function successfulCapture(turnId = 'turn-1') {
  const state = capture(turnId);
  state.stream_messages.push({
    id: `assistant-${turnId}`,
    author: { role: 'assistant' },
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true
  });
  return state;
}

test('Sound checkbox is replaced by a persisted 0-10 vertical volume popup', () => {
  assert.match(userscript,
    /AGENT_SOUND_VOLUME_STORAGE_KEY\s*=\s*'tm-conversation-recorder-agent-sound-volume'/);
  assert.doesNotMatch(userscript, /data-role="agent-sounds"[^>]*type="checkbox"/);
  assert.match(userscript, /data-role="agent-sound-control"[^>]*aria-haspopup="dialog"/);
  assert.match(userscript, /data-role="agent-sound-popup"[^>]*hidden/);
  assert.match(userscript,
    /data-role="agent-sound-volume"[^>]*type="range"[^>]*min="0"[^>]*max="10"[^>]*step="1"/);
  assert.match(userscript, /\.tm-sound-volume-slider[^}]*writing-mode:\s*vertical-lr/);
  assert.match(userscript, /\.tm-sound-volume-slider[^}]*direction:\s*rtl/);
  assert.match(userscript, /localStorage\.setItem\(AGENT_SOUND_VOLUME_STORAGE_KEY,/);
});

test('legacy boolean sound preference migrates deterministically to volume 10 or 0', () => {
  assert.match(userscript,
    /LEGACY_AGENT_SOUNDS_STORAGE_KEY\s*=\s*'tm-conversation-recorder-agent-sounds'/);
  const load = productionFunctionSource('loadAgentSoundVolume');
  assert.match(load, /legacy[^\n]*=== 'true'[\s\S]*10/);
  assert.match(load, /legacy[^\n]*=== 'false'[\s\S]*0/);
});

test('exact successful final Assistant terminal state is classified as success', () => {
  const { api } = soundHarness();
  assert.equal(api.classify(successfulCapture(), null), 'success');
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
});

test('normalized terminal playback is de-duplicated per turn and kind', () => {
  const harness = soundHarness(10, [true, true]);
  const state = successfulCapture('turn-1');
  harness.api.observe(state, null);
  harness.api.observe(state, null);
  assert.deepEqual(harness.emitted, ['success']);
  assert.equal(harness.api.keys().length, 1);
});

test('distinct later turn may sound after an earlier terminal turn', () => {
  const harness = soundHarness(10, [true, true]);
  harness.api.observe(successfulCapture('turn-1'), null);
  harness.api.observe(successfulCapture('turn-2'), null);
  assert.deepEqual(harness.emitted, ['success', 'success']);
  assert.equal(harness.api.keys().length, 2);
});

test('volume zero suppresses both success and error terminal playback', () => {
  const harness = soundHarness(0, [true, true]);
  harness.api.observe(successfulCapture('turn-1'), null);
  const state = capture('turn-2');
  harness.api.observe(state, {
    result: 'error',
    error: { reason: 'request_failed', status_code: 500 }
  });
  assert.deepEqual(harness.emitted, []);
});

test('browser-generated success cue uses volume as peak gain and does not require external media', () => {
  const harness = playbackHarness(7);
  assert.equal(harness.result, true);
  assert.equal(harness.oscillatorStarts.length, 1);
  assert.ok(harness.ramps.some(step => step.type === 'exp' && step.value === 0.7),
    'volume 7 must schedule a peak gain of 0.7');
});

test('browser-generated cue refuses playback while AudioContext is not running', () => {
  const harness = playbackHarness(10, 'suspended');
  assert.equal(harness.result, false);
  assert.equal(harness.oscillatorStarts.length, 0);
});

test('sound diagnostics expose classification, suppression, AudioContext, and successful scheduling states', () => {
  const observe = productionFunctionSource('agentSoundHandleTerminal');
  const unlock = productionFunctionSource('unlockAgentSoundAudio');
  const play = productionFunctionSource('playAgentSound');
  assert.match(observe, /agent-sound-terminal-classified/);
  assert.match(observe, /agent-sound-duplicate-suppressed/);
  assert.match(observe, /agent-sound-volume-zero-suppressed/);
  assert.match(unlock, /agent-sound-audio-unlock/);
  assert.match(play, /agent-sound-playback-attempt/);
  assert.match(play, /agent-sound-playback-started/);
  assert.match(play, /agent-sound-playback-unavailable/);
});
