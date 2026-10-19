import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = p => readFileSync(p, 'utf8');
const code = read('src/userscript/02-network-communication/03-csc-plugin-backlog.js');
const manifest = JSON.parse(read('src/userscript-manifest.json'));

function harness() {
  let handler = null;
  let seq = 0;
  const warnings = [];
  const c = vm.createContext({
    assert: (ok, message) => assert.ok(ok, message),
    cscBindPluginIngress(fn) { handler = fn; },
    cscPageInstanceId: 'fixture-page',
    cscCaptureNow(transport, direction) {
      seq++;
      return {
        transport, direction, network_sequence: seq, capture_order: seq,
        connection_id: 'navigation-' + seq, capture_id: 'fixture:' + seq,
        captured_at_epoch_ms: 1700000000000 + seq
      };
    },
    cancelReadableBodyQuietly: async () => {},
    logDiagnostic(level, name, details) { warnings.push({ level, name, details }); },
    boundedDiagnosticText: String,
    errorMessage: error => String(error?.message ?? error),
    ArrayBuffer, Blob, JSON
  });
  vm.runInContext(code + `\nthis.api = {
    connect: cscPluginQueueConnect, disconnect: cscPluginQueueDisconnect,
    publishNavigation: cscPluginQueueNavigation, snapshot: cscPluginQueueSnapshot,
    retry: cscPluginQueueRetry, drain: cscPluginQueueDrain
  }`, c);
  function event(n, direction, extra = {}, source = null) {
    return { envelope: {
      transport: 'fetch', direction, network_sequence: n, capture_order: n,
      capture_id: 'fixture:' + n, connection_id: extra.connection_id ?? 'c1',
      method: 'GET', request_url: '/backend-api/conversations/c1',
      status: 200, captured_at_epoch_ms: 1700000000000 + n, ...extra
    }, source, source_available: source !== null, source_incomplete: false };
  }
  return { api: c.api, event, publish: e => handler(e), warnings };
}

const settle = async h => { await h.api.drain(); await new Promise(resolve => setImmediate(resolve)); };

test('pre-initialization backlog preserves native identities and ordered host delivery', async () => {
  const h = harness();
  h.publish(h.event(1, 'request'));
  h.publish(h.event(2, 'response', {}, { json: async () => ({ id: 'c1' }) }));
  const seen = [];
  const host = {
    request(e) { seen.push(['request', e.network_sequence]); return true; },
    response(e) { seen.push(['response', e.network_sequence, e.body.id]); return true; },
    navigation(e) { seen.push(['navigation', e.url]); return true; }
  };
  assert.equal(h.api.snapshot().queued, 2);
  h.api.connect(host);
  await settle(h);
  assert.deepEqual(seen, [['request', 1], ['response', 1, 'c1']]);
  assert.equal(h.api.snapshot().accepted, 2);
  assert.equal(h.api.snapshot().queued, 0);
});

test('unsupported event rejected and does not stall later acknowledgements', async () => {
  const h = harness();
  h.publish(h.event(1, 'request', { transport: 'websocket' }));
  h.publish(h.event(2, 'request'));
  let count = 0;
  h.api.connect({
    request() { count++; return true; },
    response() { return true; }, navigation() { return true; }
  });
  await settle(h);
  assert.equal(count, 1);
  assert.equal(h.api.snapshot().rejected, 1);
  assert.equal(h.api.snapshot().accepted, 1);
  assert.equal(h.api.snapshot().queued, 0);
});

test('temporary host exception retains head and tail and retries exactly once', async () => {
  const h = harness();
  h.publish(h.event(1, 'request'));
  h.publish(h.event(2, 'request', { connection_id: 'c2' }));
  let fail = true, calls = [];
  h.api.connect({
    request(e) {
      calls.push(e.network_sequence);
      if (fail) { fail = false; throw Error('temporary'); }
      return true;
    },
    response() { return false; }, navigation() { return false; }
  });
  await settle(h);
  assert.equal(h.api.snapshot().queued, 2);
  assert.equal(h.api.snapshot().failures, 1);
  h.api.retry();
  await settle(h);
  assert.deepEqual(calls, [1, 1, 2]);
  assert.equal(h.api.snapshot().accepted, 2);
  assert.equal(h.api.snapshot().queued, 0);
});

test('slow parse cannot deliver to disposed host, new host drains retained entry', async () => {
  const h = harness();
  h.publish(h.event(1, 'request'));
  let resolveBody;
  h.publish(h.event(2, 'response', {},
    { json: () => new Promise(resolve => { resolveBody = resolve; }) }));
  const delivered = [];
  const a = {
    request() { return true; },
    response() { delivered.push('old'); return true; },
    navigation() { return true; }
  };
  const b = {
    request() { return true; },
    response(e) { delivered.push('new:' + e.network_sequence); return true; },
    navigation() { return true; }
  };
  h.api.connect(a);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveBody, 'function');
  h.api.disconnect(a);
  h.api.connect(b);
  resolveBody({ id: 'late' });
  await settle(h);
  assert.deepEqual(delivered, ['new:1']);
  assert.equal(h.api.snapshot().queued, 0);
});

