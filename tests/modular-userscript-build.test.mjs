import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DEFAULT_PART_BYTES,
  assembleUserscript,
  gitBlobSha1,
  readUserscriptManifest,
  replaceUserscriptHeader,
  splitTextAtNewlines,
  splitUserscript
} from '../scripts/userscript-build-lib.mjs';

const rootDir = new URL('..', import.meta.url);
const userscriptPath = new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url);
const headerPath = new URL('../src/userscript-header.js', import.meta.url);

function firstDifference(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : limit;
}

test('issue #150 modular source can reproduce the current runtime body exactly', async () => {
  const [userscript, header] = await Promise.all([
    readFile(userscriptPath, 'utf8'),
    readFile(headerPath, 'utf8')
  ]);

  const { body } = splitUserscript(userscript);
  const parts = splitTextAtNewlines(body, DEFAULT_PART_BYTES);

  assert.ok(parts.length > 1, 'migration must split the monolithic runtime body');
  assert.equal(parts.join(''), body, 'fragment concatenation must preserve every runtime byte');
  for (const part of parts) {
    assert.ok(
      Buffer.byteLength(part, 'utf8') <= DEFAULT_PART_BYTES,
      'each generated source fragment must remain connector-sized'
    );
  }

  const rebuilt = `${header}${parts.join('')}`;
  assert.equal(
    rebuilt,
    replaceUserscriptHeader(userscript, header),
    'build output may change only the authoritative userscript header during the first migration'
  );
});

test('issue #150 checked-in manifest assembles byte-equivalent runtime output', async () => {
  const [userscript, header, manifest] = await Promise.all([
    readFile(userscriptPath, 'utf8'),
    readFile(headerPath, 'utf8'),
    readUserscriptManifest(rootDir)
  ]);
  const rebuilt = await assembleUserscript(rootDir, manifest);
  const expected = replaceUserscriptHeader(userscript, header);

  assert.equal(
    manifest.migration_source?.git_blob_sha1,
    gitBlobSha1(userscript),
    'manifest migration source must identify the exact monolith used for the split'
  );

  if (rebuilt !== expected) {
    const difference = firstDifference(rebuilt, expected);
    const headerLength = header.length;
    const bodyOffset = Math.max(0, difference - headerLength);
    let cumulative = 0;
    let fragment = '<header>';
    let fragmentOffset = difference;
    if (difference >= headerLength) {
      for (const relativePath of manifest.parts) {
        const part = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
        if (bodyOffset < cumulative + part.length) {
          fragment = relativePath;
          fragmentOffset = bodyOffset - cumulative;
          break;
        }
        cumulative += part.length;
      }
      if (fragment === '<header>') {
        fragment = '<after-last-fragment>';
        fragmentOffset = bodyOffset - cumulative;
      }
    }
    const contextStart = Math.max(0, difference - 40);
    const contextEnd = difference + 80;
    assert.fail(
      `checked-in manifest differs at character ${difference} ` +
      `(${fragment} offset ${fragmentOffset}); actual length ${rebuilt.length}, expected ${expected.length}; ` +
      `actual context ${JSON.stringify(rebuilt.slice(contextStart, contextEnd))}; ` +
      `expected context ${JSON.stringify(expected.slice(contextStart, contextEnd))}`
    );
  }

  for (const relativePath of manifest.parts) {
    const part = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
    assert.ok(
      Buffer.byteLength(part, 'utf8') <= manifest.fragment_max_bytes,
      `${relativePath} exceeds the declared fragment byte limit`
    );
  }
});
