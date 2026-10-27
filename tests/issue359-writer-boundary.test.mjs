import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const path = '../src/userscript/02-network-communication/';
const source = ['04-csc-comm-disk-writer.js',
  '04-csc-comm-disk-writer-part2.js']
  .map(name => readFileSync(new URL(path + name, import.meta.url), 'utf8'))
  .join('\n');
const create = new Function(source + '\nreturn cscCommDiskWriter;')();
const portSource = readFileSync(new URL(path + '04-csc-comm-durable-port.js',
  import.meta.url), 'utf8');
const createPort = new Function('assert', portSource +
  '\nreturn cscCommDurablePort;')(assert);
const restartA = '2026-10-27T15:24:00.000Z';
const restartB = '2026-10-27T15:24:00.001Z';

function fixture({ corrupt = false, recoveredCycle = null } = {}) {
  const files = new Map();
  if (recoveredCycle !== null) {
    const rows = [
      { version: { comm: '2', gen: '2' }, key_restart: restartA },
      recoveredCycle
    ];
    files.set('fragment-00000001.jsonl', new TextEncoder().encode(
      rows.map(row => JSON.stringify(row)).join('\n') + '\n'));
  }
  const events = [];
  let receive;
  const mainListeners = new Set();
  const directory = {
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) {
          const error = new Error('missing');
          error.name = 'NotFoundError';
          throw error;
        }
        files.set(name, new Uint8Array());
      }
      return {
        async getFile() {
          const data = files.get(name);
          return {
            size: data.length,
            arrayBuffer: async () => data.slice().buffer,
            slice: start => ({
              arrayBuffer: async () => data.slice(start).buffer
            })
          };
        },
        async createWritable({ keepExistingData } = {}) {
          let written = keepExistingData ? files.get(name).slice() : new Uint8Array();
          let cursor = 0;
          return {
            seek: async offset => { cursor = offset; },
            write: async bytes => {
              const combined = new Uint8Array(Math.max(written.length,
                cursor + bytes.length));
              combined.set(written);
              combined.set(bytes, cursor);
              written = combined;
              cursor += bytes.length;
            },
            close: async () => {
              if (corrupt) written[0] ^= 1;
              files.set(name, written);
            },
            abort: async () => {}
          };
        }
      };
    },
    removeEntry: async name => { files.delete(name); },
    async *entries() {
      for (const name of files.keys()) {
        yield [name, { kind: 'file', ...await this.getFileHandle(name) }];
      }
    }
  };
  const scope = {
    postMessage: event => {
      events.push(event);
      for (const listener of mainListeners) listener({ data: event });
    },
    addEventListener: (_type, callback) => { receive = callback; },
    __cscWriterLease: { acquire: async () => {}, release: async () => {} },
    __cscWriterManifest: {
      open: async () => {}, record: async () => {}, release: () => {}
    },
    __cscWriterCopy: {}
  };
  const api = create(scope, {
    init: async () => {},
    compress: async bytes => bytes,
    decompress: async bytes => bytes
  });
  return {
    files, events, api,
    port: () => createPort({
      postMessage: payload => receive({ data: payload }),
      addEventListener: (name, listener) => {
        if (name === 'message') mainListeners.add(listener);
      },
      removeEventListener: (name, listener) => {
        if (name === 'message') mainListeners.delete(listener);
      }
    }, 1000),
    send: payload => receive({ data: payload }),
    open: () => api.open({
      handle: { getDirectoryHandle: async () => directory },
      namespace: 'fixture', version: '2', key_restart: restartA
    })
  };
}

test('first header is read back before durable key-boundary result', async () => {
  const f = fixture();
  await f.open();
  const first = await f.api.beginKeyBoundary({ version: '2', key_restart: restartA });
  assert.deepEqual(first, { durable: true, key_restart: restartA });
  const next = await f.api.beginKeyBoundary({ version: '2', key_restart: restartB });
  assert.deepEqual(next, { durable: true, key_restart: restartB });
  assert.equal(f.files.size, 2);
  for (const [name, bytes] of f.files) {
    const raw = new TextDecoder().decode(bytes);
    const header = JSON.parse(raw.split('\n')[0]);
    assert.deepEqual(header.version, { comm: '2', gen: '2' });
    assert.equal(header.key_restart,
      name.includes('00000001') ? restartA : restartB);
  }
  assert.equal(f.api.hasCycle('hmac-key-cycle:' + restartB), false);
});

test('corrupt first-header readback cannot acknowledge durability', async () => {
  const f = fixture({ corrupt: true });
  await f.open();
  await assert.rejects(
    () => f.api.beginKeyBoundary({ version: '2', key_restart: restartA }),
    /csc-writer-readback-mismatch/
  );
  assert.equal(f.events.some(event =>
    event.type === 'csc-writer-incomplete' && event.durable === false), true);
  await assert.rejects(
    () => f.api.beginKeyBoundary({ version: '2', key_restart: restartA }),
    /csc-writer-not-open/
  );
});

