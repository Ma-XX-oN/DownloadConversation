import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
const bootstrapSource = await readFile(
  new URL('../src/userscript/01-runtime/01-bootstrap.js', import.meta.url),
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
  assert.equal(plugin.ref, 'v0.1.0-issue.1.9');
  assert.equal(plugin.version, '0.1.0-issue.1.9');
  assert.equal(plugin.api_version, 1);
  assert.equal(plugin.path, 'dist/chatgpt-plugin.mjs');
  assert.match(plugin.git_blob_sha1 ?? '', /^[0-9a-f]{40}$/);
  assert.ok(Number.isSafeInteger(plugin.byte_length) && plugin.byte_length > 0);
  assert.equal(Object.hasOwn(plugin, 'commit'), false);
  assert.equal(Object.hasOwn(plugin, 'url'), false);

  assert.doesNotMatch(buildSource, /source_base64/);
  assert.doesNotMatch(buildSource, /fetchPinnedDependency\(plugin\)/);
  assert.match(buildSource, /agent plugin descriptors/i);
});

test('same userscript provides a browser-authenticated GitHub broker without repository credentials', () => {
  assert.match(header, /^\/\/ @match\s+https:\/\/github\.com\/Ma-XX-oN\/Chat-Gpt-Plugin-2\*/m);
  for (const grant of [
    'GM_getValue',
    'GM_setValue',
    'GM_addValueChangeListener',
    'GM_removeValueChangeListener'
  ]) {
    assert.match(header, new RegExp(`^// @grant\\s+${grant}$`, 'm'));
  }
  assert.match(bootstrapSource, /installGitHubAgentPluginBroker/);
  assert.match(bootstrapSource, /credentials:\s*'include'/);
  assert.match(bootstrapSource, /github\.com\/.*\/raw\//);
  assert.doesNotMatch(bootstrapSource, /Authorization\s*:/i);
  assert.doesNotMatch(bootstrapSource, /access[_-]?token/i);
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
