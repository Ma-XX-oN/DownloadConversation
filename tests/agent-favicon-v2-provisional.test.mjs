import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  markedBlock, productionFunctionSource
} from './helpers/userscript-source.mjs';

const consumer = markedBlock(
  '  /** A favicon pulse has forty 250-ms slots',
  "window.addEventListener('pagehide', agentFaviconDispose);"
);

function fixture({
  theme = 'light', candidates = 1, delayedRead = null, version = '1.11.8'
} = {}) {
  let now = 0, closed = 0, serial = 0;
  const reads = [], requested = [], revoked = [], created = [];
  const sequences = new Map(), listeners = new Map(), intervals = [];
  const links = Array.from({ length: candidates }, (_, i) => {
    let href = `https://chatgpt.com/favicon${i}.svg`;
    return {
      media: i ? '(prefers-color-scheme: dark)' : '',
      type: 'image/svg+xml', sizes: { value: i ? '48x48' : '32x32' },
      writes: 0, get href() { return href; },
      set href(value) { this.writes++; href = value; }
    };
  });
  const match = {
    matches: theme === 'dark',
    addEventListener(type, fn) { listeners.set(type, fn); }
  };
  const keyFor = (url, scheme, base, step) =>
    JSON.stringify([version, url, scheme, base, step]);
  const provider = {
    version, update_every_ms: 250,
    async read_png(url, scheme, base, step, frame) {
      reads.push([url, scheme, base, step, frame]);
      if (delayedRead) await delayedRead(url, scheme, base, step, frame);
      const key = keyFor(url, scheme, base, step);
      if (!sequences.has(key)) {
        if (!requested.includes(key)) requested.push(key);
        return null;
      }
      const frames = sequences.get(key);
      return frames[frame] ?? null;
    },
    async close() { closed++; }
  };
  const context = vm.createContext({
    document: { visibilityState: 'visible', hasFocus() { return true; },
      querySelectorAll() { return links; }, addEventListener() {} },
    window: { matchMedia(query) {
      assert.equal(query, '(prefers-color-scheme: dark)');
      return match;
    }, addEventListener(type, fn) { listeners.set(type, fn); } },
    performance: { now: () => now },
    Blob, URL: {
      createObjectURL(blob) {
        assert.equal(blob.type, 'image/png');
        const url = `blob:provisional/${++serial}`;
        created.push(url);
        return url;
      },
      revokeObjectURL(url) { revoked.push(url); }
    },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {}, provider, diagnostics: []
  });
  vm.runInContext(`
    const VERSION = ${JSON.stringify(version)};
    const agentFaviconOriginalSources = new Map();
    let agentFaviconRenderGeneration = 0;
    let agentFaviconPulseUpdatePending = false;
    let agentStopwatchState = {
      active: true, started_at_ms: 0, total_ms: null
    };
    function logDiagnostic(level, name, details) {
      diagnostics.push({ level, name, details });
    }
    function errorMessage(e) { return String(e); }
    function get_compatible_version_key() {
      return Promise.resolve(${JSON.stringify(version)});
    }
    async function open_favicon_dataset() { return provider; }
    ${productionFunctionSource('agentFaviconCurrentTheme')}
    ${productionFunctionSource('agentFaviconHandleThemeChange')}
    ${productionFunctionSource('agentFaviconActiveCandidates')}
    ${productionFunctionSource('agentFaviconPulseHeartbeat')}
    ${productionFunctionSource('agentFaviconRestoreStockCandidates')}
    ${consumer}
    this.api = {
      get: get_favicon, render: agentFaviconRenderState,
      dispose: agentFaviconDispose, pulse: agentFaviconPulseIndex
    };
  `, context);
  return {
    api: context.api, links, reads, requested, intervals, revoked, created,
    publish(url, scheme, base, step) {
      const frames = Array.from({ length: 21 }, (_, i) =>
        new Blob([`frame-${i}`], { type: 'image/png' }));
      sequences.set(keyFor(url, scheme, base, step), frames);
    },
    setTime(ms) { now = ms; },
    changeTheme(scheme) {
      match.matches = scheme === 'dark';
      listeners.get('change')?.({ matches: match.matches });
    },
    closed: () => closed
  };
}

test('V2 RED: one cold miss requests only one complete 21-frame sequence', async () => {
  const h = fixture();
  const url = 'https://chatgpt.com/favicon0.svg';
  assert.equal(await h.api.render('processing'), false);
  assert.equal(h.links[0].href, url, 'missing sequence retains untouched original');
  assert.equal(h.requested.length, 1);
  assert.deepEqual(JSON.parse(h.requested[0]), ['1.11.8', url, 'light', 0, 0]);
  h.publish(url, 'light', 0, 0);
  assert.equal(await h.api.render('processing', true), true);
  const displayed = [];
  for (let slot = 0; slot < 40; slot++) {
    h.setTime(slot * 250);
    const result = await h.api.get('1.11.8', 0, 0, slot * 250);
    assert.equal(result.length, 1);
    displayed.push(result[0].href);
  }
  assert.equal(new Set(displayed).size, 21);
  for (let slot = 21; slot < 40; slot++) {
    assert.equal(displayed[slot], displayed[40 - slot]);
  }
  assert.equal(h.requested.length, 1, 'no unrelated version/theme/colour/step');
});

