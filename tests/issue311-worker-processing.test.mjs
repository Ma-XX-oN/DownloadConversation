import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(path.join(root,
  'src/userscript/02-network-communication/04-csc-comm-worker-processing.js'), 'utf8');
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const SCOPE = '00112233445566778899aabbccddeeff';
const policy = (extra = {}) => ({
  mode: 'replay-essentials', origin: 'https://chatgpt.com',
  binary: false, cross_origin: false, auth_headers: false, all: false, ...extra
});
const input = (extra = {}) => ({
  capture_id: 'synthetic:1', page_instance_id: 'page-1',
  connection_id: 'connection-1', network_sequence: 1, capture_order: 1,
  captured_at_epoch_ms: 10000, captured_at_mono_ms: 17, clock_domain: 'page-1',
  transport: 'fetch', direction: 'response', url: 'https://chatgpt.com/backend-api/test',
  body_state: 'cloneable-value', body_type: 'application/json',
  headers: [['content-type', 'application/json']],
  redaction_format: 'dc-secret-marker/2', redaction_scope: SCOPE,
  redaction_key_generation: SCOPE, redaction_key_epoch: 1,
  redaction_key_storage: 'tampermonkey-script-installation',
  complete: true, value: '{}', ...extra
});

function harness() {
  const messages = [];
  const writes = [];
  const listeners = [];
  const scope = {
    postMessage: value => messages.push(value),
    addEventListener(name, cb) { assert.equal(name, 'message'); listeners.push(cb); }
  };
  const sandbox = vm.createContext({
    crypto: webcrypto, TextEncoder, TextDecoder, URL, Uint8Array, ArrayBuffer,
    DataView, Map, Set, atob, btoa, Object, String, Number, Promise, Error
  });
  vm.runInContext(code + '\nglobalThis.workerFactory = cscCommWorkerProcessing;', sandbox);
  const api = sandbox.workerFactory(scope, {
    async write(bytes) { writes.push(Buffer.from(bytes)); }
  });
  const dispatch = value => listeners[0]({ data: value });
  const frames = () => Buffer.concat(writes).toString('utf8').trim().split('\n')
    .filter(Boolean).map(line => JSON.parse(line));
  const status = id => messages.find(message => message.type === 'csc-comm-status'
    && message.capture_id === id);
  async function waitFor(match, limitMs = 15000) {
    const start = Date.now();
    while (!match()) {
      assert.ok(Date.now() - start < limitMs, 'Worker test timed out');
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  }
  async function provision() {
    dispatch({ type: 'csc-comm-provision',
      key_bytes: new Uint8Array(KEY), redaction_scope: SCOPE,
      redaction_key_generation: SCOPE });
    await waitFor(() => messages.some(x => x.type === 'csc-comm-key-ready'));
  }
  async function record(event) {
    dispatch({ type: 'csc-comm-capture', envelope: event });
    await waitFor(() => Boolean(status(event.capture_id)));
    return status(event.capture_id);
  }
  return { api, frames, record, status, provision, messages, dispatch, writes };
}

test('#311 manifest ownership and Worker source stay isolated from page ingress', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'src/userscript-manifest.json')));
  const files = manifest.modules.flatMap(module => module.files);
  const p = 'src/userscript/02-network-communication/04-csc-comm-worker-processing.js';
  assert.equal(files.filter(name => name === p).length, 1);
  assert.ok(files.indexOf(p) > files.indexOf(
    'src/userscript/02-network-communication/03-csc-canonical-ingress.js'));
  assert.ok(code.split('\n').length < 500);
  assert.doesNotMatch(code, /\bdocument\.\w+|\bwindow\.\w+|\bfetch\s*\(/);
  assert.match(code, /cscCommWriteChunk/);
});

test('V2 marker uses V1 digest grammar and does not emit original Unicode secret', async () => {
  const h = harness();
  await h.provision();
  const marker = await h.api.marker('Aé界𐐀', 'json.string', true);
  assert.equal(marker, '[189db1163cef21040f2a9e9b14e41c84/O/' +
    '9d3f1627b52faacb890d379407303a69afe844186da05371/1234]');
  assert.equal(await h.api.marker('Aé界𐐀', 'json.string', true), marker);
  await assert.rejects(() => h.api.marker('x'.repeat(129), 'json.string', true),
    /csc-unsupported-sensitive-value/);
});

test('JSON crossing every byte and Unicode boundaries is framed without raw secrets', async () => {
  const h = harness();
  await h.provision();
  const raw = '{"authorization":"Aé界𐐀","ordinary":"hello 😀"}';
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    }
  });
  const result = await h.record(input({
    body_state: 'stream-transferred', body: stream, value: null,
    headers: [['Content-Type', 'application/json'], ['Authorization', 'not-recorded']]
  }));
  assert.equal(result.status, 'completed');
  assert.equal(result.source_bytes, bytes.length);
  assert.equal(result.durable, false, '#317 has not acknowledged disk write');
  const frames = h.frames();
  assert.equal(frames[0].headers.length, 1);
  assert.deepEqual(frames[0].omitted_headers, ['authorization']);
  const body = frames.filter(x => x.kind === 'csc-comm-body').map(x => x.data).join('');
  assert.equal(JSON.parse(body).ordinary, 'hello 😀');
  assert.match(JSON.parse(body).authorization, /^\[[0-9a-f]{32}\/O\//);
  assert.ok(!Buffer.concat(h.writes).includes(Buffer.from('Aé界𐐀')));
});

