import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const path = '../src/userscript/02-network-communication/';
const source = ['04-csc-comm-disk-writer.js',
  '04-csc-comm-disk-writer-part2.js']
  .map(name => readFileSync(new URL(path + name, import.meta.url), 'utf8'))
  .join('\n');
const create = new Function(source + '\nreturn cscCommDiskWriter;')();
const restartA = '2026-10-27T15:24:00.000Z';
const restartB = '2026-10-27T15:24:00.001Z';

function fixture({ corrupt = false } = {}) {
  const files = new Map();
  const events = [];
  let receive;
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
        async createWritable() {
          let written;
          return {
            write: async bytes => { written = bytes.slice(); },
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
    postMessage: event => events.push(event),
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
  const first = await f.api.beginKeyBoundary(restartA);
  assert.deepEqual(first, { durable: true, key_restart: restartA });
  const next = await f.api.beginKeyBoundary(restartB);
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
    () => f.api.beginKeyBoundary(restartA),
    /csc-writer-readback-mismatch/
  );
  assert.equal(f.events.some(event =>
    event.type === 'csc-writer-incomplete' && event.durable === false), true);
  await assert.rejects(
    () => f.api.beginKeyBoundary(restartA),
    /csc-writer-not-open/
  );
});

test('correlated Worker protocol returns only verified boundary status', async () => {
  const f = fixture();
  await f.open();
  f.send({ type: 'csc-writer-begin-key-boundary',
    request_id: 'boundary-1', key_restart: restartA });
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
