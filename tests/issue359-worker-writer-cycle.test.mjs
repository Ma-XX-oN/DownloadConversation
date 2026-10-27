import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = '../src/userscript/02-network-communication/';
const workerSource = [
  '04-csc-comm-worker-processing.js',
  '04-csc-comm-worker-processing-part2.js',
  '04-csc-comm-worker-processing-part3.js'
].map(x => readFileSync(new URL(root + x, import.meta.url), 'utf8')).join('\n');
const writerSource = [
  '04-csc-comm-disk-writer.js',
  '04-csc-comm-disk-writer-part2.js'
].map(x => readFileSync(new URL(root + x, import.meta.url), 'utf8')).join('\n');

const Worker = new Function(workerSource +
  '\nreturn cscCommWorkerProcessing;')();
const Writer = new Function(writerSource +
  '\nreturn cscCommDiskWriter;')();
const key_restart = '2026-10-27T17:00:00.000Z';
const cycle = Object.freeze({
  type: 'hmac-key-cycle',
  id: 'hmac-key-cycle:' + key_restart,
  key_restart, epoch: 2,
  occurred_at_ms: Date.parse(key_restart),
  reason: 'manual'
});

function filesystem() {
  const files = new Map();
  const directory = {
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) {
          const e = new Error('missing'); e.name = 'NotFoundError'; throw e;
        }
        files.set(name, new Uint8Array());
      }
      return {
        async getFile() {
          const bytes = files.get(name);
          return {
            size: bytes.length,
            arrayBuffer: async () => bytes.slice().buffer,
            slice: offset => ({
              arrayBuffer: async () => bytes.slice(offset).buffer
            })
          };
        },
        async createWritable({ keepExistingData } = {}) {
          let bytes = keepExistingData ? files.get(name).slice() : new Uint8Array();
          let cursor = 0;
          return {
            seek: async offset => { cursor = offset; },
            write: async added => {
              const combined = new Uint8Array(Math.max(bytes.length,
                cursor + added.length));
              combined.set(bytes);
              combined.set(added, cursor);
              bytes = combined;
              cursor += added.length;
            },
            close: async () => { files.set(name, bytes); },
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
  return { files, directory };
}

test('Worker queue becomes durable only after physical Writer readback', async () => {
  const fs = filesystem(), writerEvents = [], workerEvents = [];
  const writer = Writer({
    postMessage: event => writerEvents.push(event),
    addEventListener: () => {},
    __cscWriterLease: {
      acquire: async () => {}, release: async () => {}
    },
    __cscWriterManifest: {
      open: async () => {}, record: async () => {}, release: () => {}
    },
    __cscWriterCopy: {}
  }, {
    init: async () => {},
    compress: async bytes => bytes,
    decompress: async bytes => bytes
  });
  await writer.open({
    handle: { getDirectoryHandle: async () => fs.directory },
    namespace: 'fixture', version: '1.11.15', key_restart
  });
  assert.deepEqual(await writer.beginKeyBoundary({ version: '1.11.15', key_restart }),
    { durable: true, key_restart });

  let receiver;
  Worker({
    addEventListener: (_, callback) => { receiver = callback; },
    postMessage: event => workerEvents.push(event)
  }, { write: bytes => writer.write(bytes) });
  receiver({ data: { type: 'csc-comm-key-cycle', event: cycle } });
  for (let i = 0; i < 25; i++) await new Promise(setImmediate);

  assert.equal(workerEvents.length, 1);
  assert.equal(workerEvents[0].status, 'completed');
  assert.equal(workerEvents[0].durable, false);
  const durable = writerEvents.find(event =>
    event.type === 'csc-writer-durable-cycle');
  assert.equal(durable.id, cycle.id);
  assert.equal(durable.durable, true);
  assert.equal(writer.hasCycle(cycle.id), true);

  const persisted = new TextDecoder().decode(fs.files.values().next().value);
  const records = persisted.trimEnd().split('\n').map(JSON.parse);
  assert.equal(records[0].key_restart, key_restart);
  assert.equal(records[0].version.comm, '1.11.15');
  assert.equal(records[1].key_restart, key_restart);
  assert.equal(records[1].id, cycle.id);

  receiver({ data: { type: 'csc-comm-key-cycle', event: cycle } });
  for (let i = 0; i < 25; i++) await new Promise(setImmediate);
  assert.equal(workerEvents[1].status, 'duplicate');
  assert.equal(workerEvents[1].durable, false);
  assert.equal(writerEvents.filter(event =>
    event.type === 'csc-writer-durable-cycle').length, 1);
});
