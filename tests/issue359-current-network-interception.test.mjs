import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = [
  '../src/userscript/03-agent-lifecycle/08-generation-request.js',
  '../src/userscript/03-agent-lifecycle/09-network-install-api-transition.js'
].map(p => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');

async function exercise({ worker = false } = {}) {
  const observed = [];
  let legacyRequests = 0;
  let legacyResponses = 0;
  let order = 0;
  const response = {
    url: 'https://chatgpt.com/backend-api/conversation/1',
    status: 200, ok: true, redirected: false, body: null,
    headers: { get: () => 'application/json' }
  };
  const page = {
    fetch: () => Promise.resolve(response),
    Request: class {
      constructor(url) { this.url = url; this.method = 'GET'; this.headers = {}; }
    }
  };
  const context = {
    window: page,
    captureInstalled: false,
    originalPageFetch: null,
    stockNetworkTraceFetchStart: (_req, url, stamp) => ({
      sequence: stamp.network_sequence,
      method: 'GET', url,
      started_at: stamp.captured_at_mono_ms
    }),
    stockNetworkTraceFetchResponse: () => {},
    communicationLogFetchRequest: async () => { legacyRequests++; },
    communicationLogFetchResponse: async () => { legacyResponses++; },
    rememberApiRequestContext: () => {},
    recordClickDiagnosticNetworkRequest: () => {},
    agentTerminalObserveStatsRequest: () => {},
    agentStopwatchIsInitialConversationUrl: () => false,
    isGenerationStreamUrl: () => false,
    isConversationResumeUrl: () => false,
    isSteerTurnUrl: () => false,
    cscCaptureNow: (transport, direction, connectionId, parent) => ({
      transport, direction, connection_id: connectionId ?? 'request',
      network_sequence: ++order, capture_order: order,
      captured_at_mono_ms: 99,
      capture_id: 'capture:' + order,
      request_capture_id: parent?.capture_id ?? null
    }),
    cscPublishFetch: (stamp, object, metadata) =>
      observed.push({ stamp, object, metadata }),
    cscDispatchObservedFetch: (native, receiver, args) => native.apply(receiver, args),
    cscCommWorker: worker ? { postMessage: () => {} } : null,
    performance: { now: () => 99 },
    Request: page.Request
  };
  const install = new Function('context',
    'with(context) {\n' + source + '\nreturn installNetworkCapture;\n}'
  )(context);
  install();
  const actualResponse = await page.fetch(response.url);
  return { actualResponse, response, observed, legacyRequests,
    legacyResponses, installed: context.captureInstalled };
}

test('stock fetch retains exact response and original capture identity', async () => {
  const result = await exercise();
  assert.equal(result.installed, true);
  assert.equal(result.actualResponse, result.response);
  assert.deepEqual(result.observed.map(item => item.stamp.direction),
    ['request', 'response']);
  assert.deepEqual(result.observed.map(item => item.stamp.network_sequence),
    [1, 2]);
  assert.equal(result.observed[1].stamp.request_capture_id, 'capture:1');
  assert.equal(result.legacyRequests, 1);
  assert.equal(result.legacyResponses, 1);
});

test('Worker-owned COMM disables duplicate legacy COMM recording', async () => {
  const result = await exercise({ worker: true });
  assert.equal(result.actualResponse, result.response);
  assert.equal(result.observed.length, 2);
  assert.equal(result.legacyRequests, 0);
  assert.equal(result.legacyResponses, 0);
});
