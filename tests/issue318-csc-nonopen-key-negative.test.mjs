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
