
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const schemaSource = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-schema.js',
  import.meta.url), 'utf8');
const singletonSource = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-singleton.js',
  import.meta.url), 'utf8');

import vm from 'node:vm';

const sharedSource = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-shared-settings.js',
  import.meta.url), 'utf8');
const source = schemaSource + readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-control-plane.js',
  import.meta.url), 'utf8') + singletonSource;

function fixture(raw = null) {
  const context = vm.createContext({ location: { origin: 'https://chatgpt.com' },
    VERSION: '1.11.13-issue.318.1' });
  vm.runInContext(source + '\nthis.testExports = {' +
    'cscCaptureControlPlane, cscControlValidateOptions, CSC_CONTROL_DEFAULTS};',
  context);
  let saved = raw;
  let subscribed = null;
  const writes = [];
  const store = {
    read: async () => saved,
    write: async next => { saved = next; writes.push(next); },
    subscribe: fn => { subscribed = fn; return () => { subscribed = null; }; }
  };
  const keys = {
    current: '2026-10-23T11:00:00.000Z',
    epoch: 1,
    pending: false, statusFails: false, rotationFails: false,
    initialized: true,
    completeFails: false,
    journal: [{ type: 'hmac-key-cycle', id:
      'hmac-key-cycle:2026-10-23T11:00:00.000Z',
      key_restart: '2026-10-23T11:00:00.000Z',
      epoch: 1, occurred_at_ms: Date.parse('2026-10-23T11:00:00.000Z'),
      reason: 'initial' }]
  };
  const calls = { configure: [], pause: 0, resume: 0, provision: [],
    genHeaders: [], commHeaders: [], genEvents: [], commEvents: [] };
  const committed = { gen: new Set(), comm: new Set() };
  const hmac = {
    status: async () => {
      if (keys.statusFails) throw Error('key-store-offline');
      if (!keys.initialized) return { state: 'uninitialized' };
      return { state: keys.pending ? 'draining' : 'open',
      key_restart: keys.current, redaction_key_epoch: keys.epoch,
      expires_at_ms: Date.parse(keys.current) + 24 * 60 * 60 * 1000 };
    },
    cycleEvents: async after => keys.journal.filter(v => v.epoch > after),
    admit: async () => {
      if (!keys.initialized) {
        keys.initialized = true;
        keys.journal.push({ type: 'hmac-key-cycle',
          id: 'hmac-key-cycle:' + keys.current, key_restart: keys.current,
          epoch: keys.epoch, occurred_at_ms: Date.parse(keys.current),
          reason: 'initial' });
      }
      return { token: 't01', metadata: { key_restart: keys.current } };
    },
    provision: (token, target) => target.postMessage({ type: 'dc-hmac-key-v2', token }),
    complete: async () => {
      if (keys.completeFails) throw Error('hmac-release-failed');
    },
    randomize: async confirmed => {
      assert.equal(confirmed, true);
      if (keys.rotationFails) throw Error('rotation-transaction-failed');
      if (keys.pending) return { state: 'DRAINING' };
      keys.epoch++;
      keys.current = '2026-10-23T12:00:00.000Z';
      keys.journal.push({ type: 'hmac-key-cycle',
        id: 'hmac-key-cycle:' + keys.current, key_restart: keys.current,
        epoch: keys.epoch, occurred_at_ms: Date.parse(keys.current),
        reason: 'manual' });
      return { state: 'COMMITTED', key_restart: keys.current };
    },
    dispose: () => {}
  };
  const worker = {
    pause: async () => { calls.pause++; },
    configure: async request => {
      calls.configure.push(request);
      return { type: 'csc-comm-configured', schema: request.schema,
        request_id: request.request_id };
    },
    resume: async () => { calls.resume++; },
    provisionTarget: { postMessage: event => calls.provision.push(event) },
    awaitKey: async token => ({ type: 'csc-comm-key-ready', token })
  };
  const gen = {
    hasCycle: async id => committed.gen.has(id),
    beginSegment: async header => { calls.genHeaders.push(header);
      return { durable: true, key_restart: header.key_restart }; },
    writeCycle: async event => { committed.gen.add(event.id);
      calls.genEvents.push(event); return { durable: true, id: event.id }; }
  };
  const comm = {
    drain: async () => ({ durable: true }),
    hasCycle: async id => committed.comm.has(id),
    beginKeyBoundary: async header => { calls.commHeaders.push(header);
      return { durable: true, key_restart: header.key_restart }; },
    writeCycle: async event => { committed.comm.add(event.id);
      calls.commEvents.push(event); return { durable: true, id: event.id }; }
  };
  const control = context.testExports.cscCaptureControlPlane({
    store, serviceFactory: () => hmac, origin: 'https://chatgpt.com',
    version: '1.11.13-issue.318.1'
  });
  return { control, store, worker, gen, comm, keys, calls, writes,
    committed, get saved() { return saved; },
    deliver: next => { saved = next; subscribed(next); },
    exports: context.testExports };
}
function fullOptions() {
  return { schema: 1, mode: 'everything', binary: true,
    cross_origin: true, auth_headers: true, all: true };
}

