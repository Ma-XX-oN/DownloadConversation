import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(path.join(root,
  'src/userscript/02-network-communication/04-csc-comm-worker-processing.js'), 'utf8') +
  readFileSync(path.join(root,
    'src/userscript/02-network-communication/04-csc-comm-worker-processing-part2.js'), 'utf8') +
  readFileSync(path.join(root,
    'src/userscript/02-network-communication/04-csc-comm-worker-processing-part3.js'), 'utf8');
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
  return { api, frames, record, status, provision, messages, dispatch, writes, waitFor };
}

test('#311 manifest ownership and Worker source stay isolated from page ingress', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'src/userscript-manifest.json')));
  const files = manifest.modules.flatMap(module => module.files);
  const p = 'src/userscript/02-network-communication/04-csc-comm-worker-processing.js';
  assert.equal(files.filter(name => name === p).length, 1);
  assert.ok(files.indexOf(p) > files.indexOf(
    'src/userscript/02-network-communication/03-csc-canonical-ingress.js'));
  const part1 = readFileSync(path.join(root,
    'src/userscript/02-network-communication/04-csc-comm-worker-processing.js'), 'utf8');
  const part2 = readFileSync(path.join(root,
    'src/userscript/02-network-communication/04-csc-comm-worker-processing-part2.js'), 'utf8');
  const part3 = readFileSync(path.join(root,
    'src/userscript/02-network-communication/04-csc-comm-worker-processing-part3.js'), 'utf8');
  assert.ok([part1, part2, part3].every(x => x.split('\n').length < 500));
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
  assert.equal(h.frames().length, 1);
  assert.equal(h.frames()[0].kind, 'csc-comm-selection');
  assert.equal(h.frames()[0].status, 'unselected');
  assert.equal(h.frames()[0].body_captured, false);
  h.dispatch({ type: 'csc-comm-configure', options: policy({ binary: true }) });
  const enabled = await h.record(input({ capture_id: 'synthetic:binary-on',
    body_type: 'application/octet-stream', value: bytes.buffer }));
  assert.equal(enabled.status, 'completed');
  assert.equal(enabled.source_bytes, bytes.length);
  const frames = h.frames();
  assert.equal(frames.find(x => x.kind === 'csc-comm-start').binary_encoding,
    'base64');
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
    capture_id: 'synthetic:invalid', url: 'http://['
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


test('#313 actual token/key message is imported, used once, then released', async () => {
  const h = harness();
  const token = 'synthetic-session-311-token-1';
  const key = new Uint8Array(KEY);
  h.dispatch({ type: 'dc-hmac-key-v2', token, key_bytes: key });
  await h.waitFor(() => h.messages.some(x => x.type === 'csc-comm-key-ready' &&
    x.token === token));
  assert.deepEqual([...key], Array(32).fill(0), 'Sensitive provision bytes zeroed');
  const first = await h.record(input({
    capture_id: 'synthetic:token-one', hmac_token: token,
    value: '{"token":"Aé界𐐀"}'
  }));
  assert.equal(first.status, 'completed');
  const output = Buffer.concat(h.writes).toString('utf8');
  assert.ok(!output.includes('Aé界𐐀'));
  assert.ok(!output.includes(token), 'Private admission token must not be logged');
  const reuse = await h.record(input({
    capture_id: 'synthetic:token-replay', hmac_token: token
  }));
  assert.equal(reuse.status, 'failed', 'Token must not authorize a second capture');
  assert.equal(reuse.reason, 'csc-key-token-unavailable');
});


