import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

const ACTIVE_BACKGROUND = 'rgba(32, 32, 32, 0.92)';
const SUCCESS_BACKGROUND = 'darkgreen';

function user(id, exchangeId, createTime) {
  return {
    id,
    author: { role: 'user' },
    create_time: createTime,
    update_time: null,
    content: { content_type: 'text', parts: [id] },
    status: 'finished_successfully',
    end_turn: null,
    metadata: {
      turn_exchange_id: exchangeId,
      working_turn_id: exchangeId
    },
    channel: null
  };
}

function assistant(id, exchangeId, createTime, updateTime, endTurn = true) {
  return {
    id,
    author: { role: 'assistant' },
    create_time: createTime,
    update_time: updateTime,
    content: { content_type: 'text', parts: [id] },
    status: 'finished_successfully',
    end_turn: endTurn,
    metadata: {
      turn_exchange_id: exchangeId,
      working_turn_id: exchangeId
    },
    channel: endTurn ? 'final' : 'commentary'
  };
}

function page(messages, {
  hasPrevious = false,
  startCursor = null,
  conversationId = 'conversation-1'
} = {}) {
  return {
    conversation_id: conversationId,
    messages,
    page_info: {
      has_previous_page: hasPrevious,
      has_next_page: false,
      start_cursor: startCursor,
      end_cursor: messages.at(-1)?.id ?? null
    }
  };
}

