
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root,
  'src/userscript/02-network-communication/04-csc-comm-disk-writer.js'), 'utf8') +
  readFileSync(path.join(root,
    'src/userscript/02-network-communication/04-csc-comm-disk-writer-part2.js'), 'utf8');
const leaseSource = readFileSync(path.join(root,
  'src/userscript/02-network-communication/04-csc-comm-disk-lock.js'), 'utf8');
const manifestSource = readFileSync(path.join(root,
  'src/userscript/02-network-communication/04-csc-comm-disk-manifest.js'), 'utf8');
const copySource = readFileSync(path.join(root,
  'src/userscript/02-network-communication/04-csc-comm-disk-copy.js'), 'utf8');
const start = new Date(1761152400000).toISOString();
const encoder = new TextEncoder();
const frame = value => encoder.encode(JSON.stringify(value) + '\n');

function fixture({ denied = false, corrupt = false, locks = new Set() } = {}) {
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
    crypto: webcrypto,
    navigator: { locks: {
      request(name, options, callback) {
        if (locks.has(name)) return Promise.resolve(callback(null));
        locks.add(name);
        return Promise.resolve(callback({ name })).finally(() => locks.delete(name));
      }
    } },
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
  vm.runInContext(leaseSource + manifestSource + copySource + source +
    '\nglobalThis.factory = cscCommDiskWriter;', sandbox);
  scope.__cscWriterLease = sandbox.cscCommWriterLease(scope);
  scope.__cscWriterManifest = sandbox.cscCommDiskManifest(scope);
  scope.__cscWriterCopy = sandbox.cscCommDiskCopy();
  const writer = sandbox.factory(scope, codec);
  return { parent, directory, files, messages, handlers, scope, writer, codec };
}
async function open(f, restart = start, version = '1.11.7-issue.317.1') {
  await f.writer.open({ handle: f.parent, namespace: 'synthetic-tab',
    version, key_restart: restart });
}
function readPlain(f) {
  const sorted = [...f.files].filter(([name]) =>
    /^fragment-\d{8}\.jsonl(\.zst)?$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b));
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
  const later = new Date(Date.parse(start) + 1000).toISOString();
  await f.writer.setRestart(later);
  const event = { kind: 'hmac-key-cycle', id: 'hmac-key-cycle:' + later,
    key_restart: later, occurred_at_ms: Date.parse(later), reason: 'manual' };
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
    id: 'hmac-key-cycle:' + start, key_restart: start,
    occurred_at_ms: Date.parse(start),
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

test('writer rejects malformed or uncommitted key_restart without file changes', async () => {
  const f = fixture();
  await assert.rejects(() => open(f, 'not-a-timestamp'),
    /csc-writer-invalid-restart/);
  assert.equal(f.files.size, 0);
  const g = fixture();
  await open(g);
  await assert.rejects(() => g.writer.write(record('csc-comm-start', {
    key_restart: new Date(Date.parse(start) + 1000).toISOString()
  })), /csc-writer-capture-restart-mismatch/);
  assert.ok(!g.messages.some(m => m.type === 'csc-writer-durable-capture'));
});
test('two independent 101 MiB synthetic streams seal without payload loss', async () => {
  for (let repetition = 0; repetition < 2; repetition += 1) {
    const f = fixture();
    await open(f);
    await f.writer.write(record('csc-comm-start', { key_restart: start }));
    const payload = 'b'.repeat(1024 * 1024);
    for (let index = 0; index < 101; index += 1) {
      await f.writer.write(record('csc-comm-body', {
        encoding: 'utf8', data: payload
      }));
    }
    await f.writer.write(record('csc-comm-end', {
      status: 'completed', source_bytes: 101 * 1024 * 1024
    }));
    await f.writer.close();
    const sealed = readPlain(f);
    let total = 0;
    let bodyCount = 0;
    for (const [, bytes] of sealed) {
      const records = new TextDecoder().decode(bytes).trimEnd().split('\n');
      assert.equal(JSON.parse(records[0]).key_restart, start);
      for (const json of records.slice(1)) {
        const item = JSON.parse(json);
        if (item.kind === 'csc-comm-body') {
          total += item.data.length;
          bodyCount += 1;
          assert.equal(item.data, payload);
        }
      }
    }
    assert.equal(bodyCount, 101);
    assert.equal(total, 101 * 1024 * 1024);
    assert.ok(f.messages.some(m =>
      m.type === 'csc-writer-durable-capture' && m.durable));
  }
});

