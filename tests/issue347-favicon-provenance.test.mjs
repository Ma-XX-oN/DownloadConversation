import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { markedBlock, productionFunctionSource } from './helpers/userscript-source.mjs';

const provenance = markedBlock(
  '  /** Event-driven favicon provenance, separate from lifecycle/cache behaviour. */',
  '  faviconProvenanceStart();'
);

function fixture() {
  let serial = 0;
  const logs = [];
  const links = [];
  let dark = false;
  let observer;
  const matchMedia = query => ({
    matches: query.includes('dark') ? dark : !dark,
    addEventListener() {}
  });
  const document = {
    head: {}, baseURI: 'https://chatgpt.com/c/test',
    querySelectorAll(selector) {
      assert.equal(selector, 'link[rel~="icon"]');
      return links.filter(link => link.rel.split(/\s+/).includes('icon'));
    }
  };
  const makeLink = (href, media = '') => {
    const link = {
      tagName: 'LINK', nodeType: 1, rel: 'icon',
      media, type: 'image/svg+xml', sizes: { value: '32x32' },
      href,
      matches(selector) { return selector === 'link[rel~="icon"]'; }
    };
    links.push(link);
    return link;
  };
  const link = makeLink('https://chatgpt.com/favicon.svg');
  class MockObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() { this.started = true; }
    disconnect() { this.disconnected = true; }
  }
  const context = vm.createContext({
    document, window: { matchMedia, addEventListener() {} },
    MutationObserver: MockObserver, URL, logs
  });
  vm.runInContext(`
    const agentFaviconOriginalSources = new Map();
    const agentFaviconDisplayedHrefs = new Map();
    function logDiagnostic(level, event, details) {
      logs.push({ level, event, details });
    }
    function diagnosticEnabled(level) { return level === 'debug'; }
    ${productionFunctionSource('agentFaviconCurrentCandidates')}
    ${provenance}
    this.api = {
      seen: agentFaviconCurrentCandidates,
      write: faviconProvenanceNoteWrite,
      cache: faviconProvenanceCacheEvent,
      theme: faviconProvenanceThemeChanged
    };
  `, context);
  return {
    link, links, logs, makeLink, api: context.api,
    setDark(value) { dark = value; },
    notifyAttributes(element, attributeName = 'href') {
      observer.callback([{type:'attributes',target:element,attributeName}]);
    },
    remove(element) {
      const index = links.indexOf(element);
      links.splice(index, 1);
      observer.callback([{
        type:'childList', addedNodes: [], removedNodes:[element]
      }]);
    },
    observer: () => observer,
    blob() { return 'blob:https://chatgpt.com/' + (++serial); }
  };
}

function events(h, name) {
  return h.logs.filter(item => item.event === 'agent-favicon-' + name);
}

test('initial link and browser theme are observed without guessing app theme', () => {
  const h = fixture();
  assert.equal(events(h, 'stock-link-observed').length, 1);
  assert.equal(events(h, 'browser-theme-changed').length, 1);
  assert.equal(events(h, 'browser-theme-changed')[0].details.app_theme, 'unobserved');
  assert.equal(events(h, 'stock-link-observed')[0].details.media_matches, true);
  assert.equal(h.observer().started, true);
});

test('external href change is tracked and full signed query is not logged', () => {
  const h = fixture();
  h.link.href = 'https://chatgpt.com/new-favicon.svg?token=secret123&sig=xyz';
  h.notifyAttributes(h.link);
  const changes = events(h, 'stock-source-changed');
  assert.equal(changes.length, 1);
  const record = JSON.stringify(changes[0]);
  assert.ok(record.includes('new-favicon.svg'));
  assert.ok(record.includes('query-hidden'));
  assert.ok(!record.includes('secret123'));
  assert.ok(!record.includes('sig=xyz'));
  assert.equal(changes[0].details.origin, 'observed-dom-not-attributed-to-chatgpt');
});

test('DC pulse assignments and restores never masquerade as ChatGPT writes', () => {
  const h = fixture();
  const source = h.link.href;
  for (let i = 0; i < 40; i++) {
    const generated = h.blob();
    h.api.write(h.link, h.link.href, generated, 'generated', {
      original_url: source, theme: 'light', state: 'completed', progress_step: 0
    });
    h.link.href = generated;
    h.notifyAttributes(h.link);
    h.api.seen();
  }
  assert.equal(events(h, 'dc-assigned').length, 1);
  assert.equal(events(h, 'stock-source-changed').length, 0);
  assert.equal(events(h, 'stock-href-overwritten').length, 0);
  h.api.write(h.link, h.link.href, source, 'original', {
    original_url: source, state: 'original'
  });
  h.link.href = source;
  h.notifyAttributes(h.link);
  assert.equal(events(h, 'dc-restored').length, 1);
  assert.equal(events(h, 'stock-href-overwritten').length, 0);
});

test('external stock restoration during a DC override is not treated as DC', () => {
  const h = fixture();
  const original = h.link.href, generated = h.blob();
  h.api.write(h.link, original, generated, 'generated', {
    original_url: original, theme: 'light', state: 'processing', progress_step: 0
  });
  h.link.href = generated;
  h.notifyAttributes(h.link);
  h.api.seen();
  h.link.href = original;
  h.notifyAttributes(h.link);
  assert.equal(events(h, 'stock-href-overwritten').length, 1);
});

test('same URL media metadata and colour scheme are separately recorded', () => {
  const h = fixture();
  h.link.media = '(prefers-color-scheme: dark)';
  h.notifyAttributes(h.link, 'media');
  assert.equal(events(h, 'stock-attributes-changed').length, 1);
  assert.equal(events(h, 'stock-attributes-changed')[0].details.media_matches, false);
  h.setDark(true);
  h.api.theme('dark');
  assert.equal(events(h, 'browser-theme-changed').length, 2);
  assert.equal(events(h, 'browser-theme-changed')[1].details.candidates[0].media_matches, true);
  assert.equal(events(h, 'stock-source-changed').length, 0);
});

test('removal recorded, and cache tuple activity logged only once', () => {
  const h = fixture();
  for (let i = 0; i < 40; i++) {
    h.api.cache('1.11.8', h.link.href, 'light', 1, 0, false);
    h.api.cache('1.11.8', h.link.href, 'light', 1, 0, true);
  }
  assert.equal(events(h, 'cache-frame-requested').length, 1);
  assert.equal(events(h, 'cache-frame-available').length, 1);
  assert.match(events(h, 'cache-frame-available')[0].details.note,
    /not exposed/);
  h.remove(h.link);
  assert.equal(events(h, 'stock-link-removed').length, 1);
});
