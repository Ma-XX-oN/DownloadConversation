import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bridge = await readFile(new URL(
  '../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url
), 'utf8');
const header = await readFile(new URL('../src/userscript-header.js', import.meta.url), 'utf8');

test('CGP2 executes independently without obsolete authenticated transport', () => {
  assert.match(header, /^\/\/ @grant\s+none$/m);
  assert.doesNotMatch(header, /^\/\/ @connect/m);
  assert.doesNotMatch(bridge, /GM_xmlhttpRequest|GM_getValue|GM_setValue/);
  assert.doesNotMatch(bridge, /import\(blobUrl\)|new Blob\(\[bytes\]/);
  assert.match(bridge, /globalThis\.ChatGPTWebAgentPlugin/);
});
test('separately installed provider is validated and startup errors are retryable', () => {
  assert.match(bridge, /plugin\.id === descriptor\.id/);
  assert.match(bridge, /plugin\.apiVersion === descriptor\.apiVersion/);
  assert.match(bridge, /check\.version === descriptor\.version/);
  assert.match(bridge, /chatGPTPluginModulePromise = null;\s*throw error;/);
  assert.match(bridge, /await core\.loadAgent\('chatgpt-web'/);
});