test('second Worker on the same recording namespace fails closed until release', async () => {
  const locks = new Set();
  const first = fixture({ locks });
  const competing = fixture({ locks });
  await open(first);
  await assert.rejects(() => open(competing), /csc-writer-lock-contended/);
  assert.equal(competing.files.size, 0);
  await first.writer.close();
  await open(competing);
  await competing.writer.close();
  assert.equal(locks.size, 0);
});
test('unavailable Web Locks API fails without creating a fragment', async () => {
  const f = fixture();
  delete f.scope.navigator;
  await assert.rejects(() => open(f), /csc-writer-lock-unavailable/);
  assert.equal(f.files.size, 0);
});

test('previous immutable version is sealed on restart without rewriting its header', async () => {
  const f = fixture();
  await open(f);
  await normalCapture(f);
  await f.scope.__cscWriterLease.release();
  const successor = fixture();
  successor.parent.getDirectoryHandle = f.parent.getDirectoryHandle;
  await open(successor, start, '1.11.7-issue.317.2');
  await successor.writer.write(frame({
    kind: 'csc-comm-start', capture_id: 'second', key_restart: start
  }));
  await successor.writer.write(frame({
    kind: 'csc-comm-end', capture_id: 'second', status: 'completed'
  }));
  await successor.writer.close();
  const versions = readPlain(f).map(([, raw]) =>
    JSON.parse(new TextDecoder().decode(raw).split('\n')[0]).version.comm);
  assert.deepEqual(versions, ['1.11.7-issue.317.1', '1.11.7-issue.317.2']);
});
test('replayed completed capture cannot create another physical record', async () => {
  const f = fixture();
  await open(f);
  await normalCapture(f);
  await f.writer.close();
  const bytes = [...f.files.values()].reduce((n, v) => n + v.length, 0);
  const successor = fixture();
  successor.parent.getDirectoryHandle = f.parent.getDirectoryHandle;
  await open(successor);
  await assert.rejects(() =>
    successor.writer.write(record('csc-comm-start', { key_restart: start })),
    /csc-writer-duplicate-capture/);
  assert.equal([...f.files.values()].reduce((n, v) => n + v.length, 0), bytes);
});
test('crash with unterminated capture fails closed and preserves on-disk bytes', async () => {
  const f = fixture();
  await open(f);
  await f.writer.write(record('csc-comm-start', { key_restart: start }));
  await f.scope.__cscWriterLease.release();
  const before = [...f.files.values()].map(b => Uint8Array.from(b));
  const successor = fixture();
  successor.parent.getDirectoryHandle = f.parent.getDirectoryHandle;
  await assert.rejects(() => open(successor),
    /csc-writer-unresolved-(?:old-)?capture/);
  assert.equal(f.files.size, before.length);
  assert.deepEqual([...f.files.values()].map(b => Array.from(b)),
    before.map(b => Array.from(b)));
});

test('after a physical write failure the Worker rejects every subsequent write', async () => {
  const f = fixture({ corrupt: true });
  await open(f);
  await assert.rejects(() => f.writer.write(record('csc-comm-start', {
    key_restart: start
  })), /csc-writer-readback-mismatch/);
  await assert.rejects(() => f.writer.write(record('csc-comm-body', {
    encoding: 'utf8', data: 'synthetic'
  })), /csc-writer-poisoned/);
  assert.ok(f.messages.some(m => m.type === 'csc-writer-incomplete' &&
    m.durable === false));
  assert.ok(!f.messages.some(m => m.type === 'csc-writer-durable-capture'));
});

