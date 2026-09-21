import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const capturedFixture = await readFile(
  new URL('./fixtures/agent-turn-stopwatch-real-sse.txt', import.meta.url),
  'utf8'
);
const reloadResumeFixture = await readFile(
  new URL('./fixtures/agent-reload-resume-success-sse.txt', import.meta.url),
  'utf8'
);

function streamHarness() {
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
    URL,
    location: { origin: 'https://chatgpt.com' },
    document,
    structuredClone,
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
    const STREAM_TAIL_RECORD_LIMIT = 256;
    const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';
    const AGENT_STOPWATCH_REFRESH_MS = 250;
    let agentStopwatchState = null;
    let agentStopwatchTimer = null;
    function streamTailPersistCapture() { return true; }
    function agentSoundHandleTerminal() {}
    function agentSoundPositionInitializationIndicator() {}
    function logDiagnostic() {}
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
    ${productionFunctionSource('agentStopwatchObserveSteerTurn')}
    ${productionFunctionSource('agentStopwatchObserveInputMessage')}
    ${productionFunctionSource('agentTerminalIsPollingTimeout')}
    ${productionFunctionSource('agentTerminalHasFinishedAssistant')}
    ${productionFunctionSource('agentTerminalIsConversationTurnComplete')}
    ${productionFunctionSource('agentTerminalSuccessfulFinal')}
    ${productionFunctionSource('agentTerminalExchangeId')}
    ${productionFunctionSource('agentTerminalKey')}
    ${productionFunctionSource('agentTerminalClassifyKind')}
    ${productionFunctionSource('agentTerminalNormalize')}
    ${productionFunctionSource('agentStopwatchHandleTerminal')}
    const agentTerminalHandlers = Object.freeze([agentSoundHandleTerminal, agentStopwatchHandleTerminal]);
    ${productionFunctionSource('agentTerminalObserve')}
    ${productionFunctionSource('agentStopwatchObserveStreamEvent')}
    ${productionFunctionSource('isGenerationStreamUrl')}
    ${productionFunctionSource('isSteerTurnUrl')}
    ${productionFunctionSource('createStreamTailCapture')}
    ${productionFunctionSource('streamTailClone')}
    ${productionFunctionSource('streamTailUpsertMessage')}
    ${productionFunctionSource('streamTailPointerSegment')}
    ${productionFunctionSource('streamTailApplyPathPatch')}
    ${productionFunctionSource('streamTailApplyEvent')}
    ${productionFunctionSource('streamTailHasCompletedAssistant')}
    ${productionFunctionSource('consumeStreamTailSseChunk')}
    this.api = {
      create: createStreamTailCapture,
      request: agentStopwatchObserveRequest,
      steer: agentStopwatchObserveSteerTurn,
      consume: consumeStreamTailSseChunk,
      isGeneration: isGenerationStreamUrl,
      isSteer: isSteerTurnUrl,
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
    }
  };
}

function requestCapture(harness, messageId, submittedAtMs) {
  const capture = harness.api.create('conversation-1');
  capture.request_messages = [{
    id: messageId,
    author: { role: 'user' },
    metadata: {}
  }];
  capture.stopwatch_submitted_at_ms = submittedAtMs;
  harness.api.request(capture);
  return capture;
}

function inputMessageSse(messageId, exchangeId) {
  return `data: ${JSON.stringify({
    type: 'input_message',
    input_message: {
      id: messageId,
      author: { role: 'user', name: null, metadata: {} },
      status: 'finished_successfully',
      end_turn: null,
      metadata: {
        request_id: `request-${exchangeId}`,
        turn_exchange_id: exchangeId,
        working_turn_id: exchangeId,
        turn_id: `turn-${exchangeId}`,
        parent_id: 'parent-1'
      },
      recipient: 'all',
      channel: null
    },
    conversation_id: 'conversation-1'
  })}\n\n`;
}

function sameExchangeNextMetadataSse(exchangeId) {
  return `data: ${JSON.stringify({
    p: '',
    o: 'add',
    v: {
      message: {
        id: `system-${exchangeId}`,
        author: { role: 'system', name: null, metadata: {} },
        status: 'finished_successfully',
        end_turn: null,
        metadata: {
          request_id: `request-${exchangeId}`,
          message_type: 'next',
          turn_exchange_id: exchangeId,
          working_turn_id: exchangeId,
          turn_id: `turn-${exchangeId}`
        },
        recipient: 'all',
        channel: null
      }
    }
  })}\n\n`;
}

