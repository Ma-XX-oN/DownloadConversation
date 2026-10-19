import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = p => readFileSync(p, 'utf8');
const ingress = read('src/userscript/02-network-communication/03-csc-canonical-ingress.js');
const backlog = read('src/userscript/02-network-communication/03-csc-plugin-backlog.js');

function harness({ workerFailure = false } = {}) {
  const state = {
    clones: 0, warnings: [], worker: [], ordinal: 0,
    wall: 1700000000000, monotonic: 100
  };
  const context = vm.createContext({
    Date: class extends Date {
      static now() { return state.wall; }
    },
    performance: { now: () => state.monotonic },
    crypto: { randomUUID: () => 'native-csc-' + ++state.ordinal },
    stockNetworkSequence: 0,
    assert: (ok, message) => assert.ok(ok, message),
    cloneSafely(value) { state.clones++; return value.clone(); },
    cancelReadableBodyQuietly: async body => body.cancel(),
    errorMessage: error => String(error?.message ?? error),
    boundedDiagnosticText: String,
    logDiagnostic(level, name, detail) { state.warnings.push({ level, name, detail }); },
    structuredClone, setTimeout, clearTimeout,
    Blob, Request, Response, Headers, ReadableStream, Uint8Array,
    ArrayBuffer, Object, Promise, String, Map
  });
  vm.runInContext(ingress + '\n' + backlog + '\n' + 'globalThis.api = { ' +
    'stamp: cscCaptureNow, publish: cscPublishFetch, publishValue: cscPublishValue, ' +
    'attachWorker: cscBindCommWorker, connect: cscPluginQueueConnect, ' +
    'disconnect: cscPluginQueueDisconnect, snapshot: cscPluginQueueSnapshot, ' +
    'drain: cscPluginQueueDrain };', context);
  const worker = {
    postMessage(payload, transfer) {
      if (workerFailure) throw new Error('Synthetic COMM Worker transfer failure');
      state.worker.push(structuredClone(payload, { transfer }));
    }
  };
  return { api: context.api, state, worker };
}

async function settle(api) {
  await api.drain();
  await new Promise(resolve => setImmediate(resolve));
  await api.drain();
}

async function bytesFromStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

test('#310 real #309 native Response clones survive late host and COMM read', async () => {
  const h = harness();
  h.api.attachWorker(h.worker);
  const path = 'https://chatgpt.com/backend-api/conversations/example';
  const request = new Request(path);
  const q = h.api.stamp('fetch', 'request');
  h.api.publish(q, request, { method: 'GET', request_url: path });
  const payload = { id: 'conversation-1', title: 'Unmodified source ☺' };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8');
  const stock = new Response(encoded, {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
  h.state.wall += 125;
  h.state.monotonic += 75;
  const a = h.api.stamp('fetch', 'response', q.connection_id, q);
  h.api.publish(a, stock, { method: 'GET', request_url: path, status: 200 });
  assert.equal(h.api.snapshot().queued, 2,
    'The real plugin-owned Response clone must exist before host readiness');
  assert.equal(h.state.clones, 4,
    'One COMM and one plugin native clone for each original request/response');
  const received = [];
  const host = {
    navigation() { return true; },
    request(e) { received.push({ method: 'request', ...e }); return true; },
    response(e) { received.push({ method: 'response', ...e }); return true; }
  };
  h.state.wall += 100000;
  h.state.monotonic += 10000;
  h.api.connect(host);
  await settle(h.api);
  assert.equal(h.api.snapshot().queued, 0);
  assert.equal(h.api.snapshot().accepted, 2);
  assert.equal(received.length, 2);
  assert.equal(received[0].network_sequence, q.network_sequence);
  assert.equal(received[1].network_sequence, q.network_sequence,
    'Response must reuse the accepted request correlation sequence');
  assert.deepEqual(received[1].body, payload);
  const transferred = h.state.worker[1].envelope;
  assert.equal(transferred.capture_id, a.capture_id);
  assert.equal(transferred.captured_at_epoch_ms, 1700000000125);
  assert.equal(transferred.captured_at_mono_ms, 175);
  assert.deepEqual(await bytesFromStream(transferred.body), encoded);
  assert.deepEqual(Buffer.from(await stock.arrayBuffer()), encoded,
    'Stock ChatGPT response must remain readable after both consumers');
  assert.equal(h.state.warnings.length, 0);
});

test('#310 XHR already-available JSON is cloned and never aliases page object', async () => {
  const h = harness();
  const url = 'https://chatgpt.com/backend-api/conversations/example';
  const q = h.api.stamp('xhr', 'request');
  h.api.publishValue(q, { method: 'GET', url, request_url: url });
  const pageObject = { title: 'early-original', nested: { count: 7 } };
  const a = h.api.stamp('xhr', 'response', q.connection_id, q);
  h.api.publishValue(a, { status: 200, method: 'GET', request_url: url },
    pageObject);
  pageObject.title = 'late-page-mutation';
  pageObject.nested.count = 99;
  let received = null;
  const host = {
    navigation() { return true; },
    request() { return true; },
    response(e) { received = e.body; return true; }
  };
  h.api.connect(host);
  await settle(h.api);
  assert.equal(received.title, 'early-original');
  assert.equal(received.nested.count, 7);
  assert.equal(h.api.snapshot().queued, 0);
});

test('#310 a COMM Worker transfer failure cannot corrupt delayed provider clone', async () => {
  const h = harness({ workerFailure: true });
  h.api.attachWorker(h.worker);
  const path = 'https://chatgpt.com/backend-api/conversations/example';
  const request = new Request(path);
  const q = h.api.stamp('fetch', 'request');
  h.api.publish(q, request, { method: 'GET', request_url: path });
  const stock = new Response(JSON.stringify({ title: 'still-valid' }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  const a = h.api.stamp('fetch', 'response', q.connection_id, q);
  h.api.publish(a, stock, { method: 'GET', request_url: path, status: 200 });
  let title = null;
  h.api.connect({
    navigation() { return true; }, request() { return true; },
    response(event) { title = event.body.title; return true; }
  });
  await settle(h.api);
  assert.equal(title, 'still-valid');
  assert.equal(await stock.json().then(v => v.title), 'still-valid');
  assert.equal(h.state.worker.length, 0);
  assert.equal(h.state.warnings.filter(x =>
    x.name === 'csc-ingress-incomplete').length, 2);
});
