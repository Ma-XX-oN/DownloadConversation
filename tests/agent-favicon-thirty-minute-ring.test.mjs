import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function ringHarness() {
  const context = { requests: [], arcs: [] };
  vm.runInNewContext(`
    const AGENT_FAVICON_RING_STEP_MS = 300000;
    let agentFaviconRingRenderedStep = 0;
    let agentFaviconProcessingObserved = true;
    let agentStopwatchState = {
      active: true, started_at_ms: 1000, total_ms: null
    };
    function agentFaviconRenderState(state) { this.requests.push(state); }
    ${productionFunctionSource('agentFaviconRingStep')}
    ${productionFunctionSource('agentFaviconRingColor')}
    ${productionFunctionSource('agentFaviconDrawRing')}
    ${productionFunctionSource('agentFaviconDrawPieSlice')}
    ${productionFunctionSource('agentFaviconRingObserveTime')}
    this.api = {
      step: agentFaviconRingStep,
      color: agentFaviconRingColor,
      draw: agentFaviconDrawRing,
      drawPie: agentFaviconDrawPieSlice,
      tick: agentFaviconRingObserveTime,
      restart(atMs) {
        agentStopwatchState = {
          active: true, started_at_ms: atMs, total_ms: null
        };
        agentFaviconRingRenderedStep = 0;
        agentFaviconProcessingObserved = true;
      },
      finish(totalMs) {
        agentStopwatchState.active = false;
        agentStopwatchState.total_ms = totalMs;
        agentFaviconProcessingObserved = false;
      },
      idle() { agentFaviconProcessingObserved = false; }
    };
  `, context);
  return context;
}

test('six five-minute thresholds have exact clockwise arcs and green-to-red colours', () => {
  const h = ringHarness();
  const expected = ['#00cc00', '#55cc00', '#aacc00',
    '#ffcc00', '#ff7700', '#ff0000'];
  for (let minute = 0; minute <= 30; minute += 5) {
    const step = minute / 5;
    const now = 1000 + minute * 60000;
    assert.equal(h.api.step(now), step);
    const strokes = [];
    const ctx = {
      beginPath() {},
      arc(...args) { strokes.push({ arc: args }); },
      stroke() { strokes.push({ color: this.strokeStyle }); }
    };
    h.api.draw(ctx, 32, 32, step);
    if (!step) {
      assert.equal(strokes.length, 0);
    } else {
      assert.equal(strokes.length, 2);
      assert.equal(strokes[1].color, expected[step - 1]);
      assert.ok(Math.abs(
        (strokes[0].arc[4] - strokes[0].arc[3]) / (Math.PI * 2) - step / 6
      ) < 1e-9);
      assert.equal(h.api.color(step), expected[step - 1]);
    }
  }
  assert.equal(h.api.step(1000 + 40 * 60000), 6, 'cap at 30 minutes');
  assert.equal(h.api.step(1000 + 299999), 0);
  assert.equal(h.api.step(1000 + 300000), 1);
  assert.equal(h.api.step(1000 + 599999), 1);
});

test('one render per step, including no redundant redraws between boundaries', () => {
  const h = ringHarness();
  h.api.tick(1000);
  h.api.tick(1000 + 299999);
  assert.deepEqual(h.requests, []);
  for (let step = 1; step <= 6; step += 1) {
    h.api.tick(1000 + step * 300000);
    h.api.tick(1000 + step * 300000 + 2000);
  }
  assert.deepEqual(h.requests, Array(6).fill('processing'));
  h.api.tick(1000 + 3600000);
  assert.equal(h.requests.length, 6);
});

test('completion freezes ring and a later exchange restarts its clock', () => {
  const h = ringHarness();
  h.api.tick(1000 + 600000);
  assert.equal(h.requests.length, 1);
  h.api.finish(600000);
  assert.equal(h.api.step(1000 + 5000000), 2);
  h.api.tick(1000 + 5000000);
  assert.equal(h.requests.length, 1, 'completed favicon does not continue stepping');
  h.api.restart(7000000);
  h.api.tick(7000000);
  assert.equal(h.api.step(7000000), 0);
  h.api.tick(7300000);
  assert.equal(h.requests.length, 2);
});

test('ring only draws over favicon canvas, preserving the source image and initial transparency', () => {
  const source = productionFunctionSource('agentFaviconRenderCandidate');
  assert.match(source, /context\.drawImage\(image, 0, 0, width, height\)/);
  assert.match(source, /agentFaviconRecolorPixels\(pixels\.data, targetRgb\)/);
  assert.match(source, /agentFaviconDrawRing\(context, width, height, ringStep\)/);
  assert.match(source, /candidate\.link\.href = canvas\.toDataURL\('image\/png'\)/);
  assert.doesNotMatch(productionFunctionSource('agentFaviconRingObserveTime'),
    /setInterval|setTimeout|addEventListener/);
});

test('pie underlay has matching six sectors and never draws at zero', () => {
  const h = ringHarness();
  const colours = ['#00cc00', '#55cc00', '#aacc00',
    '#ffcc00', '#ff7700', '#ff0000'];
  for (let step = 0; step <= 6; step += 1) {
    const calls = [];
    const context = {
      beginPath() { calls.push(['begin']); },
      moveTo(...args) { calls.push(['move', ...args]); },
      arc(...args) { calls.push(['arc', ...args]); },
      closePath() { calls.push(['close']); },
      fill() { calls.push(['fill', this.fillStyle]); }
    };
    h.api.drawPie(context, 32, 32, step);
    if (step === 0) {
      assert.equal(calls.length, 0);
      continue;
    }
    assert.deepEqual(calls.map(c => c[0]),
      ['begin', 'move', 'arc', 'close', 'fill']);
    assert.equal(calls[4][1], colours[step - 1]);
    assert.ok(Math.abs(
      (calls[2][5] - calls[2][4]) / (Math.PI * 2) - step / 6
    ) < 1e-9);
  }
});

test('pie behind logo persists at completion and ring remains foreground', () => {
  const source = productionFunctionSource('agentFaviconRenderCandidate');
  assert.match(source, /state === 'processing' \|\| state === 'completed'/);
  assert.match(source, /context\.globalCompositeOperation = 'destination-over'/);
  assert.match(source, /finally\s*\{\s*context\.globalCompositeOperation = 'source-over'/);
  assert.ok(source.indexOf('agentFaviconDrawPieSlice(') <
    source.indexOf('agentFaviconDrawRing('));
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
  assert.deepEqual(events, [
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
  assert.deepEqual(events, [
    ['recovered', false],
    ['render', 'completed', 2]
  ]);
});
