import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function ringHarness() {
  const h = { requests: [] };
  vm.runInNewContext(`
    let agentFaviconRingRenderedStep = 0;
    let agentFaviconProcessingObserved = true;
    let agentStopwatchState = {
      active: true, started_at_ms: 1000, total_ms: null
    };
    function agentFaviconRenderState(state) { requests.push(state); }
    ${productionFunctionSource('agentFaviconRingStep')}
    ${productionFunctionSource('agentFaviconRingObserveTime')}
    this.api = {
      step: agentFaviconRingStep, tick: agentFaviconRingObserveTime,
      finish(duration) {
        agentStopwatchState.active = false;
        agentStopwatchState.total_ms = duration;
        agentFaviconProcessingObserved = false;
      },
      restart(at) {
        agentStopwatchState = {
          active: true, started_at_ms: at, total_ms: null
        };
        agentFaviconRingRenderedStep = 0;
        agentFaviconProcessingObserved = true;
      }
    };
  `, h);
  return h;
}

test('six five-minute ring/pie indexes preserve the 30-minute saturated step', () => {
  const h = ringHarness();
  for (let step = 0; step <= 6; step++) {
    assert.equal(h.api.step(1000 + step * 300000), step);
    if (step) h.api.tick(1000 + step * 300000);
  }
  assert.equal(h.api.step(1000 + 3600000), 6);
  assert.equal(h.api.step(1000 + 299999), 0);
  assert.equal(h.api.step(1000 + 300000), 1);
  assert.deepEqual(h.requests, Array(6).fill('processing'));
});

test('completed ring step freezes; a new prompt resets to zero', () => {
  const h = ringHarness();
  h.api.tick(1000 + 600000);
  assert.equal(h.requests.length, 1);
  h.api.finish(600000);
  assert.equal(h.api.step(1000 + 5000000), 2);
  h.api.tick(1000 + 5000000);
  assert.equal(h.requests.length, 1);
  h.api.restart(7000000);
  assert.equal(h.api.step(7000000), 0);
  h.api.tick(7300000);
  assert.equal(h.requests.length, 2);
});

test('reload redraws the recovered five-minute step rather than zero', async () => {
  const events = [];
  const context = {
    Date: { now: () => 960000 },
    performance: { now: () => 1000 },
    events
  };
  vm.runInNewContext(`
    let agentStopwatchState = null;
    const recovery = {
      ready: true, exchange_id: 'exchange-A', final_message: { id: 'final' }
    };
    function currentConversationId() { return 'conversation-A'; }
    async function agentStopwatchCollectRecovery() { return recovery; }
    function fetchOneConversationPage() { throw new Error('unexpected'); }
    function pageUrl() { throw new Error('unexpected'); }
    function conversationSpineFromPages() { return null; }
    async function agentStopwatchFetchStreamStatus() { return { status: 'IS_STREAMING' }; }
    function agentStopwatchStreamIsActive(p) { return p?.status === 'IS_STREAMING'; }
    function agentStopwatchApplyRecovery(r, active, wallNow, now) {
      agentStopwatchState = {
        active, started_at_ms: now - 600000, total_ms: null
      };
      events.push(['recovered', active]);
    }
    function agentFaviconObserveStreamStatus(status) {
      events.push(['favicon', status.status,
        Math.floor((performance.now() - agentStopwatchState.started_at_ms) / 300000)]);
    }
    function agentFaviconRenderState(state) { events.push(['render', state]); }
    ${productionFunctionSource('agentStopwatchObserveConversationResponse')}
    this.restore = agentStopwatchObserveConversationResponse;
  `, context);
  await context.restore({
    ok: true,
    async json() { return { conversation_id: 'conversation-A' }; }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    ['recovered', true],
    ['favicon', 'IS_STREAMING', 2]
  ]);
});

test('completed reload preserves the final elapsed step without restarting', async () => {
  const events = [];
  const context = {
    Date: { now: () => 960000 },
    performance: { now: () => 1000 },
    events
  };
  vm.runInNewContext(`
    let agentStopwatchState = null;
    const recovery = {
      ready: true, exchange_id: 'exchange-A', final_message: { id: 'final' }
    };
    function currentConversationId() { return 'conversation-A'; }
    async function agentStopwatchCollectRecovery() { return recovery; }
    function fetchOneConversationPage() { throw new Error('unexpected'); }
    function pageUrl() { throw new Error('unexpected'); }
    function conversationSpineFromPages() { return null; }
    async function agentStopwatchFetchStreamStatus() { return { status: 'NOT_STREAMING' }; }
    function agentStopwatchStreamIsActive(p) { return p?.status === 'IS_STREAMING'; }
    function agentStopwatchApplyRecovery(r, active, wallNow, now) {
      agentStopwatchState = { active, started_at_ms: now - 600000, total_ms: 600000 };
      events.push(['recovered', active]);
    }
    function agentFaviconObserveStreamStatus() { throw new Error('not streaming'); }
    function agentFaviconRenderState(state) {
      events.push(['render', state, Math.floor(agentStopwatchState.total_ms / 300000)]);
    }
    ${productionFunctionSource('agentStopwatchObserveConversationResponse')}
    this.restore = agentStopwatchObserveConversationResponse;
  `, context);
  await context.restore({
    ok: true,
    async json() { return { conversation_id: 'conversation-A' }; }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    ['recovered', false],
    ['render', 'completed', 2]
  ]);
});
