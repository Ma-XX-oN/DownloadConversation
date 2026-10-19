import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ingress = readFileSync(path.join(root,
  'src/userscript/02-network-communication/03-csc-canonical-ingress.js'), 'utf8');
const mib = count => count * 1024 * 1024;
const format = bytes => +(bytes / mib(1)).toFixed(2);
const chunkSize = 64 * 1024;

function stressHarness({ withPlugin = false } = {}) {
  const state = { transferred: [], pluginSources: [], published: 0, cloneCount: 0, warnings: [], index: 0 };
  const worker = {
    postMessage(payload, transfers) {
      state.transferred.push(structuredClone(payload, { transfer: transfers }));
    }
  };
  const context = vm.createContext({
    Date, performance, Response, ReadableStream, ArrayBuffer,
    Blob, Uint8Array, Headers, String, Object, Promise, Map,
    crypto: { randomUUID: () => 'stress-' + ++state.index },
    stockNetworkSequence: 0,
    cloneSafely(value) { state.cloneCount++; return value.clone(); },
    assert: (ok, msg) => assert.ok(ok, msg),
    cancelReadableBodyQuietly: async body => body.cancel(),
    boundedDiagnosticText: value => String(value),
    errorMessage: value => String(value?.message ?? value),
    logDiagnostic(level, event, details) { state.warnings.push({ level, event, details }); }
  });
  vm.runInContext(ingress + '\n' + [
    'globalThis.csc = { cscCaptureNow, cscBindCommWorker,',
    ' cscBindPluginIngress, cscPublishFetch };'
  ].join(''), context);
  context.csc.cscBindCommWorker(worker);
  if (withPlugin) context.csc.cscBindPluginIngress(event => {
    state.published++;
    state.pluginSources.push(event.source);
  });
  return { api: context.csc, state };
}

function payloadStream(length) {
  let count = 0;
  const countChunks = Math.ceil(length / chunkSize);
  return {
    stream: new ReadableStream({
      pull(controller) {
        if (count === length) { controller.close(); return; }
        const available = Math.min(chunkSize, length - count);
        const chunk = new Uint8Array(available);
        chunk.fill((Math.floor(count / chunkSize) * 31 + 7) & 255);
        count += available;
        controller.enqueue(chunk);
      }
    }, { highWaterMark: 1 }),
    produced: () => count,
    chunks: countChunks
  };
}

async function verifyAllBytes(stream, length) {
  const reader = stream.getReader();
  let total = 0;
  let ordinal = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      assert.equal(value instanceof Uint8Array, true);
      assert.equal(value.byteLength, Math.min(chunkSize, length - total));
      const expected = (ordinal * 31 + 7) & 255;
      for (let i = 0; i < value.byteLength; i++) {
        assert.equal(value[i], expected, 'Incorrect byte at ' + (total + i));
      }
      total += value.byteLength;
      ordinal++;
    }
    assert.equal(total, length);
    return ordinal;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Demonstrates native Response.clone() tee behaviour without a page-side
 * COMM queue, page-side decoder, body-size omission or invented backpressure.
 * This is NODE evidence, NOT a Chrome/Tampermonkey latency certificate.
 */
test('#309 10/23/40/101 MiB exact streams and three sustained >100 MiB runs', {
  timeout: 120000
}, async t => {
  for (const sizeMiB of [10, 23, 40, 101, 101, 101]) {
    const length = mib(sizeMiB);
    const h = stressHarness();
    const origin = payloadStream(length);
    const stockResponse = new Response(origin.stream, {
      headers: { 'content-type': 'application/octet-stream' }
    });
    const event = h.api.cscCaptureNow('fetch', 'response');
    let tickCount = 0;
    const interval = setInterval(() => { tickCount++; }, 20);
    const start = performance.now();
    h.api.cscPublishFetch(event, stockResponse, {
      method: 'GET', request_url: 'https://chatgpt.com/backend-api/history',
      status: 200
    });
    assert.equal(h.state.transferred.length, 1);
    assert.equal(h.state.published, 0, 'Absent plugin causes no second native clone');
    assert.equal(h.state.cloneCount, 1);
    assert.equal(h.state.transferred[0].envelope.captured_at_epoch_ms,
      event.captured_at_epoch_ms);
    // Simulated Worker is deliberately not consuming while stock drains.
    const stockChunks = await verifyAllBytes(stockResponse.body, length);
    const unreadAtStockCompletion = origin.produced();
    const memoryBeforeWorker = process.memoryUsage();
    await new Promise(resolve => setTimeout(resolve, 60));
    const workerChunks = await verifyAllBytes(
      h.state.transferred[0].envelope.body, length);
    clearInterval(interval);
    assert.equal(unreadAtStockCompletion, length);
    assert.equal(workerChunks, stockChunks);
    assert.equal(h.state.warnings.length, 0);
    t.diagnostic(JSON.stringify({
      source: 'isolated-node22-native-response-clone',
      payloadMiB: sizeMiB, fullPayloadStillUnreadMiB: format(unreadAtStockCompletion),
      arrayBuffersMiB: format(memoryBeforeWorker.arrayBuffers),
      heapUsedMiB: format(memoryBeforeWorker.heapUsed),
      rssMiB: format(memoryBeforeWorker.rss),
      eventLoopTicks: tickCount,
      elapsedMs: Math.round(performance.now() - start),
      stockExact: true, workerExact: true,
      warning: 'Measured native tee can buffer entire unread cloned branch; no bounded-backpressure certification'
    }));
  }
});

test('#309 dual active 10 MiB consumers independently preserve all stock bytes', {
  timeout: 120000
}, async t => {
  const len = mib(10);
  const h = stressHarness({ withPlugin: true });
  const origin = payloadStream(len);
  const stock = new Response(origin.stream);
  h.api.cscPublishFetch(h.api.cscCaptureNow('fetch', 'response'), stock,
    { request_url: 'https://chatgpt.com/backend-api/history', status: 200 });
  assert.equal(h.state.cloneCount, 2, 'Plugin and COMM each own one native clone');
  assert.equal(h.state.published, 1);
  assert.equal(h.state.transferred.length, 1);
  assert.notEqual(h.state.pluginSources[0], stock, 'Stock Response is not shared');
  const [stockChunks, commChunks, pluginChunks] = await Promise.all([
    verifyAllBytes(stock.body, len),
    verifyAllBytes(h.state.transferred[0].envelope.body, len),
    verifyAllBytes(h.state.pluginSources[0].body, len)
  ]);
  assert.equal(stockChunks, commChunks);
  assert.equal(stockChunks, pluginChunks);
  assert.equal(h.state.warnings.length, 0);
  t.diagnostic(JSON.stringify({
    source: 'isolated-node22-exact-ingress',
    branchMiB: 10, nativeClones: h.state.cloneCount,
    originalExact: true, pluginExact: true, commExact: true
  }));
});