test('correlated Worker protocol returns only verified boundary status', async () => {
  const f = fixture();
  await f.open();
  f.send({ type: 'csc-writer-begin-key-boundary',
    request_id: 'boundary-1', header: { version: '2', key_restart: restartA } });
  for (let n = 0; n < 30; n++) await new Promise(setImmediate);
  const ready = f.events.find(event =>
    event.type === 'csc-writer-key-boundary-ready');
  assert.equal(ready.request_id, 'boundary-1');
  assert.equal(ready.key_restart, restartA);
  assert.equal(ready.durable, true);
  f.send({ type: 'csc-writer-has-cycle', request_id: 'query-1',
    id: 'hmac-key-cycle:' + restartA });
  for (let n = 0; n < 30; n++) await new Promise(setImmediate);
  const history = f.events.find(event =>
    event.type === 'csc-writer-cycle-history');
  assert.deepEqual(history, {
    type: 'csc-writer-cycle-history', request_id: 'query-1',
    id: 'hmac-key-cycle:' + restartA, durable: false
  });
});

test('failed Worker boundary reply keeps request correlation and no durability', async () => {
  const f = fixture();
  await f.open();
  f.send({ type: 'csc-writer-begin-key-boundary',
    request_id: 'boundary-invalid', header: { version: '2', key_restart: 'invalid' } });
  for (let n = 0; n < 30; n++) await new Promise(setImmediate);
  const failed = f.events.find(event =>
    event.type === 'csc-writer-error' &&
    event.operation === 'csc-writer-begin-key-boundary');
  assert.equal(failed.request_id, 'boundary-invalid');
  assert.equal(failed.durable, false);
  assert.equal(f.events.some(event =>
    event.type === 'csc-writer-key-boundary-ready'), false);
});

test('recovered journal answers hasCycle before new writes', async () => {
  const event = { kind: 'hmac-key-cycle', type: 'hmac-key-cycle',
    id: 'hmac-key-cycle:' + restartA, key_restart: restartA,
    epoch: 1, occurred_at_ms: Date.parse(restartA), reason: 'initial' };
  const f = fixture({ recoveredCycle: event });
  await f.open();
  assert.equal(f.api.hasCycle(event.id), true);
  assert.equal(f.api.hasCycle('hmac-key-cycle:' + restartB), false);
  f.send({ type: 'csc-writer-has-cycle', request_id: 'recover-1', id: event.id });
  for (let n = 0; n < 30; n++) await new Promise(setImmediate);
  const response = f.events.find(message =>
    message.type === 'csc-writer-cycle-history');
  assert.equal(response.request_id, 'recover-1');
  assert.equal(response.durable, true);
});

test('accepted #318 COMM ports drain and durably persist exact producer cycle', async () => {
  const f = fixture();
  await f.open();
  assert.deepEqual(await f.api.drain(), { durable: true });
  const boundary = await f.api.beginKeyBoundary({
    version: '2', key_restart: restartA
  });
  assert.equal(boundary.durable, true);
  const cycle = {
    type: 'hmac-key-cycle', id: 'hmac-key-cycle:' + restartA,
    key_restart: restartA, epoch: 1,
    occurred_at_ms: Date.parse(restartA), reason: 'initial'
  };
  const ack = await f.api.writeCycle(cycle);
  assert.deepEqual(ack, { durable: true, id: cycle.id });
  assert.equal(f.api.hasCycle(cycle.id), true);
  const bytes = f.files.values().next().value;
  const rows = new TextDecoder().decode(bytes).trimEnd()
    .split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key_restart, restartA);
  assert.equal(rows[1].id, cycle.id);
  assert.equal(rows[1].key_restart, restartA);
});

test('COMM rejects invalid-version boundary and cycle before any durable ACK', async () => {
  const f = fixture();
  await f.open();
  await assert.rejects(
    () => f.api.beginKeyBoundary({ version: 'WRONG', key_restart: restartA }),
    /csc-writer-boundary-version-mismatch/
  );
  await assert.rejects(
    () => f.api.writeCycle({
      type: 'hmac-key-cycle', id: 'hmac-key-cycle:' + restartA,
      key_restart: restartA, epoch: 1,
      occurred_at_ms: Date.parse(restartA), reason: 'manual'
    }),
    /csc-writer-boundary-not-durable/
  );
  assert.equal(f.events.some(event =>
    event.type === 'csc-writer-durable-cycle'), false);
});

test('actual parent port and Writer message loop satisfy #318 four-method contract', async () => {
  const f = fixture();
  await f.open();
  const port = f.port();
  try {
    assert.deepEqual(await port.drain(), { durable: true });
    assert.deepEqual(await port.beginKeyBoundary({
      version: '2', key_restart: restartA
    }), { durable: true, key_restart: restartA });
    const event = {
      type: 'hmac-key-cycle', id: 'hmac-key-cycle:' + restartA,
      key_restart: restartA, epoch: 1,
      occurred_at_ms: Date.parse(restartA), reason: 'initial'
    };
    assert.deepEqual(await port.writeCycle(event),
      { durable: true, id: event.id });
    assert.equal(await port.hasCycle(event.id), true);
    assert.equal(await port.hasCycle('hmac-key-cycle:' + restartB), false);
    assert.equal(f.events.filter(item =>
      item.type === 'csc-writer-cycle-written' && item.durable).length, 1);
  } finally {
    port.dispose();
  }
});
