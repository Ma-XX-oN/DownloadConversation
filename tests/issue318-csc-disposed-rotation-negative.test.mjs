import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-schema.js',
  import.meta.url), 'utf8') + readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-control-plane.js',
  import.meta.url), 'utf8');

test('disposed controller cancels queued HMAC Randomize before key mutation',
  async () => {
    const ctx = vm.createContext({});
    vm.runInContext(source + '\nthis.make=cscCaptureControlPlane;', ctx);
    let rotations = 0;
    const stamp = '2026-10-26T17:00:00.000Z';
    const service = {
      status: async () => ({ state:'open', key_restart:stamp,
        redaction_key_epoch:1 }),
      cycleEvents: async () => [],
      randomize: async () => {
        rotations++;
        return {state:'COMMITTED',key_restart:stamp};
      },
      dispose: () => {}
    };
    const store = { read:async()=>null, write:async()=>{},
      subscribe:()=>()=>{} };
    const worker = { pause:async()=>{}, resume:async()=>{},
      configure:async req => ({type:'csc-comm-configured',
        schema:req.schema,request_id:req.request_id}),
      provisionTarget:{postMessage(){}}, awaitKey:async()=>{} };
    const sink = { hasCycle:async()=>true,
      beginSegment:async()=>({durable:true,key_restart:stamp}),
      writeCycle:async()=>({durable:true}),
      beginKeyBoundary:async()=>({durable:true,key_restart:stamp}),
      drain:async()=>({durable:true}) };
    const control = ctx.make({store,serviceFactory:()=>service,
      version:'1.11.15-issue.318.25', origin:'https://chatgpt.com'});
    await control.init();
    control.bindSinks({gen:sink,comm:sink});
    await control.bindWorker(worker);
    assert.equal(control.snapshot().settings_applied,true);
    const pending = control.randomize(true);
    control.dispose();
    await assert.rejects(pending,/csc-randomize-failed|csc-controls-disposed/);
    assert.equal(rotations,0,
      'queued HMAC key replacement must not commit after disposal');
    assert.equal(control.snapshot().settings_applied,false);
  });
