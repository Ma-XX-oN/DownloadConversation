import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL(
  '../src/userscript/02-network-communication/04-csc-gen-durable-port.js',
  import.meta.url), 'utf8');
const create = new Function(source + '\nreturn cscGenDurablePort;')();
const version = '1.11.15';
const keyA = '2026-10-29T04:29:00.000Z';
const keyB = '2026-10-29T04:29:01.000Z';
const event = key_restart => ({
  type: 'hmac-key-cycle', id: 'hmac-key-cycle:' + key_restart,
  key_restart, epoch: key_restart === keyA ? 1 : 2,
  occurred_at_ms: Date.parse(key_restart), reason: 'initial'
});
function fixture({ corrupt = false } = {}) {
  const files = new Map();
  const directory = {
    async getFileHandle(name, {create: shouldCreate} = {}) {
      if (!files.has(name)) {
        if (!shouldCreate) {
          const error = new Error('missing');
          error.name = 'NotFoundError';
          throw error;
        }
        files.set(name, new Uint8Array());
      }
      return {
        kind: 'file',
        async getFile() {
          const snapshot = files.get(name);
          return {
            size: snapshot.length,
            arrayBuffer: async () => snapshot.slice().buffer
          };
        },
        async createWritable({keepExistingData} = {}) {
          let bytes = keepExistingData ? files.get(name).slice() : new Uint8Array();
          let offset = 0;
          return {
            seek: async value => { offset = value; },
            write: async value => {
              const output = new Uint8Array(Math.max(bytes.length, offset + value.length));
              output.set(bytes);
              output.set(value, offset);
              bytes = output;
              offset += value.length;
            },
            close: async () => {
              if (corrupt) bytes[0] ^= 1;
              files.set(name, bytes);
            },
            abort: async () => {}
          };
        }
      };
    },
    async *entries() {
      for (const name of files.keys()) {
        yield [name, {kind:'file'}];
      }
    }
  };
  return {files, directory, create: () => create(directory, version)};
}
test('GEN first header, cycle durable bytes, duplicate, recovery', async () => {
  const f=fixture(), gen=f.create();
  assert.deepEqual(await gen.beginSegment({version,key_restart:keyA}),
    {durable:true,key_restart:keyA});
  assert.deepEqual(await gen.writeCycle(event(keyA)),
    {durable:true,id:event(keyA).id});
  assert.deepEqual(await gen.writeCycle(event(keyA)),
    {durable:true,id:event(keyA).id});
  assert.equal(await gen.hasCycle(event(keyA).id),true);
  const rows=new TextDecoder().decode(f.files.values().next().value)
    .trimEnd().split('\n').map(JSON.parse);
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0],{version:{gen:version,comm:version},key_restart:keyA});
  assert.deepEqual(rows[1],event(keyA));
  const recovered=f.create();
  assert.deepEqual(await recovered.recover(),{files:1,key_restart:keyA});
  assert.equal(await recovered.hasCycle(event(keyA).id),true);
});
test('GEN rotates into second physical fragment, preserving old bytes', async () => {
  const f=fixture(),gen=f.create();
  await gen.beginSegment({version,key_restart:keyA});
  await gen.writeCycle(event(keyA));
  const previous=f.files.get('gen-key-00000001.jsonl').slice();
  assert.deepEqual(await gen.beginSegment({version,key_restart:keyB}),
    {durable:true,key_restart:keyB});
  await gen.writeCycle(event(keyB));
  assert.deepEqual(f.files.get('gen-key-00000001.jsonl'),previous);
  assert.equal(f.files.size,2);
  const recovered=f.create();
  await recovered.recover();
  assert.equal(await recovered.hasCycle(event(keyA).id),true);
  assert.equal(await recovered.hasCycle(event(keyB).id),true);
});
test('GEN cannot write cycle before committed key boundary', async () => {
  const gen=fixture().create();
  await assert.rejects(() => gen.writeCycle(event(keyA)),
    /csc-gen-key-boundary-not-committed/);
});
test('GEN mismatched version is rejected without a durable success', async () => {
  const gen=fixture().create();
  await assert.rejects(() => gen.beginSegment({version:'WRONG',key_restart:keyA}),
    /csc-gen-boundary-invalid/);
});
test('GEN corrupt physical readback poisons subsequent writes', async () => {
  const gen=fixture({corrupt:true}).create();
  await assert.rejects(() => gen.beginSegment({version,key_restart:keyA}),
    /csc-gen-header-readback-mismatch/);
  await assert.rejects(() => gen.writeCycle(event(keyA)),/csc-gen-poisoned/);
});
test('GEN contradictory same-cycle payload is rejected', async () => {
  const gen=fixture().create();
  await gen.beginSegment({version,key_restart:keyA});
  await gen.writeCycle(event(keyA));
  await assert.rejects(() => gen.writeCycle({...event(keyA),reason:'manual'}),
    /csc-gen-cycle-conflict/);
});

test('GEN queries existing on-disk history without explicit recovery call', async () => {
  const f = fixture();
  const first = f.create();
  await first.beginSegment({version,key_restart:keyA});
  await first.writeCycle(event(keyA));
  const second = f.create();
  assert.equal(await second.hasCycle(event(keyA).id),true);
  assert.deepEqual(await second.beginSegment({version,key_restart:keyA}),
    {durable:true,key_restart:keyA});
  assert.equal(f.files.size,1);
});
test('GEN rejects truncated prior segment rather than starting a new key', async () => {
  const f = fixture();
  f.files.set('gen-key-00000001.jsonl',
    new TextEncoder().encode('{"version":'));
  const gen = f.create();
  await assert.rejects(
    () => gen.beginSegment({version,key_restart:keyB}),
    /csc-gen-truncated-file/
  );
  assert.equal(f.files.size,1);
});
test('GEN refuses a historical key downgrade after recovery', async () => {
  const f=fixture(), first=f.create();
  await first.beginSegment({version,key_restart:keyB});
  const second=f.create();
  await second.recover();
  await assert.rejects(
    () => second.beginSegment({version,key_restart:keyA}),
    /csc-gen-stale-key-restart/
  );
  assert.equal(f.files.size,1);
});
