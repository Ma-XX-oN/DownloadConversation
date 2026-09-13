import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const loggerPath = new URL('../chatgpt-final-turn-state-logger.user.js', import.meta.url);

async function loadTestApi() {
  const source = await readFile(loggerPath, 'utf8');
  const context = {
    __FINAL_TURN_LOGGER_TEST_MODE__: true,
    console,
    globalThis: null,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    URL,
    Blob
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'chatgpt-final-turn-state-logger.user.js' });
  assert.ok(context.__FINAL_TURN_LOGGER_TEST_API__, 'Diagnostic userscript must expose its test API in test mode.');
  return { api: context.__FINAL_TURN_LOGGER_TEST_API__, source };
}

test('diagnostic userscript is separate, page-realm, and starts at document-start', async () => {
  const { source } = await loadTestApi();
  assert.match(source, /@name\s+ChatGPT Final-Turn State Logger/);
  assert.match(source, /@run-at\s+document-start/);
  assert.match(source, /@grant\s+none/);
  assert.match(source, /@inject-into\s+page/);
  assert.doesNotMatch(source, /chatgpt-conversation-markdown-export\.user\.js/);
});

test('fetch wrapper returns the original promise and only inspects a cloned response', async () => {
  const { api } = await loadTestApi();
  let resolveFetch;
  const response = {
    status: 200,
    headers: { get: () => 'application/json' },
    cloneCalls: 0,
    clone() {
      this.cloneCalls += 1;
      return { cloned: true };
    }
  };
  const originalPromise = new Promise(resolve => { resolveFetch = resolve; });
  const target = {
    fetch(...args) {
      target.calls.push(args);
      return originalPromise;
    },
    calls: []
  };
  const observations = [];
  const restore = api.installFetchObserver(target, observation => observations.push(observation), () => 12);
  const returned = target.fetch('/backend-api/conversation/test-id', { method: 'POST' });
  assert.equal(returned, originalPromise, 'Fetch wrapper must return the exact original promise object.');
  resolveFetch(response);
  await originalPromise;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(response.cloneCalls, 1);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].transport, 'fetch');
  assert.equal(observations[0].method, 'POST');
  assert.equal(observations[0].url, '/backend-api/conversation/test-id');
  assert.deepEqual(observations[0].response, { cloned: true });
  restore();
  assert.equal(target.fetch.name, 'fetch');
});

test('XHR wrapper preserves open/send return values and observes only after loadend', async () => {
  const { api } = await loadTestApi();

  class FakeXHR {
    constructor() {
      this.listeners = new Map();
      this.status = 200;
      this.responseType = '';
      this.responseText = '{"ok":true}';
    }

    open(method, url) {
      this.openArgs = [method, url];
      return 'OPEN-RESULT';
    }

    send(body) {
      this.sentBody = body;
      return 'SEND-RESULT';
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    getResponseHeader(name) {
      return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
    }

    emit(name) {
      this.listeners.get(name)?.call(this);
    }
  }

  const target = { XMLHttpRequest: FakeXHR };
  const observations = [];
  const restore = api.installXhrObserver(target, observation => observations.push(observation), () => 20);
  const xhr = new target.XMLHttpRequest();
  assert.equal(xhr.open('GET', '/backend-api/conversation/test-id'), 'OPEN-RESULT');
  assert.equal(xhr.send('body'), 'SEND-RESULT');
  assert.equal(observations.length, 0, 'Observation must not run before loadend.');
  xhr.emit('loadend');
  assert.equal(observations.length, 1);
  assert.equal(observations[0].transport, 'xhr');
  assert.equal(observations[0].method, 'GET');
  assert.equal(observations[0].url, '/backend-api/conversation/test-id');
  assert.equal(observations[0].xhr, xhr);
  assert.equal(xhr.responseText, '{"ok":true}', 'Observer must not mutate the response body.');
  restore();
  const restored = new target.XMLHttpRequest();
  assert.equal(restored.open('GET', '/x'), 'OPEN-RESULT');
});

test('bounded text preserves both ends while enforcing a hard character cap', async () => {
  const { api } = await loadTestApi();
  const input = 'A'.repeat(200) + 'MIDDLE' + 'Z'.repeat(200);
  const result = api.boundedText(input, 120);
  assert.ok(result.length <= 120);
  assert.match(result, /^A+/);
  assert.match(result, /Z+$/);
  assert.match(result, /omitted/);
});

test('distinct store deduplicates repeated states and bounds mutation storms', async () => {
  const { api } = await loadTestApi();
  const store = api.createDistinctStore(5);
  assert.equal(store.push('same', { state: 1 }), true);
  assert.equal(store.push('same', { state: 1 }), false);
  for (let index = 0; index < 1000; index += 1) {
    store.push(`state-${index}`, { index });
  }
  assert.equal(store.items.length, 5);
  assert.deepEqual(Array.from(store.items, item => item.index), [995, 996, 997, 998, 999]);
});

test('distinct final-turn state history preserves intermediate then final state order', async () => {
  const { api } = await loadTestApi();
  const store = api.createDistinctStore(10);
  const intermediate = { turnId: 'turn-a', messageId: 'msg-a', text: 'partial' };
  const final = { turnId: 'turn-a', messageId: 'msg-a', text: 'complete' };
  assert.equal(store.push(api.hashText(JSON.stringify(intermediate)), intermediate), true);
  assert.equal(store.push(api.hashText(JSON.stringify(final)), final), true);
  assert.equal(store.push(api.hashText(JSON.stringify(final)), final), false);
  assert.deepEqual(Array.from(store.items, item => item.text), ['partial', 'complete']);
});

test('logger never injects or rewrites transcript content', async () => {
  const { source } = await loadTestApi();
  assert.doesNotMatch(source, /section\s*\[\s*data-turn-id[^\n]*\.(?:append|appendChild|prepend|replaceChildren|remove)/);
  assert.doesNotMatch(source, /(?:innerHTML|outerHTML|textContent|innerText)\s*=/);
  assert.doesNotMatch(source, /document\.write\s*\(/);
});
