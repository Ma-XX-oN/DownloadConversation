import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { userscript } from './userscript-source.mjs';

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

export const coreSourceUrl = coreDependency.url;
const begin = `// BEGIN bundled ${coreDependency.name} commit=${coreDependency.commit} blob=${coreDependency.git_blob_sha1}\n`;
const end = `// END bundled ${coreDependency.name}\n`;
const startIndex = userscript.indexOf(begin);
assert.ok(startIndex >= 0, `Generated userscript is missing the pinned ${coreDependency.name} begin marker.`);
const bundleStart = startIndex + begin.length;
const bundleEnd = userscript.indexOf(end, bundleStart);
assert.ok(bundleEnd > bundleStart, `Generated userscript is missing the pinned ${coreDependency.name} end marker.`);

export const coreBundle = userscript.slice(bundleStart, bundleEnd);
const bytes = Buffer.from(coreBundle, 'utf8');
assert.equal(bytes.length, coreDependency.byte_length,
  `Committed ${coreDependency.name} byte length does not match the manifest pin.`);
const blobHeader = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
const blobSha1 = createHash('sha1').update(blobHeader).update(bytes).digest('hex');
assert.equal(blobSha1, coreDependency.git_blob_sha1,
  `Committed ${coreDependency.name} Git blob does not match the manifest pin.`);

// Existing integration suites fetch coreUrl. Point that test-only URL at the
// exact committed pinned bytes so assertions remain locally runnable without
// requiring network access.
export const coreUrl = `data:text/javascript;base64,${bytes.toString('base64')}`;
