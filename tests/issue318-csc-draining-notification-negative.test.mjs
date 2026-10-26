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

function fixture() {
  const ctx = vm.createContext({});
  vm.runInContext(schema + control +
    '\nthis.make=cscCaptureControlPlane;', ctx);
  let changed = null;
  let keyState = 'open';
  let statusError = false;
  const calls = { pauses: 0, resumes: 0, configs: 0 };
  const settings = { schema: 1, mode: 'replay-essentials',
    binary: false, cross_origin: false, auth_headers: false, all: false };
  const store = {
    read: async () => settings,
    write: async () => {},
    subscribe: fn => { changed = fn; return () => { changed = null; }; }
  };
  const service = {
    status: async () => {
      if (statusError) throw Error('key-service-offline');
      return { state: keyState,
        key_restart: '2026-10-26T10:00:00.000Z',
        redaction_key_epoch: 1 };
    },
    dispose: () => {}
  };
  const worker = {
    pause: async () => { calls.pauses++; },
    configure: async request => {
      calls.configs++;
      return { type: 'csc-comm-configured',
        schema: request.schema, request_id: request.request_id };
    },
    resume: async () => { calls.resumes++; },
    provisionTarget: { postMessage() {} },
    awaitKey: async () => ({})
  };
  const controller = ctx.make({
    store, serviceFactory: () => service,
    version: '1.11.15-issue.318.10', origin: 'https://chatgpt.com'
  });
  return { controller, worker, calls,
    drain: () => { keyState = 'draining'; },
    fail: () => { statusError = true; },
    signal: async () => {
      changed();
      for (let i = 0; i < 12; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  };
}

test('focus or cross-tab notifications cannot resume Worker during HMAC drain',
  async () => {
    const f = fixture();
    await f.controller.init();
    await f.controller.bindWorker(f.worker);
    assert.equal(f.controller.snapshot().settings_applied, true);
    f.drain();
    await f.controller.refreshKey();
    assert.equal(f.controller.snapshot().settings_applied, false);
    const beforeResumes = f.calls.resumes;
    await f.signal();
    assert.equal(f.calls.resumes, beforeResumes,
      'Worker must remain paused throughout producer DRAINING');
    assert.equal(f.controller.snapshot().settings_applied, false);
    f.controller.dispose();
  });

test('focus or cross-tab notifications cannot resume Worker after failed HMAC status',
  async () => {
    const f = fixture();
    await f.controller.init();
    await f.controller.bindWorker(f.worker);
    f.fail();
    await f.controller.refreshKey();
    assert.equal(f.controller.snapshot().key_state, 'failed');
    const beforeResumes = f.calls.resumes;
    await f.signal();
    assert.equal(f.calls.resumes, beforeResumes,
      'Worker must remain paused after HMAC status failure');
    assert.equal(f.controller.snapshot().settings_applied, false);
    f.controller.dispose();
  });

test('remote HMAC drain unseen by cached state blocks settings-triggered resume',
  async () => {
    const f = fixture();
    await f.controller.init();
    await f.controller.bindWorker(f.worker);
    assert.equal(f.controller.snapshot().key_state, 'open');
    const beforeResumes = f.calls.resumes;
    // A different tab begins draining; this local controller is stale.
    f.drain();
    await f.signal();
    assert.equal(f.controller.snapshot().key_state, 'draining');
    assert.equal(f.controller.snapshot().settings_applied, false);
    assert.equal(f.calls.resumes, beforeResumes,
      'settings notifications must never resume using stale HMAC status');
    f.controller.dispose();
  });

test('HMAC draining while Worker configure ACK is in flight prevents resume',
  async () => {
    const f = fixture();
    await f.controller.init();
    await f.controller.bindWorker(f.worker);
    const initialResumes = f.calls.resumes;
    let respond;
    f.worker.configure = async r => new Promise(resolve => {
      respond = () => resolve({ type: 'csc-comm-configured',
        schema: r.schema, request_id: r.request_id });
    });
    const next = { schema: 1, mode: 'replay-essentials',
      binary: false, cross_origin: false, auth_headers: false, all: false };
    const change = f.controller.setOptions(next, false);
    for (let i=0; i<30 && !respond; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(typeof respond, 'function',
      'configure request must reach asynchronous ACK boundary');
    f.drain();
    respond();
    await assert.rejects(change, /csc-settings-apply-failed|csc-key-status-failed/,
      'pending settings cannot resume capture after producer begins drain');
    assert.equal(f.calls.resumes, initialResumes);
    assert.equal(f.controller.snapshot().settings_applied, false);
    f.controller.dispose();
  });

test('dispose during in-flight Worker config cannot resume capture',
  async () => {
    const f = fixture();
    await f.controller.init();
    await f.controller.bindWorker(f.worker);
    const beforeResumes = f.calls.resumes;
    const beforePauses = f.calls.pauses;
    let respond;
    f.worker.configure = async request => new Promise(resolve => {
      respond = () => resolve({type:'csc-comm-configured',
        schema:request.schema,request_id:request.request_id});
    });
    const options = { schema:1, mode:'replay-essentials',
      binary:false,cross_origin:false,auth_headers:false,all:false };
    const change = f.controller.setOptions(options,false);
    for(let i=0;i<30&&!respond;i++){
      await new Promise(resolve=>setImmediate(resolve));
    }
    assert.equal(typeof respond,'function');
    f.controller.dispose();
    respond();
    await assert.rejects(change,/csc-settings-apply-failed|csc-controls-disposed/);
    assert.equal(f.calls.resumes,beforeResumes,
      'disposed controller must never restart Worker capture');
    assert.ok(f.calls.pauses>beforePauses);
    assert.equal(f.controller.snapshot().settings_applied,false);
  });

test('late Worker resume completion after disposal is followed by final pause',
  async () => {
    const f = fixture();
    await f.controller.init();
    await f.controller.bindWorker(f.worker);
    const events = [];
    let releaseResume;
    f.worker.pause = async () => { events.push('pause'); };
    f.worker.resume = async () => new Promise(resolve => {
      releaseResume = () => { events.push('resume'); resolve(); };
    });
    const settings = { schema:1, mode:'replay-essentials',
      binary:false, cross_origin:false, auth_headers:false, all:false };
    const change = f.controller.setOptions(settings,false);
    for(let i=0;i<30&&!releaseResume;i++) {
      await new Promise(resolve=>setImmediate(resolve));
    }
    assert.equal(typeof releaseResume,'function');
    f.controller.dispose();
    releaseResume();
    await assert.rejects(change,/csc-settings-apply-failed|csc-controls-disposed/);
    assert.equal(events.at(-1),'pause',
      'a late resume must be followed by a final Worker pause');
    assert.equal(f.controller.snapshot().settings_applied,false);
  });
