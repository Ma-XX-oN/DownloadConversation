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

for (const status of ['unavailable', 'pending', 'unknown']) {
  test('non-open HMAC producer state '+status+' must not arm Worker', async () => {
    const context = vm.createContext({});
    vm.runInContext(schema + control +
      '\nthis.create=cscCaptureControlPlane;', context);
    let resumed = 0, configured = 0, paused = 0;
    const worker = {
      pause: async () => { paused++; },
      resume: async () => { resumed++; },
      configure: async request => {
        configured++;
        return {type:'csc-comm-configured',schema:request.schema,
          request_id:request.request_id};
      },
      provisionTarget: {postMessage(){}},
      awaitKey: async () => ({})
    };
    const service = {
      status: async () => ({state:status}),
      dispose() {}
    };
    const controls = context.create({
      store:{read:async()=>null,subscribe:()=>()=>{},dispose(){}},
      serviceFactory:()=>service,version:'1.11.15-issue.318.34',
      origin:'https://chatgpt.com'
    });
    await controls.init();
    await assert.rejects(controls.bindWorker(worker),
      /csc-key-status-not-open/);
    assert.equal(controls.snapshot().settings_applied,false);
    assert.equal(controls.snapshot().settings_state,'failed');
    assert.equal(configured,0);
    assert.equal(resumed,0);
    assert.ok(paused > 0);
    controls.dispose();
  });
}

test('HMAC status becomes unavailable after resume: Worker must be paused', async () => {
  const context = vm.createContext({});
  vm.runInContext(schema + control +
    '\nthis.create=cscCaptureControlPlane;', context);
  let statusReads=0, resumed=0, paused=0;
  const service = {
    status:async () => ({
      state:++statusReads >= 4 ? 'unavailable' : 'open',
      key_restart:'2026-10-27T15:00:00.000Z'
    }),
    dispose() {}
  };
  const controls = context.create({
    store:{read:async()=>null,subscribe:()=>()=>{},dispose(){}},
    serviceFactory:()=>service,version:'1.11.15-issue.318.34',
    origin:'https://chatgpt.com'
  });
  const worker = {
    pause:async()=>{paused++;},
    resume:async()=>{resumed++;},
    configure:async request=>({
      type:'csc-comm-configured',schema:request.schema,
      request_id:request.request_id
    }),
    provisionTarget:{postMessage(){}},
    awaitKey:async()=>({})
  };
  await controls.init();
  await assert.rejects(controls.bindWorker(worker),
    /csc-settings-apply-failed/);
  assert.equal(resumed,1,'late key state changed after Worker resume');
  assert.ok(paused>=2,'final pause must follow a completed resume');
  assert.equal(controls.snapshot().settings_applied,false);
  controls.dispose();
});

test('refresh to unavailable pauses applied Worker', async () => {
  const context=vm.createContext({});
  vm.runInContext(schema+control+'\nthis.create=cscCaptureControlPlane;',context);
  let state='open', pauses=0;
  const controls=context.create({
    store:{read:async()=>null,subscribe:()=>()=>{},dispose(){}},
    serviceFactory:()=>({status:async()=>({state,key_restart:'2026-10-27T15:00:00.000Z'}),dispose(){}}),
    version:'test',origin:'https://chatgpt.com'
  });
  await controls.init();
  await controls.bindWorker({
    pause:async()=>{pauses++;},resume:async()=>{},
    configure:async x=>({type:'csc-comm-configured',schema:x.schema,request_id:x.request_id}),
    awaitKey:async()=>({}),provisionTarget:{postMessage(){}}
  });
  assert.equal(controls.snapshot().settings_applied,true);
  const before=pauses;
  state='unavailable';
  await controls.refreshKey();
  assert.ok(pauses>before);
  assert.equal(controls.snapshot().settings_applied,false);
  controls.dispose();
});
