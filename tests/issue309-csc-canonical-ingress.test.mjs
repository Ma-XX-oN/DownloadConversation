import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ingress = readFileSync(path.join(root,
  'src/userscript/02-network-communication/03-csc-canonical-ingress.js'), 'utf8');
const fetchInstall = readFileSync(path.join(root,
  'src/userscript/03-agent-lifecycle/08-generation-request.js'), 'utf8');
const captureTail = readFileSync(path.join(root,
  'src/userscript/03-agent-lifecycle/09-network-install-api-transition.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(root,
  'src/userscript-manifest.json'), 'utf8'));

function harness({ workerFails = false, cloneFails = false } = {}) {
  const state = { events: [], published: [], warnings: [], clones: 0, clock: 400,
    wall: 700000, counter: 0 };
  const worker = {
    postMessage(payload, transfer) {
      if (workerFails) throw new DOMException('Synthetic DataCloneError', 'DataCloneError');
      state.events.push(structuredClone(payload, { transfer }));
    }
  };
  const context = vm.createContext({
    Date: class extends Date {
      static now() { return state.wall; }
    },
    performance: { now: () => state.clock },
    crypto: { randomUUID: () => 'csc-test-' + ++state.counter },
    stockNetworkSequence: 0,
    assert: (condition, reason) => assert.ok(condition, reason),
    cloneSafely(value) {
      state.clones += 1;
      return cloneFails ? null : value.clone();
    },
    cancelReadableBodyQuietly: async body => body.cancel(),
    boundedDiagnosticText: value => String(value),
    errorMessage: error => error?.message || String(error),
    logDiagnostic(level, name, detail) { state.warnings.push({ level, name, detail }); },
    ArrayBuffer, Blob, Request, Response, Headers, ReadableStream, Uint8Array,
    Object, Promise, String, Map
  });
  vm.runInContext(ingress + '\n' + [
    'globalThis.api = { cscCaptureNow, cscBindCommWorker, cscBindPluginIngress,',
    '  cscFanOut, cscPublishFetch, cscPublishValue, cscXhrBodySnapshot,',
    '  cscRawHeaderEntries };'
  ].join(''), context);
  return { api: context.api, state, worker };
}

async function streamBytes(stream) {
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const byte of value) chunks.push(byte);
  }
  reader.releaseLock();
  return chunks;
}

