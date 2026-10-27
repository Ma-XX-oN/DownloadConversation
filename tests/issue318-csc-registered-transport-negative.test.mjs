import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const shared = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-shared-settings.js',
  import.meta.url), 'utf8');
const schema = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-schema.js',
  import.meta.url), 'utf8');
const control = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-control-plane.js',
  import.meta.url), 'utf8');

test('raw page realm fails closed without IndexedDB or GM grants', async () => {
  let closed = false;
  const ctx = vm.createContext({
    crypto: { getRandomValues: array => array.fill(37) },
    BroadcastChannel: class {
      close() { closed = true; }
    }
  });
  vm.runInContext(shared + schema + control +
    '\nthis.store = cscControlSharedStore();' +
    '\nthis.controller = cscCaptureControlPlane({' +
    'store:this.store,origin:"https://chatgpt.com",version:"1.11.15"});', ctx);
  await assert.rejects(ctx.store.read(), /csc-settings-indexeddb-unavailable/);
  await assert.rejects(ctx.store.write({
    schema: 1, mode: 'everything',
    binary: true, cross_origin: true,
    auth_headers: true, all: true
  }), /csc-settings-indexeddb-unavailable/);
  await ctx.controller.init();
  const state = ctx.controller.snapshot();
  assert.equal(state.settings_state, 'failed');
  assert.equal(state.settings_applied, false);
  assert.equal(state.settings.all, false);
  assert.equal(state.error, 'csc-settings-storage-unavailable');
  let configs = 0;
  await assert.rejects(ctx.controller.bindWorker({
    pause: async () => {},
    configure: async () => { configs++; return {}; },
    resume: async () => {},
    provisionTarget: { postMessage() {} },
    awaitKey: async () => ({})
  }), /csc-settings-storage-unavailable/);
  assert.equal(configs, 0, 'no settings publication after storage failure');
  ctx.controller.dispose();
  assert.equal(closed, true, 'broadcast channel is released');
});

test('closed native settings store cannot be reused or fall back to localStorage',
  async () => {
    const ctx = vm.createContext({
      crypto: { getRandomValues: array => array.fill(0) },
      localStorage: new Proxy({}, {
        get() { throw Error('forbidden-localStorage-access'); }
      }),
      GM_getValue() { throw Error('forbidden-GM-bridge'); }
    });
    vm.runInContext(shared + '\nthis.store=cscControlSharedStore();',ctx);
    ctx.store.dispose();
    await assert.rejects(ctx.store.read(), /csc-settings-store-closed/);
    await assert.rejects(ctx.store.write({}), /csc-settings-store-closed/);
  });