test('V2 RED: same SVG URL has distinct light and dark cache sequences', async () => {
  const h = fixture();
  const url = 'https://chatgpt.com/favicon0.svg';
  h.publish(url, 'light', 0, 0);
  assert.equal(await h.api.render('processing'), true);
  const light = h.links[0].href;
  h.changeTheme('dark');
  assert.equal(h.links[0].href, url,
    'theme flip immediately restores original while dark sequence generates');
  assert.equal(await h.api.render('processing'), false);
  assert.deepEqual(JSON.parse(h.requested[0]), ['1.11.8', url, 'dark', 0, 0]);
  h.publish(url, 'dark', 0, 0);
  assert.equal(await h.api.render('processing', true), true);
  assert.notEqual(h.links[0].href, light);
});

test('V2 RED: cold tuples never leak one colour or progress into another', async () => {
  const h = fixture();
  const url = 'https://chatgpt.com/favicon0.svg';
  h.publish(url, 'light', 0, 0);
  assert.equal(await h.api.render('processing'), true);
  assert.equal(await h.api.render('error'), false);
  assert.equal(h.links[0].href, url);
  assert.deepEqual(JSON.parse(h.requested[0]), ['1.11.8', url, 'light', 2, 0]);
  assert.equal(h.requested.length, 1);
});

test('V2 RED: late reply for old theme/colour cannot overwrite red', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const h = fixture({ delayedRead: async (_u, scheme, base) => {
    if (scheme === 'light' && base === 0) {
      entered();
      await gate;
    }
  } });
  const url = 'https://chatgpt.com/favicon0.svg';
  h.publish(url, 'light', 0, 0);
  h.publish(url, 'dark', 2, 0);
  const old = h.api.render('processing');
  await started;
  h.changeTheme('dark');
  assert.equal(await h.api.render('error'), true);
  const red = h.links[0].href;
  release();
  assert.equal(await old, false);
  assert.equal(h.links[0].href, red);
});

test('V2 RED: warm reads never fetch or decode source in consumer', async () => {
  const s = productionFunctionSource('get_favicon');
  assert.doesNotMatch(s, /SourceDigest|find_variant|fetch\(|createElement\(['"]canvas/);
  assert.match(productionFunctionSource('agentFaviconFrameUrl'), /read_png\(/);
});

test('V2 RED: inactive media candidates do not request another source', async () => {
  const h = fixture({ candidates: 2 });
  assert.equal(await h.api.render('processing'), false);
  assert.equal(h.requested.length, 1);
  assert.equal(JSON.parse(h.requested[0])[1],
    'https://chatgpt.com/favicon0.svg');
  assert.equal(h.links[1].href, 'https://chatgpt.com/favicon1.svg');
});

test('V2 RED: cold next progress step immediately displays stock favicon', async () => {
  const h = fixture();
  const original = 'https://chatgpt.com/favicon0.svg';
  h.publish(original, 'light', 0, 0);
  assert.equal(await h.api.render('processing'), true);
  assert.match(h.links[0].href, /^blob:/);
  h.setTime(300000);
  const cold = h.api.render('processing');
  assert.equal(h.links[0].href, original,
    'do not display the outdated pie while the next sequence is generating');
  assert.equal(await cold, false);
  assert.deepEqual(JSON.parse(h.requested[0]),
    ['1.11.8', original, 'light', 0, 1]);
  h.publish(original, 'light', 0, 1);
  assert.equal(await h.api.render('processing', true), true);
  assert.match(h.links[0].href, /^blob:/);
});

test('V2 RED: async provider generation coalesces 250ms pulse refreshes', async () => {
  let enteredRead, releaseGeneration;
  const entered = new Promise(resolve => { enteredRead = resolve; });
  const release = new Promise(resolve => { releaseGeneration = resolve; });
  const h = fixture({ delayedRead: async () => {
    enteredRead();
    await release;
  } });
  const url = 'https://chatgpt.com/favicon0.svg';
  h.publish(url, 'light', 0, 0);
  const initial = h.api.render('processing');
  await entered;
  assert.equal(h.intervals.length, 1, 'provider cadence registered');
  const tick = h.intervals[0].fn;
  tick();
  // Allow the first heartbeat to enter its pending async provider read.
  await new Promise(resolve => setImmediate(resolve));
  const inFlight = h.reads.length;
  assert.equal(inFlight, 2, 'initial render and one heartbeat only');
  for (let n = 0; n < 6; n++) {
    tick();
    await Promise.resolve();
  }
  assert.equal(h.reads.length, inFlight,
    'repeated ticks cannot perpetually supersede a slow valid result');
  releaseGeneration();
  await initial;
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.links[0].href, /^blob:/,
    'latest waiting render eventually presents fully ready sequence');
});
