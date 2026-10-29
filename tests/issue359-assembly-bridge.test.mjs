import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL(
  '../src/userscript/02-network-communication/04-csc-assembly-bridge.js',
  import.meta.url), 'utf8');

function fixture() {
  const outbound = [], listeners = new Map(), binding = [];
  let worker;
  class WorkerStub {
    constructor() { worker = this; this.terminated = false; }
    addEventListener(type, fn) {
      const items = listeners.get(type) ?? new Set();
      items.add(fn); listeners.set(type, items);
    }
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }
    postMessage(message) { outbound.push(message); }
    terminate() { this.terminated = true; }
  }
  class BlobStub {}
  class URLStub {}
  URLStub.createObjectURL = () => 'blob:fixture';
  URLStub.revokeObjectURL = () => {};
  const compressor = { wasmGzipBase64: 'x'.repeat(30) };
  const root = {
    getDirectoryHandle: async () => ({
      getFileHandle: async () => {},
      entries: async function* () {}
    })
  };
  const gen = { recover: async () => ({files:0}), beginSegment:async()=>{},
    writeCycle:async()=>{}, hasCycle:async()=>false };
  const calls = [];
  const durable = {
    hasCycle: async id => { calls.push(['history',id]); return false; },
    drain: async () => { calls.push(['drain']); return {durable:true}; },
    beginKeyBoundary: async header => {
      calls.push(['boundary',header]);
      return {durable:true,key_restart:header.key_restart};
    },
    writeCycle: async e => { calls.push(['cycle',e]); return {durable:true,id:e.id}; },
    dispose: () => {}
  };
  const create = new Function('assert','Worker','Blob','URL','globalThis',
    'cscCommDiskWorkerSource','cscCommDurablePort','cscGenDurablePort',
    'cscBindCommWorker',source+'\nreturn cscAssemblyBridge;');
  const bridge = create(assert,WorkerStub,BlobStub,URLStub,
    {__dcCompressor:compressor},()=>'(function(){})();',
    () => durable,()=>gen,worker => binding.push(worker)
  )(root,'namespace', '1.11.15');
  const receive = data => {
    for (const fn of listeners.get('message') ?? []) fn({data});
  };
  return {bridge,receive,outbound,binding,calls,worker:()=>worker};
}
const restart='2026-10-29T04:30:00.000Z';
test('COMM opens Writer lazily with actual first cycle key, then queries history',async()=>{
  const f=fixture();
  const pending=f.bridge.comm.hasCycle('hmac-key-cycle:'+restart);
  assert.equal(f.outbound[0].type,'csc-writer-open');
  assert.equal(f.outbound[0].key_restart,restart);
  f.receive({type:'csc-writer-ready',durable:true,key_restart:restart});
  assert.equal(await pending,false);
  assert.deepEqual(f.calls[0],['history','hmac-key-cycle:'+restart]);
  f.bridge.dispose();
});
test('controller accepts correlated configure and key admission only',async()=>{
  const f=fixture();
  const request={type:'csc-comm-configure',schema:1,request_id:'csc-options-1',options:{}};
  const configured=f.bridge.controllerWorker.configure(request);
  f.receive({type:'csc-comm-configured',schema:1,request_id:'csc-options-0'});
  f.receive({type:'csc-comm-configured',schema:1,request_id:request.request_id});
  assert.equal((await configured).request_id,request.request_id);
  const admitted=f.bridge.controllerWorker.awaitKey('my-admission-token');
  f.receive({type:'csc-comm-key-ready',token:'unrelated'});
  f.receive({type:'csc-comm-key-ready',token:'my-admission-token'});
  assert.equal((await admitted).token,'my-admission-token');
  f.bridge.dispose();
});
test('controller pause disarms ingress and disposal terminates Worker',async()=>{
  const f=fixture();
  await f.bridge.controllerWorker.pause();
  assert.equal(f.binding.at(-1),null);
  f.bridge.dispose();
  assert.equal(f.worker().terminated,true);
});
test('writer open wrong-key acknowledgement rejects and never enables ingress',async()=>{
  const f=fixture();
  const pending=f.bridge.comm.hasCycle('hmac-key-cycle:'+restart);
  f.receive({type:'csc-writer-ready',durable:true,
    key_restart:'2026-10-29T04:30:01.000Z'});
  await assert.rejects(pending,/csc-assembly-writer-open-invalid/);
  assert.equal(f.bridge.enabled,false);
  f.bridge.dispose();
});

test('historical cycle query after current key opens is permitted read-only',async()=>{
 const f=fixture();
 const current='2026-10-29T04:30:01.000Z';
 const old='2026-10-29T04:30:00.000Z';
 const opening=f.bridge.comm.hasCycle('hmac-key-cycle:'+current);
 f.receive({type:'csc-writer-ready',durable:true,key_restart:current});
 assert.equal(await opening,false);
 const history=f.bridge.comm.hasCycle('hmac-key-cycle:'+old);
 assert.equal(await history,false);
 assert.deepEqual(f.calls.at(-1),['history','hmac-key-cycle:'+old]);
 f.bridge.dispose();
});
