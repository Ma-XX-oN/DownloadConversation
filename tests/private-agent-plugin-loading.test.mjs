import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { userscript } from './helpers/userscript-source.mjs';

const manifest = JSON.parse(await readFile(
  new URL('../src/userscript-manifest.json', import.meta.url), 'utf8'
));
const header = await readFile(
  new URL('../src/userscript-header.js', import.meta.url), 'utf8'
);
const build = await readFile(
  new URL('../scripts/build-userscript.mjs', import.meta.url), 'utf8'
);
const buildLib = await readFile(
  new URL('../scripts/userscript-build-lib.mjs', import.meta.url), 'utf8'
);
const bridge = await readFile(
  new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js',
    import.meta.url), 'utf8'
);
test('provider selection remains owned by AICC, not DownloadConversation', () => {
  assert.equal(Object.hasOwn(manifest, 'agent_plugins'), false);
  assert.deepEqual(manifest.dependencies.map(entry => entry.name),
    ['AIConversationCore']);
  assert.equal(manifest.dependencies[0].ref, 'main');
  assert.doesNotMatch(JSON.stringify(manifest), /Chat-Gpt-Plugin-2/);
  assert.doesNotMatch(build, /manifest\.agent_plugins/);
  assert.doesNotMatch(buildLib, /DC_AGENT_PLUGIN_DESCRIPTORS/);
  assert.doesNotMatch(buildLib, /validateAgentPluginDescriptor/);
});

test('DC only matches ChatGPT and needs no privileged Tampermonkey grants', async () => {
  for (const source of [header, userscript]) {
    assert.doesNotMatch(source, /^\/\/ @match\s+https:\/\/github\.com\/\*$/m);
    assert.match(source, /^\/\/ @match\s+https:\/\/chatgpt\.com\/\*$/m);
    assert.match(source, /^\/\/ @sandbox\s+raw$/m);
    assert.match(source, /^\/\/ @grant\s+none$/m);
    assert.doesNotMatch(source, /^\/\/ @connect\s+/m);
  }
  assert.doesNotMatch(bridge, /GM_xmlhttpRequest|import\(blobUrl\)/);
  assert.doesNotMatch(build, /github-agent-plugin-broker\.js|buildAgentPluginPrelude/);
  assert.doesNotMatch(buildLib, /buildAgentPluginPrelude/);
});

test('shared-world loader uses the installed CGP2 object and preserves AICC authority', () => {
  assert.match(bridge, /globalThis\.ChatGPTWebAgentPlugin/);
  assert.match(bridge, /plugin\.id === descriptor\.id/);
  assert.match(bridge, /plugin\.apiVersion === descriptor\.apiVersion/);
  assert.match(bridge, /check\.version === descriptor\.version/);
  assert.match(bridge, /return \{ default: plugin \}/);
  assert.match(bridge, /core\.loadAgent\('chatgpt-web'/);
  assert.match(bridge, /chatGPTPluginModulePromise = null;\s*throw error;/);
  assert.doesNotMatch(bridge, /Authorization\s*:/i);
  assert.doesNotMatch(bridge, /access[_-]?token/i);
});
