import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ingress = readFileSync(path.join(root,
  'src/userscript/02-network-communication/03-csc-canonical-ingress.js'), 'utf8');

function exactIngressHarness() {
  const state = { plugin: [], worker: [], warnings: [], clones: 0, ordinal: 0 };
  const worker = {
    postMessage(message, transfer = []) {
      state.worker.push(structuredClone(message, { transfer }));
    }
  };
  const context = vm.createContext({
    Date, performance, Request, Response, Headers, ReadableStream, Uint8Array,
    ArrayBuffer, Blob, Object, Promise, String, Map,
    crypto: { randomUUID: () => 'ownership-' + ++state.ordinal },
    stockNetworkSequence: 0,
    cloneSafely(value) {
      state.clones++;
      return value.clone();
    },
    assert: (condition, reason) => assert.ok(condition, reason),
    cancelReadableBodyQuietly: async body => body.cancel(),
    boundedDiagnosticText: value => String(value),
    errorMessage: error => String(error?.message ?? error),
    logDiagnostic(level, name, info) { state.warnings.push({ level, name, info }); }
  });
  vm.runInContext(ingress + '\n' + [
    'globalThis.csc = { cscCaptureNow, cscBindCommWorker,',
    ' cscBindPluginIngress, cscPublishFetch };'
  ].join(''), context);
  context.csc.cscBindCommWorker(worker);
  context.csc.cscBindPluginIngress(item => state.plugin.push(item));
  return { api: context.csc, state };
}

test('#309 GREEN: plugin reading a cloned Response preserves stock ChatGPT body', async () => {
  const { api, state } = exactIngressHarness();
  const stock = new Response('stock-body-must-remain-intact');
  const event = api.cscCaptureNow('fetch', 'response');
  api.cscPublishFetch(event, stock, { status: 200 });
  assert.equal(state.clones, 2,
    'Exactly one plugin branch and one COMM branch, no Worker handoff clone');
  assert.equal(state.plugin.length, 1);
  assert.equal(state.worker.length, 1);
  assert.equal(await state.plugin[0].source.text(), 'stock-body-must-remain-intact',
    'Plugin requires the unsanitized body');
  assert.equal(await stock.text(), 'stock-body-must-remain-intact',
    'Plugin body must never consume the original page-owned Response');
});

test('#309 GREEN: late plugin body access survives stock finishing first', async () => {
  const { api, state } = exactIngressHarness();
  const stock = new Response('late-plugin-raw-body');
  const event = api.cscCaptureNow('fetch', 'response');
  api.cscPublishFetch(event, stock, { status: 200 });
  assert.equal(await stock.text(), 'late-plugin-raw-body');
  assert.equal(await state.plugin[0].source.text(), 'late-plugin-raw-body',
    'Delayed plugin queue retains an independent cloned body after stock completion');
});
