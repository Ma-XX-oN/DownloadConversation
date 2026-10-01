import assert from 'node:assert/strict';
import vm from 'node:vm';

import { userscript } from './userscript-source.mjs';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(
  new URL('../../src/userscript-manifest.json', import.meta.url),
  'utf8'
));

export const chatGPTPluginPin = manifest.agent_plugins?.find(
  plugin => plugin?.id === 'chatgpt-web'
);
assert.ok(chatGPTPluginPin, 'Userscript build manifest must describe chatgpt-web.');
assert.match(chatGPTPluginPin.ref ?? '', /\S+/);
assert.match(chatGPTPluginPin.commit ?? '', /^[0-9a-f]{40}$/);
assert.match(chatGPTPluginPin.git_blob_sha1 ?? '', /^[0-9a-f]{40}$/);
assert.ok(chatGPTPluginPin.url?.includes(`/${chatGPTPluginPin.commit}/`));

const startMarker = '// BEGIN agent plugin descriptors\n';
const endMarker = '// END agent plugin descriptors\n';
const start = userscript.indexOf(startMarker);
const end = userscript.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start, 'Generated userscript is missing agent plugin descriptors.');
const prelude = userscript.slice(start, end + endMarker.length);
const context = {};
vm.runInNewContext(
  prelude.replace(
    '  const DC_AGENT_PLUGIN_DESCRIPTORS =',
    'globalThis.DC_AGENT_PLUGIN_DESCRIPTORS ='
  ),
  context,
  { filename: 'agent-plugin-descriptors.js' }
);
export const chatGPTPluginArtifact = context.DC_AGENT_PLUGIN_DESCRIPTORS?.['chatgpt-web'];
assert.ok(chatGPTPluginArtifact, 'Generated userscript does not describe chatgpt-web.');
for (const field of [
  'id', 'repository', 'ref', 'commit', 'version', 'api_version', 'path',
  'git_blob_sha1', 'byte_length'
]) {
  assert.equal(chatGPTPluginArtifact[field], chatGPTPluginPin[field],
    `Generated chatgpt-web descriptor ${field} differs from manifest pin.`);
}
assert.equal(Object.hasOwn(chatGPTPluginArtifact, 'source_base64'), false,
  'Public userscript must not embed provider source bytes.');
