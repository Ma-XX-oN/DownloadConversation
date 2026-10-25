import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const root = '../src/userscript/';
const load = path => readFileSync(new URL(root + path, import.meta.url), 'utf8');
const source = [
  load('02-network-communication/03-csc-plugin-backlog.js'),
  load('02-network-communication/03-csc-issue127-witness-ingress.js'),
  load('06-image-export-tests/07-issue127-queued-witness.js'),
  load('06-image-export-tests/07a-issue127-queued-witness.js')
].join('\n');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(storage = new Map(), page = 'page-1') {
  let counter = 0, ingress = null, subscriber = null, host = null;
  let current = 'A', title = 'Conversation A', project = 'Project A';
  let cloneCount = 0, extraHttp = 0, hostConnections = 0, hostResponses = 0;
  const requestUrls = new Map(), cache = new Map(), logs = [];
  const group = { enabled: true, ready: true, uuid: 'one-tab-group' };
  const agent = {
    version() { return { version: '0.1.0-issue.1.29' }; },
    observeState(callback) {
      subscriber = callback;
      callback({ readiness: 'unresolved',
        conversation: { status: 'unresolved' }, project: { status: 'unresolved' } });
      return () => { if (subscriber === callback) subscriber = null; };
    }
  };
  function publish(record) {
    if (!record) return;
    subscriber?.({ readiness: 'resolved',
      conversation: { status: 'identified', id: record.id, name: record.title },
      project: record.gizmo === null
        ? { status: 'none', id: null, name: null }
        : { status: 'identified', id: record.gizmo, name: record.project }
    });
  }
  function makeHost() {
    hostConnections++;
    return {
      navigation({ url }) {
        current = new URL(url).pathname.split('/').at(-1);
        publish(cache.get(current));
        return true;
      },
      request({ network_sequence, request_url }) {
        requestUrls.set(network_sequence, request_url);
        return true;
      },
      response({ network_sequence, body }) {
        const url = requestUrls.get(network_sequence);
        requestUrls.delete(network_sequence);
        if (!url) return false;
        hostResponses++;
        if (url.includes('/gizmos/')) {
          const record = cache.get(current);
          if (record && body.gizmo?.id === record.gizmo)
            record.project = body.gizmo.display.name;
          publish(record);
        } else if (body.conversation_id === current) {
          cache.set(current, { id: current, title: body.title,
            gizmo: body.gizmo_id, project: project });
          publish(cache.get(current));
        }
        return undefined; // Real #306 void ACK, not boolean true.
      },
      dispose() {}
    };
  }
  const location = { origin: 'https://chatgpt.com',
    get href() { return 'https://chatgpt.com/c/' + current; } };
  const document = {
    get title() { return title + ' - ChatGPT'; },
    querySelectorAll(selector) {
      if (selector === 'a[href]') return [{
        href: location.href, textContent: title,
        getAttribute: () => 'page'
      }];
      if (selector.includes('Breadcrumb'))
        return project ? [{ href: 'https://chatgpt.com/project/' + current,
          textContent: project }] : [];
      return [];
    }
  };
  const context = {
    URL, Date, Map, Set, JSON, Math, Promise, Object, Number, Blob,
    crypto: webcrypto, location, document, sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    cscPageInstanceId: page,
    cscBindPluginIngress(fn) { ingress = fn; },
    cloneSafely() { cloneCount++; throw Error('Unexpected extra clone'); },
    cancelReadableBodyQuietly: async () => {},
    logDiagnostic(level, name, fields) { logs.push({ level, name, fields }); },
    boundedDiagnosticText: String, errorMessage: String,
    recordingGroupState: () => group,
    canonicalCore: () => ({
      getVersion: () => '1.1.0-issue.127.22',
      getAgentPluginArtifact: () => ({
        commit: 'db7e3450aac94eb2990fba0de54d090e377dafa3',
        gitBlobSha1: 'c731721005aefbc14a61bfc97270d7270aa80ea0'
      })
    }),
    assert(condition, message) { assert.ok(condition, message); },
    setTimeout, clearTimeout,
    async ensureChatGPTCanonicalAgent() {
      context.c.attach(agent);
      if (!host) {
        host = makeHost();
        context.c.connect(host);
      }
      return agent;
    }
  };
  vm.runInNewContext('let chatGPTSubjectHost = null;\n' + source + `
    globalThis.c = {
      start: aicc127Start, nav: testAicc127Navigation,
      project: testAicc127LiveProject, standalone: testAicc127LiveStandalone,
      stale: testAicc127StaleResponse, reload: testAicc127ReloadRebind,
      group: testAicc127GroupOne, evidence: () => aicc127Runtime.evidence,
      state: () => aicc127Runtime,
      attach: aicc127AttachAgentEarly,
      connect(h) { chatGPTSubjectHost = h; cscPluginQueueConnect(h); },
      capture: cscPluginQueuePublish,
      backlog: () => cscPluginQueueSnapshot(),
      disconnect() {
        cscPluginQueueDisconnect(chatGPTSubjectHost);
        chatGPTSubjectHost = null;
      }
    };
  `, context);
  function envelope(dir, url, connection) {
    const order = ++counter;
    return Object.freeze({
      direction: dir, transport: dir === 'navigation' ? 'navigation' : 'fetch',
      method: 'GET', request_url: url, url,
      connection_id: connection || 'connection-' + order,
      capture_order: order, network_sequence: order,
      captured_at_epoch_ms: 10000 + order,
      captured_at_mono_ms: 10 + order,
      page_instance_id: page, capture_id: page + ':' + order,
      status: 200
    });
  }
  function navigation(id, t, p) {
    current = id; title = t; project = p;
    context.c.capture({ envelope: envelope('navigation', location.href),
      source: null, source_available: false, source_incomplete: false });
  }
  function request(kind, id, conn) {
    const url = kind === 'project' ? 'https://chatgpt.com/backend-api/gizmos/g-p-' + id
      : 'https://chatgpt.com/backend-api/conversations/' + id;
    context.c.capture({ envelope: envelope('request', url, conn),
      source: null, source_available: false, source_incomplete: false });
  }
  function response(kind, id, conn, body) {
    const url = kind === 'project' ? 'https://chatgpt.com/backend-api/gizmos/g-p-' + id
      : 'https://chatgpt.com/backend-api/conversations/' + id;
    context.c.capture({ envelope: envelope('response', url, conn),
      source: { json: async () => body }, source_available: true,
      source_incomplete: false });
  }
  async function visit(id, t, p, name = 'g-p-' + id) {
    navigation(id, t, p);
    request('conversation', id, 'request-' + id + '-' + counter);
    const conn = 'request-' + id + '-' + (counter - 1);
    response('conversation', id, conn,
      { conversation_id: id, title: t, gizmo_id: p ? name : null });
    await tick(); await tick();
  }
  return { navigation, request, response, visit, context, storage, group,
    get captureCount() { return counter; },
    get hostConnections() { return hostConnections; },
    get cloneCount() { return cloneCount; },
    get extraHttp() { return extraHttp; },
    get hostResponses() { return hostResponses; },
    get logs() { return logs; },
    get evidence() { return context.c.evidence(); } };
}

