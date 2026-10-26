import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const schema = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-schema.js',
  import.meta.url), 'utf8');
const controls = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-control-plane.js',
  import.meta.url), 'utf8');

const safe = () => ({ schema: 1, mode: 'replay-essentials',
  binary: false, cross_origin: false, auth_headers: false, all: false });
const broad = () => ({ schema: 1, mode: 'everything',
  binary: true, cross_origin: false, auth_headers: false, all: false });

test('capture admission in-flight cannot survive a changed Worker configuration',
  {timeout:4000}, async () => {
    const ctx = vm.createContext({});
    vm.runInContext(schema+controls+'\nthis.create=cscCaptureControlPlane;',ctx);
    let stored=safe(), completeCount=0, resolveKey=null;
    let admissionStarted=false;
    const store={
      read:async()=>stored,
      write:async next=>{ stored=next; },
      subscribe:()=>()=>{}
    };
    const restart='2026-10-26T13:00:00.000Z';
    const service={
      status:async()=>({state:'open',key_restart:restart,
        redaction_key_epoch:1}),
      cycleEvents:async()=>[],
      admit:async()=>({token:'one',metadata:{key_restart:restart}}),
      provision:()=>{},
      complete:async()=>{completeCount++;},
      dispose:()=>{}
    };
    const worker={
      pause:async()=>{},
      resume:async()=>{},
      configure:async r=>({
        type:'csc-comm-configured',schema:r.schema,request_id:r.request_id
      }),
      provisionTarget:{postMessage(){}},
      awaitKey:async token=>{
        admissionStarted=true;
        return new Promise(resolve=>{resolveKey=()=>{
          resolve({type:'csc-comm-key-ready',token});
        };});
      }
    };
    const sink={
      hasCycle:async()=>false,
      beginSegment:async h=>({durable:true,key_restart:h.key_restart}),
      writeCycle:async e=>({durable:true,id:e.id}),
      drain:async()=>({durable:true}),
      beginKeyBoundary:async h=>({durable:true,key_restart:h.key_restart})
    };
    const controller=ctx.create({
      store,serviceFactory:()=>service,origin:'https://chatgpt.com',
      version:'1.11.15-issue.318.11'
    });
    await controller.init();
    controller.bindSinks({gen:sink,comm:sink});
    await controller.bindWorker(worker);
    const admission=controller.prepareCapture();
    for(let i=0;i<30 && !admissionStarted;i++){
      await new Promise(resolve=>setImmediate(resolve));
    }
    assert.ok(admissionStarted,'admission reached asynchronous Worker key ACK');
    await controller.setOptions(broad(),true);
    assert.equal(controller.snapshot().settings_applied,true);
    assert.equal(controller.snapshot().settings.mode,'everything');
    resolveKey();
    await assert.rejects(admission,/csc-capture-settings-changed/,
      'in-flight old-config capture must not survive a settings transition');
    assert.equal(completeCount,1,
      'aborted admission token released even after policy changed');
    controller.dispose();
  });
