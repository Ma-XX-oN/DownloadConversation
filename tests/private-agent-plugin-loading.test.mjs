import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const manifest = JSON.parse(await readFile(
  new URL('../src/userscript-manifest.json', import.meta.url),
  'utf8'
));
const header = await readFile(
  new URL('../src/userscript-header.js', import.meta.url),
  'utf8'
);
const buildSource = await readFile(
  new URL('../scripts/build-userscript.mjs', import.meta.url),
  'utf8'
);
const buildLibSource = await readFile(
  new URL('../scripts/userscript-build-lib.mjs', import.meta.url),
  'utf8'
);
const brokerSource = await readFile(
  new URL('../src/userscript/01-runtime/02-github-agent-plugin-broker.js', import.meta.url),
  'utf8'
);
const bridgeSource = await readFile(
  new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url),
  'utf8'
);

const plugin = manifest.agent_plugins?.find(item => item?.id === 'chatgpt-web');

test('public DC describes but does not embed the private CGP2 artifact', () => {
  assert.ok(plugin, 'chatgpt-web plugin descriptor is required.');
  assert.equal(plugin.repository, 'Ma-XX-oN/Chat-Gpt-Plugin-2');
  assert.equal(plugin.ref, 'issue-1-chatgpt-agent-plugin');
  assert.equal(plugin.commit, '958a163a3d60be42c98b0197bf85202ff717384f');
  assert.equal(plugin.version, '0.1.0-issue.1.9');
  assert.equal(plugin.api_version, 1);
  assert.equal(plugin.path, 'dist/chatgpt-plugin.mjs');
  assert.equal(plugin.git_blob_sha1, 'f29805c7f8d0393f588aacf22661f667b11f8cfa');
  assert.equal(plugin.byte_length, 50204);

  assert.doesNotMatch(buildSource, /source_base64/);
  assert.doesNotMatch(buildSource, /fetchPinnedDependency\(plugin\)/);
  assert.match(buildLibSource, /BEGIN agent plugin descriptors/);
  assert.match(buildSource, /buildAgentPluginPrelude/);
});

