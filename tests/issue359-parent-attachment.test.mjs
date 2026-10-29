import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const source=readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-parent-assembly.js',
  import.meta.url),'utf8');
function fixture() {
  const calls=[],instances=[];
  let id='conversation-A';
  const controller={
    init:async()=>{calls.push('init');},
    snapshot:()=>({key_restart:'2026-10-29T04:30:00.000Z'}),
    bindSinks:ports=>{assert.ok(ports.gen&&ports.comm);calls.push('sinks');},
    bindWorker:async()=>{calls.push('worker');}
  };
  const create=new Function('assert','currentConversationId',
    'communicationLogConversationName','cscAssemblyBridge',
    'cscControlsCurrent','VERSION',source+
    '\nreturn {attach:cscAttachPhysicalDirectory,dispose:cscDisposePhysicalDirectory};');
  const api=create(assert,()=>id,()=>'title',(handle,ns,version)=>{
    calls.push('create:'+ns);
    const instance={
      comm:{hasCycle:async()=>{calls.push('history');}},
      openGen:async()=>{calls.push('gen');return {writeCycle:async()=>{}};},
      controllerWorker:{},
      dispose:()=>{calls.push('dispose');}
    };
    instances.push(instance);
    return instance;
  },()=>controller,'1.11.15');
  return {api,calls,instances,rename:value=>{id=value;}};
}
test('accepted controller binds existing granted root with no second picker',async()=>{
  const f=fixture(),root={getDirectoryHandle:async()=>{}};
  const result=await f.api.attach(root);
  assert.deepEqual(result,{attached:true,namespace:'conversation-A'});
  assert.deepEqual(f.calls,[
    'create:conversation-A','init','gen','history','sinks','worker'
  ]);
  await f.api.attach(root);
  assert.equal(f.instances.length,1);
});
test('conversation navigation disposes prior worker and rebinds new namespace',async()=>{
  const f=fixture(),root={getDirectoryHandle:async()=>{}};
  await f.api.attach(root);
  f.rename('conversation-B');
  await f.api.attach(root);
  assert.equal(f.instances.length,2);
  assert.ok(f.calls.includes('dispose'));
  f.api.dispose();
  assert.equal(f.calls.filter(x=>x==='dispose').length,2);
});
test('physical assembly failure does not retain a stale bridge',async()=>{
  const root={getDirectoryHandle:async()=>{}};
  let disposed=0;
  const create=new Function('assert','currentConversationId',
    'communicationLogConversationName','cscAssemblyBridge',
    'cscControlsCurrent','VERSION',source+
    '\nreturn cscAttachPhysicalDirectory;');
  const attach=create(assert,()=>'A',()=>'title',()=>({
    openGen:async()=>{throw Error('disk denied');},
    dispose:()=>{disposed++;}
  }),()=>({init:async()=>{},snapshot:()=>({})}),'1.11.15');
  await assert.rejects(()=>attach(root),/disk denied/);
  assert.equal(disposed,1);
});
