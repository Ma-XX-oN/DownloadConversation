import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('recorder panel restores dialog/log/switch/extract UI contracts', () => {
  assert.match(userscript, /function installModalContract\(/);
  assert.match(userscript, /event\.key === 'Escape'/);
  assert.match(userscript, /event\.key === 'Tab'/);
  assert.match(userscript, /event\.shiftKey/);
  assert.match(userscript, /event\.key === 'Enter'/);
  assert.match(userscript, /restore\?\.isConnected/);
  assert.doesNotMatch(userscript, /setStatus\(currentTestStatusLines\(\)\.join/,
    'Test results belong in the test dialog, not general status.');

  const titleAt = userscript.indexOf('<div class="tm-title" data-role="title"></div>');
  const logAt = userscript.indexOf('<div class="tm-log-head">', titleAt);
  const statusAt = userscript.indexOf('<div class="tm-status" data-role="status"></div>', titleAt);
  assert.ok(titleAt >= 0 && logAt > titleAt && statusAt > logAt, 'Log must be directly below title, before status/other controls.');
  assert.match(userscript, /data-role="copy-log"[^>]*aria-label="Copy diagnostic log"/);
  assert.match(userscript, /checkIconMarkup\(\)/);
  assert.match(userscript, /button\.classList\.add\('tm-copy-fade'\)/,
    'Copy confirmation must fade before the copy icon returns.');
  assert.match(userscript, /requestAnimationFrame\(\(\) => button\.classList\.remove\('tm-copy-fade'\)\)/,
    'Copy icon must fade back in after the confirmation checkmark.');
  assert.match(userscript, /data-role="toggle-log"/);
  assert.match(userscript, /data-role="log-output" hidden/);
  assert.match(userscript, /\.tm-log-row:nth-child\(even\)/);

  assert.match(userscript, /data-role="screen-on"[^>]*role="switch"[^>]*aria-checked="false"/);
  assert.match(userscript, /class="tm-switch-thumb"/);
  assert.match(userscript, /screen\.setAttribute\('aria-checked', String\(screenOnWhenCapturing\)\)/);

  assert.match(userscript, /data-role="extract" type="button">Extract<\/button>/);
  assert.match(userscript, /data-role="format-jsonl" type="checkbox"> JSONL/);
  assert.doesNotMatch(userscript, /data-role="format-jsonl" type="checkbox" checked/);
  assert.match(userscript, /data-role="format-md" type="checkbox" checked> MD/);
  assert.doesNotMatch(userscript, /data-role="extract-jsonl"/);
  assert.doesNotMatch(userscript, /data-role="extract-md"/);
  assert.match(userscript, /if \(jsonl\?\.checked\) await runExport\('jsonl'\)/);
  assert.match(userscript, /if \(md\?\.checked\) await runExport\('md'\)/);
});