test('real SSE shape records a lap for a same-exchange user follow-up even though input_message has no message_type', () => {
  const harness = streamHarness();

  harness.setNow(1000);
  const initial = requestCapture(harness, 'user-1', 1000);
  harness.api.consume(initial, inputMessageSse('user-1', 'exchange-A'));
  assert.equal(harness.api.state().exchange_id, 'exchange-A');

  harness.setNow(71000);
  const followUp = requestCapture(harness, 'user-2', 71000);
  harness.api.consume(followUp, inputMessageSse('user-2', 'exchange-A'));
  harness.api.consume(followUp, sameExchangeNextMetadataSse('exchange-A'));

  const state = harness.api.state();
  assert.deepEqual(Array.from(state.laps_ms), [70000]);
  assert.equal(state.lap_started_at_ms, 71000);
});

test('real SSE shape resets to a fresh stopwatch when the user submission belongs to a different exchange', () => {
  const harness = streamHarness();

  harness.setNow(1000);
  const initial = requestCapture(harness, 'user-1', 1000);
  harness.api.consume(initial, inputMessageSse('user-1', 'exchange-A'));

  harness.setNow(71000);
  const next = requestCapture(harness, 'user-2', 71000);
  harness.api.consume(next, inputMessageSse('user-2', 'exchange-B'));

  const state = harness.api.state();
  assert.equal(state.active, true);
  assert.equal(state.exchange_id, 'exchange-B');
  assert.equal(state.started_at_ms, 71000);
  assert.deepEqual(Array.from(state.laps_ms), []);
});

test('captured production SSE fixture reaches final completion through the real stream consumer', () => {
  const harness = streamHarness();
  harness.setNow(1000);
  const capture = requestCapture(
    harness,
    'f883a1e5-e953-44fb-9340-4a3364131823',
    1000
  );
  harness.setNow(31000);
  harness.api.consume(capture, capturedFixture, true, false);

  const state = harness.api.state();
  assert.equal(state.active, false);
  assert.equal(state.exchange_id, 'bb0909f8-df1a-43a7-9bda-ebee076f6e09');
  assert.equal(state.total_ms, 30000);
  assert.deepEqual(Array.from(state.laps_ms), [30000]);
});

test('captured reload resume SSE can terminate an already-active matching exchange through the shared parser', () => {
  const harness = streamHarness();
  const exchange = 'd224d5a7-3ba9-4fd9-beb7-7d4c234e9b4d';

  harness.setNow(1000);
  const initial = requestCapture(
    harness,
    '31d021ea-4720-4a1c-88bf-8d84d5e66f2b',
    1000
  );
  harness.api.consume(initial, inputMessageSse(
    '31d021ea-4720-4a1c-88bf-8d84d5e66f2b',
    exchange
  ));
  assert.equal(harness.api.state().active, true);
  assert.equal(harness.api.state().exchange_id, exchange);

  harness.setNow(31000);
  const resumed = harness.api.create('6aae0d5c-7cbc-83e9-ac16-fbf6c7d5e82d');
  harness.api.consume(resumed, reloadResumeFixture, true, false);

  const state = harness.api.state();
  assert.equal(state.active, false);
  assert.equal(state.exchange_id, exchange);
  assert.equal(state.total_ms, 30000);
  assert.deepEqual(Array.from(state.laps_ms), [30000]);
});

test('live steer_turn follow-up records one lap at the POST boundary without double-counting later stream input', () => {
  const harness = streamHarness();

  assert.equal(harness.api.isGeneration('https://chatgpt.com/backend-api/f/conversation'), true);
  assert.equal(harness.api.isGeneration('https://chatgpt.com/backend-api/f/steer_turn'), false);
  assert.equal(harness.api.isSteer('https://chatgpt.com/backend-api/f/steer_turn'), true);
  assert.equal(harness.api.isSteer('https://chatgpt.com/backend-api/f/conversation'), false);
  assert.equal(harness.api.isSteer('https://example.com/backend-api/f/steer_turn'), false);

  harness.setNow(1000);
  const initial = requestCapture(harness, 'user-1', 1000);
  harness.api.consume(initial, inputMessageSse('user-1', 'exchange-A'));

  harness.setNow(71000);
  harness.api.steer(71000);
  assert.deepEqual(Array.from(harness.api.state().laps_ms), [70000]);
  assert.equal(harness.api.state().lap_started_at_ms, 71000);

  harness.api.consume(initial, inputMessageSse('user-2', 'exchange-A'));
  assert.deepEqual(Array.from(harness.api.state().laps_ms), [70000]);

  const install = productionFunctionSource('installNetworkCapture');
  assert.match(install, /isSteerTurnUrl\(requestUrl\)/);
  assert.match(install, /agentStopwatchObserveSteerTurn\(performance\.now\(\)\)/);
});