test('same userscript reads the authenticated GitHub file view without repository credentials', () => {
  assert.match(header, /^\/\/ @match\s+https:\/\/github\.com\/Ma-XX-oN\/Chat-Gpt-Plugin-2\*/m);
  for (const grant of [
    'GM_getValue',
    'GM_setValue',
    'GM_addValueChangeListener',
    'GM_removeValueChangeListener'
  ]) {
    assert.match(header, new RegExp(`^// @grant\\s+${grant}$`, 'm'));
  }
  assert.match(brokerSource, /installGitHubAgentPluginBroker/);
  assert.match(brokerSource, /githubAgentPluginBlobUrl/);
  assert.match(brokerSource,
    /textarea\[data-testid="read-only-cursor-text-area"\]\[aria-label="file content"\]/);
  assert.match(brokerSource, /textarea\.value/);
  assert.doesNotMatch(brokerSource, /if\s*\([^\n]*instanceof\s+HTMLTextAreaElement/);
  assert.doesNotMatch(brokerSource, /\bfetch\s*\(/);
  assert.doesNotMatch(brokerSource, /raw\.githubusercontent\.com/);
  assert.doesNotMatch(brokerSource, /Authorization\s*:/i);
  assert.doesNotMatch(brokerSource, /access[_-]?token/i);
  assert.match(brokerSource, /AGENT_PLUGIN_TRACE_PREFIX/);
  assert.match(brokerSource, /publishGitHubAgentPluginTrace/);
  assert.match(brokerSource, /normalizeGitHubAgentPluginSource/);
  assert.match(bridgeSource, /githubAgentPluginBlobUrl\(descriptor\)/);
});

test('GitHub broker restores the terminal LF and closes only after publishing source', async () => {
  assert.ok(plugin, 'chatgpt-web plugin descriptor is required.');
  const displayedSource = 'export const marker = "from-github-textarea";';
  const transferredSource = `${displayedSource}\n`;
  const brokerPlugin = {
    ...plugin,
    byte_length: Buffer.byteLength(transferredSource, 'utf8')
  };
  const textarea = {
    tagName: 'TEXTAREA',
    value: displayedSource
  };
  const request = {
    request_id: 'request-1',
    plugin_id: brokerPlugin.id,
    repository: brokerPlugin.repository,
    ref: brokerPlugin.ref,
    path: brokerPlugin.path,
    version: brokerPlugin.version,
    api_version: brokerPlugin.api_version,
    git_blob_sha1: brokerPlugin.git_blob_sha1,
    byte_length: brokerPlugin.byte_length,
    requested_at: Date.now()
  };
  const values = new Map([
    ['downloadconversation:agent-plugin-request', request]
  ]);
  const events = [];
  let fetchCalls = 0;
  const pathname = `/${brokerPlugin.repository}/blob/${brokerPlugin.ref}/${brokerPlugin.path}`;
  const context = {
    URL,
    Date,
    Promise,
    TextEncoder,
    setTimeout,
    clearTimeout,
    console,
    location: {
      origin: 'https://github.com',
      hostname: 'github.com',
      pathname
    },
    window: {
      close() {
        events.push('window.close');
      }
    },
    document: {
      documentElement: {},
      querySelector(selector) {
        assert.equal(
          selector,
          'textarea[data-testid="read-only-cursor-text-area"][aria-label="file content"]'
        );
        return textarea;
      }
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    DC_AGENT_PLUGIN_DESCRIPTORS: Object.freeze({
      'chatgpt-web': Object.freeze({ ...brokerPlugin })
    }),
    assert(condition, message) {
      assert.ok(condition, message);
    },
    GM_getValue(name, fallback) {
      return values.has(name) ? values.get(name) : fallback;
    },
    GM_setValue(name, value) {
      values.set(name, value);
      if (name === 'downloadconversation:agent-plugin-response:request-1' && value?.ok) {
        events.push('response-published');
      }
    },
    GM_addValueChangeListener() {
      return 1;
    },
    fetch() {
      fetchCalls += 1;
      throw new Error('broker must not fetch the raw host');
    }
  };

  vm.runInNewContext(`(function () {${brokerSource}\n})()`, context);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls, 0);
  const response = values.get('downloadconversation:agent-plugin-response:request-1');
  assert.equal(response?.request_id, 'request-1');
  assert.equal(response?.ok, true);
  assert.equal(response?.source, transferredSource);
  const trace = values.get('downloadconversation:agent-plugin-trace:request-1');
  assert.equal(trace?.request_id, 'request-1');
  assert.equal(trace?.stage, 'response-published');
  assert.equal(trace?.transferred_byte_length, brokerPlugin.byte_length);
  assert.equal(trace?.terminal_lf_restored, true);
  assert.deepEqual(events, ['response-published', 'window.close']);
});

test('shared broker constants required by the ChatGPT bridge are defined in runtime scope', () => {
  assert.match(brokerSource,
    /const AGENT_PLUGIN_CACHE_PREFIX = 'downloadconversation:agent-plugin-cache:';/);
  assert.match(brokerSource,
    /const AGENT_PLUGIN_BROKER_TIMEOUT_MS = 2 \* 60 \* 1000;/);
  assert.match(bridgeSource, /AGENT_PLUGIN_CACHE_PREFIX/);
  assert.match(bridgeSource, /AGENT_PLUGIN_BROKER_TIMEOUT_MS/);
});

test('ChatGPT runtime verifies broker bytes before Blob import and shares only verified source cache', () => {
  assert.match(bridgeSource, /GM_addValueChangeListener/);
  assert.match(bridgeSource, /GM_setValue/);
  assert.match(bridgeSource, /crypto\.subtle\.digest\('SHA-1'/);
  assert.match(bridgeSource, /git_blob_sha1/);
  assert.match(bridgeSource, /byte_length/);
  assert.match(bridgeSource, /new Blob\(\[bytes\]/);
  assert.match(bridgeSource, /import\(blobUrl\)/);
  assert.doesNotMatch(bridgeSource, /source_base64/);
  assert.doesNotMatch(bridgeSource, /Authorization\s*:/i);
  assert.doesNotMatch(bridgeSource, /access[_-]?token/i);
});
