import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

test('capture all original stock favicon candidates without modifying browser selectors', () => {
  const links = [
    { href: 'https://chatgpt.com/light.png', rel: 'icon', type: 'image/png',
      media: '', sizes: { value: '32x32' } },
    { href: 'https://chatgpt.com/dark.png', rel: 'icon', type: 'image/png',
      media: '(prefers-color-scheme: dark)', sizes: { value: '48x48' } }
  ];
  const h = { document: { querySelectorAll() { return links; } } };
  vm.runInNewContext(`
    const agentFaviconOriginalSources = new Map();
    const agentFaviconDisplayedHrefs = new Map();
    ${productionFunctionSource('agentFaviconCurrentCandidates')}
    this.candidates = agentFaviconCurrentCandidates;
    this.displayed = agentFaviconDisplayedHrefs;
  `, h);
  let candidates = h.candidates();
  assert.equal(candidates.length, 2);
  assert.deepEqual(Array.from(candidates, c => c.original_href), links.map(l => l.href));
  assert.equal(candidates[1].media, '(prefers-color-scheme: dark)');
  assert.equal(candidates[1].sizes, '48x48');
  h.displayed.set(links[0], 'blob:test');
  links[0].href = 'blob:test';
  assert.equal(h.candidates()[0].original_href, 'https://chatgpt.com/light.png');
  links[0].href = 'https://chatgpt.com/changed.png';
  candidates = h.candidates();
  assert.equal(candidates[0].original_href, 'https://chatgpt.com/changed.png');
  assert.equal(links.length, 2, 'no generic favicon candidate appended');
});
