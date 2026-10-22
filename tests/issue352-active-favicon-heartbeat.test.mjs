import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { functionSourceFrom, productionFunctionSource } from './helpers/userscript-source.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const policy = read('src/userscript/03-agent-lifecycle/02-favicon-title-policy.js');
const consumer = read('src/userscript/03-agent-lifecycle/02-favicon-cached-lookup.js');
const identity = name => ({
  subject: 'subject-identification',
  revision: 1, readiness: 'unresolved',
  project: { status: 'unresolved', id: null, name: null },
  conversation: { status: 'unresolved', id: null, name }
});

function fixture(initial = 'DC #352 - ACTIVE') {
  let callback = null, subscribed = 0, unsubscribed = 0;
  const stops = [], renders = [], events = new Map();
  const ctx = vm.createContext({
    agentFaviconPageHidden: false,
    agentFaviconRenderGeneration: 10,
    agentFaviconPulseUpdatePending: { old: true },
    agentFaviconVisibleState: 'processing',
    interm_agent: {
      observeState(fn, subject) {
        assert.equal(subject, 'subject-identification');
        assert.equal(callback, null);
        callback = fn;
        subscribed++;
        fn(identity(initial));
        return () => { callback = null; unsubscribed++; };
      }
    },
    window: { addEventListener(type, fn) { events.set(type, fn); } },
    agentFaviconStopPulse() { stops.push('stop'); },
    agentFaviconRenderState(state, heartbeat) {
      renders.push({ state, heartbeat }); return Promise.resolve(true);
    }
  });
  vm.runInContext(policy + '\nthis.api = {' +
    'start:agentFaviconTitleMonitorStart,pause:agentFaviconTitlePause,' +
    'cadence:agentFaviconHeartbeatCadence,' +
    'offset:agentFaviconFrameTimeOffset};', ctx);
  return {
    api: ctx.api, ctx, stops, renders, events,
    notify(name) { assert.ok(callback); callback(identity(name)); },
    stats() { return { subscribed, unsubscribed }; }
  };
}

test('suffix dictionary reads only identity callback, not the DOM', () => {
  const h = fixture();
  h.api.start();
  for (const [name, cadence] of [
    ['DC #352 - ACTIVE', 1000],
    ['x - y - ACTIVE  ', 1000],
    ['DC #352 - USER ACTION REQUIRED ', 2000],
    ['DC #352 - BLOCKED by RWF #109', null],
    ['DC #352 - CLOSED', null],
    ['DC #352 - active', null],
    ['DC #352 - ACTIVE extra', null],
    [null, null]
  ]) {
    h.notify(name);
    assert.equal(h.api.cadence(), cadence, String(name));
  }
  assert.match(policy, /title\.lastIndexOf\('-'\)/);
  assert.match(policy, /AGENT_FAVICON_TITLE_CADENCES\[suffix\]/);
  assert.doesNotMatch(policy, /conversationTitle\(\)|document\.title|querySelector/);
});

test('title rename stops old timer and invalidates stale frame', () => {
  const h = fixture();
  h.api.start();
  assert.equal(h.api.cadence(), 1000);
  assert.equal(h.stops.length, 1);
  h.notify('RWF #701 - BLOCKED by RWF #109');
  assert.equal(h.api.cadence(), null);
  assert.equal(h.stops.length, 2);
  assert.equal(h.ctx.agentFaviconPulseUpdatePending, null);
  assert.equal(h.ctx.agentFaviconRenderGeneration, 12);
  h.notify('RWF #701 - BLOCKED by RWF #109');
  assert.equal(h.stops.length, 2);
  h.notify('RWF #701 - USER ACTION REQUIRED');
  assert.equal(h.api.cadence(), 2000);
  assert.equal(h.stops.length, 3);
});