test('canonical module is ordered before COMM legacy and stock interception is once', () => {
  const modules = manifest.modules.flatMap(module => module.files);
  const p = 'src/userscript/02-network-communication/03-csc-canonical-ingress.js';
  assert.equal(modules.filter(item => item === p).length, 1);
  assert.ok(modules.indexOf(p) > modules.findIndex(item =>
    item.endsWith('08-communication-xhr.js')));
  assert.equal((fetchInstall + captureTail).split('function installNetworkCapture()').length - 1, 1);
  assert.match(fetchInstall, /pageWindow.fetch = function\(\.\.\.args\) \{\s*const requestStamp = cscCaptureNow/);
  assert.match(captureTail, /XHR\.prototype\.send = function\(body\) \{\s*const requestStamp = cscCaptureNow/);
  assert.match(captureTail, /socket\.send = function\(data\) \{\s*const stamp = cscCaptureNow/);
  assert.match(captureTail, /socket\.addEventListener\('message', event => \{\s*const stamp = cscCaptureNow/);
  assert.doesNotMatch(ingress, /getReader\(|\.text\(|\.arrayBuffer\(|new Request\(|new Response\(/);
  assert.doesNotMatch(ingress, /(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
});

test('monotonic event identity and independent wall-clock and page clocks', () => {
  const { api, state } = harness();
  const a = api.cscCaptureNow('fetch', 'request');
  state.clock += 17;
  state.wall -= 100000; // Simulate system clock being moved backwards.
  const b = api.cscCaptureNow('fetch', 'response', a.connection_id, a);
  assert.equal(a.network_sequence + 1, b.network_sequence);
  assert.equal(a.capture_order + 1, b.capture_order);
  assert.ok(b.captured_at_mono_ms > a.captured_at_mono_ms);
  assert.ok(b.captured_at_epoch_ms < a.captured_at_epoch_ms);
  assert.equal(b.request_capture_id, a.capture_id);
  assert.equal(b.connection_id, a.connection_id);
  assert.equal(b.clock_domain, a.clock_domain);
  assert.equal(Object.isFrozen(a), true);
  assert.equal(a.captured_at_mono_ms, 400);
});

test('COMM stream moves once and stock body remains untouched across delayed delivery', async () => {
  const { api, state, worker } = harness();
  api.cscBindCommWorker(worker);
  api.cscBindPluginIngress(event => { state.published.push(event); });
  const raw = Uint8Array.from({ length: 131072 }, (_, i) => i % 251);
  const original = new Response(raw, {
    headers: { 'content-type': 'application/octet-stream', authorization: 'private-token' }
  });
  const event = api.cscCaptureNow('fetch', 'response');
  state.clock += 1000;
  state.wall += 50000;
  api.cscPublishFetch(event, original, { url: 'https://example.test/raw', status: 206 });
  assert.equal(state.clones, 2, 'One plugin clone and one COMM clone, never a transfer clone');
  assert.equal(state.events.length, 1);
  assert.equal(state.published.length, 1);
  assert.notEqual(state.published[0].source, original, 'Plugin must not own stock Response');
  assert.equal(state.events[0].envelope.capture_id, event.capture_id);
  assert.equal(state.published[0].envelope.capture_id, event.capture_id);
  assert.equal(state.events[0].envelope.captured_at_epoch_ms, event.captured_at_epoch_ms);
  assert.equal(state.events[0].envelope.captured_at_mono_ms, 400);
  assert.equal(state.events[0].envelope.body_state, 'stream-transferred');
  assert.equal(state.events[0].envelope.headers[0][0], 'authorization');
  assert.deepEqual(await streamBytes(state.events[0].envelope.body), [...raw]);
  assert.deepEqual([...new Uint8Array(await original.arrayBuffer())], [...raw]);
  assert.equal(state.warnings.length, 0);
});

test('Worker stalled or absent does not stall plugin; plugin absent does not stall COMM', () => {
  const { api, state, worker } = harness();
  api.cscBindPluginIngress(e => { state.published.push(e); });
  let event = api.cscCaptureNow('websocket', 'incoming');
  api.cscPublishValue(event, { url: 'wss://example.test' }, 'first');
  assert.equal(state.published.length, 1);
  assert.equal(state.events.length, 0);
  api.cscBindCommWorker(worker);
  event = api.cscCaptureNow('websocket', 'outgoing');
  api.cscPublishValue(event, { url: 'wss://example.test' }, 'second');
  assert.equal(state.published.length, 2);
  assert.equal(state.events.length, 1);
  api.cscBindPluginIngress(null);
  event = api.cscCaptureNow('websocket', 'incoming');
  api.cscPublishValue(event, {}, 'third');
  assert.equal(state.published.length, 2);
  assert.equal(state.events.length, 2);
  assert.ok(state.events[0].envelope.network_sequence <
    state.events[1].envelope.network_sequence);
});

test('XHR/WS byte values clone without detaching or aliasing page buffers', () => {
  const { api, state, worker } = harness();
  api.cscBindCommWorker(worker);
  const bytes = new Uint8Array([9, 8, 7, 6]);
  const event = api.cscCaptureNow('xhr', 'response');
  api.cscPublishValue(event, { response_type: 'arraybuffer' }, bytes.buffer);
  bytes[0] = 123;
  assert.equal(bytes.byteLength, 4);
  assert.equal(new Uint8Array(state.events[0].envelope.value)[0], 9);
  const snapshot = api.cscXhrBodySnapshot({
    responseType: 'arraybuffer', response: bytes.buffer
  });
  assert.equal(snapshot.body_available, true);
  assert.equal(snapshot.body_type, 'binary');
  assert.equal(api.cscXhrBodySnapshot({ responseType: 'document', response: {} })
    .body_available, false);
  const unavailable = api.cscCaptureNow('xhr', 'response');
  api.cscPublishValue(unavailable, { body_available: false }, null);
  assert.equal(state.events[1].envelope.body_state, 'none-or-unavailable');
});

test('Worker transfer errors are reported; plugin receives exact event and stock survives', async () => {
  const { api, state, worker } = harness({ workerFails: true });
  api.cscBindCommWorker(worker);
  api.cscBindPluginIngress(value => state.published.push(value));
  const response = new Response('original-content');
  const stamp = api.cscCaptureNow('fetch', 'response');
  api.cscPublishFetch(stamp, response, { status: 200 });
  assert.equal(state.published.length, 1);
  assert.equal(state.events.length, 0);
  assert.equal(state.warnings.length, 1);
  assert.equal(state.warnings[0].name, 'csc-ingress-incomplete');
  assert.equal(state.warnings[0].detail.capture_id, stamp.capture_id);
  assert.equal(await response.text(), 'original-content');
});

test('native clone failure reports incomplete, with no false body transfer', async () => {
  const { api, state, worker } = harness({ cloneFails: true });
  api.cscBindCommWorker(worker);
  const response = new Response('stock-valid');
  api.cscPublishFetch(api.cscCaptureNow('fetch', 'response'), response, {});
  assert.equal(state.events.length, 0);
  assert.equal(state.warnings.length, 1);
  assert.match(state.warnings[0].detail.error, /clone unavailable/);
  assert.equal(await response.text(), 'stock-valid');
});

test('XHR native ArrayBuffer from another JS realm is still browser-accessible', () => {
  const { api } = harness();
  const foreign = vm.runInNewContext('new ArrayBuffer(4)');
  assert.equal(foreign instanceof ArrayBuffer, false,
    'Fixture must use a different native ArrayBuffer realm');
  assert.equal(Object.prototype.toString.call(foreign), '[object ArrayBuffer]');
  const captured = api.cscXhrBodySnapshot({
    responseType: 'arraybuffer', response: foreign
  });
  assert.equal(captured.body_available, true);
  assert.equal(captured.body_type, 'binary');
  assert.equal(captured.value, foreign);
});
