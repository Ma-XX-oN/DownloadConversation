import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {downloadConversationSource, userscript} from './helpers/userscript-source.mjs';

const preview = readFileSync(new URL(
  '../src/userscript/06-image-export-tests/03-favicon-source-preview.js', import.meta.url
), 'utf8');
const testMenu = readFileSync(new URL(
  '../src/userscript/06-image-export-tests/05-modal-contract.js', import.meta.url
), 'utf8');
const testMatrix = readFileSync(new URL(
  '../src/userscript/06-image-export-tests/04-tests-modal-transition.js', import.meta.url
), 'utf8');

function fixture(hrefs = []) {
  const links = hrefs.map(href => ({href}));
  const original = new Map();
  const context = vm.createContext({
    URL,
    document: {
      baseURI: 'https://chatgpt.com/c/123',
      querySelectorAll(query) {
        assert.equal(query, 'link[rel~="icon"]');
        return links;
      }
    }
  });
  vm.runInContext(`
    const agentFaviconOriginalSources = new Map();
    ${preview}
    this.previewAssets = faviconPreviewAssets;
    this.setOriginal = (index, url) => {
      agentFaviconOriginalSources.set(links[index], url);
    };
  `, Object.assign(context, {links}));
  return {assets: () => Array.from(context.previewAssets()), links, setOriginal: context.setOriginal};
}

test('visual Test entry displays exactly PNG + both observed SVG variants', () => {
  const h = fixture();
  const rows = h.assets();
  assert.deepEqual(rows.map(x => x.key), ['light-svg', 'dark-svg', 'png']);
  assert.deepEqual(rows.map(x => x.label), ['Light SVG', 'Dark SVG', '48×48 PNG']);
  assert.equal(new Set(rows.map(x => x.url)).size, 3);
  assert.ok(rows[0].url.endsWith('.svg'));
  assert.ok(rows[1].url.endsWith('.svg'));
  assert.ok(rows[2].url.endsWith('.png'));
  assert.ok(rows.every(row => /Observed log reference/.test(row.provenance)));
});

test('current stock sources override historical references, never generated Blob hrefs', () => {
  const h = fixture(['blob:https://chatgpt.com/123', 'blob:https://chatgpt.com/456']);
  h.setOriginal(0, 'https://chatgpt.com/cdn/assets/favicon-dark.CURRENT.svg');
  h.setOriginal(1, 'https://chatgpt.com/cdn/assets/favicon-48x48.CURRENT.png');
  const rows = h.assets();
  assert.ok(rows[1].url.endsWith('favicon-dark.CURRENT.svg'));
  assert.ok(rows[2].url.endsWith('favicon-48x48.CURRENT.png'));
  assert.ok(rows[0].provenance.startsWith('Observed log reference'));
  assert.ok(rows[1].provenance.startsWith('Live stock DOM'));
  assert.ok(rows[2].provenance.startsWith('Live stock DOM'));
  assert.ok(rows.every(row => !row.url.startsWith('blob:')));
});

test('untrusted unrelated favicon links cannot substitute for stock assets', () => {
  const h = fixture(['https://other.invalid/cdn/assets/favicon-dark.fake.svg',
    'https://chatgpt.com/unrelated/favicon-48x48.fake.png']);
  assert.ok(h.assets().every(row => row.provenance.includes('Observed log reference')));
});

test('visual comparison is read-only and preserves actual source URLs in the preview', () => {
  assert.match(preview, /document\.createElement\('img'\)/);
  assert.match(preview, /image\.src = asset\.url/);
  assert.match(preview, /status\.textContent = 'Loaded: '/);
  assert.match(preview, /status\.textContent = 'Failed to load source'/);
  assert.match(preview, /browserTheme.*agentFaviconCurrentTheme/s);
  assert.doesNotMatch(preview, /document\.head\.(?:append|replaceChildren)/);
  assert.doesNotMatch(preview, /document\.createElement\('link'\)/);
  assert.match(downloadConversationSource, /function showFaviconSourceComparison\(row\)/);
});

test('favicon comparison draws a complete outline outside each icon, without a split background', () => {
  assert.match(preview, /width:88px;height:88px;box-sizing:border-box/);
  assert.match(preview, /border:1px solid #777/);
  assert.match(preview, /background:transparent/);
  assert.match(preview, /image.style.cssText = 'width:72px;height:72px;object-fit:contain'/);
  assert.doesNotMatch(preview, /linear-gradient/);
});

test('built-in Test matrix treats preview as Visual and excludes it from Run All', () => {
  assert.match(testMatrix, /\['Favicon source comparison', null, 'Visual'\]/);
  assert.match(testMatrix, /if \(type !== 'Visual'\) await executeBuiltInTest\(name, fn\)/);
  assert.match(testMenu, /type === 'Visual' \? 'Visual' : 'Automatic'/);
  assert.match(testMenu, /type === 'Visual' \? 'Show' : 'Run'/);
  assert.match(testMenu, /test\?\.\[2\] === 'Visual'\) showFaviconSourceComparison\(row\)/);
  assert.ok(userscript.includes('Favicon source comparison'));
});
