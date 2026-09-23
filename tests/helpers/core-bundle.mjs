import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { coreDependency } from './core-pin.mjs';
import { userscript } from './userscript-source.mjs';

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
