import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DEFAULT_PART_BYTES,
  replaceUserscriptHeader,
  splitTextAtNewlines,
  splitUserscript
} from '../scripts/userscript-build-lib.mjs';

const userscriptPath = new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url);
const headerPath = new URL('../src/userscript-header.js', import.meta.url);

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
