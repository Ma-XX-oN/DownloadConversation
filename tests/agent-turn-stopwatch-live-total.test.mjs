import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function renderHarness(state, nowMs) {
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
    performance: { now: () => nowMs }
  };
  vm.runInNewContext(`
    const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';
    let agentStopwatchState = ${JSON.stringify(state)};
    ${productionFunctionSource('assert')}
    ${productionFunctionSource('agentStopwatchFormatDuration')}
    ${productionFunctionSource('ensureAgentStopwatchControl')}
    ${productionFunctionSource('agentStopwatchRender')}
    agentStopwatchRender();
    this.text = document.getElementById(AGENT_STOPWATCH_ID)?.textContent ?? '';
  `, context);
  return context.text;
}

test('active stopwatch always displays a live Total line', () => {
  const text = renderHarness({
    active: true,
    started_at_ms: 1000,
    lap_started_at_ms: 1000,
    laps_ms: [],
    total_ms: null,
    exchange_id: 'exchange-A',
    pending_submission_at_ms: null,
    pending_message_id: null
  }, 66000);

  assert.equal(text, 'Lap 1: 1 m 5 s\nTotal: 1 m 5 s');
});

test('live Total spans all laps while the current lap keeps its own duration', () => {
  const text = renderHarness({
    active: true,
    started_at_ms: 1000,
    lap_started_at_ms: 71000,
    laps_ms: [70000],
    total_ms: null,
    exchange_id: 'exchange-A',
    pending_submission_at_ms: null,
    pending_message_id: null
  }, 76000);

  assert.equal(text, 'Lap 1: 1 m 10 s\nLap 2: 0 m 5 s\nTotal: 1 m 15 s');
});

test('completed stopwatch keeps the frozen Total value', () => {
  const text = renderHarness({
    active: false,
    started_at_ms: 1000,
    lap_started_at_ms: 71000,
    laps_ms: [70000, 30000],
    total_ms: 100000,
    exchange_id: 'exchange-A',
    pending_submission_at_ms: null,
    pending_message_id: null
  }, 200000);

  assert.equal(text, 'Lap 1: 1 m 10 s\nLap 2: 0 m 30 s\nTotal: 1 m 40 s');
});