test('safe defaults, no worker success claim and no captured secrets', async () => {
  const f = fixture();
  await f.control.init();
  const s = f.control.snapshot();
  assert.equal(s.settings.mode, 'replay-essentials');
  assert.equal(s.settings.all, false);
  assert.equal(s.settings.binary, false);
  assert.equal(s.settings_applied, false);
  assert.equal(s.settings_state, 'pending');
  assert.equal(s.key_restart, f.keys.current);
  assert.equal(Object.keys(s).some(x => /key_hex|key_bytes/.test(x)), false);
});

test('expanded scope requires explicit confirmation, then persists versioned policy', async () => {
  const f = fixture();
  await f.control.init();
  await f.control.bindWorker(f.worker);
  await assert.rejects(f.control.setOptions(fullOptions(), false),
    /csc-sensitive-capture-not-confirmed/);
  assert.equal(f.writes.length, 0);
  await f.control.setOptions(fullOptions(), true);
  assert.equal(f.saved.schema, 1);
  assert.equal(f.calls.configure.at(-1).options.mode, 'everything');
  assert.equal(f.calls.configure.at(-1).options.origin, 'https://chatgpt.com');
  assert.equal(f.control.snapshot().settings_state, 'applied');
  assert(f.calls.pause >= 2);
});

test('Worker acknowledgement lacking request identity fails closed', async () => {
  const f = fixture();
  f.worker.configure = async () => ({ type: 'csc-comm-configured' });
  await f.control.init();
  await assert.rejects(f.control.bindWorker(f.worker), /csc-settings-apply-failed/);
  assert.equal(f.control.snapshot().settings_state, 'failed');
  assert.equal(f.control.snapshot().settings_applied, false);
  assert.equal(f.calls.resume, 0);
  await assert.rejects(f.control.prepareCapture(), /csc-capture-not-ready/);
});

test('Worker reset requires fresh acknowledgement before admitting capture', async () => {
  const f = fixture();
  await f.control.init();
  await f.control.bindWorker(f.worker);
  const interrupted = { ...f.worker, configure: async () => {
    throw new Error('worker-restarted');
  }};
  await assert.rejects(f.control.bindWorker(interrupted),
    /csc-settings-apply-failed/);
  assert.equal(f.control.snapshot().settings_applied, false);
  await f.control.bindWorker(f.worker);
  assert.equal(f.control.snapshot().settings_applied, true);
});

test('remote duplicate-tab preference change re-applies only after Worker ack', async () => {
  const f = fixture();
  await f.control.init();
  await f.control.bindWorker(f.worker);
  f.deliver({ schema: 1, mode: 'replay-essentials', binary: true,
    cross_origin: false, auth_headers: false, all: false });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.control.snapshot().settings.binary, true);
  assert.equal(f.control.snapshot().settings_applied, false);
  assert.equal(f.control.snapshot().settings_state, 'pending');
  assert.equal(f.calls.configure.at(-1).options.binary, false);
  await f.control.setOptions(f.control.snapshot().settings, true);
  assert.equal(f.control.snapshot().settings_applied, true);
  assert.equal(f.calls.configure.at(-1).options.binary, true);
  f.deliver({ schema: 999, mode: 'everything', all: true });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.control.snapshot().settings_applied, false);
  assert.equal(f.control.snapshot().settings_state, 'failed');
});

test('GEN and COMM receive identical version + key_restart and cycle events', async () => {
  const f = fixture();
  await f.control.init();
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  await f.control.bindWorker(f.worker);
  const admitted = await f.control.prepareCapture();
  assert.equal(admitted.metadata.key_restart, f.keys.current);
  assert.equal(f.calls.provision[0].type, 'dc-hmac-key-v2');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.genHeaders[0])),
    JSON.parse(JSON.stringify(f.calls.commHeaders[0])));
  assert.equal(f.calls.genEvents[0].id, f.calls.commEvents[0].id);
  assert.equal(f.calls.genEvents[0].key_restart, f.keys.current);
  await f.control.completeCapture(admitted.token);
  await f.control.reconcileCycles();
  assert.equal(f.calls.genEvents.length, 1, 'old journal events are idempotent');
});

