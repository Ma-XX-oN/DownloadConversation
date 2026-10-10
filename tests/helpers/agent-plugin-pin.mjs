import assert from 'node:assert/strict';
import vm from 'node:vm';

import { coreBundle } from './core-pin.mjs';

const context = vm.createContext({ URL });
vm.runInContext(coreBundle, context, { filename: 'aiconversationcore.browser.js' });

const core = context.AIConversationCore;
assert.equal(typeof core?.getAgentPluginArtifact, 'function',
  'Bundled AIConversationCore must expose its agent artifact catalogue.');

export const chatGPTPluginArtifact = core.getAgentPluginArtifact('chatgpt-web');
export const chatGPTPluginPin = chatGPTPluginArtifact;

assert.equal(chatGPTPluginArtifact.id, 'chatgpt-web');
assert.match(chatGPTPluginArtifact.ref ?? '', /\S+/);
assert.match(chatGPTPluginArtifact.commit ?? '', /^[0-9a-f]{40}$/);
assert.match(chatGPTPluginArtifact.gitBlobSha1 ?? '', /^[0-9a-f]{40}$/);
assert.ok(Number.isSafeInteger(chatGPTPluginArtifact.byteLength));
assert.equal(Object.hasOwn(chatGPTPluginArtifact, 'source_base64'), false,
  'AIConversationCore artifact metadata must not embed provider source bytes.');
