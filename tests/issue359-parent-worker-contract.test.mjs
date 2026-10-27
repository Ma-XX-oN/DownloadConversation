import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';

const files = [
  '04-csc-comm-worker-processing.js',
  '04-csc-comm-worker-processing-part2.js',
  '04-csc-comm-worker-processing-part3.js'
];
const source = files.map(file => readFileSync(
  new URL('../src/userscript/02-network-communication/' + file, import.meta.url),
  'utf8'
)).join('\n');
const create = new Function(source + '\nreturn cscCommWorkerProcessing;')();

function harness() {
  const replies = [];
  const frames = [];
  const listeners = [];
  create({
    addEventListener: (kind, listener) => {
      assert.equal(kind, 'message');
      listeners.push(listener);
    },
    postMessage: reply => replies.push(reply)
  }, {
    write: async bytes => frames.push(JSON.parse(new TextDecoder().decode(bytes)))
  });
  assert.equal(listeners.length, 1);
  return {
    replies, frames,
    send: value => listeners[0]({ data: value }),
    async settle() {
      for (let i = 0; i < 50; i++) await new Promise(setImmediate);
    }
  };
}

const options = Object.freeze({
  mode: 'replay-essentials',
  origin: 'https://chatgpt.com',
  binary: false,
  cross_origin: false,
  auth_headers: false,
  all: false
});

test('configuration acknowledges only the correlated schema and request', async () => {
  const h = harness();
  h.send({ type: 'csc-comm-configure', schema: 1,
    request_id: 'csc-options-1', options });
  h.send({ type: 'csc-comm-configure', schema: 2,
    request_id: 'csc-options-2', options });
  h.send({ type: 'csc-comm-configure', schema: 1,
    request_id: 'INVALID', options });
  assert.deepEqual(h.replies, [
    { type: 'csc-comm-configured', schema: 1,
      request_id: 'csc-options-1' },
    { type: 'csc-comm-configuration-failed', schema: 1,
      request_id: 'csc-options-2' },
    { type: 'csc-comm-configuration-failed', schema: 1,
      request_id: 'INVALID' }
  ]);
});

test('canonical cycle retains key_restart through the Worker queue', async () => {
  const h = harness();
  const occurred_at_ms = Date.parse('2026-10-27T15:24:00.000Z');
  const key_restart = new Date(occurred_at_ms).toISOString();
  const event = { type: 'hmac-key-cycle',
    id: 'hmac-key-cycle:' + key_restart,
    key_restart, epoch: 3, occurred_at_ms, reason: 'manual' };
  h.send({ type: 'csc-comm-key-cycle', event });
  await h.settle();
  assert.equal(h.frames.length, 1);
  assert.equal(h.frames[0].key_restart, key_restart);
  assert.equal(h.frames[0].id, event.id);
  assert.equal(h.frames[0].generation, undefined);
  assert.equal(h.replies.at(-1).durable, false);
});

test('retired or malformed cycle identifiers reject without durable claims', async () => {
  const h = harness();
  const occurred_at_ms = Date.parse('2026-10-27T15:24:00.000Z');
  const key_restart = new Date(occurred_at_ms).toISOString();
  const good = { type: 'hmac-key-cycle',
    id: 'hmac-key-cycle:' + key_restart,
    key_restart, epoch: 3, occurred_at_ms, reason: 'manual' };
  const bad = [
    { ...good, id: 'hmac-key-cycle:3:deadbeef' },
    { ...good, generation: 'legacy' },
    { ...good, epoch: 0 },
    { ...good, key_restart: '2026-02-31T00:00:00.000Z' },
    { ...good, occurred_at_ms: Number.MAX_SAFE_INTEGER },
    { ...good, reason: 'unknown' }
  ];
  for (const event of bad) h.send({ type: 'csc-comm-key-cycle', event });
  await h.settle();
  assert.equal(h.frames.length, 0);
  assert.equal(h.replies.length, bad.length);
  assert.ok(h.replies.every(reply =>
    reply.status === 'rejected' && reply.durable === false));
});

test('canonical admission emits matching start and completion, not durability', async () => {
  const h = harness();
  const token = 'csc-test-token-0001';
  const key_bytes = new Uint8Array(32);
  webcrypto.getRandomValues(key_bytes);
  h.send({ type: 'dc-hmac-key-v2', token, key_bytes });
  await h.settle();
  const key_restart = '2026-10-27T15:24:00.000Z';
  h.send({ type: 'csc-comm-capture', envelope: {
    capture_id: 'capture-1', transport: 'fetch', direction: 'response',
    url: 'https://chatgpt.com/backend-api/conversation',
    body_available: true, body_type: 'application/json',
    value: '{"message":"hello"}', complete: true,
    network_sequence: 1, capture_order: 1,
    captured_at_epoch_ms: 1, captured_at_mono_ms: 1,
    hmac_token: token, key_restart, redaction_key_epoch: 1,
    redaction_key_storage: 'chatgpt-origin-indexeddb',
    redaction_format: 'dc-secret-marker/2'
  } });
  await h.settle();
  assert.deepEqual(h.frames.map(frame => frame.kind),
    ['csc-comm-start', 'csc-comm-body', 'csc-comm-end']);
  assert.equal(h.frames[0].key_restart, key_restart);
  const status = h.replies.find(reply => reply.type === 'csc-comm-status');
  assert.equal(status.status, 'completed');
  assert.equal(status.durable, false);
});
