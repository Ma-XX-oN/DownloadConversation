import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

test('ten-second sine heartbeat samples with a two-second period', () => {
  const h = { performance: { now: () => 0 } };
  vm.runInNewContext(`
    const AGENT_FAVICON_PULSE_PERIOD_MS = 10000;
    ${productionFunctionSource('agentFaviconPulseOpacity')}
    this.sample = agentFaviconPulseOpacity;
  `, h);
  assert.equal(h.sample(0), 1);
  assert.ok(Math.abs(h.sample(2000) - 0.6545084971874737) < 1e-12);
  assert.ok(Math.abs(h.sample(4000) - 0.09549150281252627) < 1e-12);
  assert.equal(h.sample(5000), 0);
  assert.equal(h.sample(10000), 1);
});

test('opacity multiplies every existing alpha channel without changing RGB', () => {
  const h = { assert };
  vm.runInNewContext(`
    ${productionFunctionSource('agentFaviconApplyOpacity')}
    this.apply = agentFaviconApplyOpacity;
  `, h);
  const pixels = new Uint8ClampedArray([25, 60, 75, 255, 15, 40, 100, 100]);
  h.apply(pixels, 0.5);
  assert.deepEqual([...pixels], [25, 60, 75, 128, 15, 40, 100, 50]);
});

test('completion becomes white only on visible focused tab', async () => {
  let focused = false;
  let visible = 'hidden';
  const h = {
    document: { get visibilityState() { return visible; }, hasFocus: () => focused },
    rendered: []
  };
  vm.runInNewContext(`
    let agentFaviconVisibleState = 'completed';
    function agentFaviconRenderState(state) { this.rendered.push(state); }
    ${productionFunctionSource('agentFaviconAcknowledgeCompletion')}
    this.acknowledge = agentFaviconAcknowledgeCompletion;
    this.state = () => agentFaviconVisibleState;
  `, h);
  h.acknowledge();
  assert.deepEqual(h.rendered, []);
  visible = 'visible';
  h.acknowledge();
  assert.deepEqual(h.rendered, []);
  focused = true;
  h.acknowledge();
  assert.deepEqual(h.rendered, ['acknowledged']);
});

test('pulse interval samples every 2000ms and stops on cleanup', () => {
  const callbacks = [];
  const intervals = [];
  const h = {
    setInterval(fn, ms) { intervals.push(ms); callbacks.push(fn); return 7; },
    clearInterval(id) { assert.equal(id, 7); },
    rendered: []
  };
  vm.runInNewContext(`
    const AGENT_FAVICON_PULSE_INTERVAL_MS = 2000;
    let agentFaviconPulseTimer = null;
    let agentFaviconVisibleState = 'completed';
    function agentFaviconRenderState(state, heartbeat) {
      this.rendered.push([state, heartbeat]);
    }
    ${productionFunctionSource('agentFaviconStartPulse')}
    ${productionFunctionSource('agentFaviconStopPulse')}
    this.start = agentFaviconStartPulse;
    this.stop = agentFaviconStopPulse;
  `, h);
  h.start();
  h.start();
  assert.deepEqual(intervals, [2000]);
  callbacks[0]();
  assert.deepEqual(JSON.parse(JSON.stringify(h.rendered)), [['completed', true]]);
  h.stop();
  h.start();
  assert.deepEqual(intervals, [2000, 2000]);
});
