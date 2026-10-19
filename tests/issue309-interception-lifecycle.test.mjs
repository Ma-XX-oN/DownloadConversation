import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(path.join(root, name), 'utf8');
const ingress = read('src/userscript/02-network-communication/03-csc-canonical-ingress.js');
const fetchPart = read('src/userscript/03-agent-lifecycle/08-generation-request.js');
const tailPart = read('src/userscript/03-agent-lifecycle/09-network-install-api-transition.js');
const entry = '  function installNetworkCapture() {';
const end = '    captureInstalled = true;\n  }';
const begin = fetchPart.indexOf(entry);
const finish = tailPart.indexOf(end);
assert.ok(begin !== -1 && finish !== -1, 'Exact production interception boundary is missing');
const interceptor = fetchPart.slice(begin) + '\n'
  + tailPart.slice(0, finish + end.length);

/**
 * Host only the exact production #309 ingress and interception wrapper.
 * Everything else is an explicitly simulated page or legacy observer.
 */
function simulatedPage({ nativeSendFailure = false, synchronousFetchFailure = false,
  socketConstructFailure = false } = {}) {
  const state = { records: [], plugin: [], wire: [], logs: [], clones: 0,
    sequenceAtWire: [], now: 9000, monotonic: 100, ids: 0,
    fetchDeferred: [], xhrInstances: [], sockets: [], lifecycle: [] };
  class FakeXHR {
    constructor() {
      this.listeners = new Map();
      this.response = '';
      this.responseType = '';
      this.responseText = '';
      this.status = 200;
      this.responseURL = 'https://chatgpt.com/backend-api/resource';
      state.xhrInstances.push(this);
    }
    addEventListener(type, callback, options = {}) {
      const group = this.listeners.get(type) || [];
      group.push({ callback, once: options.once === true });
      this.listeners.set(type, group);
    }
    dispatch(type, extras = {}) {
      const group = [...(this.listeners.get(type) || [])];
      for (const entry of group) {
        entry.callback({ type, target: this, ...extras });
        if (entry.once) {
          this.listeners.set(type, (this.listeners.get(type) || [])
            .filter(item => item !== entry));
        }
      }
    }
    open(method, url) { this.url = url; this.method = method; }
    setRequestHeader(key, value) { this.headers ??= {}; this.headers[key] = value; }
    send(body) { state.wire.push({ transport: 'xhr', body, xhr: this }); }
    getAllResponseHeaders() { return 'content-type: application/json\r\nx-request-id: ref-9\r\n'; }
  }
  class FakeSocket {
    constructor(url) {
      if (socketConstructFailure) throw new TypeError('Invalid synthetic WS URL');
      this.url = url;
      this.listeners = new Map();
      state.sockets.push(this);
    }
    addEventListener(type, cb) {
      const existing = this.listeners.get(type) || [];
      existing.push(cb);
      this.listeners.set(type, existing);
    }
    dispatch(type, event = {}) {
      for (const cb of this.listeners.get(type) || []) cb(event);
    }
    send(data) {
      if (nativeSendFailure) throw new DOMException('not open', 'InvalidStateError');
      state.wire.push({ transport: 'ws', data, socket: this });
    }
  }
  const pageWindow = {
    Request,
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeSocket,
    fetch(...args) {
      if (synchronousFetchFailure) throw new TypeError('Synchronous stock fetch failure');
      let resolve;
      let reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      state.fetchDeferred.push({ args, resolve, reject });
      state.wire.push({ transport: 'fetch', args });
      return promise;
    }
  };
  const worker = {
    postMessage(message, transfer = []) {
      state.records.push(structuredClone(message, { transfer }).envelope);
    }
  };
  const sandbox = {
    pageWindow, unsafeWindow: pageWindow, window: pageWindow, Request,
    Response, Blob, ReadableStream, ArrayBuffer, Uint8Array, Headers,
    structuredClone, URL, Promise, String, Object, Map, Set,
    Date: class extends Date { static now() { return state.now++; } },
    performance: { now: () => state.monotonic++ },
    crypto: { randomUUID: () => 'tab1-' + ++state.ids },
    location: { href: 'https://chatgpt.com/c/A', origin: 'https://chatgpt.com' },
    console,
    assert: (condition, msg) => assert.ok(condition, msg),
    cloneSafely(original) {
      state.clones++;
      return original?.clone?.() ?? null;
    },
    cancelReadableBodyQuietly: async body => body?.cancel?.(),
    logDiagnostic(level, name, details) { state.logs.push({ level, name, details }); },
    boundedDiagnosticText: text => String(text),
    errorMessage: error => error?.message ?? String(error),
    stockNetworkSafeUrl: url => String(url),
    stockNetworkTraceFetchStart(request, url, stamp) {
      return { sequence: stamp.network_sequence, started_at: stamp.captured_at_mono_ms,
        method: request?.method ?? 'GET', url };
    },
    stockNetworkTraceFetchResponse() {},
    stockNetworkTraceXhrStart(xhr, info, stamp) {
      return { sequence: stamp.network_sequence, started_at: stamp.captured_at_mono_ms,
        method: info.method, url: info.url };
    },
    stockNetworkTraceXhrResponse() {},
    communicationLogFetchRequest: async () => {},
    communicationLogFetchResponse: async () => {},
    communicationLogXhrRequest: async () => {},
    communicationLogXhrResponse: async () => {},
    communicationLogWebSocketSend: async () => {},
    communicationLogWebSocketMessage: async () => {},
    communicationLogRecord: async () => {},
    communicationLogReportFailure() {},
    rememberApiRequestContext() {},
    recordClickDiagnosticNetworkRequest() {},
    agentTerminalObserveStatsRequest() {},
    isGenerationStreamUrl: () => false,
    isConversationResumeUrl: () => false,
    isSteerTurnUrl: () => false,
    agentStopwatchIsInitialConversationUrl: () => false,
    agentFaviconObserveProcessing() {},
    agentStopwatchObserveSteerTurn() {},
    agentStopwatchObserveConversationResponse() {},
    captureGenerationWebSocketFrame(data) { state.lifecycle.push(data); }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext('let stockNetworkSequence = 0; let captureInstalled = false;\n'
    + ingress + '\n' + interceptor + '\n'
    + 'globalThis.api = { cscBindCommWorker, cscBindPluginIngress, installNetworkCapture };',
  context);
  context.api.cscBindCommWorker(worker);
  context.api.cscBindPluginIngress(message => state.plugin.push(message));
  context.api.installNetworkCapture();
  return { state, pageWindow, worker, api: context.api, context };
}

test('#309 overlapping fetch responses preserve request/response identity despite completion inversion', async () => {
  const h = simulatedPage();
  const urlA = 'https://chatgpt.com/backend-api/conversation/A';
  const urlB = 'https://chatgpt.com/backend-api/conversation/B';
  const aPromise = h.pageWindow.fetch(urlA);
  const bPromise = h.pageWindow.fetch(urlB);
  assert.equal(h.state.wire.filter(w => w.transport === 'fetch').length, 2);
  assert.equal(h.state.records.length, 2, 'Both request streams entered Worker first');
  h.state.fetchDeferred[1].resolve(new Response('B-response', {
    headers: { 'content-type': 'text/event-stream' }
  }));
  h.state.fetchDeferred[0].resolve(new Response('A-response', {
    headers: { 'content-type': 'application/json' }
  }));
  const [a, b] = await Promise.all([aPromise, bPromise]);
  assert.equal(await a.text(), 'A-response');
  assert.equal(await b.text(), 'B-response');
  const events = h.state.records;
  assert.deepEqual(events.map(e => e.direction),
    ['request', 'request', 'response', 'response']);
  assert.deepEqual(events.map(e => e.network_sequence), [1, 2, 3, 4]);
  assert.equal(events[2].request_capture_id, events[1].capture_id);
  assert.equal(events[3].request_capture_id, events[0].capture_id);
  assert.equal(events[2].request_url, urlB);
  assert.equal(events[3].request_url, urlA);
  assert.deepEqual(h.state.plugin.map(p => p.envelope.capture_id),
    events.map(e => e.capture_id));
  assert.equal(h.state.clones, 8, 'One plugin and one COMM native clone per Request/Response');
  assert.equal(h.state.wire.length, 2, 'No additional stock fetch requests');
});

test('#309 fetch rejection emits correlated incomplete event and preserves original rejection', async () => {
  const h = simulatedPage();
  const rejected = h.pageWindow.fetch('https://chatgpt.com/fail');
  h.state.fetchDeferred[0].reject(new TypeError('synthetic transport failure'));
  await assert.rejects(rejected, /synthetic transport failure/);
  assert.deepEqual(h.state.records.map(e => e.direction), ['request', 'error']);
  assert.equal(h.state.records[1].request_capture_id,
    h.state.records[0].capture_id);
  assert.equal(h.state.records[1].complete, false);
  assert.equal(h.state.plugin.length, 2);
});

test('#309 XHR captures raw binary and text, original bytes intact with independent plugin', () => {
  const h = simulatedPage();
  const xhr = new h.pageWindow.XMLHttpRequest();
  xhr.open('POST', 'https://chatgpt.com/backend-api/blob');
  xhr.setRequestHeader('Authorization', 'Bearer private');
  const bytes = new Uint8Array([1, 2, 3, 4]);
  xhr.send(bytes.buffer);
  assert.equal(h.state.wire[0].body, bytes.buffer);
  xhr.responseType = 'arraybuffer';
  xhr.response = new Uint8Array([9, 8, 7]).buffer;
  xhr.status = 206;
  xhr.dispatch('loadend');
  assert.deepEqual(h.state.records.map(e => e.direction), ['request', 'response']);
  assert.equal(h.state.records[1].request_capture_id,
    h.state.records[0].capture_id);
  assert.equal(h.state.records[0].headers[0][0].toLowerCase(), 'authorization');
  assert.equal(h.state.records[0].headers[0][1], 'Bearer private');
  assert.deepEqual([...new Uint8Array(h.state.records[1].value)], [9, 8, 7]);
  bytes[0] = 99;
  assert.equal(new Uint8Array(h.state.records[0].value)[0], 1,
    'Worker received independent structured clone');
  assert.equal(h.state.plugin.length, 2);
  assert.equal(new Uint8Array(h.state.plugin[0].source)[0], 1,
    'Plugin snapshot must not alias page-owned request bytes');
  assert.equal(h.state.wire.filter(e => e.transport === 'xhr').length, 1);
});

test('#309 XHR abort/error/timeout never become a successfully complete response', () => {
  for (const reason of ['abort', 'error', 'timeout']) {
    const h = simulatedPage();
    const xhr = new h.pageWindow.XMLHttpRequest();
    xhr.open('GET', 'https://chatgpt.com/backend-api/slow');
    xhr.send();
    xhr.status = 0;
    xhr.responseText = '';
    xhr.dispatch(reason);
    xhr.dispatch('loadend');
    const events = h.state.records;
    assert.equal(events[0].direction, 'request');
    assert.equal(events[1].direction, 'error');
    assert.equal(events[1].event, reason);
    assert.equal(events[1].complete, false);
    assert.equal(events.at(-1).complete, false,
      reason + ' must never indicate complete response');
    assert.ok(events.every(event => event.connection_id === events[0].connection_id));
  }
});

test('#309 WebSocket send and incoming frames use one connection and per-frame clocks', () => {
  const h = simulatedPage();
  const socket = new h.pageWindow.WebSocket('wss://chatgpt.com/ws');
  socket.dispatch('open');
  socket.send('sent');
  socket.dispatch('message', { data: 'received' });
  socket.dispatch('close', { code: 1000, wasClean: true });
  assert.deepEqual(h.state.records.map(e => e.direction),
    ['event', 'outgoing', 'incoming', 'event']);
  const connection = h.state.records[0].connection_id;
  assert.ok(h.state.records.every(event => event.connection_id === connection));
  assert.deepEqual(h.state.records.map(e => e.network_sequence), [2, 3, 4, 5]);
  assert.deepEqual(h.state.wire.map(e => e.data), ['sent']);
  assert.deepEqual(h.state.lifecycle, ['received']);
  assert.deepEqual(h.state.plugin.map(p => p.envelope.capture_id),
    h.state.records.map(e => e.capture_id));
});

test('#309 separate A→B→A requests keep unique monotonic sequence in one page instance', async () => {
  const h = simulatedPage();
  for (const topic of ['A', 'B', 'A']) {
    h.context.location.href = 'https://chatgpt.com/c/' + topic;
    const p = h.pageWindow.fetch('https://chatgpt.com/backend-api/c/' + topic);
    h.state.fetchDeferred.at(-1).resolve(new Response(topic));
    await p;
  }
  const ids = h.state.records.map(e => e.capture_id);
  const sequence = h.state.records.map(e => e.network_sequence);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(sequence, [1, 2, 3, 4, 5, 6]);
  assert.equal(h.state.records[4].request_url,
    h.state.records[0].request_url);
  assert.equal(h.state.records[4].request_capture_id, null);
});

test('#309 Worker unbound leaves main-thread plugin flow independent', async () => {
  const h = simulatedPage();
  h.api.cscBindCommWorker(null);
  const p = h.pageWindow.fetch('https://chatgpt.com/backend-api/legacy');
  h.state.fetchDeferred[0].resolve(new Response('legacy'));
  await p;
  assert.equal(h.state.records.length, 0);
  assert.equal(h.state.plugin.length, 2);
  assert.equal(h.state.wire.length, 1);
});

test('#309 opaque response explicitly declares absent browser-accessible body', async () => {
  const h = simulatedPage();
  const p = h.pageWindow.fetch('https://elsewhere.test/opaque');
  const opaque = { headers: new Headers(), type: 'opaque', body: null,
    url: '', status: 0, redirected: false, ok: false,
    clone() { return { body: null }; } };
  h.state.fetchDeferred[0].resolve(opaque);
  assert.equal(await p, opaque);
  assert.equal(h.state.records[1].body_available, false);
  assert.equal(h.state.records[1].body_state, 'unavailable');
  assert.equal(h.state.records[1].response_type, 'opaque');
});

test('#309 synchronously throwing stock fetch still records a correlated failure', () => {
  const h = simulatedPage({ synchronousFetchFailure: true });
  assert.throws(() => h.pageWindow.fetch('https://chatgpt.com/backend-api/sync'),
    /Synchronous stock fetch failure/);
  assert.equal(h.state.records.length, 2);
  assert.equal(h.state.records[1].direction, 'error');
  assert.equal(h.state.records[1].request_capture_id,
    h.state.records[0].capture_id);
  assert.equal(h.state.records[1].complete, false);
  assert.equal(h.state.plugin.length, 2);
});

test('#309 rejected WebSocket send retains attempted data plus explicit failure provenance', () => {
  const h = simulatedPage({ nativeSendFailure: true });
  const s = new h.pageWindow.WebSocket('wss://chatgpt.com/ws');
  assert.throws(() => s.send('not accepted'), /not open/);
  const events = h.state.records;
  assert.equal(events.length, 2);
  assert.equal(events[0].direction, 'outgoing');
  assert.equal(events[0].value, 'not accepted');
  assert.equal(events[1].direction, 'error');
  assert.equal(events[1].event, 'send-rejected');
  assert.equal(events[1].complete, false);
  assert.equal(events[1].parent_capture_id, events[0].capture_id);
  assert.equal(events[1].request_capture_id, 'tab1-1:1');
  assert.equal(h.state.wire.length, 0);
});

test('#309 failed WebSocket construction is published without creating a phantom connection', () => {
  const h = simulatedPage({ socketConstructFailure: true });
  assert.throws(() => new h.pageWindow.WebSocket('invalid'), /Invalid synthetic WS URL/);
  assert.equal(h.state.sockets.length, 0);
  assert.equal(h.state.records.length, 1);
  assert.equal(h.state.records[0].event, 'construct-failed');
  assert.equal(h.state.records[0].complete, false);
});