test('confirmed Randomize drains first and creates an exact new segment', async () => {
  const f = fixture();
  await f.control.init();
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  await f.control.bindWorker(f.worker);
  await f.control.reconcileCycles();
  await assert.rejects(f.control.randomize(false), /csc-randomize-unconfirmed/);
  const result = await f.control.randomize(true);
  assert.equal(result.state, 'COMMITTED');
  assert.equal(f.calls.genHeaders.length, 2);
  assert.equal(f.calls.commHeaders.length, 2);
  assert.equal(f.calls.genHeaders[1].key_restart, f.keys.current);
  assert.equal(f.calls.commEvents[1].id, 'hmac-key-cycle:' + f.keys.current);
  assert.equal(f.control.snapshot().settings_applied, true);
});

test('an unacknowledged GEN cycle blocks progress and requires recovery', async () => {
  const f = fixture();
  await f.control.init();
  f.control.bindSinks({ gen: { ...f.gen, writeCycle: async () =>
    ({ durable: false }) }, comm: f.comm });
  await f.control.bindWorker(f.worker);
  await assert.rejects(f.control.reconcileCycles(), /csc-cycle-not-durable/);
  await assert.rejects(f.control.reconcileCycles(),
    /csc-cycle-recovery-requires-parent/);
});

test('malformed persistent settings fail closed and never enable all', async () => {
  const f = fixture({ schema: 999, mode: 'everything', all: true });
  await f.control.init();
  const state = f.control.snapshot();
  assert.equal(state.settings.mode, 'replay-essentials');
  assert.equal(state.settings.all, false);
  assert.equal(state.settings_state, 'failed');
  assert.equal(state.settings_applied, false);
});

test('failed persistence does not falsely publish applied options', async () => {
  const f = fixture();
  f.store.write = async () => { throw Error('storage-unavailable'); };
  await f.control.init();
  await f.control.bindWorker(f.worker);
  await assert.rejects(f.control.setOptions(fullOptions(), true),
    /csc-settings-persist-failed/);
  assert.equal(f.control.snapshot().settings_applied, false);
});

test('no off-record capture may enter without Worker and both durable sinks', async () => {
  const f = fixture();
  await f.control.init();
  await assert.rejects(f.control.prepareCapture(), /csc-capture-not-ready/);
  await assert.rejects(f.control.randomize(true), /csc-randomize-ports-not-ready/);
});

test('Worker cannot apply defaults before persisted shared startup policy loads', async () => {
  const f = fixture();
  let resolveStorage;
  f.store.read = () => new Promise(resolve => { resolveStorage = resolve; });
  const boot = f.control.init();
  const binding = f.control.bindWorker(f.worker);
  await new Promise(resolve => setImmediate(resolve));
  const earlyCount = f.calls.configure.length;
  resolveStorage(fullOptions());
  await boot;
  await binding;
  assert.equal(earlyCount, 0, 'no Worker configuration before IDB read resolves');
  assert.equal(f.control.snapshot().settings.mode, 'everything');
  assert.equal(f.control.snapshot().settings_applied, false);
  await f.control.setOptions(fullOptions(), true);
  assert.equal(f.calls.configure.at(-1).options.mode, 'everything');
  assert.equal(f.control.snapshot().settings_applied, true);
});

test('Worker pause errors report failed settings rather than indefinite pending', async () => {
  const f = fixture();
  f.worker.pause = async () => { throw Error('worker-offline'); };
  await f.control.init();
  await assert.rejects(f.control.bindWorker(f.worker));
  assert.equal(f.control.snapshot().settings_state, 'failed');
  assert.equal(f.control.snapshot().settings_applied, false);
});

test('HMAC status failure blocks admission and provisioning after config ack', async () => {
  const f = fixture();
  await f.control.init();
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  await f.control.bindWorker(f.worker);
  f.keys.statusFails = true;
  await assert.rejects(f.control.prepareCapture(), /csc-capture-not-ready/);
  assert.equal(f.calls.provision.length, 0);
  assert.equal(f.control.snapshot().settings_applied, false);
});

test('failed confirmed HMAC rotation visibly remains failed and unapplied', async () => {
  const f = fixture();
  await f.control.init();
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  await f.control.bindWorker(f.worker);
  f.keys.rotationFails = true;
  await assert.rejects(f.control.randomize(true));
  assert.equal(f.control.snapshot().settings_state, 'failed');
  assert.equal(f.control.snapshot().settings_applied, false);
});

test('settings transition fails visibly when a previously bound Worker goes offline', async () => {
  const f = fixture();
  await f.control.init();
  await f.control.bindWorker(f.worker);
  f.worker.pause = async () => { throw Error('worker-gone'); };
  await assert.rejects(f.control.setOptions(fullOptions(), true));
  assert.equal(f.control.snapshot().settings_state, 'failed');
  assert.equal(f.control.snapshot().settings_applied, false);
});

