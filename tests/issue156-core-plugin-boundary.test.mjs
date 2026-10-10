import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(
  new URL('../src/userscript-manifest.json', import.meta.url),
  'utf8'
));
const header = await readFile(new URL('../src/userscript-header.js', import.meta.url), 'utf8');
const build = await readFile(new URL('../scripts/build-userscript.mjs', import.meta.url), 'utf8');
const buildLib = await readFile(new URL('../scripts/userscript-build-lib.mjs', import.meta.url), 'utf8');
const bridge = await readFile(
  new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url),
  'utf8'
);

const forbiddenProviderIdentity = /Chat-Gpt-Plugin-2|958a163a3d60be42c98b0197bf85202ff717384f|f29805c7f8d0393f588aacf22661f667b11f8cfa/;

test('DC build metadata depends on AICC only and contains no provider-plugin pin', () => {
  assert.equal(Object.hasOwn(manifest, 'agent_plugins'), false);
  assert.equal(manifest.dependencies.length, 1);
  assert.equal(manifest.dependencies[0].name, 'AIConversationCore');
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenProviderIdentity);
  assert.doesNotMatch(header, /Chat-Gpt-Plugin-2/);
});

test('DC build does not manufacture provider-plugin descriptors', () => {
  assert.doesNotMatch(build, /manifest\.agent_plugins/);
  assert.doesNotMatch(buildLib, /DC_AGENT_PLUGIN_DESCRIPTORS/);
  assert.doesNotMatch(buildLib, /validateAgentPluginDescriptor/);
  assert.doesNotMatch(buildLib, forbiddenProviderIdentity);
});

test('DC delegates plugin selection, registration and agent creation to AICC', () => {
  assert.match(bridge, /core\.loadAgent\(/);
  assert.doesNotMatch(bridge, /new core\.AgentPluginRegistry/);
  assert.doesNotMatch(bridge, /\.registerModule\(/);
  assert.doesNotMatch(bridge, /DC_AGENT_PLUGIN_DESCRIPTORS/);
  assert.doesNotMatch(bridge, forbiddenProviderIdentity);
});