test('Worker reaches a rejecting sink after valid V2 key admission', async () => {
  const listeners = [];
  const statuses = [];
  let writeAttempts = 0;
  const sandbox = vm.createContext({
    crypto: webcrypto, TextEncoder, TextDecoder, URL, Uint8Array, ArrayBuffer,
    DataView, Map, Set, atob, btoa, Object, String, Number, Promise, Error
  });
  vm.runInContext(code + '\nglobalThis.workerFactory = cscCommWorkerProcessing;', sandbox);
  sandbox.workerFactory({
    addEventListener(type, cb) { listeners.push(cb); },
    postMessage(message) { statuses.push(message); }
  }, { async write() {
    writeAttempts += 1;
    throw new Error('PRIVATE RAW TOKEN');
  } });
  listeners[0]({ data: {
    type: 'csc-comm-provision', key_bytes: new Uint8Array(KEY),
    redaction_scope: SCOPE, redaction_key_generation: SCOPE
  } });
  for (let i = 0; i < 100 && !statuses.some(x => x.type === 'csc-comm-key-ready'); i++) {
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.ok(statuses.some(x => x.type === 'csc-comm-key-ready'));
  listeners[0]({ data: { type: 'csc-comm-capture',
    envelope: input({ capture_id: 'synthetic:writer-fail' }) } });
  for (let i = 0; i < 100 && !statuses.some(x => x.type === 'csc-comm-status'); i++) {
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  const failure = statuses.find(x => x.type === 'csc-comm-status');
  assert.ok(writeAttempts >= 2, 'Start write and failed terminal write were attempted');
  assert.equal(failure.status, 'failed');
  assert.equal(failure.reason, 'csc-processing-error');
  assert.equal(JSON.stringify(statuses).includes('PRIVATE RAW TOKEN'), false);
});

test('missing key has a separate explicit failure path', async () => {
  const h = harness();
  const result = await h.record(input({ capture_id: 'synthetic:key-missing' }));
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'csc-key-scope-mismatch');
});

test('WebSocket outbound binary body without MIME is selected only with binary option', async () => {
  const h = harness();
  await h.provision();
  const source = Uint8Array.from({ length: 524299 }, (_, i) => (i * 31 + 3) & 255);
  const actual = source.buffer;
  const event = input({ capture_id: 'synthetic:ws-binary-off',
    transport: 'websocket', direction: 'outgoing',
    url: 'wss://chatgpt.com/backend-api/ws', body_type: 'object',
    value: actual, headers: []
  });
  const off = await h.record(event);
  assert.equal(off.status, 'unselected');
  h.dispatch({ type: 'csc-comm-configure', options: policy({ binary: true }) });
  const on = await h.record({ ...event, capture_id: 'synthetic:ws-binary-on' });
  assert.equal(on.status, 'completed');
  assert.equal(on.source_bytes, source.byteLength);
  const frames = h.frames().filter(x => x.capture_id === 'synthetic:ws-binary-on');
  const restored = Buffer.concat(frames.filter(x => x.kind === 'csc-comm-body')
    .map(x => Buffer.from(x.data, 'base64')));
  assert.deepEqual(restored, Buffer.from(source));
  assert.equal(source[0], 3, 'Page-owned buffer was not detached or mutated');
  h.dispatch({ type: 'csc-comm-configure', options: policy({ all: true }) });
  assert.equal((await h.record({ ...event, capture_id: 'synthetic:ws-binary-master' }))
    .status, 'completed');
});

test('WebSocket incoming Blob streams preserve byte values across chunks', async () => {
  const h = harness();
  await h.provision();
  h.dispatch({ type: 'csc-comm-configure', options: policy({ binary: true }) });
  const bytes = Uint8Array.from({ length: 131075 }, (_, i) => i & 255);
  const event = input({ capture_id: 'synthetic:ws-blob', transport: 'websocket',
    direction: 'incoming', body_type: 'object',
    url: 'wss://chatgpt.com/backend-api/ws', value: new Blob([bytes]),
    headers: []
  });
  const result = await h.record(event);
  assert.equal(result.status, 'completed');
  const restored = Buffer.concat(h.frames().filter(x => x.kind === 'csc-comm-body')
    .map(x => Buffer.from(x.data, 'base64')));
  assert.deepEqual(restored, Buffer.from(bytes));
});

test('already parsed XHR JSON is sanitized without inventing wire byte totals', async () => {
  const h = harness();
  await h.provision();
  const parsed = {
    metadata: { count: 3, valid: true, list: ['first', 'second', null] },
    authorization: 'Aé界𐐀'
  };
  const result = await h.record(input({
    capture_id: 'synthetic:xhr-parsed-json', transport: 'xhr',
    direction: 'response', body_type: 'json', response_type: 'json',
    value: parsed, headers: 'content-type: application/json\r\n'
  }));
  assert.equal(result.status, 'completed');
  assert.equal(result.source_bytes, null);
  assert.ok(result.derived_json_utf8_bytes > 0);
  const frames = h.frames();
  const start = frames.find(x => x.kind === 'csc-comm-start');
  assert.equal(start.source_byte_provenance, 'unavailable-parsed-xhr-json');
  const end = frames.find(x => x.kind === 'csc-comm-end');
  assert.equal(end.source_bytes, null);
  assert.ok(end.derived_json_utf8_bytes > 0);
  const stored = frames.filter(x => x.kind === 'csc-comm-body').map(x => x.data).join('');
  const restored = JSON.parse(stored);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.metadata)), parsed.metadata);
  assert.match(restored.authorization, /^\[[0-9a-f]{32}\/O\//);
  assert.ok(!Buffer.concat(h.writes).includes(Buffer.from('Aé界𐐀')));
});

test('parsed XHR cyclic JSON fails closed without leaking value', async () => {
  const h = harness();
  await h.provision();
  const cyclic = { ordinary: 'hello' };
  cyclic.self = cyclic;
  const result = await h.record(input({
    capture_id: 'synthetic:xhr-cyclic', transport: 'xhr',
    response_type: 'json', body_type: 'json', value: cyclic
  }));
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'csc-invalid-parsed-json');
  assert.equal(h.frames().at(-1).source_complete, false);
});

