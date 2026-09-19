import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

function lifecycleHarness() {
  const context = { rendered: [] };
  vm.runInNewContext(`
    let agentFaviconProcessingObserved = false;
    function agentFaviconRenderState(state) { this.rendered.push(state); return Promise.resolve(true); }
    ${productionFunctionSource('agentStopwatchStreamIsActive')}
    ${productionFunctionSource('agentFaviconObserveProcessing')}
    ${productionFunctionSource('agentFaviconObserveStreamStatus')}
    ${productionFunctionSource('agentFaviconHandleTerminal')}
    this.api = {
      processing: agentFaviconObserveProcessing,
      streamStatus: agentFaviconObserveStreamStatus,
      terminal: agentFaviconHandleTerminal,
      observed: () => agentFaviconProcessingObserved
    };
  `, context);
  return context;
}

function renderHarness() {
  const originalHref = 'https://chatgpt.com/favicon-test.png';
  const stockLink = { id: '', rel: 'icon', href: originalHref };
  let override = null;
  const imageSources = [];
  const renderedUrls = [];
  let currentPixels = null;

  const document = {
    head: {
      append(element) {
        override = element;
      }
    },
    documentElement: {
      append(element) {
        override = element;
      }
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'link[rel~="icon"]');
      return override ? [stockLink, override] : [stockLink];
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
          remove() {
            override = null;
          }
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
              putImageData(imageData) {
                currentPixels = Array.from(imageData.data);
              }
            };
          },
          toDataURL() {
            const url = `data:image/png;pixels=${currentPixels.slice(0, 3).join(',')}`;
            renderedUrls.push(url);
            return url;
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
      this.naturalWidth = 1;
      this.naturalHeight = 1;
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
    imageSources,
    renderedUrls,
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
    this.api = {
      render: agentFaviconRenderState,
      source: agentFaviconOriginalSource,
      override: () => document.getElementById(AGENT_FAVICON_OVERRIDE_ID)
    };
  `, context);
  return { context, originalHref };
}

test('favicon recoloring changes only near-white pixels and preserves alpha/non-white pixels', () => {
  const context = { Uint8ClampedArray };
  vm.runInNewContext(`
    ${productionFunctionSource('agentFaviconRecolorPixels')}
    this.recolor = agentFaviconRecolorPixels;
  `, context);

  const pixels = new Uint8ClampedArray([
    255, 255, 255, 255,
    248, 247, 249, 200,
    220, 220, 220, 255,
    0, 0, 0, 255,
    255, 0, 0, 255,
    255, 255, 255, 0
  ]);
  const changed = context.recolor(pixels, [255, 255, 0]);

  assert.equal(changed, 2);
  assert.deepEqual(Array.from(pixels.slice(0, 4)), [255, 255, 0, 255]);
  assert.equal(pixels[7], 200, 'alpha of recolored antialiased pixel must be preserved');
  assert.deepEqual(Array.from(pixels.slice(8, 20)), [
    220, 220, 220, 255,
    0, 0, 0, 255,
    255, 0, 0, 255
  ]);
  assert.deepEqual(Array.from(pixels.slice(20, 24)), [255, 255, 255, 0]);
});

test('processing then successful terminal renders yellow then light green', () => {
  const harness = lifecycleHarness();
  harness.api.processing();
  assert.equal(harness.api.observed(), true);
  harness.api.terminal({ kind: 'success', terminal_key: 'conversation-1:exchange-A' });
  assert.equal(harness.api.observed(), false);
  assert.deepEqual(harness.rendered, ['processing', 'completed']);
});

test('successful terminal without current-page processing does not infer green', () => {
  const harness = lifecycleHarness();
  harness.api.terminal({ kind: 'success', terminal_key: 'conversation-1:exchange-A' });
  assert.deepEqual(harness.rendered, []);
});

test('reload IS_STREAMING renders processing while NOT_STREAMING leaves original untouched', () => {
  const streaming = lifecycleHarness();
  streaming.api.streamStatus({ status: 'IS_STREAMING' });
  assert.deepEqual(streaming.rendered, ['processing']);
  assert.equal(streaming.api.observed(), true);

  const idle = lifecycleHarness();
  idle.api.streamStatus({ status: 'NOT_STREAMING' });
  assert.deepEqual(idle.rendered, []);
  assert.equal(idle.api.observed(), false);
});

test('post-success terminal error does not replace completed favicon state', () => {
  const harness = lifecycleHarness();
  harness.api.processing();
  harness.api.terminal({ kind: 'success', terminal_key: 'conversation-1:exchange-A' });
  harness.api.terminal({ kind: 'error', terminal_key: 'conversation-1:exchange-A' });
  assert.deepEqual(harness.rendered, ['processing', 'completed']);
});

test('a new prompt after completed state returns favicon to processing', () => {
  const harness = lifecycleHarness();
  harness.api.processing();
  harness.api.terminal({ kind: 'success', terminal_key: 'conversation-1:exchange-A' });
  harness.api.processing();
  assert.deepEqual(harness.rendered, ['processing', 'completed', 'processing']);
});

test('every colored favicon render uses the captured original stock favicon source', async () => {
  const { context, originalHref } = renderHarness();
  assert.equal(await context.api.render('processing'), true);
  const yellowHref = context.api.override().href;
  assert.equal(await context.api.render('completed'), true);
  const greenHref = context.api.override().href;

  assert.deepEqual(context.imageSources, [originalHref, originalHref]);
  assert.match(yellowHref, /pixels=255,255,0$/);
  assert.match(greenHref, /pixels=144,238,144$/);
  assert.notEqual(yellowHref, greenHref);
});

test('favicon is wired to the existing request, terminal, and reload watchers', () => {
  const install = productionFunctionSource('installNetworkCapture');
  const reload = productionFunctionSource('agentStopwatchObserveConversationResponse');

  assert.match(install, /generationRequest[\s\S]*agentFaviconObserveProcessing/);
  assert.match(reload, /agentStopwatchFetchStreamStatus\(conversationId\)[\s\S]*agentFaviconObserveStreamStatus\(streamStatus\)/);
  assert.match(userscript,
    /const agentTerminalHandlers = Object\.freeze\(\[[\s\S]*agentSoundHandleTerminal,[\s\S]*agentStopwatchHandleTerminal,[\s\S]*agentFaviconHandleTerminal[\s\S]*\]\)/);
  assert.doesNotMatch(productionFunctionSource('agentFaviconHandleTerminal'), /agentTerminalClassifyKind|agentTerminalNormalize/,
    'favicon terminal consumer must not rediscover terminal state');
});
