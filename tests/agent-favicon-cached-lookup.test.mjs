import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import {
  markedBlock, productionFunctionSource, downloadConversationSource
} from './helpers/userscript-source.mjs';

const source = markedBlock(
  '  /** A favicon pulse has forty 250-ms slots',
  "window.addEventListener('pagehide', agentFaviconDispose);"
);

function fixture(known = true, delayedRead = null, candidates = 1) {
  const links = Array.from({ length: candidates }, (_, i) => {
    let href = `https://chatgpt.com/favicon${i}.png`;
    return {
      rel: 'icon', media: i ? '(prefers-color-scheme: dark)' : '',
      type: 'image/png', sizes: { value: i ? '48x48' : '32x32' },
      writes: 0, get href() { return href; },
      set href(value) { this.writes++; href = value; }
    };
  });
  const reads = [], fetched = [], revoked = [], created = [], intervals = [];
  let clock = 0, closed = 0;
  const session = {
    version: '1.11.8', update_every_ms: 250,
    find_variant() { return known ? 'v' : null; },
    async read_png(...args) {
      reads.push(args);
      if (delayedRead) await delayedRead(...args);
      return new Blob(['png'], { type: 'image/png' });
    },
    async close() { closed++; }
  };
  const h = vm.createContext({
    document: { addEventListener() {}, querySelectorAll(s) {
      assert.equal(s, 'link[rel~="icon"]');
      return links;
    } },
    window: { addEventListener() {} },
    performance: { now: () => clock },
    Blob, crypto: webcrypto, Uint8Array,
    fetch: async url => {
      fetched.push(url);
      return { ok: true, type: 'basic',
        arrayBuffer: async () => new TextEncoder().encode(url).buffer };
    },
    URL: {
      createObjectURL() {
        const url = `blob:test/${created.length + 1}`;
        created.push(url);
        return url;
      },
      revokeObjectURL(url) { revoked.push(url); }
    },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {}, session, diagnostics: []
  });
  vm.runInContext(`
    const VERSION = '1.11.8';
    const agentFaviconOriginalSources = new Map();
    let agentFaviconRenderGeneration = 0;
    let agentStopwatchState = { active: true, started_at_ms: 0, total_ms: null };
    function logDiagnostic(level, name, details) {
      diagnostics.push({ level, name, details });
    }
    function errorMessage(e) { return String(e); }
    function get_compatible_version_key() { return Promise.resolve('1.11.8'); }
    function open_favicon_dataset() { return session; }
    ${source}
    this.api = { get: get_favicon, pulse: agentFaviconPulseIndex,
      render: agentFaviconRenderState, dispose: agentFaviconDispose };
  `, h);
  return { api: h.api, links, reads, fetched, revoked, created, intervals,
    setClock(n) { clock = n; }, closed: () => closed };
}

test('all forty time slots use exactly twenty-one symmetric pulse frames', () => {
  const h = fixture();
  for (let slot = 0; slot < 40; slot++) {
    assert.equal(h.api.pulse(slot * 250), Math.min(slot, 40 - slot));
  }
  assert.equal(h.api.pulse(10000), 0);
  assert.equal(h.api.pulse(-250), 1);
  assert.equal(h.api.pulse(NaN), null);
  assert.equal(h.api.pulse(Infinity), null);
});

test('all 588 state, step, and pulse combinations reach the B V1 provider', async () => {
  const h = fixture();
  const unique = new Set();
  for (let base = 0; base < 4; base++) {
    for (let step = 0; step <= 6; step++) {
      for (let slot = 0; slot < 40; slot++) {
        const selected = await h.api.get('1.11.8', base, step, slot * 250);
        assert.equal(selected.length, 1);
        unique.add(JSON.stringify([base, step, Math.min(slot, 40 - slot)]));
      }
    }
  }
  assert.equal(unique.size, 588);
  assert.equal(h.created.length, 588);
  assert.equal(h.fetched.length, 1);
  assert.equal(await h.api.get('1.11.8', 4, 0, 0), null);
  assert.equal(await h.api.get('1.11.8', 0, 7, 0), null);
  assert.equal(await h.api.get('1.11.8', 0, 0, Infinity), null);
});

test('all stock candidates keep link attributes, use URLs and skip redundant hrefs', async () => {
  const h = fixture(true, null, 2);
  assert.equal(await h.api.render('processing'), true);
  assert.ok(h.links.every(link => link.href.startsWith('blob:test/')));
  const writes = h.links.map(link => link.writes);
  assert.equal(await h.api.render('processing'), true);
  assert.deepEqual(h.links.map(link => link.writes), writes);
  assert.equal(h.links[1].media, '(prefers-color-scheme: dark)');
  assert.equal(h.links[1].sizes.value, '48x48');
  assert.ok(h.intervals.every(x => x.ms === 250));
  assert.equal(await h.api.render('original'), true);
  assert.deepEqual(h.links.map(link => link.href), [
    'https://chatgpt.com/favicon0.png', 'https://chatgpt.com/favicon1.png'
  ]);
});

test('unknown source digest preserves stock favicon unchanged', async () => {
  const h = fixture(false);
  assert.equal(await h.api.render('processing'), false);
  assert.equal(h.links[0].href, 'https://chatgpt.com/favicon0.png');
});

test('late yellow lookup cannot overwrite later red error', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = fixture(true, async (_variant, base) => {
    if (base === 0) await gate;
  });
  const pending = h.api.render('processing');
  while (!h.reads.some(args => args[1] === 0)) await Promise.resolve();
  assert.equal(await h.api.render('error'), true);
  const red = h.links[0].href;
  release();
  assert.equal(await pending, false);
  assert.equal(h.links[0].href, red);
});

test('page navigation disposes tab URLs and closes provider session', async () => {
  const h = fixture();
  assert.equal(await h.api.render('processing'), true);
  h.api.dispose();
  assert.equal(h.revoked.length, 1);
  assert.equal(h.closed(), 1);
});

test('renderer no longer performs per-heartbeat canvas or PNG encoding', () => {
  assert.match(productionFunctionSource('agentFaviconRenderState'), /get_favicon\(/);
  assert.match(productionFunctionSource('get_favicon'),
    /get_favicon\(compatible_version_key, base_type, completion_time, time_offset\)/);
  assert.doesNotMatch(downloadConversationSource,
    /canvas\.toDataURL\(['"]image\/png['"]\)|context\.(?:get|put)ImageData\(/);
});
