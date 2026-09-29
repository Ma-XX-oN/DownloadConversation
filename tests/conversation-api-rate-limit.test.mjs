import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  readDownloadConversationSource,
  readUserscriptManifest
} from '../scripts/userscript-build-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(
  new URL('../src/userscript/03-agent-lifecycle/10-conversation-api-rate-limit.js', import.meta.url),
  'utf8'
);

function fakeResponse(status, retryAfter = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'retry-after' ? retryAfter : null;
      }
    },
    clone() {
      return fakeResponse(status, retryAfter);
    }
  };
}

function harness(physicalFetch) {
  let now = 1_000_000;
  const delays = [];
  const diagnostics = [];
  const context = {
    __conversationId: 'conversation-1',
    __physicalFetch: physicalFetch,
    __delays: delays,
    __diagnostics: diagnostics,
    Date: {
      now: () => now,
      parse: Date.parse
    },
    Math: {
      max: Math.max,
      min: Math.min,
      round: Math.round,
      random: () => 0.5
    },
    Promise,
    Map,
    Error,
    Number,
    String,
    setTimeout(callback, delay) {
      delays.push(delay);
      now += delay;
      queueMicrotask(callback);
      return delays.length;
    },
    queueMicrotask
  };
  vm.runInNewContext(`
    let apiFetch = url => globalThis.__physicalFetch(url);
    function currentConversationId() { return globalThis.__conversationId; }
    function diagnosticRequestPath(url) { return String(url); }
    function logDiagnostic(level, event, details) {
      globalThis.__diagnostics.push({ level, event, details });
    }
    ${source}
    globalThis.__apiFetch = apiFetch;
  `, context);
  return context;
}

test('coordinator is assembled at top level before the direct API fetch declaration', async () => {
  const manifest = await readUserscriptManifest(root);
  const built = await readDownloadConversationSource(root, manifest);
  const captureEnd = built.indexOf('    captureInstalled = true;\n  }');
  const coordinator = built.indexOf('// BEGIN Issue #183 Conversation API rate-limit coordination');
  const apiFetchDeclaration = built.indexOf('  async function apiFetch(url)');
  const pageHttpFailure = built.indexOf('    if (!response.ok) {', apiFetchDeclaration);

  assert.ok(captureEnd >= 0, 'network-capture installation boundary must exist');
  assert.ok(coordinator > captureEnd, 'coordinator must begin after the completed network-capture function');
  assert.ok(apiFetchDeclaration > coordinator, 'coordinator must be installed before direct Conversation API use');
  assert.ok(pageHttpFailure > apiFetchDeclaration, 'page HTTP failure handling must remain after apiFetch');
  assert.doesNotMatch(
    built,
    /if \(!response\.ok\) \{\s*\/\/ BEGIN Issue #183 Conversation API rate-limit coordination/,
    'coordinator must never be assembled inside the page HTTP failure branch'
  );
  assert.ok(
    built.includes("    if (!response.ok) {\n      let bodyPreview = '';"),
    'HTTP failure branch must preserve the source-boundary newline before bodyPreview'
  );
});

test('Retry-After suppresses the next physical request for at least the server delay', async () => {
  let calls = 0;
  const context = harness(async () => {
    calls += 1;
    return calls === 1 ? fakeResponse(429, '10') : fakeResponse(200);
  });

  const response = await context.__apiFetch('https://chatgpt.com/page-1');
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(context.__delays, [10_000]);
});

test('429 without Retry-After uses bounded exponential backoff', async () => {
  let calls = 0;
  const context = harness(async () => {
    calls += 1;
    if (calls <= 2) return fakeResponse(429);
    return fakeResponse(200);
  });

  const response = await context.__apiFetch('https://chatgpt.com/page-1');
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(context.__delays, [5_000, 10_000]);
});

test('concurrent callers for the same page coalesce onto one physical request', async () => {
  let calls = 0;
  let resolvePhysical;
  const pending = new Promise(resolve => { resolvePhysical = resolve; });
  const context = harness(async () => {
    calls += 1;
    return pending;
  });

  const first = context.__apiFetch('https://chatgpt.com/page-1');
  const second = context.__apiFetch('https://chatgpt.com/page-1');
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(calls, 1);

  resolvePhysical(fakeResponse(200));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(calls, 1);
});

test('a successful response resets the consecutive-429 backoff', async () => {
  const responses = [
    fakeResponse(429), fakeResponse(200),
    fakeResponse(429), fakeResponse(200)
  ];
  const context = harness(async () => responses.shift());

  await context.__apiFetch('https://chatgpt.com/page-1');
  await context.__apiFetch('https://chatgpt.com/page-2');
  assert.deepEqual(context.__delays, [5_000, 5_000]);
});

test('navigation cancels a queued 429 retry before another physical request fires', async () => {
  let calls = 0;
  let context;
  context = harness(async () => {
    calls += 1;
    context.__conversationId = 'conversation-2';
    return fakeResponse(429);
  });

  await assert.rejects(
    context.__apiFetch('https://chatgpt.com/page-1'),
    /active conversation changed/
  );
  assert.equal(calls, 1);
});

test('non-429 HTTP failures retain downstream status handling without coordinator retry', async () => {
  let calls = 0;
  const context = harness(async () => {
    calls += 1;
    return fakeResponse(500);
  });

  const response = await context.__apiFetch('https://chatgpt.com/page-1');
  assert.equal(response.status, 500);
  assert.equal(calls, 1);
  assert.deepEqual(context.__delays, []);
});

test('successful distinct pagination pages are each requested exactly once', async () => {
  const urls = [];
  const context = harness(async url => {
    urls.push(url);
    return fakeResponse(200);
  });

  await context.__apiFetch('https://chatgpt.com/page-1');
  await context.__apiFetch('https://chatgpt.com/page-2');
  await context.__apiFetch('https://chatgpt.com/page-3');
  assert.deepEqual(urls, [
    'https://chatgpt.com/page-1',
    'https://chatgpt.com/page-2',
    'https://chatgpt.com/page-3'
  ]);
});

test('rate-limit diagnostics record one decision per received 429', async () => {
  let calls = 0;
  const context = harness(async () => {
    calls += 1;
    return calls === 1 ? fakeResponse(429) : fakeResponse(200);
  });

  await context.__apiFetch('https://chatgpt.com/page-1');
  const rateLimitEvents = context.__diagnostics.filter(
    entry => entry.event === 'conversation-api-rate-limited'
  );
  assert.equal(rateLimitEvents.length, 1);
  assert.equal(rateLimitEvents[0].details.delay_ms, 5_000);
});
