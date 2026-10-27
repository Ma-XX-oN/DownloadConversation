import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const code = readFileSync(new URL(
  '../src/userscript/02-network-communication/04-csc-comm-durable-port.js',
  import.meta.url), 'utf8');
const create = new Function('assert', code +
  '\nreturn cscCommDurablePort;')(assert);

function harness() {
  const listeners = new Map();
  const messages = [];
  const worker = {
    postMessage(message) { messages.push(message); },
    addEventListener(type, callback) {
      const group = listeners.get(type) ?? new Set();
      group.add(callback);
      listeners.set(type, group);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    }
  };
  const emit = data => {
    for (const cb of listeners.get('message') ?? []) cb({ data });
  };
  return { worker, messages, emit, listeners };
}

test('COMM ignores unrelated acknowledgements and accepts only correlated durability', async () => {
  const h = harness(), port = create(h.worker, 500);
  try {
    const promise = port.beginKeyBoundary({
      version: '2', key_restart: '2026-10-27T15:24:00.000Z'
    });
    assert.equal(h.messages.length, 1);
    const expected = h.messages[0].request_id;
    h.emit({ type: 'csc-writer-key-boundary-ready',
      request_id: expected + '-other', durable: true,
      key_restart: '2026-10-27T15:24:00.000Z' });
    h.emit({ type: 'csc-writer-key-boundary-ready',
      request_id: expected, durable: false,
      key_restart: '2026-10-27T15:24:00.000Z' });
    await assert.rejects(promise, /csc-writer-boundary-unconfirmed/);
    assert.equal(h.listeners.get('message').size, 1);
  } finally {
    port.dispose();
    assert.equal(h.listeners.get('message').size, 0);
  }
});

test('COMM rejects all outstanding control promises if the Worker fails', async () => {
  const h = harness(), port = create(h.worker, 500);
  const a = port.drain();
  const b = port.hasCycle('hmac-key-cycle:2026-10-27T15:24:00.000Z');
  try {
    for (const callback of h.listeners.get('error') ?? []) callback();
    await assert.rejects(a, /csc-writer-control-worker-failed/);
    await assert.rejects(b, /csc-writer-control-worker-failed/);
  } finally { port.dispose(); }
});