test('binary option preserves bytes across multiple bounded frames', async () => {
  const h = harness();
  await h.provision();
  const bytes = Uint8Array.from({ length: 524299 }, (_, i) => (i * 29 + 7) & 255);
  const disabled = await h.record(input({ capture_id: 'synthetic:binary-off',
    body_type: 'application/octet-stream', value: bytes.buffer }));
  assert.equal(disabled.status, 'unselected');
  assert.equal(h.frames().length, 0);
  h.dispatch({ type: 'csc-comm-configure', options: policy({ binary: true }) });
  const enabled = await h.record(input({ capture_id: 'synthetic:binary-on',
    body_type: 'application/octet-stream', value: bytes.buffer }));
  assert.equal(enabled.status, 'completed');
  assert.equal(enabled.source_bytes, bytes.length);
  const frames = h.frames();
  assert.equal(frames[0].binary_encoding, 'base64');
  const decoded = Buffer.concat(frames.filter(x => x.kind === 'csc-comm-body')
    .map(x => Buffer.from(x.data, 'base64')));
  assert.deepEqual(decoded, Buffer.from(bytes));
});

test('mode and origin selection exposes unsupported, inaccessible and rejected states', async () => {
  const h = harness();
  await h.provision();
  assert.equal((await h.record(input({
    capture_id: 'synthetic:cross', url: 'https://other.example.test/path'
  }))).status, 'unselected');
  assert.equal((await h.record(input({
    capture_id: 'synthetic:opaque', body_available: false,
    body_state: 'unavailable', value: null
  }))).status, 'inaccessible');
  h.dispatch({ type: 'csc-comm-configure', options: policy({ mode: 'everything' }) });
  assert.equal((await h.record(input({
    capture_id: 'synthetic:text', body_type: 'text/plain', value: 'unknown plaintext'
  }))).status, 'unsupported');
  assert.equal((await h.record(input({
    capture_id: 'synthetic:invalid', url: '%'
  }))).status, 'rejected');
});

test('fail closed on scope, epoch, unsupported sensitive values and incomplete streams', async () => {
  const h = harness();
  await h.provision();
  for (const [id, mutation, reason] of [
    ['scope', { redaction_scope: 'ffeeddccbbaa99887766554433221100' }, 'csc-key-scope-mismatch'],
    ['epoch', { redaction_key_epoch: 0 }, 'csc-key-scope-mismatch'],
    ['secret', { value: '{"token":"' + 'x'.repeat(129) + '"}' }, 'csc-unsupported-sensitive-value'],
    ['abort', { complete: false }, 'csc-source-incomplete']
  ]) {
    const value = await h.record(input({ ...mutation, capture_id: 'synthetic:' + id }));
    assert.equal(value.status, 'failed', id);
    assert.equal(value.reason, reason, id);
    assert.equal(h.frames().at(-1).status, 'failed');
    assert.equal(h.frames().at(-1).source_complete, false);
  }
  assert.ok(!Buffer.concat(h.writes).includes(Buffer.from('x'.repeat(129))));
});

test('SSE one event split into small chunks retains framing and marker substitution', async () => {
  const h = harness();
  await h.provision();
  const text = 'event: message\r\ndata: {"token":"Aé界𐐀"}\r\n\r\n';
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 2) {
        controller.enqueue(bytes.subarray(i, i + 2));
      }
      controller.close();
    }
  });
  const result = await h.record(input({ capture_id: 'synthetic:sse',
    body_type: 'text/event-stream', body_state: 'stream-transferred',
    value: null, body: stream
  }));
  assert.equal(result.status, 'completed');
  const output = h.frames().filter(x => x.kind === 'csc-comm-body').map(x => x.data).join('');
  assert.match(output, /^event: message\r\ndata: \{"token":"\[[0-9a-f]/);
  assert.ok(output.endsWith('\r\n\r\n'));
});

test('auth header opt-in never writes plaintext, and unknown content fails closed', async () => {
  const h = harness();
  await h.provision();
  h.dispatch({ type: 'csc-comm-configure', options: policy({ auth_headers: true }) });
  const result = await h.record(input({ capture_id: 'synthetic:auth',
    headers: [['Authorization', 'synthetic-auth-credential'], ['X-Unknown', 'opaque']]
  }));
  assert.equal(result.status, 'completed');
  const start = h.frames()[0];
  assert.match(start.headers[0][1], /^\[[0-9a-f]{32}\/O\//);
  assert.deepEqual(start.omitted_headers, ['x-unknown']);
  assert.ok(!Buffer.concat(h.writes).includes(Buffer.from('synthetic-auth-credential')));
});

test('Worker has no fallback to unsanitized page archive when writer rejects', async () => {
  const listeners = [];
  const statuses = [];
  const sandbox = vm.createContext({
    crypto: webcrypto, TextEncoder, TextDecoder, URL, Uint8Array, ArrayBuffer,
    DataView, Map, Set, atob, btoa, Object, String, Number, Promise, Error
  });
  vm.runInContext(code + '\nglobalThis.workerFactory = cscCommWorkerProcessing;', sandbox);
  const api = sandbox.workerFactory({
    addEventListener(type, cb) { listeners.push(cb); },
    postMessage(message) { statuses.push(message); }
  }, { async write() { throw new Error('PRIVATE RAW TOKEN'); } });
  await api.enqueue(input({ capture_id: 'synthetic:writer-fail' }));
  for (let i = 0; i < 100 && statuses.length === 0; i++) {
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  const failure = statuses.find(x => x.type === 'csc-comm-status');
  assert.ok(failure);
  assert.equal(failure.status, 'failed');
  assert.equal(JSON.stringify(statuses).includes('PRIVATE RAW TOKEN'), false);
});
