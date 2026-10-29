import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const files=[
'../src/userscript/02-network-communication/04-csc-gen-durable-port.js',
'../src/userscript/02-network-communication/04-csc-comm-durable-port.js',
'../src/userscript/02-network-communication/04-csc-assembly-bridge.js',
'../src/userscript/07-panel-launcher/03-csc-schema.js',
'../src/userscript/07-panel-launcher/03-csc-control-plane.js',
'../src/userscript/07-panel-launcher/03-csc-singleton.js',
'../src/userscript/07-panel-launcher/03-csc-parent-assembly.js'];
const source=files.map(x=>readFileSync(new URL(x,import.meta.url),'utf8')).join('\n');
const restart='2026-10-29T04:30:00.000Z';
const cycle={type:'hmac-key-cycle',id:'hmac-key-cycle:'+restart,
 key_restart:restart,epoch:1,occurred_at_ms:Date.parse(restart),reason:'initial'};
function fixture(){
 const disk=new Map(),messages=[],comm=new Map(),listeners=new Map(),binds=[];
 const root={
  async getDirectoryHandle(){return this;},
  async getFileHandle(name,{create=false}={}){
   if(!disk.has(name)){if(!create)throw Error('missing');disk.set(name,new Uint8Array());}
   return {
    kind:'file',
    getFile:async()=>{const bytes=disk.get(name);return{
     size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer};},
    createWritable:async({keepExistingData=false}={})=>{
     let bytes=keepExistingData?disk.get(name).slice():new Uint8Array(),offset=0;
     return {seek:async n=>{offset=n;},write:async value=>{
      const next=new Uint8Array(Math.max(bytes.length,offset+value.length));
      next.set(bytes);next.set(value,offset);bytes=next;offset+=value.length;
     },close:async()=>{disk.set(name,bytes);},abort:async()=>{}};
    }
   };
  },
  async *entries(){for(const name of disk.keys())yield[name,{kind:'file'}];}
 };
 const emit=data=>{Promise.resolve().then(()=>{
  for(const cb of listeners.get('message')??[])cb({data});
 });};
 class WorkerStub{
  addEventListener(type,fn){const s=listeners.get(type)??new Set();s.add(fn);listeners.set(type,s);}
  removeEventListener(type,fn){listeners.get(type)?.delete(fn);}
  terminate(){}
  postMessage(v){
   messages.push(v);
   const type=v.type,id=v.request_id;
   if(type==='csc-writer-open')emit({type:'csc-writer-ready',durable:true,key_restart:v.key_restart});
   if(type==='csc-writer-has-cycle')emit({type:'csc-writer-cycle-history',request_id:id,id:v.id,durable:comm.has(v.id)});
   if(type==='csc-comm-drain')emit({type:'csc-comm-drained',request_id:id,durable:false});
   if(type==='csc-writer-drain')emit({type:'csc-writer-drained',request_id:id,durable:true});
   if(type==='csc-writer-begin-key-boundary')emit({type:'csc-writer-key-boundary-ready',request_id:id,key_restart:v.header.key_restart,durable:true});
   if(type==='csc-writer-write-cycle'){comm.set(v.event.id,v.event);emit({type:'csc-writer-cycle-written',request_id:id,id:v.event.id,durable:true});}
   if(type==='csc-comm-configure')emit({type:'csc-comm-configured',request_id:id,schema:1});
  }
 }
 class URLStub{}
 URLStub.createObjectURL=()=> 'blob:fixture';URLStub.revokeObjectURL=()=>{};
 const service={
  status:async()=>({state:'open',key_restart:restart,redaction_key_epoch:1,expires_at_ms:Date.now()+300000}),
  cycleEvents:async()=>[cycle],dispose:()=>{},admit:async()=>({token:'test-token-12345678',metadata:{key_restart:restart}}),
  provision:()=>{},complete:async()=>{}
 };
 const store={subscribe:()=>()=>{},read:async()=>null,write:async()=>{},dispose:()=>{}};
 const make=new Function('assert','Worker','Blob','URL','globalThis',
  'cscCommDiskWorkerSource','cscControlSharedStore',
  'communicationPersistentHmacCurrentTabService',
  'VERSION','location','currentConversationId',
  'communicationLogConversationName','cscBindCommWorker',
  source+'\ncscControlsRegisterHmacFactory(communicationPersistentHmacCurrentTabService);'+
  '\nreturn {ctrl:cscControlsCurrent,attach:cscAttachPhysicalDirectory};');
 const app=make(assert,WorkerStub,class{},URLStub,
  {__dcCompressor:{wasmGzipBase64:'x'.repeat(100)}},
  ()=>'',()=>store,()=>service,'1.11.15',
  {origin:'https://chatgpt.com'},()=>'conv-A',()=>'conversation',
  x=>binds.push(x));
 return {app,root,disk,messages,comm,binds};
}
test('real accepted controller reconciles one cycle to both GEN and COMM',async()=>{
 const f=fixture();
 await f.app.attach(f.root);
 assert.equal(await f.app.ctrl().reconcileCycles(),1);
 assert.equal(f.comm.has(cycle.id),true);
 const rows=[...f.disk.values()].map(v=>new TextDecoder().decode(v)
  .trimEnd().split('\n').map(JSON.parse));
 assert.equal(rows.length,1);
 assert.deepEqual(rows[0][0],{version:{gen:'1.11.15',comm:'1.11.15'},key_restart:restart});
 assert.deepEqual(rows[0][1],cycle);
 assert.deepEqual(f.messages.map(x=>x.type).filter(x=>
  ['csc-comm-drain','csc-writer-drain','csc-writer-begin-key-boundary',
   'csc-writer-write-cycle'].includes(x)),
  ['csc-comm-drain','csc-writer-drain','csc-writer-begin-key-boundary',
   'csc-writer-write-cycle']);
 assert.equal(f.binds.some(Boolean),true);
});
