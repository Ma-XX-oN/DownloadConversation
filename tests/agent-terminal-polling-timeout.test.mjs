import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/agent-terminal-polling-timeout.json', import.meta.url),
  'utf8'
));

const timeoutEvent = Object.freeze({
  type: 'client_terminal_error',
  code: 'network_error',
  source: 'completion_stream_polling_fallback',
  reason: 'polling_timeout'
});

function soundHarness() {
  const context = {
    emitted: [],
    document: { addEventListener() {} },
    diagnostics: []
  };
  vm.runInNewContext(`
    let agentSoundVolume = 10;
    let agentSoundAudioContext = null;
    const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;
    const agentSoundTerminalKeys = new Set();
    function playAgentSound(kind) { this.emitted.push(kind); return true; }
    function agentSoundHandleUserGesture() {}
    function logDiagnostic(level, name, details) { this.diagnostics.push({ level, name, details }); }
    ${productionFunctionSource('agentSoundTerminalKey')}
    ${productionFunctionSource('agentSoundRememberTerminalKey')}
    ${productionFunctionSource('agentSoundClassifyTerminal')}
    ${productionFunctionSource('agentSoundObserveTerminal')}
    this.api = {
      classify: agentSoundClassifyTerminal,
      observe: agentSoundObserveTerminal,
      keys: () => [...agentSoundTerminalKeys]
    };
  `, context);
  return context;
}

function stopwatchHarness() {
  let now = 0;
  const elements = new Map();
  const body = { append(element) { if (element?.id) elements.set(element.id, element); } };
  const document = {
    body,
    documentElement: body,
    getElementById(id) { return elements.get(id) ?? null; },
    createElement() {
      return { id: '', style: {}, textContent: '', setAttribute() {} };
    }
  };
  const context = {
    document,
    performance: { now: () => now },
    setInterval() { return 1; },
    clearInterval() {}
  };
  vm.runInNewContext(`
    const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';
    const AGENT_STOPWATCH_REFRESH_MS = 250;
    let agentStopwatchState = null;
    let agentStopwatchTimer = null;
    ${productionFunctionSource('assert')}
    ${productionFunctionSource('agentStopwatchFormatDuration')}
    ${productionFunctionSource('agentStopwatchExchangeId')}
    ${productionFunctionSource('ensureAgentStopwatchControl')}
    ${productionFunctionSource('agentStopwatchRender')}
    ${productionFunctionSource('agentStopwatchStartTimer')}
    ${productionFunctionSource('agentStopwatchStopTimer')}
    ${productionFunctionSource('agentStopwatchStartNew')}
    ${productionFunctionSource('agentStopwatchRecordLap')}
    ${productionFunctionSource('agentStopwatchObserveRequest')}
    ${productionFunctionSource('agentStopwatchObserveInputMessage')}
    ${productionFunctionSource('agentStopwatchSuccessfulFinal')}
    ${productionFunctionSource('agentStopwatchObserveTerminal')}
    this.api = {
      request: agentStopwatchObserveRequest,
      input: agentStopwatchObserveInputMessage,
      terminal: agentStopwatchObserveTerminal,
      state: () => agentStopwatchState,
      text: () => document.getElementById(AGENT_STOPWATCH_ID)?.textContent ?? ''
    };
  `, context);
  return {
    api: context.api,
    setNow(value) { now = value; }
  };
}

function activeCapture(exchangeId = 'exchange-A') {
  return {
    conversation_id: 'conversation-1',
    parent_message_id: 'parent-1',
    stopwatch_submitted_at_ms: 1000,
    stopwatch_exchange_id: exchangeId,
    request_messages: [{
      id: 'user-1',
      author: { role: 'user' },
      metadata: {
        turn_exchange_id: exchangeId,
        working_turn_id: exchangeId,
        request_id: `request-${exchangeId}`
      }
    }],
    stream_messages: []
  };
}

test('real stats-flush polling-timeout fixture normalizes to one structured terminal error', () => {
  const context = { payload: fixture.stats_flush };
  vm.runInNewContext(`
    ${productionFunctionSource('agentTerminalFailureFromStatsPayload')}
    this.result = agentTerminalFailureFromStatsPayload(payload);
  `, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.result)),
    timeoutEvent
  );
});

test('polling-timeout terminal error produces exactly one error sound', () => {
  const harness = soundHarness();
  const capture = activeCapture();
  assert.equal(harness.api.classify(capture, timeoutEvent), 'error');
  harness.api.observe(capture, timeoutEvent);
  harness.api.observe(capture, timeoutEvent);
  assert.deepEqual(harness.emitted, ['error']);
  assert.equal(harness.api.keys().length, 1);
});

test('polling-timeout terminal error freezes the active stopwatch', () => {
  const harness = stopwatchHarness();
  const capture = activeCapture();
  harness.setNow(1000);
  harness.api.request(capture);
  harness.api.input(capture, {
    id: 'user-1',
    author: { role: 'user' },
    metadata: {
      turn_exchange_id: 'exchange-A',
      working_turn_id: 'exchange-A',
      request_id: 'request-exchange-A'
    }
  });
  harness.setNow(31000);
  harness.api.terminal(capture, timeoutEvent);

  const state = harness.api.state();
  assert.equal(state.active, false);
  assert.deepEqual(Array.from(state.laps_ms), [30000]);
  assert.equal(state.total_ms, 30000);
  assert.equal(harness.api.text(), 'Total: 0 m 30 s');
});

test('stock stats-flush request is observed structurally without visible error-text matching', () => {
  const install = productionFunctionSource('installNetworkCapture');
  assert.match(install, /agentTerminalObserveStatsRequest/);
  assert.match(userscript, /\/ces\/statsc\/flush/);
  assert.doesNotMatch(userscript, /Message delivery timed out/);
});
