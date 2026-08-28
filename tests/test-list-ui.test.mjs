import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

test('Test opens the interactive built-in test matrix instead of immediately running all tests', () => {
  assert.match(userscript, /function builtInTests\(\) \{/,
    'Production userscript must expose one built-in-test registry.');
  assert.match(userscript,
    /panel\.querySelector\('\[data-role="test"\]'\)\.addEventListener\('click', event => openTestMatrix\(event\.currentTarget\)\);/,
    'Test button must open the matrix with its opener for focus restoration, not immediately execute Run All.');
  assert.doesNotMatch(userscript, /data-role="test-list"/,
    'The rejected v0.6.136 static inline list must not remain.');
  assert.match(userscript, /<strong id="\$\{TEST_MATRIX_ID\}-title">Built-in tests<\/strong>/,
    'Matrix must identify the built-in test set before execution.');
  for (const heading of ['Type', 'Previous Result', 'Current Result']) {
    assert.ok(userscript.includes(`<th>${heading}</th>`), `Matrix is missing ${heading}.`);
  }
  assert.match(userscript, /data-role="run-test">Run<\/button>/,
    'Every matrix row must expose an individual Run control.');
  assert.match(userscript, /data-role="run-all-tests">Run All<\/button>/,
    'Matrix must expose Run All.');
  assert.match(userscript,
    /for \(const \[name, fn\] of builtInTests\(\)\) \{/,
    'Run All must execute the same registry shown by the matrix.');

  for (const name of [
    'API pagination',
    'Stable API message IDs',
    'Multimodal User + chronological order',
    'AI-transcript renderer parity',
    'Generated sandbox download link',
    'Jump identifier resolution',
    'Conversation API access/schema'
  ]) {
    assert.ok(userscript.includes(`['${name}',`), `Built-in registry is missing ${name}.`);
  }
});
