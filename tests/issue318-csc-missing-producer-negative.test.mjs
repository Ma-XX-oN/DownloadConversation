import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const schema = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-schema.js',
  import.meta.url), 'utf8');
const control = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-control-plane.js',
  import.meta.url), 'utf8');

test('missing registered producer cannot report Worker capture settings applied',
  async () => {
    const context = vm.createContext({});
    vm.runInContext(schema + control +
      '\nthis.create=cscCaptureControlPlane;', context);
    let paused=0, resumed=0, configured=0;
    const store = {read:async()=>null, write:async()=>{},
      subscribe:()=>()=>{}};
    const worker = {
      pause:async()=>{paused++;},
      resume:async()=>{resumed++;},
      configure:async request=>{
        configured++;
        return {type:'csc-comm-configured',schema:request.schema,
          request_id:request.request_id};
      },
      provisionTarget:{postMessage(){}},
      awaitKey:async()=>({})
    };
    const controller = context.create({store,origin:'https://chatgpt.com',
      version:'1.11.15-issue.318.29'});
    await controller.init();
    assert.equal(controller.snapshot().key_state,'unavailable');
    await controller.bindWorker(worker);
    assert.equal(controller.snapshot().settings_applied,false,
      'unregistered HMAC producer must not advertise active capture');
    assert.notEqual(controller.snapshot().settings_state,'applied');
    assert.equal(resumed,0,
      'unregistered producer must never resume an active Worker');
    assert.ok(paused>0);
    await assert.rejects(controller.prepareCapture(),/csc-capture-not-ready/);
    controller.dispose();
  });