test('Test-button wrappers arm the real observer before any host readiness', () => {
  const readiness = load('06-image-export-tests/06-agent-plugin-readiness.js');
  assert.ok(readiness.includes("if (name.startsWith('AICC #127')) return runOneTestWithCanonicalAgent"), 'Individual Test must bypass preloading.');
  const runAll = readiness.slice(readiness.indexOf('runTestsAfterChatGPTPluginReady'));
  assert.ok(runAll.includes('aicc127Prepare();') &&
    runAll.indexOf('aicc127Prepare();') < runAll.indexOf('await ensureChatGPTCanonicalAgent();'),
  'Run All must arm before host readiness.');
  const bridge = load('04-conversation-rendering/08-agent-plugin-bridge.js');
  const subscribe = bridge.indexOf('aicc127AttachAgentEarly(agent)');
  const connect = bridge.indexOf('reconnectChatGPTSubjectHost();', subscribe);
  assert.ok(subscribe >= 0 && connect > subscribe,
    'Real subject observer must subscribe before host connection/drain.');
});

test('RED boundary: old #351 source contains no live Test-button instrumentation', () => {
  const manifest = readFileSync(new URL('../src/userscript-manifest.json',
    import.meta.url), 'utf8');
  assert.match(manifest, /03-csc-issue127-witness-ingress.js/);
  assert.match(manifest, /07-issue127-queued-witness.js/);
  const stock = load('02-network-communication/01-stock-network-identities.js');
  assert.doesNotMatch(stock, /aicc127LiveOnFullFetchResponse|aicc127LiveOnRequest/);
  assert.doesNotMatch(source, /cloneSafely\(response\)|fetch\('/);
  assert.match(source, /aicc127WitnessParsed\(request.envelope, e, body\)/);
});

test('pre-host request/response buffered with original timestamps and one host', async () => {
  const h = harness();
  h.navigation('A', 'Conversation A', 'Project A');
  h.request('conversation', 'A', 'c-A');
  h.response('conversation', 'A', 'c-A',
    { conversation_id: 'A', title: 'Conversation A', gizmo_id: 'g-p-A',
      mapping: 'secret conversation content'.repeat(100000) });
  await h.context.c.start();
  await tick(); await tick();
  const step = h.evidence.navigation_steps[0];
  assert.equal(step.slot, 'A');
  assert.equal(step.conversation_requests, 1);
  assert.equal(step.conversation_responses, 1);
  assert.equal(step.first_capture_epoch_ms, 10001);
  assert.equal(step.first_capture_mono_ms, 11);
  assert.equal(step.last_capture_epoch_ms, 10003);
  assert.equal(step.observer_matches_backend, true);
  assert.equal(h.hostConnections, 1);
  assert.equal(h.hostResponses, 1);
  assert.equal(h.cloneCount, 0);
  assert.equal(h.extraHttp, 0);
  assert.doesNotMatch(JSON.stringify(h.evidence), /secret conversation content|Conversation A|Project A|g-p-A/);
});

test('two buffered concurrent responses complete out of order without loss', async () => {
  const h = harness();
  h.navigation('A', 'Conversation A', 'Project A');
  h.request('conversation', 'A', 'fast-c1');
  h.request('conversation', 'A', 'slow-c2');
  h.response('conversation', 'A', 'slow-c2',
    { conversation_id: 'A', title: 'Conversation A', gizmo_id: 'g-p-A' });
  h.response('conversation', 'A', 'fast-c1',
    { conversation_id: 'A', title: 'Conversation A', gizmo_id: 'g-p-A' });
  await h.context.c.start();
  await tick(); await tick();
  const step = h.evidence.navigation_steps[0];
  assert.equal(step.conversation_requests, 2);
  assert.equal(step.conversation_responses, 2);
  assert.equal(step.observer_matches_backend, true);
  assert.equal(h.hostResponses, 2);
  assert.equal(h.cloneCount, 0);
  assert.equal(step.first_capture_mono_ms, 11);
  assert.equal(step.last_capture_mono_ms, 15);
});

test('A-B-A reuses verified backend identity with zero conversation traffic', async () => {
  const h = harness();
  await h.context.c.start();
  await h.visit('A', 'Conversation A', 'Project A');
  await h.visit('B', 'Conversation B', 'Project B');
  h.navigation('A', 'Conversation A', 'Project A');
  await tick(); await tick();
  assert.equal(await h.context.c.nav(), undefined);
  const last = h.evidence.navigation_steps.at(-1);
  assert.equal(last.backend_source, 'verified-session-cache');
  assert.equal(last.conversation_requests, 0);
  assert.equal(last.conversation_responses, 0);
  assert.ok(last.observer_updates > 0);
  assert.equal(h.hostConnections, 1);
});

test('out-of-order completions retain correlation and stale B cannot overwrite A', async () => {
  const h = harness();
  await h.context.c.start();
  await h.visit('A', 'Conversation A', 'Project A');
  await h.visit('B', 'Conversation B', 'Project B');
  h.request('conversation', 'B', 'late-B');
  h.navigation('A', 'Conversation A', 'Project A');
  h.response('conversation', 'B', 'late-B',
    { conversation_id: 'B', title: 'Conversation B', gizmo_id: 'g-p-B' });
  await tick(); await tick();
  assert.equal((await h.context.c.nav()).status, 'INCOMPLETE',
    'Late B response produces non-zero return traffic: no fabricated zero-network PASS.');
  assert.equal(h.evidence.navigation_steps.at(-1).stale_responses, 1);
  assert.equal(await h.context.c.stale(), undefined);
});

test('standalone requires explicit backend null and actual observer none', async () => {
  const h = harness();
  await h.context.c.start();
  await h.visit('A', 'Standalone A', null);
  assert.equal(await h.context.c.standalone(), undefined);
  assert.equal((await h.context.c.project()).status, 'INCOMPLETE');
  assert.equal(h.evidence.navigation_steps[0].backend_explicit_gizmo_null, true);
});

test('reload/rebind retains checkpoint and group-1 identity without duplicate host', async () => {
  const storage = new Map();
  const first = harness(storage, 'page-1');
  await first.context.c.start();
  await first.visit('A', 'Conversation A', 'Project A');
  const second = harness(storage, 'page-2');
  second.navigation('A', 'Conversation A', 'Project A');
  await second.context.c.start();
  await tick(); await tick();
  assert.equal(second.evidence.reload_count, 1);
  assert.equal(second.hostConnections, 1);
  assert.equal(await second.context.c.reload(), undefined);
  assert.equal(await second.context.c.group(), undefined);
});
