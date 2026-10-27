import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL(
  '../src/userscript/02-network-communication/04-csc-comm-durable-port.js',
  import.meta.url), 'utf8');
const factory = new Function('assert', source + '\nreturn cscCommDurablePort;');

function fixture(timeoutMs = 1000) {
  const listeners = new Map();
  const sent = [];
  const worker = {
    postMessage(message) { sent.push(message); },
    addEventListener(type, fn) {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    receive(message) {
      for (const fn of listeners.get('message') ?? []) fn({ data: message });
    },
    fail() {
      for (const fn of listeners.get('error') ?? []) fn(new Error('worker failed'));
    }
  };
  const port = factory(assert)(worker, timeoutMs);
  return { worker, sent, port };
}

test('four COMM methods require correlated writer durability', async () => {
  const f = fixture(), header = {
    version: '1.11.15', key_restart: '2026-10-27T17:00:00.000Z'
  };
  const drained = f.port.drain();
  const processor = f.sent.at(-1);
  assert.equal(processor.type, 'csc-comm-drain');
  f.worker.receive({
    type: 'csc-comm-drained', request_id: processor.request_id, durable: false
  });
  await Promise.resolve();
  const one = f.sent.at(-1);
  assert.equal(one.type, 'csc-writer-drain');
  f.worker.receive({
    type: 'csc-writer-drained', request_id: one.request_id, durable: true
  });
  assert.deepEqual(await drained, { durable: true });
  const boundary = f.port.beginKeyBoundary(header);
  const two = f.sent.at(-1);
  assert.deepEqual(two.header, header);
  f.worker.receive({
    type: 'csc-writer-key-boundary-ready',
    request_id: two.request_id, durable: true, key_restart: header.key_restart
  });
  assert.deepEqual(await boundary, {
    durable: true, key_restart: header.key_restart
  });
  const event = { type: 'hmac-key-cycle',
    id: 'hmac-key-cycle:' + header.key_restart,
    key_restart: header.key_restart,
    epoch: 1, occurred_at_ms: Date.parse(header.key_restart),
    reason: 'initial' };
  const cycle = f.port.writeCycle(event);
  const three = f.sent.at(-1);
  f.worker.receive({
    type: 'csc-writer-cycle-written',
    request_id: three.request_id, id: event.id, durable: true
  });
  assert.deepEqual(await cycle, { durable: true, id: event.id });
  const existing = f.port.hasCycle(event.id);
  const four = f.sent.at(-1);
  f.worker.receive({
    type: 'csc-writer-cycle-history', request_id: four.request_id,
    id: event.id, durable: false
  });
  assert.equal(await existing, false);
  assert.equal(new Set(f.sent.map(x => x.request_id)).size, 5);
  f.port.dispose();
});

test('unrelated and invalid durability responses never complete a request', async () => {
  const f = fixture();
  const operation = f.port.drain();
  const request = f.sent.at(-1);
  f.worker.receive({
    type: 'csc-comm-drained', request_id: 'stale', durable: false
  });
  f.worker.receive({
    type: 'csc-comm-drained',
    request_id: request.request_id, durable: true
  });
  await assert.rejects(operation, /csc-comm-drain-ack-invalid/);
  f.port.dispose();
});

test('explicit worker errors reject corresponding operation without success', async () => {
  const f = fixture();
  const operation = f.port.drain();
  const request = f.sent.at(-1);
  f.worker.receive({
    type: 'csc-comm-drain-failed', request_id: request.request_id,
    reason: 'csc-writer-readback-mismatch', durable: false
  });
  await assert.rejects(operation, /csc-writer-readback-mismatch/);
  f.port.dispose();
});

test('worker crash and disposal reject pending durable operations', async () => {
  const f = fixture();
  const operation = f.port.drain();
  f.worker.fail();
  await assert.rejects(operation, /csc-writer-control-worker-failed/);
  const pending = f.port.drain();
  f.port.dispose();
  await assert.rejects(pending, /csc-writer-control-disposed/);
});

test('missing Writer acknowledgement rejects at explicit timeout', async () => {
  const f = fixture(10);
  try {
    await assert.rejects(f.port.drain(), /csc-writer-control-timeout/);
  } finally {
    f.port.dispose();
  }
});

test('RED: COMM drain must wait for processor queue before Writer queue', async () => {
  const f = fixture();
  const operation = f.port.drain();
  try {
    assert.equal(f.sent[0].type, 'csc-comm-drain',
      'Processor queue must be drained before Writer can certify durability.');
  } finally {
    f.port.dispose();
    await assert.rejects(operation, /csc-writer-control-disposed/);
  }
});
