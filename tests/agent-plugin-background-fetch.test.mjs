import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(
  new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url),
  'utf8'
);
const start = source.indexOf('  function requestAgentPluginFromGitHub(descriptor) {');
const end = source.indexOf('\n  /**', start);
assert.ok(start >= 0 && end > start, 'Missing production background fetch function.');
const implementation = source.slice(start, end);

const descriptor = {
  repository: 'Ma-XX-oN/Chat-Gpt-Plugin-2',
  ref: 'main',
  path: 'dist/chatgpt-plugin.mjs'
};

function runWith(onRequest) {
  const context = {
    assert,
    AGENT_PLUGIN_BROKER_TIMEOUT_MS: 120000,
    GM_xmlhttpRequest: onRequest
  };
  vm.runInNewContext(implementation, context);
  return context.requestAgentPluginFromGitHub(descriptor);
}

test('authenticated GitHub-origin raw is requested without opening a window', async () => {
  let requests = 0;
  const sourceText = await runWith(request => {
    requests += 1;
    assert.equal(request.method, 'GET');
    assert.equal(request.url,
      'https://github.com/Ma-XX-oN/Chat-Gpt-Plugin-2/raw/main/dist/chatgpt-plugin.mjs');
    assert.equal(request.timeout, 120000);
    request.onload({ status: 200, responseText: 'private module source' });
  });
  assert.equal(requests, 1);
  assert.equal(sourceText, 'private module source');
});

test('authentication failure does not become executable source', async () => {
  await assert.rejects(runWith(request => {
    request.onload({ status: 404, responseText: 'Not Found' });
  }), /HTTP 404/);
});

test('network errors and timeout are rejected', async () => {
  await assert.rejects(runWith(request => request.onerror()), /download failed/);
  await assert.rejects(runWith(request => request.ontimeout()), /timed out/);
});

test('missing source is rejected', async () => {
  await assert.rejects(runWith(request => {
    request.onload({ status: 200, responseText: undefined });
  }), /no UTF-8 source/);
});
