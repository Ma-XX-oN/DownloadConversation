import { userscript } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

function productionFetchWrapperSource() {
  const startMarker = '      pageWindow.fetch = function(...args) {';
  const endMarker = '\n    }\n\n    // Retain the page-realm XHR constructor';
  const start = userscript.indexOf(startMarker);
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start,
    'Production page fetch wrapper could not be located.');
  const wrapperEnd = userscript.lastIndexOf('\n      };', end);
  assert.ok(wrapperEnd >= start,
    'Production page fetch wrapper terminator could not be located.');
  return userscript.slice(start, wrapperEnd + '\n      };'.length);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class FakeRequest {
  constructor(input, init = {}) {
    this.url = typeof input === 'string' ? input : input.url;
    this.method = String(init.method ?? input?.method ?? 'GET').toUpperCase();
    this.headers = new Map();
  }
}

test('generation response clone is acquired before the stock response can be disturbed', async () => {
  const captureReady = deferred();
  const originalResponse = {
    disturbed: false,
    clone_count: 0,
    clone() {
      if (this.disturbed) throw new TypeError('Body has already been disturbed.');
      this.clone_count += 1;
      return { independent_clone: true, body: {} };
    }
  };
  const capturedResponses = [];
  const pageWindow = { Request: FakeRequest, fetch: null };
  const context = {
    pageWindow,
    Request: FakeRequest,
    performance: { now: () => 1000 },
    originalFetch: async () => originalResponse,
    stockNetworkTraceFetchStart: () => ({
      sequence: 1,
      method: 'POST',
      url: '/backend-api/f/conversation',
      started_at: 1000
    }),
    communicationLogFetchRequest: async () => {},
    rememberApiRequestContext() {},
    recordClickDiagnosticNetworkRequest() {},
    agentTerminalObserveStatsRequest: async () => {},
    isGenerationStreamUrl: url => url.endsWith('/backend-api/f/conversation'),
    isSteerTurnUrl: () => false,
    agentFaviconObserveProcessing() {},
    agentStopwatchObserveSteerTurn() {},
    captureGenerationStreamRequest: () => captureReady.promise,
    stockNetworkTraceFetchResponse() {},
    communicationLogFetchResponse: async () => {},
    cloneSafely(value) {
      try { return value.clone(); } catch { return null; }
    },
    captureGenerationStreamResponse(response, capture) {
      capturedResponses.push({ response, capture });
      return Promise.resolve();
    },
    logDiagnostic() {},
    boundedDiagnosticText: value => String(value),
    errorMessage: error => String(error?.message ?? error)
  };
  vm.runInNewContext(productionFetchWrapperSource(), context);

  const returned = await pageWindow.fetch('/backend-api/f/conversation', { method: 'POST' });
  assert.equal(returned, originalResponse,
    'The stock page must receive its original Response unchanged.');

  // Once fetch resolves, ChatGPT is free to lock or consume the original body immediately.
  originalResponse.disturbed = true;
  captureReady.resolve({ id: 'captured-request' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(originalResponse.clone_count, 1,
    'DownloadConversation must acquire its generation Response clone before returning the stock Response.');
  assert.equal(capturedResponses.length, 1,
    'The already-acquired clone must be delivered when request capture becomes ready.');
  assert.equal(capturedResponses[0].response.independent_clone, true,
    'Generation capture must consume the independent Response clone.');
});
