import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
assert.ok(chatGPTPluginPin, 'Userscript build manifest must pin chatgpt-web.');
assert.match(chatGPTPluginPin.ref ?? '', /\S+/);
assert.match(chatGPTPluginPin.commit ?? '', /^[0-9a-f]{40}$/);
assert.match(chatGPTPluginPin.git_blob_sha1 ?? '', /^[0-9a-f]{40}$/);
assert.ok(chatGPTPluginPin.url?.includes(`/${chatGPTPluginPin.commit}/`));

const startMarker = '// BEGIN embedded agent plugin artifacts\n';
const endMarker = '// END embedded agent plugin artifacts\n';
const start = userscript.indexOf(startMarker);
const end = userscript.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start, 'Generated userscript is missing embedded agent plugin artifacts.');
const prelude = userscript.slice(start, end + endMarker.length);
const context = {};
vm.runInNewContext(
  prelude.replace(
    '  const DC_AGENT_PLUGIN_ARTIFACTS =',
    'globalThis.DC_AGENT_PLUGIN_ARTIFACTS ='
  ),
  context,
  { filename: 'embedded-agent-plugins.js' }
);
export const chatGPTPluginArtifact = context.DC_AGENT_PLUGIN_ARTIFACTS?.['chatgpt-web'];
assert.ok(chatGPTPluginArtifact, 'Generated userscript does not embed chatgpt-web.');
for (const field of [
  'id', 'repository', 'ref', 'commit', 'version', 'api_version', 'path',
  'git_blob_sha1', 'byte_length'
]) {
  assert.equal(chatGPTPluginArtifact[field], chatGPTPluginPin[field],
    `Embedded chatgpt-web ${field} differs from manifest pin.`);
}

const bytes = Buffer.from(chatGPTPluginArtifact.source_base64, 'base64');
assert.equal(bytes.length, chatGPTPluginPin.byte_length);
const blobHeader = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
const blobSha1 = createHash('sha1').update(blobHeader).update(bytes).digest('hex');
assert.equal(blobSha1, chatGPTPluginPin.git_blob_sha1,
  'Embedded chatgpt-web bytes do not match the pinned Git blob.');

export const chatGPTPluginSource = bytes.toString('utf8');
export const chatGPTPluginModuleUrl =
  `data:text/javascript;base64,${bytes.toString('base64')}`;
