import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  markedBlock, productionFunctionSource, downloadConversationSource
} from './helpers/userscript-source.mjs';

const source = markedBlock(
  '  /** A favicon pulse has forty 250-ms slots',
  "window.addEventListener('pagehide', agentFaviconDispose);"
);

function fixture(known = true, delayedRead = null, candidates = 1,
  version = '1.11.8', delayedOpen = null) {
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
    version, update_every_ms: 250,
    async read_png(...args) {
      reads.push(args);
      if (delayedRead) await delayedRead(...args);
      const matched = typeof known === 'function' ? known(args[0]) : known;
      return matched ? new Blob(['png'], { type: 'image/png' }) : null;
    },
    async close() { closed++; }
  };
  const h = vm.createContext({
    document: { addEventListener() {}, querySelectorAll(s) {
      assert.equal(s, 'link[rel~="icon"]');
      return links;
    } },
    window: {
      matchMedia() { return { matches: false, addEventListener() {} }; },
      addEventListener() {}
    },
    performance: { now: () => clock },
    Blob, Uint8Array,
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
    const VERSION = ${JSON.stringify(version)};
    const agentFaviconOriginalSources = new Map();
    let agentFaviconRenderGeneration = 0;
    let agentFaviconPulseUpdatePending = false;
    let agentStopwatchState = { active: true, started_at_ms: 0, total_ms: null };
    function logDiagnostic(level, name, details) {
      diagnostics.push({ level, name, details });
    }
    function errorMessage(e) { return String(e); }
    function get_compatible_version_key() {
      return Promise.resolve(${JSON.stringify(version)});
    }
    function open_favicon_dataset() {
      return typeof delayedOpen === 'function' ? delayedOpen() : delayedOpen || session;
    }
    ${productionFunctionSource('agentFaviconCurrentTheme')}
    ${productionFunctionSource('agentFaviconHandleThemeChange')}
    ${productionFunctionSource('agentFaviconActiveCandidates')}
    ${productionFunctionSource('agentFaviconPulseHeartbeat')}
    ${productionFunctionSource('agentFaviconRestoreStockCandidates')}
    ${source}
    this.api = { get: get_favicon, pulse: agentFaviconPulseIndex,
      render: agentFaviconRenderState, dispose: agentFaviconDispose };
  `, Object.assign(h, { delayedOpen }));
  return { api: h.api, links, reads, fetched, revoked, created, intervals, session,
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

test('all 588 state, step, and pulse combinations select a ready V2 frame', async () => {
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
  assert.equal(h.fetched.length, 0, 'consumer does not fetch original source');
  assert.equal(await h.api.get('1.11.8', 4, 0, 0), null);
  assert.equal(await h.api.get('1.11.8', 0, 7, 0), null);
  assert.equal(await h.api.get('1.11.8', 0, 0, Infinity), null);
});

test('all stock candidates keep link attributes, use URLs and skip redundant hrefs', async () => {
  const h = fixture(true, null, 2);
  assert.equal(await h.api.render('processing'), true);
  assert.ok(h.links[0].href.startsWith('blob:test/'));
  assert.equal(h.links[1].href, 'https://chatgpt.com/favicon1.png');
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

test('unavailable original source sequence preserves stock favicon unchanged', async () => {
  const h = fixture(false);
  assert.equal(await h.api.render('processing'), false);
  assert.equal(h.links[0].href, 'https://chatgpt.com/favicon0.png');
});

test('late yellow lookup cannot overwrite later red error', async () => {
  let release;
  let firstRead;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { firstRead = resolve; });
  const h = fixture(true, async (_url, _theme, base) => {
    if (base === 0) {
      firstRead();
      await gate;
    }
  });
  const pending = h.api.render('processing');
  await entered;
  assert.equal(await h.api.render('error'), true);
  const red = h.links[0].href;
  release();
  assert.equal(await pending, false);
  assert.equal(h.links[0].href, red);
});

test('page navigation restores stock href before revoking displayed PNG', async () => {
  const h = fixture();
  assert.equal(await h.api.render('processing'), true);
  const displayed = h.links[0].href;
  assert.match(displayed, /^blob:/);
  h.api.dispose();
  assert.equal(h.links[0].href, 'https://chatgpt.com/favicon0.png');
  assert.deepEqual(h.revoked, [displayed]);
  assert.equal(h.closed(), 1);
});

test('renderer no longer performs per-heartbeat canvas or PNG encoding', () => {
  assert.match(productionFunctionSource('agentFaviconRenderState'), /get_favicon\(/);
  assert.match(productionFunctionSource('get_favicon'),
    /get_favicon\(version_key, base_type, completion_time, time_offset\)/);
  assert.doesNotMatch(downloadConversationSource,
    /canvas\.toDataURL\(['"]image\/png['"]\)|context\.(?:get|put)ImageData\(/);
});

test('two independent tabs use their exact version-scoped provider sessions', async () => {
  const oldTab = fixture(true, null, 1, '1.11.7');
  const newTab = fixture(true, null, 1, '1.12.0');
  const [oldResult, newResult] = await Promise.all([
    oldTab.api.get('1.11.7', 0, 0, 0),
    newTab.api.get('1.12.0', 3, 6, 5000)
  ]);
  assert.equal(oldResult.length, 1);
  assert.equal(newResult.length, 1);
  assert.equal(oldTab.reads[0][1], 'light');
  assert.equal(oldTab.reads[0][2], 0);
  assert.equal(newTab.reads[0][1], 'light');
  assert.equal(newTab.reads[0][2], 3);
  assert.equal(newTab.reads[0][3], 6);
  assert.equal(newTab.reads[0][4], 20);
  assert.equal(oldTab.created.length, 1);
  assert.equal(newTab.created.length, 1);
  assert.equal(oldTab.revoked.length, 0);
  assert.equal(newTab.revoked.length, 0);
});

test('an unavailable source sequence leaves only that candidate untouched', async () => {
  const firstUrl = 'https://chatgpt.com/favicon0.png';
  const h = fixture(url => url === firstUrl, null, 2);
  assert.equal(await h.api.render('processing'), true);
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0][0], firstUrl);
  assert.ok(h.links[0].href.startsWith('blob:test/'));
  assert.equal(h.links[1].href, 'https://chatgpt.com/favicon1.png');
});

test('navigation during an outstanding PNG read releases the lease without leaking URLs', async () => {
  let entered;
  let finishRead;
  const began = new Promise(resolve => { entered = resolve; });
  const release = new Promise(resolve => { finishRead = resolve; });
  const h = fixture(true, async () => {
    entered();
    await release;
  });
  const pending = h.api.render('processing');
  await began;
  h.api.dispose();
  finishRead();
  assert.equal(await pending, false);
  assert.equal(h.closed(), 1);
  assert.equal(h.created.length, 0, 'no object URL after navigation');
});

test('navigation during session acquisition closes the late shared lease', async () => {
  let finishOpen;
  let entered;
  const opening = new Promise(resolve => { finishOpen = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const h = fixture(true, null, 1, '1.11.8', () => {
    entered();
    return opening;
  });
  const pending = h.api.render('processing');
  await started;
  h.api.dispose();
  finishOpen(h.session);
  assert.equal(await pending, false);
  await Promise.resolve();
  assert.equal(h.closed(), 1);
  assert.equal(h.created.length, 0);
});

test('bounded URL cache evicts old frames but never revokes the displayed one', async () => {
  const h = fixture();
  for (let step = 0; step <= 5; step++) {
    for (let slot = 0; slot <= 20; slot++) {
      h.setClock(step * 300000 + slot * 250);
      assert.equal(await h.api.render('processing', true), true);
      assert.ok(!h.revoked.includes(h.links[0].href));
    }
  }
  assert.ok(h.revoked.length > 0, 'historical frames must be evicted');
  assert.ok(h.created.length - h.revoked.length <= 84);
});