test('browser probe is one opt-in exact-source Worker row with synthetic payload only', () => {
  const file = 'src/userscript/06-image-export-tests/10-csc-comm-worker-processing-probe.js';
  const source = readFileSync(path.join(root, file), 'utf8');
  const manifest = JSON.parse(readFileSync(path.join(root, 'src/userscript-manifest.json')));
  const registry = readFileSync(path.join(root,
    'src/userscript/06-image-export-tests/04-tests-modal-transition.js'), 'utf8');
  const files = manifest.modules.flatMap(module => module.files);
  assert.equal(files.filter(path => path === file).length, 1);
  assert.equal(registry.split("['CSC COMM Worker processor', testCscCommWorkerProcessing]")
    .length - 1, 1);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest\s*\(|showDirectoryPicker\s*\(/);
  assert.match(source, /'dc-hmac-key-v2'/);
  assert.match(source, /\[keyBytes\.buffer\]/);
  assert.match(source, /}, \[body\]\);/);
  assert.match(source, /cscCommProcessingWorkerSource\(\)/);
  const readiness = readFileSync(path.join(root,
    'src/userscript/06-image-export-tests/06-agent-plugin-readiness.js'), 'utf8');
  assert.match(readiness, /name !== 'CSC COMM Worker processor'/);
  assert.match(source, /response|original\.arrayBuffer\(\)/);
  assert.doesNotThrow(() => new Function(source));
});

test('fetch request and XHR outgoing textual JSON preserve direction and sequence', async () => {
  const h = harness();
  await h.provision();
  for (const [transport, direction] of [['fetch', 'request'], ['xhr', 'request']]) {
    const value = await h.record(input({
      capture_id: 'synthetic:' + transport + '-request',
      transport, direction, value: '{"message":"hello"}'
    }));
    assert.equal(value.status, 'completed');
  }
  const starts = h.frames().filter(x => x.kind === 'csc-comm-start');
  assert.deepEqual(starts.map(x => x.transport), ['fetch', 'xhr']);
  assert.deepEqual(starts.map(x => x.direction), ['request', 'request']);
  assert.deepEqual(starts.map(x => x.network_sequence), [1, 1]);
});

test('cross-origin opt-in selects accessible bytes while inaccessible remains omitted', async () => {
  const h = harness();
  await h.provision();
  h.dispatch({ type: 'csc-comm-configure',
    options: policy({ cross_origin: true }) });
  const found = await h.record(input({
    capture_id: 'synthetic:cross-selected', url: 'https://other.example.test/data',
    value: '{"message":"hello"}'
  }));
  assert.equal(found.status, 'completed');
  assert.match(h.frames()[0].url, /^https:\/\/other\.example\.test\/data$/);
  const opaque = await h.record(input({
    capture_id: 'synthetic:opaque-remains',
    url: 'https://other.example.test/opaque', body_state: 'unavailable',
    body_available: false, value: null
  }));
  assert.equal(opaque.status, 'inaccessible');
});

test('legacy page-side HMAC key cannot be written as a secret in a COMM body', async () => {
  const h = harness();
  await h.provision();
  const value = await h.record(input({
    capture_id: 'synthetic:unsupported-long-secret',
    value: '{"Authorization":"' + 'private-value-'.repeat(200) + '"}'
  }));
  assert.equal(value.status, 'failed');
  assert.equal(value.reason, 'csc-unsupported-sensitive-value');
  assert.ok(!Buffer.concat(h.writes).includes(Buffer.from('private-value-')));
});

test('browser probe asserts stream ownership before asynchronous processing', () => {
  const source = readFileSync(path.join(root,
    'src/userscript/06-image-export-tests/10-csc-comm-worker-processing-probe.js'),
  'utf8');
  const transferred = source.indexOf('}, [body]);');
  const ownership = source.indexOf(
    "'Transferred COMM stream was not locked immediately after transfer'");
  const completion = source.indexOf('const outcome = await waitFor', transferred);
  assert.ok(transferred >= 0 && ownership > transferred &&
    completion > ownership, 'Transfer ownership must be checked synchronously');
  assert.match(source, /const successes = \[\];/);
  assert.match(source, /successes\.push\(name \+ ' Worker/);
  assert.match(source, /if \(failures\.length\)/);
  assert.match(source, /return successes\.join\('\s*\|\s*'\);/);
  assert.doesNotMatch(source, /return name \+ ' Worker/);
});

test('native ReadableStream can unlock after its transferred bytes are consumed',
  async () => {
    const { MessageChannel } = await import('node:worker_threads');
    const { port1, port2 } = new MessageChannel();
    const stock = new Response(new Uint8Array(1024));
    const body = stock.clone().body;
    const delivered = new Promise((resolve, reject) => {
      port2.once('message', async stream => {
        try {
          let count = 0;
          for await (const chunk of stream) count += chunk.byteLength;
          resolve(count);
        } catch (error) { reject(error); }
      });
    });
    try {
      assert.equal(body.locked, false);
      port1.postMessage(body, [body]);
      assert.equal(body.locked, true, 'Transfer must lock synchronously');
      assert.equal(await delivered, 1024);
      for (let i = 0; i < 100 && body.locked; i += 1)
        await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(body.locked, false, 'Drained transfer may be unlocked');
      assert.equal((await stock.arrayBuffer()).byteLength, 1024);
    } finally {
      port1.close();
      port2.close();
    }
  });
