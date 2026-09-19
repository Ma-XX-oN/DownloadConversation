import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

function successfulCapture() {
  return {
    conversation_id: 'conversation-1',
    parent_message_id: 'parent-1',
    request_messages: [{
      id: 'user-1',
      author: { role: 'user' },
      metadata: { request_id: 'request-1' }
    }],
    stream_messages: [{
      id: 'assistant-1',
      author: { role: 'assistant' },
      channel: 'final',
      status: 'finished_successfully',
      end_turn: true,
      metadata: {
        turn_exchange_id: 'exchange-A',
        working_turn_id: 'exchange-A',
        request_id: 'request-1'
      }
    }]
  };
}

function terminalHarness() {
  const context = { performance: { now: () => 45000 } };
  vm.runInNewContext(`
    ${productionFunctionSource('agentTerminalIsPollingTimeout')}
    ${productionFunctionSource('agentTerminalSuccessfulFinal')}
    ${productionFunctionSource('agentTerminalExchangeId')}
    ${productionFunctionSource('agentTerminalKey')}
    ${productionFunctionSource('agentTerminalClassifyKind')}
    ${productionFunctionSource('agentTerminalNormalize')}
    this.normalize = agentTerminalNormalize;
  `, context);
  return context;
}

test('successful final is normalized once with the structured final exchange identity', () => {
  const context = terminalHarness();
  const terminal = context.normalize(successfulCapture(), null);
  assert.equal(terminal.kind, 'success');
  assert.equal(terminal.exchange_id, 'exchange-A');
  assert.equal(terminal.terminal_key, 'conversation-1:exchange-A');
  assert.equal(terminal.completed_at_ms, 45000);
});

test('top-level provider error_code is normalized as the shared terminal error kind', () => {
  const context = terminalHarness();
  const terminal = context.normalize(successfulCapture(), {
    message: null,
    conversation_id: 'conversation-1',
    error: 'You have reached the maximum length for this conversation.',
    error_code: 'conversation_too_large'
  });

  assert.equal(terminal.kind, 'error');
  assert.equal(terminal.exchange_id, 'exchange-A');
  assert.equal(terminal.terminal_key, 'conversation-1:exchange-A');
});

test('one normalized terminal object drives both sound and stopwatch', () => {
  const context = {
    emitted: [],
    diagnostics: [],
    performance: { now: () => 45000 },
    document: { addEventListener() {} }
  };
  vm.runInNewContext(`
    let agentSoundVolume = 10;
    let agentSoundAudioContext = { state: 'running' };
    const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;
    const agentSoundTerminalKeys = new Set();
    let agentStopwatchState = {
      active: true,
      exchange_id: 'exchange-A',
      started_at_ms: 5000,
      lap_started_at_ms: 5000,
      laps_ms: [],
      total_ms: null
    };
    let recordedLapAt = null;
    let stopped = false;
    let rendered = false;
    function playAgentSound(kind) { this.emitted.push(kind); return true; }
    function agentSoundHandleUserGesture() {}
    function logDiagnostic(level, name, details) { this.diagnostics.push({ level, name, details }); }
    function agentStopwatchRecordLap(at) {
      recordedLapAt = at;
      agentStopwatchState.laps_ms.push(at - agentStopwatchState.lap_started_at_ms);
    }
    function agentStopwatchStopTimer() { stopped = true; }
    function agentStopwatchRender() { rendered = true; }
    ${productionFunctionSource('agentSoundRememberTerminalKey')}
    ${productionFunctionSource('agentTerminalIsPollingTimeout')}
    ${productionFunctionSource('agentTerminalSuccessfulFinal')}
    ${productionFunctionSource('agentTerminalExchangeId')}
    ${productionFunctionSource('agentTerminalKey')}
    ${productionFunctionSource('agentTerminalClassifyKind')}
    ${productionFunctionSource('agentTerminalNormalize')}
    ${productionFunctionSource('agentSoundHandleTerminal')}
    ${productionFunctionSource('agentStopwatchHandleTerminal')}
    const agentTerminalHandlers = Object.freeze([
      agentSoundHandleTerminal,
      agentStopwatchHandleTerminal
    ]);
    ${productionFunctionSource('agentTerminalObserve')}
    this.observe = agentTerminalObserve;
    this.state = () => agentStopwatchState;
    this.recordedLapAt = () => recordedLapAt;
    this.stopped = () => stopped;
    this.rendered = () => rendered;
  `, context);

  context.observe(successfulCapture(), null);

  assert.deepEqual(context.emitted, ['success']);
  assert.equal(context.state().active, false,
    'A successful terminal accepted by sound must stop the matching active stopwatch.');
  assert.equal(context.recordedLapAt(), 45000);
  assert.equal(context.state().total_ms, 40000);
  assert.equal(context.stopped(), true);
  assert.equal(context.rendered(), true);
});

test('terminal consumers are reached only through the shared terminal hook', () => {
  const streamConsumer = productionFunctionSource('consumeStreamTailSseChunk');
  const stopwatchStream = productionFunctionSource('agentStopwatchObserveStreamEvent');
  const statsObserver = productionFunctionSource('agentTerminalObserveStatsRequest');

  assert.match(streamConsumer,
    /streamTailApplyEvent\(capture, parsed\);[\s\S]*agentTerminalObserve\(capture, parsed\)/);
  assert.match(streamConsumer,
    /data === '\[DONE\]'[\s\S]*agentTerminalObserve\(capture, null\)/);
  assert.doesNotMatch(streamConsumer, /agentSoundObserveTerminal/);
  assert.doesNotMatch(stopwatchStream, /agentStopwatchObserveTerminal/);
  assert.match(statsObserver, /agentTerminalObserve\(capture, event\)/);
  assert.doesNotMatch(statsObserver, /agentSoundObserveTerminal|agentStopwatchObserveTerminal/);
  assert.doesNotMatch(userscript, /function agentSoundObserveTerminal\s*\(/);
  assert.doesNotMatch(userscript, /function agentStopwatchObserveTerminal\s*\(/);
});
