import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(
  new URL('../../src/userscript-manifest.json', import.meta.url),
  'utf8'
));

export const coreDependency = manifest.dependencies?.find(
  dependency => dependency?.name === 'AIConversationCore'
);

assert.ok(coreDependency, 'Userscript build manifest must pin AIConversationCore.');
assert.match(coreDependency.commit ?? '', /^[0-9a-f]{40}$/);
assert.match(coreDependency.git_blob_sha1 ?? '', /^[0-9a-f]{40}$/);
assert.ok(coreDependency.url?.includes(`/${coreDependency.commit}/`));

export const coreUrl = coreDependency.url;
