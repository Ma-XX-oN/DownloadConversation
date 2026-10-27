import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = [
  '../src/userscript/03-agent-lifecycle/08-generation-request.js',
  '../src/userscript/03-agent-lifecycle/09-network-install-api-transition.js'
].map(p => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');

function initialize(page, extra = {}) {
  const captures = [];
  const legacy = [];
  let sequence = 0;
  const context = {
    window: page, captureInstalled: false,
    cscCommWorker: null,
    cscCaptureNow(transport, direction, connectionId, parent) {
      return { transport, direction,
        connection_id: connectionId ?? 'one',
        network_sequence: ++sequence,
        capture_id: 'capture-' + sequence,
        request_capture_id: parent?.capture_id ?? null };
    },
    cscRawHeaderEntries: headers => Object.entries(headers),
    cscPublishValue: (stamp, metadata, value) =>
      captures.push({ stamp, metadata, value }),
    stockNetworkTraceXhrStart: (_xhr, _info, stamp) =>
      ({ sequence: stamp.network_sequence }),
    stockNetworkTraceXhrResponse: () => {},
    communicationLogXhrRequest: async () => { legacy.push('xhr-request'); },
    communicationLogXhrResponse: async () => { legacy.push('xhr-response'); },
    communicationLogWebSocketSend: async () => { legacy.push('ws-send'); },
    communicationLogWebSocketMessage: async () => { legacy.push('ws-message'); },
    communicationLogRecord: async type => { legacy.push(type); },
    communicationLogReportFailure: () => {},
    rememberApiRequestContext: () => {},
    recordClickDiagnosticNetworkRequest: () => {},
    cscXhrBodySnapshot: xhr => ({
      value: xhr.responseText, body_type: 'text', body_available: true
    }),
    cscDispatchSocketSend: (native, receiver, data) => native.call(receiver, data),
    stockNetworkSafeUrl: value => value,
    captureGenerationWebSocketFrame: () => {},
    ...extra
  };
  const install = new Function('context',
    'with(context) {\n' + source + '\nreturn installNetworkCapture;\n}'
  )(context);
  install();
  return { captures, legacy, context };
}

test('XHR retains native return, original request order and both capture records', async () => {
  class XHR {
    constructor() {
      this.listeners = {};
      this.responseText = 'response'; this.responseType = '';
      this.responseURL = 'https://chatgpt.com/api'; this.status = 200;
    }
    open() {}
    setRequestHeader() {}
    addEventListener(name, callback) {
      (this.listeners[name] ??= []).push(callback);
    }
    send() {
      for (const callback of this.listeners.loadend ?? []) callback();
      return 'native-send-result';
    }
    getAllResponseHeaders() { return 'content-type: text/plain'; }
  }
  const page = { XMLHttpRequest: XHR };
  const f = initialize(page);
  const xhr = new page.XMLHttpRequest();
  xhr.open('POST', 'https://chatgpt.com/api');
  assert.equal(xhr.send('request'), 'native-send-result');
  await Promise.resolve();
  assert.deepEqual(f.captures.map(c => c.stamp.direction),
    ['request', 'response']);
  assert.equal(f.captures[1].stamp.request_capture_id,
    f.captures[0].stamp.capture_id);
  assert.deepEqual(f.legacy, ['xhr-request', 'xhr-response']);
});

test('WebSocket incoming and outgoing retain message identity', () => {
  class WS {
    constructor(url) { this.url = url; this.listeners = {}; this.sent = []; }
    send(data) { this.sent.push(data); }
    addEventListener(name, callback) {
      (this.listeners[name] ??= []).push(callback);
    }
  }
  const page = { WebSocket: WS };
  const f = initialize(page, { cscCommWorker: { postMessage: () => {} } });
  const socket = new page.WebSocket('wss://chatgpt.com/socket');
  socket.send('outgoing');
  socket.listeners.message[0]({ data: 'incoming' });
  assert.deepEqual(socket.sent, ['outgoing']);
  assert.deepEqual(f.captures.map(c => c.stamp.direction),
    ['outgoing', 'incoming']);
  assert.equal(f.captures[1].stamp.connection_id,
    f.captures[0].stamp.connection_id);
  assert.equal(f.legacy.length, 0);
});
