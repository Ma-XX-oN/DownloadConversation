import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

test('Issue 134 keeps filename controls on one non-wrapping row and Reset log below it', () => {
  assert.match(userscript,
    /#\$\{PANEL_ID\} \.tm-communication-log-row\{[^}]*flex-wrap:nowrap[^}]*\}/,
    'The active filename/control row must explicitly prohibit wrapping.');

  const rowStart = userscript.indexOf('class="tm-row tm-communication-log-row"');
  assert.ok(rowStart >= 0, 'The dedicated communication-log filename/control row is missing.');
  const resetRowStart = userscript.indexOf(
    '<div class="tm-row"><button data-role="reset-communication-log"',
    rowStart
  );
  assert.ok(resetRowStart > rowStart,
    'Reset log must appear below the filename/control row.');
  const row = userscript.slice(rowStart, resetRowStart);

  assert.match(row, /data-role="communication-log-name-viewport"/);
  assert.match(row, /data-role="rename-communication-log"/);
  assert.match(row, /data-role="duplicate-communication-log"/);
  assert.doesNotMatch(row, /data-role="reset-communication-log"/,
    'Reset log must remain a separate action below the filename controls.');
});
