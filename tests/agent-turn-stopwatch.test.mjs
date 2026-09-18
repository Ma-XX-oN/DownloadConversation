import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

function stopwatchHarness() {
  let now = 0;
  let intervalCallback = null;
  let nextTimerId = 1;
  const elements = new Map();
  const body = {
    append(element) {
      if (element?.id) elements.set(element.id, element);
    }
  };
  const document = {
    body,
    documentElement: body,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement() {
      return {
        id: '',
        style: {},
        textContent: '',
        setAttribute() {}
      };
    }
  };
  const context = {
    document,
    performance: { now: () => now },
    setInterval(callback) {
      intervalCallback = callback;
      return nextTimerId++;
    },
    clearInterval() {
      intervalCallback = null;
    }
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
    ${productionFunctionSource('agentStopwatchObserveStreamEvent')}
    this.api = {
      request: agentStopwatchObserveRequest,
      event: agentStopwatchObserveStreamEvent,
      terminal: agentStopwatchObserveTerminal,
      render: agentStopwatchRender,
      state: () => agentStopwatchState,
      text: () => document.getElementById(AGENT_STOPWATCH_ID)?.textContent ?? ''
    };
  `, context);
  return {
    api: context.api,
    setNow(value) {
      now = value;
    },
    tick() {
      intervalCallback?.();
    },
    element() {
      return elements.get('tm-agent-turn-stopwatch') ?? null;
    }
  };
}

function requestCapture(messageId, submittedAtMs) {
  return {
    conversation_id: 'conversation-1',
    parent_message_id: 'parent-1',
    request_messages: [{
      id: messageId,
      author: { role: 'user' },
      metadata: {}
    }],
    stream_messages: [],
    stopwatch_submitted_at_ms: submittedAtMs
  };
}

function inputEvent(messageId, exchangeId, messageType = null) {
  const metadata = {
    turn_exchange_id: exchangeId,
    working_turn_id: exchangeId,
    request_id: `request-${exchangeId}`
  };
  if (messageType) metadata.message_type = messageType;
  return {
    type: 'input_message',
    input_message: {
      id: messageId,
      author: { role: 'user' },
      metadata
    }
  };
}

function finalCapture(exchangeId) {
  return {
    conversation_id: 'conversation-1',
    stopwatch_exchange_id: exchangeId,
    stream_messages: [{
      id: `assistant-${exchangeId}`,
      author: { role: 'assistant' },
      channel: 'final',
      status: 'finished_successfully',
      end_turn: true,
      metadata: {
        turn_exchange_id: exchangeId,
        working_turn_id: exchangeId,
        request_id: `request-${exchangeId}`
      }
    }]
  };
}

test('Issue 136 development version and fixed top-right stopwatch control are present', () => {
  assert.match(userscript, /@version\s+1\.2\.0-issue\.137\.1/);
  assert.match(userscript, /AGENT_STOPWATCH_ID\s*=\s*'tm-agent-turn-stopwatch'/);
  const ensure = productionFunctionSource('ensureAgentStopwatchControl');
  assert.match(ensure, /style\.position\s*=\s*'fixed'/);
  assert.match(ensure, /style\.top\s*=\s*'56px'/);
  assert.match(ensure, /style\.right\s*=\s*'16px'/);
});

test('initial prompt starts Lap 1 at the local submission boundary', () => {
  const harness = stopwatchHarness();
  harness.setNow(1000);
  const capture = requestCapture('user-1', 1000);
  harness.api.request(capture);
  harness.api.event(capture, inputEvent('user-1', 'exchange-A'));

  harness.setNow(66000);
  harness.api.render();
  const state = harness.api.state();
  assert.equal(state.active, true);
  assert.equal(state.exchange_id, 'exchange-A');
  assert.deepEqual(Array.from(state.laps_ms), []);
  assert.equal(harness.api.text(), 'Total: 1 m 5 s');
});

test('same-exchange User message_type next freezes a lap at submission time and starts the next lap', () => {
  const harness = stopwatchHarness();
  const initial = requestCapture('user-1', 1000);
  harness.api.request(initial);
  harness.api.event(initial, inputEvent('user-1', 'exchange-A'));

  const followUp = requestCapture('user-2', 71000);
  harness.api.request(followUp);
  harness.setNow(76000);
  harness.api.event(followUp, inputEvent('user-2', 'exchange-A', 'next'));

  const state = harness.api.state();
  assert.deepEqual(Array.from(state.laps_ms), [70000]);
  assert.equal(state.lap_started_at_ms, 71000);
  assert.equal(harness.api.text(), 'Lap 1: 1 m 10 s\nLap 2: 0 m 5 s\nTotal: 1 m 15 s');
});

test('multiple User follow-ups remain one stopwatch session and final completion freezes last lap and Total', () => {
  const harness = stopwatchHarness();
  const initial = requestCapture('user-1', 1000);
  harness.api.request(initial);
  harness.api.event(initial, inputEvent('user-1', 'exchange-A'));

  const followUp1 = requestCapture('user-2', 71000);
  harness.api.request(followUp1);
  harness.api.event(followUp1, inputEvent('user-2', 'exchange-A', 'next'));

  const followUp2 = requestCapture('user-3', 101000);
  harness.api.request(followUp2);
  harness.api.event(followUp2, inputEvent('user-3', 'exchange-A', 'next'));

  harness.setNow(131000);
  harness.api.terminal(finalCapture('exchange-A'));
  const state = harness.api.state();
  assert.equal(state.active, false);
  assert.deepEqual(Array.from(state.laps_ms), [70000, 30000, 30000]);
  assert.equal(state.total_ms, 130000);
  assert.equal(
    harness.api.text(),
    'Lap 1: 1 m 10 s\nLap 2: 0 m 30 s\nLap 3: 0 m 30 s\nTotal: 2 m 10 s'
  );

  harness.setNow(191000);
  harness.tick();
  assert.equal(
    harness.api.text(),
    'Lap 1: 1 m 10 s\nLap 2: 0 m 30 s\nLap 3: 0 m 30 s\nTotal: 2 m 10 s'
  );
});

test('terminal completion for another exchange cannot stop the active stopwatch', () => {
  const harness = stopwatchHarness();
  const initial = requestCapture('user-1', 1000);
  harness.api.request(initial);
  harness.api.event(initial, inputEvent('user-1', 'exchange-A'));
  harness.setNow(31000);
  harness.api.terminal(finalCapture('exchange-B'));
  assert.equal(harness.api.state().active, true);
  assert.deepEqual(Array.from(harness.api.state().laps_ms), []);
});

test('next independent prompt after completion replaces the completed stopwatch session', () => {
  const harness = stopwatchHarness();
  const initial = requestCapture('user-1', 1000);
  harness.api.request(initial);
  harness.api.event(initial, inputEvent('user-1', 'exchange-A'));
  harness.setNow(31000);
  harness.api.terminal(finalCapture('exchange-A'));

  const next = requestCapture('user-4', 200000);
  harness.api.request(next);
  harness.api.event(next, inputEvent('user-4', 'exchange-B'));
  harness.setNow(205000);
  harness.api.render();

  const state = harness.api.state();
  assert.equal(state.active, true);
  assert.equal(state.exchange_id, 'exchange-B');
  assert.deepEqual(Array.from(state.laps_ms), []);
  assert.equal(harness.api.text(), 'Total: 0 m 5 s');
});

test('same-exchange User input creates a lap without relying on message_type metadata', () => {
  const harness = stopwatchHarness();
  const initial = requestCapture('user-1', 1000);
  harness.api.request(initial);
  harness.api.event(initial, inputEvent('user-1', 'exchange-A'));

  const followUp = requestCapture('user-2', 41000);
  harness.api.request(followUp);
  harness.api.event(followUp, inputEvent('user-2', 'exchange-A'));
  assert.deepEqual(Array.from(harness.api.state().laps_ms), [40000]);
});

test('stopwatch is wired to local POST time, enriched input_message state, and structured final state', () => {
  const requestCaptureSource = productionFunctionSource('captureGenerationStreamRequest');
  assert.match(requestCaptureSource, /submittedAtMs/);
  assert.match(requestCaptureSource, /agentStopwatchObserveRequest\(capture\)/);

  const install = productionFunctionSource('installNetworkCapture');
  assert.match(install, /generationSubmittedAtMs\s*=\s*generationRequest\s*\?\s*performance\.now\(\)/);
  assert.match(install, /captureGenerationStreamRequest\(request, generationSubmittedAtMs\)/);

  const consumer = productionFunctionSource('consumeStreamTailSseChunk');
  assert.match(consumer, /streamTailApplyEvent\(capture, parsed\);[\s\S]*agentStopwatchObserveStreamEvent\(capture, parsed\)/);
  const observer = productionFunctionSource('agentStopwatchObserveStreamEvent');
  assert.match(observer, /event\.type === 'input_message'/);
  assert.doesNotMatch(observer, /message_type/);

  const terminal = productionFunctionSource('agentStopwatchSuccessfulFinal');
  assert.match(terminal, /channel === 'final'/);
  assert.match(terminal, /status === 'finished_successfully'/);
  assert.match(terminal, /end_turn === true/);
});