function restoreHarness() {
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
    const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';
    const AGENT_STOPWATCH_REFRESH_MS = 250;
    let agentStopwatchState = null;
    let agentStopwatchTimer = null;
    function agentSoundPositionInitializationIndicator() {}
    ${productionFunctionSource('assert')}
    ${productionFunctionSource('agentStopwatchFormatDuration')}
    ${productionFunctionSource('agentStopwatchExchangeId')}
    ${productionFunctionSource('ensureAgentStopwatchControl')}
    ${productionFunctionSource('agentStopwatchRender')}
    ${productionFunctionSource('agentStopwatchStartTimer')}
    ${productionFunctionSource('agentStopwatchStopTimer')}
    ${productionFunctionSource('agentStopwatchRecordLap')}
    ${productionFunctionSource('agentStopwatchObserveInputMessage')}
    ${productionFunctionSource('agentStopwatchRecoveryScan')}
    ${productionFunctionSource('agentStopwatchCollectRecovery')}
    ${productionFunctionSource('agentStopwatchApplyRecovery')}
    ${productionFunctionSource('agentStopwatchStreamIsActive')}
    this.api = {
      scan: agentStopwatchRecoveryScan,
      collect: agentStopwatchCollectRecovery,
      apply: agentStopwatchApplyRecovery,
      isStreaming: agentStopwatchStreamIsActive,
      input: agentStopwatchObserveInputMessage,
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

function simpleSpine(pagesNewestToOldest) {
  const seen = new Set();
  const messages = [];
  for (const currentPage of [...pagesNewestToOldest].reverse()) {
    for (const message of currentPage.messages ?? []) {
      if (!message?.id || seen.has(message.id)) continue;
      seen.add(message.id);
      messages.push(message);
    }
  }
  return { messages };
}

test('reload pagination does not mistake the oldest loaded follow-up for the starting prompt', async () => {
  const harness = restoreHarness();
  const exchange = 'exchange-A';
  const initial = page([
    user('follow-2', exchange, 170),
    assistant('work-2', exchange, 171, 171, false),
    user('follow-3', exchange, 230)
  ], { hasPrevious: true, startCursor: 'cursor-older-1' });
  const older1 = page([
    user('follow-1', exchange, 130),
    assistant('work-1', exchange, 131, 131, false)
  ], { hasPrevious: true, startCursor: 'cursor-older-2' });
  const older2 = page([
    user('previous-exchange-user', 'exchange-Z', 10),
    assistant('previous-exchange-final', 'exchange-Z', 11, 20),
    user('start', exchange, 100)
  ], { hasPrevious: true, startCursor: 'cursor-even-older' });

  const calls = [];
  const pagesByCursor = new Map([
    ['cursor-older-1', older1],
    ['cursor-older-2', older2]
  ]);
  const result = await harness.api.collect(initial, async cursor => {
    calls.push(cursor);
    const next = pagesByCursor.get(cursor);
    assert.ok(next, `Unexpected pagination cursor ${cursor}.`);
    return next;
  }, simpleSpine);

  assert.deepEqual(calls, ['cursor-older-1', 'cursor-older-2']);
  assert.equal(result.exchange_id, exchange);
  assert.deepEqual(
    Array.from(result.user_messages, message => message.id),
    ['start', 'follow-1', 'follow-2', 'follow-3']
  );
});

test('same-exchange User create_time values reconstruct completed lap boundaries exactly', () => {
  const harness = restoreHarness();
  const exchange = 'exchange-A';
  const recovery = harness.api.scan([
    user('previous', 'exchange-Z', 10),
    user('start', exchange, 100),
    assistant('work-1', exchange, 105, 105, false),
    user('follow-1', exchange, 160),
    user('follow-2', exchange, 205),
    assistant('final', exchange, 210, 250)
  ], false);

  assert.equal(recovery.ready, true);
  assert.equal(recovery.exchange_id, exchange);
  assert.deepEqual(
    Array.from(recovery.user_messages, message => message.create_time),
    [100, 160, 205]
  );
  assert.equal(recovery.final_message.id, 'final');
});

test('completed reload uses final create_time despite later update_time and restores structured success green', () => {
  const harness = restoreHarness();
  const exchange = 'exchange-A';
  const recovery = harness.api.scan([
    user('previous', 'exchange-Z', 10),
    user('start', exchange, 100),
    user('follow', exchange, 160),
    assistant('final', exchange, 170, 21600)
  ], false);

  harness.setNow(5000);
  harness.api.apply(recovery, false, 300000, 5000);

  const state = harness.api.state();
  assert.equal(state.active, false);
  assert.equal(state.exchange_id, exchange);
  assert.equal(state.terminal_kind, 'success');
  assert.deepEqual(Array.from(state.laps_ms), [60000, 10000]);
  assert.equal(state.total_ms, 70000);
  assert.equal(harness.api.text(), 'Lap 1: 1 m 0 s\nLap 2: 0 m 10 s\nTotal: 1 m 10 s');
  assert.equal(harness.element().style.background, SUCCESS_BACKGROUND);

  harness.setNow(65000);
  harness.tick();
  assert.equal(harness.api.text(), 'Lap 1: 1 m 0 s\nLap 2: 0 m 10 s\nTotal: 1 m 10 s');
  assert.equal(harness.element().style.background, SUCCESS_BACKGROUND);
});

test('IS_STREAMING restores the same history with active styling and continues current lap and Total', () => {
  const harness = restoreHarness();
  const exchange = 'exchange-A';
  const recovery = harness.api.scan([
    user('previous', 'exchange-Z', 10),
    user('start', exchange, 100),
    user('follow', exchange, 160)
  ], false);

  assert.equal(harness.api.isStreaming({ status: 'IS_STREAMING' }), true);
  assert.equal(harness.api.isStreaming({ status: 'NOT_STREAMING' }), false);
  assert.equal(harness.api.isStreaming({}), false);

  harness.setNow(5000);
  harness.api.apply(recovery, true, 190000, 5000);

  let state = harness.api.state();
  assert.equal(state.active, true);
  assert.equal(state.exchange_id, exchange);
  assert.equal(state.terminal_kind, null);
  assert.deepEqual(Array.from(state.laps_ms), [60000]);
  assert.equal(harness.api.text(), 'Lap 1: 1 m 0 s\nLap 2: 0 m 30 s\nTotal: 1 m 30 s');
  assert.equal(harness.element().style.background, ACTIVE_BACKGROUND);

  harness.setNow(15000);
  harness.tick();
  state = harness.api.state();
  assert.equal(state.active, true);
  assert.equal(state.terminal_kind, null);
  assert.equal(harness.api.text(), 'Lap 1: 1 m 0 s\nLap 2: 0 m 40 s\nTotal: 1 m 40 s');
  assert.equal(harness.element().style.background, ACTIVE_BACKGROUND);
});

test('resume repetition of an already recovered User message does not create another lap', () => {
  const harness = restoreHarness();
  const exchange = 'exchange-A';
  const recovery = harness.api.scan([
    user('previous', 'exchange-Z', 10),
    user('start', exchange, 100),
    user('follow', exchange, 160)
  ], false);

  harness.setNow(5000);
  harness.api.apply(recovery, true, 190000, 5000);
  const before = [...harness.api.state().laps_ms];

  harness.api.input(
    { stopwatch_exchange_id: exchange },
    user('follow', exchange, 160)
  );

  assert.deepEqual(Array.from(harness.api.state().laps_ms), before);
  assert.equal(harness.api.state().terminal_kind, null);
  assert.equal(harness.element().style.background, ACTIVE_BACKGROUND);
});

test('reload restoration is wired from a synchronously cloned stock conversation response', () => {
  assert.match(userscript, /@version\s+1\.5\.0/);
  const install = productionFunctionSource('installNetworkCapture');
  assert.match(install, /agentStopwatchIsInitialConversationUrl\(requestUrl\)/);
  assert.match(install, /cloneSafely\(response\)/);
  assert.match(install, /agentStopwatchObserveConversationResponse/);

  const observer = productionFunctionSource('agentStopwatchObserveConversationResponse');
  assert.match(observer, /agentStopwatchCollectRecovery/);
  assert.match(observer, /agentStopwatchFetchStreamStatus/);
  assert.match(observer, /agentStopwatchApplyRecovery/);
});
