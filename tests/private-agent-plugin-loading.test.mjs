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
  assert.equal(manifest.dependencies[0].ref, 'issue-127-core-convergence-v1');
  assert.doesNotMatch(JSON.stringify(manifest), /Chat-Gpt-Plugin-2/);
  assert.doesNotMatch(build, /manifest\.agent_plugins/);
  assert.doesNotMatch(buildLib, /DC_AGENT_PLUGIN_DESCRIPTORS/);
  assert.doesNotMatch(buildLib, /validateAgentPluginDescriptor/);
});

test('GitHub page match and broker implementation are absent from source and output', async () => {
  const broker = new URL(
    '../src/userscript/01-runtime/02-github-agent-plugin-broker.js',
    import.meta.url
  );
  await assert.rejects(access(broker), { code: 'ENOENT' });
  for (const source of [header, userscript]) {
    assert.doesNotMatch(source, /^\/\/ @match\s+https:\/\/github\.com\/\*$/m);
    assert.match(source, /^\/\/ @match\s+https:\/\/chatgpt\.com\/\*$/m);
    assert.match(source, /^\/\/ @connect\s+github\.com$/m);
    assert.match(source, /^\/\/ @connect\s+raw\.githubusercontent\.com$/m);
  }
  assert.doesNotMatch(userscript,
    /installGitHubAgentPluginBroker|publishGitHubAgentPluginTrace|githubAgentPluginBlobUrl/);
  assert.doesNotMatch(build, /github-agent-plugin-broker\.js|buildAgentPluginPrelude/);
  assert.doesNotMatch(buildLib, /buildAgentPluginPrelude/);
});

test('direct authenticated raw transport and exact integrity checks survive removal', () => {
  for (const grant of ['GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue']) {
    assert.match(header, new RegExp('^// @grant\\s+' + grant + '$', 'm'));
  }
  assert.match(bridge, /requestAgentPluginFromGitHub\(descriptor\)/);
  assert.match(bridge, /GM_xmlhttpRequest\(\{/);
  assert.match(bridge, /\/raw\//);
  assert.match(bridge, /verifyAgentPluginSource\(descriptor, source\)/);
  assert.match(bridge, /crypto\.subtle\.digest\('SHA-1'/);
  assert.match(bridge, /gitBlobSha1/);
  assert.match(bridge, /byteLength/);
  assert.match(bridge, /new Blob\(\[bytes\]/);
  assert.match(bridge, /import\(blobUrl\)/);
  assert.match(bridge, /core\.loadAgent\('chatgpt-web'/);
  assert.match(bridge, /const AGENT_PLUGIN_CACHE_PREFIX = /);
  assert.match(bridge, /const AGENT_PLUGIN_DOWNLOAD_TIMEOUT_MS = /);
  assert.doesNotMatch(bridge, /AGENT_PLUGIN_BROKER_TIMEOUT_MS/);
  assert.doesNotMatch(bridge, /Authorization\s*:/i);
  assert.doesNotMatch(bridge, /access[_-]?token/i);
});
