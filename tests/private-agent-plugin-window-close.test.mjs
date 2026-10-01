import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const manifest = JSON.parse(await readFile(
  new URL('../src/userscript-manifest.json', import.meta.url),
  'utf8'
));
const brokerSource = await readFile(
  new URL('../src/userscript/01-runtime/02-github-agent-plugin-broker.js', import.meta.url),
  'utf8'
);
const plugin = manifest.agent_plugins?.find(item => item?.id === 'chatgpt-web');

test('GitHub broker closes its script-opened window after publishing extracted source', async () => {
  assert.ok(plugin, 'chatgpt-web plugin descriptor is required.');
  const displayedSource = 'export const marker = "close-after-transfer";';
  const transferredSource = `${displayedSource}\n`;
  const brokerPlugin = {
    ...plugin,
    byte_length: Buffer.byteLength(transferredSource, 'utf8')
  };
  const request = {
    request_id: 'close-request-1',
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
        return {
          tagName: 'TEXTAREA',
          value: displayedSource
        };
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
      if (name === 'downloadconversation:agent-plugin-response:close-request-1' && value?.ok) {
        events.push('response-published');
      }
    },
    GM_addValueChangeListener() {
      return 1;
    }
  };

  vm.runInNewContext(`(function () {${brokerSource}\n})()`, context);
  await new Promise(resolve => setImmediate(resolve));

  const response = values.get('downloadconversation:agent-plugin-response:close-request-1');
  assert.equal(response?.ok, true);
  assert.equal(response?.source, transferredSource);
  assert.deepEqual(events, ['response-published', 'window.close']);
});
