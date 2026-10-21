import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

test('completion becomes white only on visible focused tab', () => {
  let focused = false, visible = 'hidden';
  const h = {
    document: { addEventListener() {}, get visibilityState() { return visible; }, hasFocus: () => focused },
    rendered: []
  };
  vm.runInNewContext(`
    let agentFaviconVisibleState = 'completed';
    function agentFaviconRenderState(state) { rendered.push(state); }
    ${productionFunctionSource('agentFaviconAcknowledgeCompletion')}
    this.acknowledge = agentFaviconAcknowledgeCompletion;
  `, h);
  h.acknowledge();
  visible = 'visible'; h.acknowledge();
  assert.deepEqual(h.rendered, []);
  focused = true; h.acknowledge();
  assert.deepEqual(h.rendered, ['acknowledged']);
});

test('pulse schedules at title cadence only after session is ready', async () => {
  const intervals = [];
  const h = {
    setInterval(fn, ms) { intervals.push({ fn, ms }); return 7; },
    clearInterval(id) { assert.equal(id, 7); },
    renders: []
  };
  vm.runInNewContext(`
    let agentFaviconPulseTimer = null;
    let agentFaviconVisibleState = 'completed';
    let agentFaviconPageHidden = false;
    let agentFaviconPulseUpdatePending = null;
    function agentFaviconHeartbeatCadence() { return 1000; }
    async function agentFaviconCompatibleVersion() { return '1.11.8'; }
    async function agentFaviconOpenSession() {
      return { version: '1.11.8', update_every_ms: 400 };
    }
    async function agentFaviconRenderState(state, heartbeat) {
      renders.push([state, heartbeat]);
    }
    function agentFaviconCurrentCandidates() {
      return [{ original_href: 'https://chatgpt.com/favicon.svg', media: '' }];
    }
    function agentFaviconActiveCandidates(candidates) { return candidates; }
    function agentFaviconCurrentTheme() { return 'light'; }
    function agentFaviconRingStep() { return 0; }
    ${productionFunctionSource('agentFaviconPulseHeartbeat')}
    ${productionFunctionSource('agentFaviconStartPulse')}
    ${productionFunctionSource('agentFaviconStopPulse')}
    this.start = agentFaviconStartPulse;
    this.stop = agentFaviconStopPulse;
  `, h);
  await h.start();
  await h.start();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 1000);
  intervals[0].fn();
  assert.deepEqual(JSON.parse(JSON.stringify(h.renders)), [['completed', true]]);
  h.stop();
  await h.start();
  assert.equal(intervals.length, 2);
});
