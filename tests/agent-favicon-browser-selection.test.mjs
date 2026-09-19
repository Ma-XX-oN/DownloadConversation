import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function multiCandidateHarness() {
  const originals = [
    'https://chatgpt.com/favicon-32x32.png',
    'https://chatgpt.com/favicon-48x48.png'
  ];
  const stockLinks = [
    { id: '', rel: 'icon', href: originals[0], type: 'image/png', media: '', sizes: { value: '32x32' } },
    { id: '', rel: 'icon', href: originals[1], type: 'image/png', media: '(prefers-color-scheme: dark)', sizes: { value: '48x48' } }
  ];
  let override = null;
  const imageSources = [];
  let dataUrlSequence = 0;

  const document = {
    head: { append(element) { override = element; } },
    documentElement: { append(element) { override = element; } },
    querySelectorAll(selector) {
      assert.equal(selector, 'link[rel~="icon"]');
      return override ? [...stockLinks, override] : [...stockLinks];
    },
    getElementById(id) {
      return override?.id === id ? override : null;
    },
    createElement(tag) {
      if (tag === 'link') {
        return {
          id: '',
          rel: '',
          href: '',
          remove() { override = null; }
        };
      }
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage() {},
              getImageData() {
                return { data: new Uint8ClampedArray([255, 255, 255, 255]) };
              },
              putImageData() {}
            };
          },
          toDataURL() {
            dataUrlSequence += 1;
            return `data:image/png;render=${dataUrlSequence}`;
          }
        };
      }
      throw new Error(`Unexpected element ${tag}`);
    }
  };

  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 48;
      this.naturalHeight = 48;
    }
    set src(value) {
      imageSources.push(value);
      queueMicrotask(() => this.onload?.());
    }
  }

  const context = {
    document,
    Image: FakeImage,
    Uint8ClampedArray,
    queueMicrotask,
    diagnostics: []
  };

  vm.runInNewContext(`
    const AGENT_FAVICON_OVERRIDE_ID = 'tm-agent-state-favicon';
    const AGENT_FAVICON_PROCESSING_RGB = Object.freeze([255, 255, 0]);
    const AGENT_FAVICON_COMPLETED_RGB = Object.freeze([144, 238, 144]);
    let agentFaviconOriginalHref = null;
    let agentFaviconRenderGeneration = 0;
    function logDiagnostic(level, name, details) { this.diagnostics.push({ level, name, details }); }
    ${productionFunctionSource('errorMessage')}
    ${productionFunctionSource('agentFaviconOriginalSource')}
    ${productionFunctionSource('ensureAgentFaviconOverrideLink')}
    ${productionFunctionSource('agentFaviconRecolorPixels')}
    ${productionFunctionSource('agentFaviconRenderState')}
    this.render = agentFaviconRenderState;
  `, context);

  return { context, stockLinks, originals, imageSources, override: () => override };
}

test('colored state updates every stock favicon candidate from its own original source', async () => {
  const harness = multiCandidateHarness();

  assert.equal(await harness.context.render('processing'), true);

  assert.deepEqual(harness.imageSources, harness.originals,
    'Every candidate must be rendered from its own captured original source.');
  assert.ok(harness.stockLinks.every((link, index) => link.href !== harness.originals[index]),
    'Every stock favicon candidate Chromium may select must project the colored state.');
  assert.ok(harness.stockLinks.every(link => link.href.startsWith('data:image/png;')),
    'Each stock favicon candidate must point at its generated colored image.');
  assert.equal(harness.override(), null,
    'Do not rely on an extra generic rel=icon link winning Chromium candidate selection.');
});
