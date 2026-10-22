
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root,
  'src/userscript/02-network-communication/04-csc-comm-disk-writer.js'), 'utf8');
const start = 1761152400000;
const encoder = new TextEncoder();
const frame = value => encoder.encode(JSON.stringify(value) + '\n');

function fixture({ denied = false, corrupt = false } = {}) {
  const files = new Map();
  const parent = {};
  const directory = {
    async *entries() {
      for (const [name] of files) {
        yield [name, await this.getFileHandle(name)];
      }
    },
    async getFileHandle(name, { create = false } = {}) {
      if (denied) throw new DOMException('Denied', 'NotAllowedError');
      if (!files.has(name)) {
        if (!create) throw new DOMException('Missing', 'NotFoundError');
        files.set(name, new Uint8Array());
      }
      return {
        kind: 'file',
        async createWritable({ keepExistingData = false } = {}) {
          let content = keepExistingData
            ? Uint8Array.from(files.get(name)) : new Uint8Array();
          let cursor = 0;
          return {
            async seek(value) { cursor = value; },
            async write(value) {
              const bytes = value instanceof Uint8Array
                ? value : encoder.encode(value);
              const next = new Uint8Array(Math.max(content.length,
                cursor + bytes.length));
              next.set(content);
              next.set(bytes, cursor);
              content = next;
              cursor += bytes.length;
            },
            async close() {
              const saved = Uint8Array.from(content);
              if (corrupt && name.endsWith('.jsonl')) {
                saved[Math.max(saved.length - 2, 0)] ^= 1;
              }
              files.set(name, saved);
            },
            async abort() {}
          };
        },
        async getFile() {
          const bytes = Uint8Array.from(files.get(name));
          return {
            size: bytes.length,
            async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
            slice(a, b) {
              return new Blob([bytes.subarray(a, b)]);
            }
          };
        }
      };
    },
    async removeEntry(name) {
      if (!files.delete(name)) throw new DOMException('Missing', 'NotFoundError');
    }
  };
  parent.queryPermission = async () => denied ? 'denied' : 'granted';
  parent.getDirectoryHandle = async () => directory;
  const messages = [];
  const handlers = [];
  const scope = {
    postMessage(value) { messages.push(value); },
    addEventListener(name, handler) {
      if (name === 'message') handlers.push(handler);
    }
  };
  const compressed = value => {
    const bytes = new Uint8Array(value.length + 2);
    bytes.set([67, 83]);
    bytes.set(value, 2);
    return bytes;
  };
  const codec = {
    async init() {},
    async compress(value) { return compressed(value); },
    async decompress(value) {
      assert.deepEqual(Array.from(value.subarray(0, 2)), [67, 83]);
      return value.subarray(2);
    }
  };
  const sandbox = vm.createContext({ Uint8Array, TextEncoder, TextDecoder,
    DOMException, Blob, Number, Object, JSON, String, Promise, Set, Error });
  vm.runInContext(source + '\nglobalThis.factory = cscCommDiskWriter;', sandbox);
  const writer = sandbox.factory(scope, codec);
  return { parent, directory, files, messages, handlers, scope, writer, codec };
}
async function open(f, restart = start) {
  await f.writer.open({ handle: f.parent, namespace: 'synthetic-tab',
    version: '1.11.7-issue.317.1', key_restart: restart });
}
function readPlain(f) {
  const sorted = [...f.files].sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([name, raw]) => {
    if (name.endsWith('.zst')) return [name, raw.subarray(2)];
    return [name, raw];
  });
}
function record(kind, extra = {}) {
  return frame({ kind, capture_id: 'synthetic-capture', ...extra });
}
async function normalCapture(f, bytes = 64) {
  await f.writer.write(record('csc-comm-start', {
    key_restart: start
  }));
  const payload = 'x'.repeat(bytes);
  await f.writer.write(record('csc-comm-body', {
    encoding: 'utf8', data: payload
  }));
  await f.writer.write(record('csc-comm-end', {
    status: 'completed', source_bytes: bytes
  }));
}
test('physical COMM fragment begins with exact producer key_restart and version', async () => {
  const f = fixture();
  await open(f);
  await normalCapture(f);
  const first = new TextDecoder().decode(readPlain(f)[0][1]).split('\n');
  assert.deepEqual(JSON.parse(first[0]), {
    version: { comm: '1.11.7-issue.317.1',
      gen: '1.11.7-issue.317.1' }, key_restart: start
  });
  assert.equal(f.messages.find(m => m.type === 'csc-writer-durable-capture')
    .durable, true);
  await f.writer.close();
  assert.ok([...f.files.keys()].some(n => n.endsWith('.jsonl.zst')));
});
test('disk verification failure never produces a durable capture ack', async () => {
  const f = fixture({ corrupt: true });
  await open(f);
  await assert.rejects(() => f.writer.write(record('csc-comm-start', {
    key_restart: start
  })), /readback-mismatch/);
  assert.ok(!f.messages.some(m => m.type === 'csc-writer-durable-capture'));
});
test('permission failure never creates recording content', async () => {
  const f = fixture({ denied: true });
  await assert.rejects(() => open(f), /permission-denied/);
  assert.equal(f.files.size, 0);
});
test('key rotation is an immutable fragment boundary', async () => {
  const f = fixture();
  await open(f);
  await normalCapture(f);
  const later = start + 1000;
  await f.writer.setRestart(later);
  const event = { kind: 'hmac-key-cycle', id: 'hmac-key-cycle:' + later,
    occurred_at_ms: later, reason: 'manual' };
  await f.writer.write(frame(event));
  await f.writer.close();
  const parts = readPlain(f).map(([name, raw]) => ({
    name, records: new TextDecoder().decode(raw).trim().split('\n')
  }));
  assert.equal(parts.length, 2);
  assert.equal(JSON.parse(parts[0].records[0]).key_restart, start);
  assert.equal(JSON.parse(parts[1].records[0]).key_restart, later);
  assert.equal(f.messages.filter(m =>
    m.type === 'csc-writer-durable-cycle').length, 1);
});
test('restart finds disk-committed key cycle and suppresses duplicate replay', async () => {
  const f = fixture();
  await open(f);
  const item = { kind: 'hmac-key-cycle',
    id: 'hmac-key-cycle:synthetic:1', occurred_at_ms: start,
    reason: 'initial' };
  await f.writer.write(frame(item));
  await f.writer.close();
  const before = [...f.files.values()].reduce((n, x) => n + x.length, 0);
  const restarted = fixture();
  // Retain the physical directory across distinct Worker instances.
  restarted.parent.getDirectoryHandle = f.parent.getDirectoryHandle;
  await restarted.writer.open({ handle: restarted.parent,
    namespace: 'synthetic-tab', version: '1.11.7-issue.317.1',
    key_restart: start });
  await restarted.writer.write(frame(item));
  assert.equal([...f.files.values()].reduce((n, x) => n + x.length, 0), before);
  assert.equal(restarted.messages.at(-1).duplicate, true);
});
test('large selected streams rotate into bounded verified fragments', async () => {
  const f = fixture();
  await open(f);
  await f.writer.write(record('csc-comm-start', { key_restart: start }));
  const part = 'a'.repeat(1024 * 1024);
  for (let i = 0; i < 23; i += 1) {
    await f.writer.write(record('csc-comm-body', {
      encoding: 'utf8', data: part
    }));
  }
  await f.writer.write(record('csc-comm-end', { status: 'completed' }));
  await f.writer.close();
  const sealed = readPlain(f);
  assert.ok(sealed.length >= 3);
  const actual = sealed.reduce((n, [, raw]) => n + raw.length, 0);
  assert.ok(actual >= 23 * 1024 * 1024);
  assert.ok(sealed.every(([, raw]) =>
    JSON.parse(new TextDecoder().decode(raw.subarray(0,
      raw.indexOf(10)))).key_restart === start));
  assert.ok(f.messages.some(m => m.type === 'csc-writer-durable-capture'));
});
