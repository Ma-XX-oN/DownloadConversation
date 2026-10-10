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
    ${productionFunctionSource('agentFaviconRingObserveTime')}
    this.api = {
      step: agentFaviconRingStep,
      color: agentFaviconRingColor,
      draw: agentFaviconDrawRing,
      tick: agentFaviconRingObserveTime,
      restart(atMs) {
        agentStopwatchState = {
          active: true, started_at_ms: atMs, total_ms: null
        };
        agentFaviconRingRenderedStep = 0;
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
  assert.match(source, /agentFaviconDrawRing\(context, width, height, agentFaviconRingStep\(\)\)/);
  assert.match(source, /candidate\.link\.href = canvas\.toDataURL\('image\/png'\)/);
  assert.doesNotMatch(productionFunctionSource('agentFaviconRingObserveTime'),
    /setInterval|setTimeout|addEventListener/);
});