test('crash after verified Zstd archive before raw deletion is idempotent', async () => {
  const sourceWriter = fixture();
  await open(sourceWriter);
  await normalCapture(sourceWriter);
  await sourceWriter.writer.close();
  const archive = sourceWriter.files.get('fragment-00000001.jsonl.zst');
  assert.ok(archive);
  const raw = Uint8Array.from(archive.subarray(2));
  sourceWriter.files.set('fragment-00000001.jsonl', raw);
  const resumed = fixture();
  resumed.parent.getDirectoryHandle = sourceWriter.parent.getDirectoryHandle;
  await open(resumed);
  assert.ok(!sourceWriter.files.has('fragment-00000001.jsonl'));
  assert.deepEqual(Array.from(
    sourceWriter.files.get('fragment-00000001.jsonl.zst')),
    Array.from(archive));
  await assert.rejects(() => resumed.writer.write(record('csc-comm-start', {
    key_restart: start
  })), /csc-writer-duplicate-capture/);
  await resumed.writer.close();
});
test('mismatched raw/archive twins fail closed without deleting either copy', async () => {
  const sourceWriter = fixture();
  await open(sourceWriter);
  await normalCapture(sourceWriter);
  await sourceWriter.writer.close();
  sourceWriter.files.set('fragment-00000001.jsonl',
    frame({ version: { gen: 'tampered', comm: 'tampered' },
      key_restart: start }));
  const originals = [...sourceWriter.files].map(([name, bytes]) =>
    [name, Array.from(bytes)]);
  const resumed = fixture();
  resumed.parent.getDirectoryHandle = sourceWriter.parent.getDirectoryHandle;
  await assert.rejects(() => open(resumed),
    /csc-writer-interrupted-archive-mismatch/);
  assert.deepEqual([...sourceWriter.files].map(([name, bytes]) =>
    [name, Array.from(bytes)]), originals);
});

test('archive bit corruption is caught by persisted manifest SHA256', async () => {
  const origin = fixture();
  await open(origin);
  await normalCapture(origin);
  await origin.writer.close();
  const name = 'fragment-00000001.jsonl.zst';
  const corrupted = Uint8Array.from(origin.files.get(name));
  corrupted[corrupted.length - 2] ^= 1;
  origin.files.set(name, corrupted);
  const target = fixture();
  target.parent.getDirectoryHandle = origin.parent.getDirectoryHandle;
  await assert.rejects(() => open(target),
    /csc-writer-manifest-archive-mismatch/);
  assert.deepEqual(Array.from(origin.files.get(name)), Array.from(corrupted));
});
test('corrupt or deleted manifest never silently recreates old log identity', async () => {
  for (const destroy of ['corrupt', 'delete']) {
    const origin = fixture();
    await open(origin);
    await normalCapture(origin);
    await origin.writer.close();
    if (destroy === 'delete') origin.files.delete('manifest.json');
    else origin.files.set('manifest.json', encoder.encode('{invalid'));
    const target = fixture();
    target.parent.getDirectoryHandle = origin.parent.getDirectoryHandle;
    await assert.rejects(() => open(target),
      /csc-writer-manifest-(invalid|missing-with-data)/);
    assert.ok(origin.files.has('fragment-00000001.jsonl.zst'));
  }
});

