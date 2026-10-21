import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { functionSourceFrom, productionFunctionSource } from './helpers/userscript-source.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const policy = read('src/userscript/03-agent-lifecycle/02-favicon-title-policy.js');
const consumer = read('src/userscript/03-agent-lifecycle/02-favicon-cached-lookup.js');
const theme = read('src/userscript/03-agent-lifecycle/02-favicon-theme.js');

function fixture(initial = 'DC #352 - ACTIVE') {
  let title = initial, titleNode = {}, hasSidebar = true;
  const nav = {}, events = new Map(), watchers = [], stops = [], renders = [];
  const head = { querySelector(q) {
    assert.equal(q, 'title');
    return titleNode;
  } };
  class Observer {
    constructor(callback) { this.callback = callback; watchers.push(this); }
    observe(target, options) {
      this.targets ??= [];
      this.targets.push(target); this.options = options; this.live = true;
    }
    disconnect() { this.live = false; this.targets = []; }
  }
  const ctx = vm.createContext({
    MutationObserver: Observer, Promise,
    document: {
      head,
      querySelector(q) {
        if (q === 'nav') return nav;
        assert.match(q, /data-interactive-row-link/);
        return hasSidebar ? { closest: () => nav } : null;
      },
      addEventListener(type, cb) { events.set('document:' + type, cb); }
    },
    window: {
      addEventListener(type, cb) { events.set(type, cb); },
      navigation: { addEventListener(type, cb) { events.set(type, cb); } }
    },
    conversationTitle: () => title,
    agentFaviconPageHidden: false,
    agentFaviconRenderGeneration: 10,
    agentFaviconPulseUpdatePending: { old: true },
    agentFaviconVisibleState: 'processing',
    agentFaviconStopPulse() { stops.push('stop'); },
    agentFaviconRenderState(state, heartbeat) {
      renders.push({ state, heartbeat }); return Promise.resolve(true);
    }
  });
  vm.runInContext(policy + '\nthis.api = {start:agentFaviconTitleMonitorStart,' +
    'cadence:agentFaviconHeartbeatCadence,offset:agentFaviconFrameTimeOffset};', ctx);
  return {
    ctx, head, nav, watchers, events, stops, renders, api: ctx.api,
    setTitle(value) { title = value; },
    setSidebar(value) { hasSidebar = value; },
    replaceTitle() { titleNode = {}; return titleNode; },
    notify(node) {
      const obs = watchers.find(w => w.live && w.targets.includes(node));
      assert.ok(obs, 'expected scoped observer');
      obs.callback([]);
    }
  };
}

test('last dash and ms dictionary select exact suffixes without prefix parsing', () => {
  const h = fixture();
  for (const [title, cadence] of [
    ['DC #352 - ACTIVE', 1000],
    ['unrelated - other - ACTIVE   ', 1000],
    ['- ACTIVE', 1000],
    ['RWF #109 - USER ACTION REQUIRED', 2000],
    ['anything - USER ACTION REQUIRED   ', 2000],
    ['', null], ['ACTIVE', null], ['DC #352 - active', null],
    ['DC #352 - ACTIVE extra', null], ['DC #352 - CLOSED', null],
    ['DC #352 - CONTINUED', null], ['DC #352 - UMBRELLA', null],
    ['DC #352 - BLOCKED by DC #333', null],
    ['DC #352 - user action required', null]
  ]) {
    h.setTitle(title);
    assert.equal(h.api.cadence(), cadence, title);
  }
  assert.match(policy, /title\.lastIndexOf\('-'\)/);
  assert.match(policy, /AGENT_FAVICON_TITLE_CADENCES\[suffix\]/);
  assert.match(policy, /'- ACTIVE': 1000/);
  assert.match(policy, /'- USER ACTION REQUIRED': 2000/);
});

