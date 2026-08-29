import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);
const start = userscript.indexOf("  function cgCodeFence(text, language = '') {");
const end = userscript.indexOf('\n\n  function cgRenderDetail', start);
assert.ok(start >= 0 && end > start, 'Production cgCodeFence helper is missing.');
const context = {};
vm.runInNewContext(`${userscript.slice(start, end)}\nthis.cgCodeFence = cgCodeFence;`, context);

test('fallback tool fence exceeds the longest literal backtick run', () => {
  const payload = [
    '[L1] literal tool payload',
    '````',
    '[L2] nested four-backtick fence',
    '````',
    '<details>',
    '<summary>literal payload HTML</summary>',
    '</details>'
  ].join('\n');
  const rendered = context.cgCodeFence(payload);
  const lines = rendered.split('\n');
  assert.equal(lines[0], '`````');
  assert.equal(lines.at(-1), '`````');
  assert.equal(rendered.includes(`\n${payload}\n`), true);
});

test('fallback fence remains minimal when payload has no dangerous run', () => {
  assert.equal(context.cgCodeFence('plain text'), '```\nplain text\n```');
  assert.equal(context.cgCodeFence('literal ``` line').startsWith('````\n'), true);
});
