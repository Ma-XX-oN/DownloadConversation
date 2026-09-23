import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const environment = await readFile(
  new URL('../scripts/ci-environment.mjs', import.meta.url),
  'utf8'
);

const testFiles = (await readdir(new URL('./', import.meta.url), { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
  .map(entry => entry.name)
  .sort();

test('every top-level Node regression is included in repository-owned CI', () => {
  const missing = testFiles.filter(name => !environment.includes(`tests/${name}`));
  assert.deepEqual(
    missing,
    [],
    `Repository-owned CI omits top-level Node regression(s): ${missing.join(', ')}`
  );
});