test('one data structure allows additional exact suffixes without new scheduler code', () => {
  const h = fixture();
  vm.runInContext("AGENT_FAVICON_TITLE_CADENCES['- WAITING'] = 5000;", h.ctx);
  // Frozen mapping cannot be mutated: a future change is a source-level entry.
  assert.equal(h.api.cadence(), 1000);
  assert.match(policy, /Object\.freeze\(\{/);
});

test('one selector maps 1000/2000 ms intervals onto the same two cached frames', () => {
  const h = fixture('any - ACTIVE');
  assert.deepEqual([0,999,1000,1999,2000,3999].map(h.api.offset),
    [0,0,1000,1000,2000,3000]);
  h.setTitle('any - USER ACTION REQUIRED');
  assert.deepEqual([0,1999,2000,3999,4000,5999].map(h.api.offset),
    [0,0,1000,1000,2000,2000]);
  h.setTitle('any - CLOSED');
  assert.deepEqual([0,2000,9999].map(h.api.offset), [0,0,0]);
});

test('title observer changes cadence, invalidates pending work, and stays scoped', () => {
  const h = fixture('one - ACTIVE');
  h.api.start();
  assert.equal(h.stops.length, 1);
  assert.equal(h.renders.length, 1);
  assert.equal(h.ctx.agentFaviconRenderGeneration, 11);
  assert.equal(h.ctx.agentFaviconPulseUpdatePending, null);
  assert.equal(h.watchers.filter(w => w.live).length, 2);
  h.setTitle('one - USER ACTION REQUIRED');
  h.notify(h.head);
  assert.equal(h.stops.length, 2);
  h.setTitle('another - USER ACTION REQUIRED');
  h.notify(h.nav);
  assert.equal(h.stops.length, 2, 'no churn on same cadence');
  h.setTitle('another - CLOSED');
  h.notify(h.nav);
  assert.equal(h.stops.length, 3);
  h.setTitle('next - ACTIVE');
  h.notify(h.head);
  assert.equal(h.stops.length, 4);
  assert.equal(h.ctx.agentFaviconRenderGeneration, 14);
  assert.deepEqual(h.renders.at(-1), { state: 'processing', heartbeat: true });
});

test('SPA navigation, title replacement, BFCache restore and observer cleanup', () => {
  const h = fixture();
  h.api.start();
  assert.ok(h.events.has('popstate'));
  assert.ok(h.events.has('navigatesuccess'));
  assert.ok(h.events.has('pageshow'));
  h.setTitle('another - CLOSED');
  h.events.get('popstate')();
  assert.equal(h.api.cadence(), null);
  const replaced = h.replaceTitle();
  h.notify(h.head);
  assert.ok(h.watchers.some(w => w.live && w.targets.includes(replaced)));
  h.ctx.agentFaviconPageHidden = true;
  h.events.get('pagehide')();
  assert.equal(h.watchers.filter(w => w.live).length, 0);
  h.ctx.agentFaviconPageHidden = false;
  h.setTitle('after restore - USER ACTION REQUIRED');
  h.events.get('pageshow')();
  assert.equal(h.api.cadence(), 2000);
  assert.equal(h.watchers.filter(w => w.live).length, 2);
});

test('startPulse has one timer using dictionary cadence, guarded after async open', async () => {
  let release;
  const ready = new Promise(r => { release = r; });
  const intervals = [];
  const ctx = vm.createContext({
    Promise, cadence: null, opens: 0,
    agentFaviconPageHidden: false,
    agentFaviconPulseTimer: null,
    agentFaviconVisibleState: 'processing',
    agentFaviconHeartbeatCadence() { return ctx.cadence; },
    agentFaviconCompatibleVersion: async () => '2.0.0',
    agentFaviconOpenSession: async () => { ctx.opens++; return ready; },
    agentFaviconPulseHeartbeat() {},
    setInterval(callback, ms) { intervals.push(ms); return intervals.length; }
  });
  vm.runInContext(functionSourceFrom(consumer, 'agentFaviconStartPulse') +
    '\nthis.start = agentFaviconStartPulse;', ctx);
  await ctx.start();
  assert.equal(ctx.opens, 0);
  ctx.cadence = 1000;
  const pending = ctx.start();
  await Promise.resolve();
  await Promise.resolve();
  ctx.cadence = 2000;
  release({ update_every_ms: 1000 });
  await pending;
  assert.deepEqual(intervals, [], 'old cadence must never start late');
  await ctx.start();
  assert.deepEqual(intervals, [2000]);
});

test('unmatched titles cannot run old timer callbacks', () => {
  let cadence = null, calls = 0;
  const ctx = vm.createContext({
    agentFaviconVisibleState: 'processing',
    agentFaviconPulseUpdatePending: null,
    agentFaviconHeartbeatCadence: () => cadence,
    agentFaviconCurrentCandidates: () => [],
    agentFaviconActiveCandidates: () => [],
    agentFaviconRingStep: () => 0,
    agentFaviconCurrentTheme: () => 'light',
    agentFaviconRenderState: async () => { calls++; }
  });
  vm.runInContext(productionFunctionSource('agentFaviconPulseHeartbeat') +
    '\nthis.tick=agentFaviconPulseHeartbeat;', ctx);
  ctx.tick(); assert.equal(calls, 0);
  cadence = 2000;
  ctx.tick(); assert.equal(calls, 1);
});

test('lifecycle still renders a static opaque frame for unmatched titles', async () => {
  let cadence = null;
  const offsets = [], icon = { href: 'stock' };
  const ctx = vm.createContext({
    Promise, performance: { now: () => 2500 },
    agentFaviconPageHidden: false,
    agentFaviconVisibleState: 'original',
    agentFaviconRenderGeneration: 0,
    agentFaviconPresentedStep: null,
    agentFaviconDisplayedHrefs: new Map(),
    agentFaviconFrameTimeOffset: n => cadence === null ? 0 : Math.floor(n/cadence)*1000,
    agentFaviconRingStep: () => 0,
    agentFaviconRestoreStockCandidates() {},
    agentFaviconStopPulse() {},
    agentFaviconStartPulse: async () => {},
    agentFaviconCurrentCandidates: () => [{ link: icon, original_href: 'stock' }],
    agentFaviconCurrentTheme: () => 'light',
    agentFaviconCompatibleVersion: async () => '2.0.0',
    get_favicon: async (version, colour, step, offset) => {
      offsets.push(offset); return [{ link: icon, href: 'blob:one' }];
    },
    agentFaviconTrimObjectUrls() {},
    agentFaviconActiveCandidates: a => a,
    logDiagnostic() {}
  });
  vm.runInContext(functionSourceFrom(consumer, 'agentFaviconRenderState') +
    '\nthis.render = agentFaviconRenderState;', ctx);
  assert.equal(await ctx.render('processing'), true);
  cadence = 2000;
  assert.equal(await ctx.render('processing'), true);
  assert.deepEqual(offsets, [0, 1000]);
});

test('single policy module, unchanged cache and animation version', () => {
  const manifest = JSON.parse(read('src/userscript-manifest.json'));
  const list = manifest.modules.find(x => x.name === 'agent-lifecycle').files;
  const n = list.indexOf('src/userscript/03-agent-lifecycle/02-favicon-cached-lookup.js');
  assert.equal(list[n + 1], 'src/userscript/03-agent-lifecycle/02-favicon-title-policy.js');
  assert.match(read('src/userscript/07-panel-launcher/05-bootstrap-part2.js'),
    /agentFaviconTitleMonitorStart\(\)/);
  assert.match(consumer, /agentFaviconFrameTimeOffset\(performance\.now\(\)\)/);
  assert.doesNotMatch(policy, /setInterval|setTimeout/);
  assert.match(read('src/userscript/03-agent-lifecycle/02-favicon-v2-adapter.js'),
    /FAVICON_ANIMATION_VERSION = '2\.0\.0'/);
});