test('navigation A-B-A is forwarded without fabricating extra network request', async () => {
  const h = harness();
  const seen = [];
  const host = {
    request() { throw Error('must not synthesize network'); },
    response() { return false; },
    navigation(e) { seen.push(e.url); return true; }
  };
  h.api.publishNavigation('https://chatgpt.com/c/A');
  h.api.publishNavigation('https://chatgpt.com/c/B');
  h.api.publishNavigation('https://chatgpt.com/c/A');
  h.api.connect(host);
  await settle(h);
  assert.deepEqual(seen, [
    'https://chatgpt.com/c/A', 'https://chatgpt.com/c/B', 'https://chatgpt.com/c/A'
  ]);
  assert.equal(h.api.snapshot().accepted, 3);
});

test('queue source registered once in manifest, #309 ingress and no Worker route', () => {
  const paths = manifest.modules.flatMap(m => m.files);
  assert.equal(paths.filter(p =>
    p === 'src/userscript/02-network-communication/03-csc-plugin-backlog.js').length, 1);
  assert.match(code, /cscBindPluginIngress\(cscPluginQueuePublish\)/);
  assert.doesNotMatch(code, /postMessage\s*\(|new Worker\s*\(|GM_setValue\s*\(/);
});

test('void-returning #306 provider response is acknowledged, never silently rejected', async () => {
  const h = harness();
  h.publish(h.event(1, 'request'));
  h.publish(h.event(2, 'response', {}, { json: async () => ({ id: 'ok' }) }));
  let observed = null;
  h.api.connect({
    request() { return true; },
    response(e) { observed = e; },
    navigation() { return true; }
  });
  await settle(h);
  assert.equal(observed.body.id, 'ok');
  assert.equal(observed.network_sequence, 1);
  assert.equal(h.api.snapshot().accepted, 2);
  assert.equal(h.api.snapshot().rejected, 0);
});

test('binary response is not misclassified as provider JSON', async () => {
  const h = harness();
  h.publish(h.event(1, 'request'));
  h.publish(h.event(2, 'response', {}, new Blob(['raw binary'])));
  let delivered = 0;
  h.api.connect({
    request() { return true; },
    response() { delivered++; },
    navigation() { return true; }
  });
  await settle(h);
  assert.equal(delivered, 0);
  assert.equal(h.api.snapshot().rejected, 1);
  assert.equal(h.api.snapshot().accepted, 1);
});

test('traffic arriving during asynchronous drain remains ordered with correlated responses', async () => {
  const h = harness();
  let completeFirst;
  const calls = [];
  h.publish(h.event(1, 'request', { connection_id: 'first' }));
  h.publish(h.event(2, 'response', { connection_id: 'first' }, {
    json: () => new Promise(resolve => { completeFirst = resolve; })
  }));
  h.api.connect({
    request(e) { calls.push('q' + e.network_sequence); return true; },
    response(e) { calls.push('s' + e.network_sequence + ':' + e.body.id); return true; },
    navigation() { return true; }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof completeFirst, 'function');
  h.publish(h.event(3, 'request', { connection_id: 'second' }));
  h.publish(h.event(4, 'response', { connection_id: 'second' }, {
    json: async () => ({ id: 'two' })
  }));
  completeFirst({ id: 'one' });
  await settle(h);
  assert.deepEqual(calls, ['q1', 's1:one', 'q3', 's3:two']);
  assert.equal(h.api.snapshot().accepted, 4);
});

test('out-of-order network completion preserves capture order and request correlation', async () => {
  const h = harness();
  const seen = [];
  h.publish(h.event(1, 'request', { connection_id: 'first' }));
  h.publish(h.event(2, 'request', { connection_id: 'second' }));
  h.publish(h.event(3, 'response', { connection_id: 'second' }, {
    json: async () => ({ id: 'response-second-first' })
  }));
  h.publish(h.event(4, 'response', { connection_id: 'first' }, {
    json: async () => ({ id: 'response-first-later' })
  }));
  h.api.connect({
    request(e) { seen.push('q' + e.network_sequence); return true; },
    response(e) { seen.push('s' + e.network_sequence + ':' + e.body.id); return true; },
    navigation() { return true; }
  });
  await settle(h);
  assert.deepEqual(seen, [
    'q1', 'q2', 's2:response-second-first', 's1:response-first-later'
  ]);
});

test('failed creation leaves backlog unchanged until a valid host reconnects', async () => {
  const h = harness();
  h.publish(h.event(1, 'request'));
  assert.throws(() => h.api.connect({ request() {} }), /provider navigation/);
  assert.equal(h.api.snapshot().queued, 1);
  const seen = [];
  h.api.connect({
    request(e) { seen.push(e.network_sequence); return true; },
    response() { return true; }, navigation() { return true; }
  });
  await settle(h);
  assert.deepEqual(seen, [1]);
  assert.equal(h.api.snapshot().queued, 0);
});

test('incomplete response is rejected without leaking plugin payload or blocking tail', async () => {
  const h = harness();
  h.publish(h.event(1, 'request', { connection_id: 'bad' }));
  const bad = h.event(2, 'response', { connection_id: 'bad' });
  bad.source_incomplete = true;
  h.publish(bad);
  h.publish(h.event(3, 'request', { connection_id: 'good' }));
  let seen = [];
  h.api.connect({
    request(e) { seen.push(e.network_sequence); return true; },
    response() { throw Error('incomplete source must not reach host'); },
    navigation() { return true; }
  });
  await settle(h);
  assert.deepEqual(seen, [1, 3]);
  assert.equal(h.api.snapshot().accepted, 2);
  assert.equal(h.api.snapshot().rejected, 1);
  assert.equal(h.api.snapshot().queued, 0);
});