test('admission release storage failure cannot leave stale applied state', async () => {
  const f = fixture();
  await f.control.init();
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  await f.control.bindWorker(f.worker);
  f.keys.completeFails = true;
  f.worker.awaitKey = async () => { throw Error('worker-ack-lost'); };
  await assert.rejects(f.control.prepareCapture());
  assert.equal(f.control.snapshot().settings_state, 'failed');
  assert.equal(f.control.snapshot().settings_applied, false);
});

test('Randomize stays unavailable until settings and both durable sinks are bound', async () => {
  const f = fixture();
  await f.control.init();
  assert.equal(f.control.snapshot().can_randomize, false);
  await f.control.bindWorker(f.worker);
  assert.equal(f.control.snapshot().can_randomize, false);
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  assert.equal(f.control.snapshot().can_randomize, true);
  await f.control.randomize(true);
  assert.equal(f.control.snapshot().can_randomize, true);
});

test('assembled #313 producer factory is registered explicitly before startup', async () => {
  const context=vm.createContext({
    crypto: { getRandomValues: array => array.fill(17) },
    location:{origin:'https://chatgpt.com'},
    VERSION:'1.11.15-issue.318.2'
  });
  vm.runInContext(sharedSource+source+'\nthis.bridge={register:cscControlsRegisterHmacFactory,'+
    'current:cscControlsCurrent};',context);
  let created=0;
  context.bridge.register(()=>{
    created++;
    return { status:async()=>({state:'open',
      key_restart:'2026-10-23T11:00:00.000Z'}),
      dispose:()=>{} };
  });
  const control=context.bridge.current();
  assert.equal(created,0, 'producer factory is lazy until valid store initialization');
  assert.equal(control.snapshot().settings_applied,false);
  assert.throws(()=>context.bridge.register(()=>{}),/csc-hmac-factory-invalid-or-late/);
  control.dispose();
});

test('unrecorded historical HMAC scope is never re-created after newer scope', async () => {
  const f = fixture();
  await f.control.init();
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  await f.control.bindWorker(f.worker);
  f.keys.epoch = 2;
  f.keys.journal[0].epoch = 2;
  const older = '2026-10-23T10:00:00.000Z';
  f.keys.journal.unshift({ type: 'hmac-key-cycle', id: 'hmac-key-cycle:' + older,
    key_restart: older, epoch: 1, occurred_at_ms: Date.parse(older),
    reason: 'initial' });
  await assert.rejects(f.control.reconcileCycles(),
    /csc-cycle-history-not-durable/);
  assert.equal(f.calls.genHeaders.length, 0);
  assert.equal(f.calls.commHeaders.length, 0);
});

test('old durable cycle events can be verified without replay to newer epoch', async () => {
  const f = fixture();
  await f.control.init();
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  await f.control.bindWorker(f.worker);
  f.keys.epoch = 2;
  f.keys.journal[0].epoch = 2;
  const older = '2026-10-23T10:00:00.000Z';
  const id = 'hmac-key-cycle:' + older;
  f.keys.journal.unshift({ type: 'hmac-key-cycle', id,
    key_restart: older, epoch: 1, occurred_at_ms: Date.parse(older),
    reason: 'initial' });
  f.committed.gen.add(id);
  f.committed.comm.add(id);
  await f.control.reconcileCycles();
  assert.equal(f.calls.genHeaders.length, 1);
  assert.equal(f.calls.genHeaders[0].key_restart, f.keys.current);
});

test('half recorded historical HMAC cycle rejects without regenerating old segments', async () => {
  const f = fixture();
  await f.control.init();
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  await f.control.bindWorker(f.worker);
  f.keys.epoch = 2;
  f.keys.journal[0].epoch = 2;
  const older = '2026-10-23T10:00:00.000Z';
  const id = 'hmac-key-cycle:' + older;
  f.keys.journal.unshift({ type: 'hmac-key-cycle', id,
    key_restart: older, epoch: 1, occurred_at_ms: Date.parse(older),
    reason: 'initial' });
  f.committed.gen.add(id);
  await assert.rejects(f.control.reconcileCycles(),
    /csc-cycle-recovery-requires-parent/);
  assert.equal(f.calls.genHeaders.length, 0);
});

test('genuine #313 first-admission semantics initialize key before cycle boundary', async () => {
  const f = fixture();
  f.keys.initialized = false;
  f.keys.journal = [];
  await f.control.init();
  assert.equal(f.control.snapshot().key_state, 'uninitialized');
  f.control.bindSinks({ gen: f.gen, comm: f.comm });
  await f.control.bindWorker(f.worker);
  const admission = await f.control.prepareCapture();
  assert.equal(admission.metadata.key_restart, f.keys.current);
  assert.equal(f.calls.genHeaders[0].key_restart, f.keys.current);
  assert.equal(f.calls.commHeaders[0].key_restart, f.keys.current);
  assert.equal(f.control.snapshot().key_restart, f.keys.current);
  await f.control.completeCapture(admission.token);
});
