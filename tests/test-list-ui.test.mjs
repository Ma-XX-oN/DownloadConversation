import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

test('built-in tests are visible before Test is pressed and share the execution registry', () => {
  assert.match(userscript, /function builtInTests\(\) \{/,
    'Production userscript must expose one built-in-test registry.');
  assert.match(userscript, /data-role="test-list" aria-label="Built-in tests"/,
    'Recorder panel must contain a visible built-in-test list.');
  assert.match(userscript,
    /testList\.textContent = builtInTests\(\)\.map\(\(\[name\]\) => `• \${name}`\)\.join\('\\n'\)/,
    'Pre-run test list must be populated from the same registry used for execution.');
  assert.match(userscript,
    /for \(const \[name, fn\] of builtInTests\(\)\) await run\(name, fn\);/,
    'Test execution must use the visible built-in-test registry.');

  for (const name of [
    'API pagination',
    'Stable API message IDs',
    'Multimodal User + chronological order',
    'AI-transcript renderer parity',
    'Generated sandbox download link',
    'Jump identifier resolution',
    'Conversation API access/schema'
  ]) {
    assert.ok(userscript.includes(`['${name}',`), `Visible registry is missing ${name}.`);
  }
});
