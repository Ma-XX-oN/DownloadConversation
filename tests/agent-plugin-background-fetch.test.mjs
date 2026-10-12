import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
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
    AGENT_PLUGIN_DOWNLOAD_TIMEOUT_MS: 120000,
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

test('verified GM cache survives a simulated page reload without another download', async () => {
  const sourceText = 'export const plugin = 1;\n';
  const bytes = Buffer.from(sourceText, 'utf8');
  const gitBlobSha1 = createHash('sha1')
    .update('blob ' + bytes.length + '\\0').update(bytes).digest('hex');
  const descriptor = {
    id: 'chatgpt-web',
    repository: 'Example/Private-Plugin',
    ref: 'main',
    version: '1.2.3',
    path: 'dist/plugin.mjs',
    gitBlobSha1,
    byteLength: bytes.byteLength
  };
  const cache = new Map();
  let downloads = 0;
  const functionNames = [
    'agentPluginHex', 'verifyAgentPluginSource',
    'agentPluginCacheKey', 'cachedAgentPluginSource',
    'requestAgentPluginFromGitHub', 'loadAgentPlugin'
  ];
  const sourceBlocks = functionNames.map(name => {
    const expression = new RegExp(
      '  (?:async )?function ' + name + '\\('
    );
    const match = expression.exec(source);
    assert.ok(match, 'Missing production function: ' + name);
    const end = source.indexOf('\n  /**', match.index + 5);
    assert.ok(end > match.index);
    return source.slice(match.index, end);
  });
  async function loadInNewDocument() {
    const context = {
      assert, Buffer, Uint8Array, TextEncoder, crypto: webcrypto,
      Date, Promise,
      AGENT_PLUGIN_CACHE_PREFIX: 'downloadconversation:agent-plugin-cache:',
      AGENT_PLUGIN_DOWNLOAD_TIMEOUT_MS: 120000,
      GM_getValue: (key, fallback) => cache.get(key) ?? fallback,
      GM_setValue: (key, value) => cache.set(key, value),
      GM_xmlhttpRequest(request) {
        downloads += 1;
        request.onload({ status: 200, responseText: sourceText });
      },
      logDiagnostic() {}
    };
    vm.runInNewContext(sourceBlocks.join('\n\n')
      + '\nthis.load = loadAgentPlugin;', context);
    return Buffer.from(await context.load(descriptor));
  }
  assert.deepEqual(await loadInNewDocument(), bytes);
  assert.equal(downloads, 1);
  assert.deepEqual(await loadInNewDocument(), bytes);
  assert.equal(downloads, 1,
    'A second ChatGPT page document must reuse verified persistent cache');
});