test('logical rename persists on disk without changing immutable fragment names', async () => {
  const f = fixture();
  await open(f);
  await normalCapture(f);
  await assert.rejects(() => f.writer.renameLogical('../unsafe.jsonl'),
    /csc-writer-invalid-logical-name/);
  const renamed = await f.writer.renameLogical('Bloor West.comm.jsonl');
  assert.equal(renamed, 'Bloor West.comm.jsonl');
  assert.ok(f.files.has('fragment-00000001.jsonl'));
  await f.writer.close();
  const after = fixture();
  after.parent.getDirectoryHandle = f.parent.getDirectoryHandle;
  await open(after);
  const inventory = await after.writer.snapshot();
  assert.equal(inventory.logical_name, renamed);
  assert.equal(inventory.archives.length, 1);
  await after.writer.close();
});
test('snapshot freezes full archived fragments with SHA256 integrity readback', async () => {
  const f = fixture();
  await open(f);
  await f.writer.write(record('csc-comm-start', { key_restart: start }));
  const payload = 'x'.repeat(4 * 1024 * 1024);
  for (let i = 0; i < 3; i += 1) {
    await f.writer.write(record('csc-comm-body', { data: payload }));
  }
  await f.writer.write(record('csc-comm-end', { status: 'completed' }));
  const snapshot = await f.writer.snapshot();
  assert.equal(snapshot.archives.length, 2);
  for (const item of snapshot.archives) {
    assert.match(item.sha256, /^[0-9a-f]{64}$/);
    assert.ok(f.files.has(item.name));
    assert.ok(item.name.endsWith('.zst'));
  }
  assert.ok(f.messages.some(m =>
    m.type === 'csc-writer-snapshot-ready' && m.durable));
  await f.writer.close();
});

test('complete COMM duplicate copies archived fragments and manifest exactly', async () => {
  const origin = fixture();
  await open(origin);
  await normalCapture(origin);
  const output = fixture();
  const directories = new Map();
  const root = {
    async queryPermission() { return 'granted'; },
    async getDirectoryHandle(name, options = {}) {
      if (!directories.has(name)) {
        if (!options.create) throw new DOMException('Missing', 'NotFoundError');
        directories.set(name, output.directory);
      }
      return directories.get(name);
    },
    async removeEntry(name) {
      if (!directories.delete(name)) throw new Error('Missing');
      output.files.clear();
    }
  };
  const result = await origin.writer.duplicate(root, 'copyA');
  assert.equal(result.directory_name, 'dc-comm-duplicate-copyA');
  assert.equal(result.files, 2);
  for (const [name, bytes] of output.files) {
    assert.deepEqual(Array.from(bytes), Array.from(origin.files.get(name)));
  }
  await assert.rejects(() => origin.writer.duplicate(root, 'copyA'),
    /csc-writer-duplicate-name-collision/);
  assert.ok(origin.files.has('fragment-00000001.jsonl.zst'));
  await origin.writer.close();
});

test('reset requires explicit confirmation and preserves active key identity', async () => {
  const f = fixture();
  await open(f);
  await normalCapture(f);
  await assert.rejects(() => f.writer.reset(false),
    /csc-writer-reset-unconfirmed/);
  assert.ok(f.files.has('fragment-00000001.jsonl'));
  await f.writer.reset(true);
  assert.deepEqual([...f.files.keys()], ['manifest.json']);
  const restored = await f.writer.snapshot();
  assert.equal(restored.archives.length, 0);
  assert.ok(f.messages.some(m =>
    m.type === 'csc-writer-reset-complete' && m.durable));
  await normalCapture(f);
  await f.writer.close();
});
test('interrupted confirmed reset resumes from persisted manifest intent', async () => {
  const f = fixture();
  await open(f);
  await normalCapture(f);
  const originalRemove = f.directory.removeEntry.bind(f.directory);
  let failOnce = true;
  f.directory.removeEntry = async name => {
    if (failOnce && name.startsWith('fragment-')) {
      failOnce = false;
      throw new Error('synthetic-reset-interruption');
    }
    return originalRemove(name);
  };
  await assert.rejects(() => f.writer.reset(true),
    /synthetic-reset-interruption/);
  const journal = JSON.parse(new TextDecoder().decode(
    f.files.get('manifest.json')));
  assert.equal(journal.reset_pending, true);
  await f.scope.__cscWriterLease.release();
  const resumed = fixture();
  resumed.parent.getDirectoryHandle = f.parent.getDirectoryHandle;
  await open(resumed);
  assert.deepEqual([...f.files.keys()], ['manifest.json']);
  const snapshot = await resumed.writer.snapshot();
  assert.equal(snapshot.archives.length, 0);
  await resumed.writer.close();
});