test('one observer subscribes once and unsubscribes on pagehide', () => {
  const h = fixture();
  h.api.start();
  h.api.start();
  assert.equal(h.stats().subscribed, 1);
  h.events.get('pagehide')();
  assert.equal(h.stats().unsubscribed, 1);
  assert.equal(h.api.cadence(), null);
  h.events.get('pageshow')();
  assert.equal(h.stats().subscribed, 2);
  assert.equal(h.api.cadence(), 1000);
});

test('one selector supports 1000/2000 ms intervals with same frames', () => {
  const h = fixture();
  h.api.start();
  assert.deepEqual([0,999,1000,1999,2000,3999].map(h.api.offset),
    [0,0,1000,1000,2000,3000]);
  h.notify('x - USER ACTION REQUIRED');
  assert.deepEqual([0,1999,2000,3999,4000,5999].map(h.api.offset),
    [0,0,1000,1000,2000,2000]);
  h.notify('x - DONE');
  assert.deepEqual([0,2000,9999].map(h.api.offset), [0,0,0]);
});

test('startPulse does not start stale async reads or unmatched titles', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const intervals = [];
  const ctx = vm.createContext({
    Promise, cadence: null, agentFaviconPageHidden: false,
    agentFaviconPulseTimer: null, agentFaviconVisibleState: 'processing',
    agentFaviconHeartbeatCadence() { return ctx.cadence; },
    agentFaviconCompatibleVersion: async () => '2.0.0',
    agentFaviconOpenSession: async () => ready,
    agentFaviconPulseHeartbeat() {},
    setInterval(fn, ms) { intervals.push(ms); return intervals.length; }
  });
  vm.runInContext(functionSourceFrom(consumer, 'agentFaviconStartPulse') +
    '\nthis.start=agentFaviconStartPulse;', ctx);
  await ctx.start();
  ctx.cadence = 1000;
  const first = ctx.start();
  ctx.cadence = 2000;
  release({ version: '2.0.0' });
  await first;
  assert.deepEqual(intervals, []);
  await ctx.start();
  assert.deepEqual(intervals, [2000]);
});

test('unmatched titles suppress stale heartbeat timer callbacks', () => {
  let cadence = null, count = 0;
  const ctx = vm.createContext({
    agentFaviconVisibleState: 'processing',
    agentFaviconPulseUpdatePending: null,
    agentFaviconHeartbeatCadence: () => cadence,
    agentFaviconCurrentCandidates: () => [],
    agentFaviconActiveCandidates: () => [],
    agentFaviconRingStep: () => 0,
    agentFaviconCurrentTheme: () => 'light',
    agentFaviconRenderState: async () => { count++; }
  });
  vm.runInContext(productionFunctionSource('agentFaviconPulseHeartbeat') +
    '\nthis.tick=agentFaviconPulseHeartbeat;', ctx);
  ctx.tick(); assert.equal(count, 0);
  cadence = 1000;
  ctx.tick(); assert.equal(count, 1);
});

test('shim precedes policy without changing renderer or cache version', () => {
  const manifest = JSON.parse(read('src/userscript-manifest.json'));
  const list = manifest.modules.find(x => x.name === 'agent-lifecycle').files;
  const n = list.indexOf('src/userscript/03-agent-lifecycle/02-favicon-cached-lookup.js');
  assert.equal(list[n + 1], 'src/userscript/03-agent-lifecycle/02-interm-subject-agent.js');
  assert.equal(list[n + 2], 'src/userscript/03-agent-lifecycle/02-favicon-title-policy.js');
  assert.match(read('src/userscript/07-panel-launcher/05-bootstrap-part2.js'),
    /agentFaviconTitleMonitorStart\(\)/);
  assert.match(consumer, /agentFaviconFrameTimeOffset\(performance\.now\(\)\)/);
  assert.match(read('src/userscript/03-agent-lifecycle/02-favicon-v2-adapter.js'),
    /FAVICON_ANIMATION_VERSION = '2\.0\.0'/);
});

