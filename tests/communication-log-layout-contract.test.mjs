import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

test('Issue 134 keeps filename controls on one non-wrapping row and Reset below it', () => {
  assert.match(userscript,
    /#\$\{PANEL_ID\} \.tm-communication-log-row\{[^}]*flex-wrap:nowrap[^}]*\}/,
    'The active filename/control row must explicitly prohibit wrapping.');

  const rowStart = userscript.indexOf('class="tm-row tm-communication-log-row"');
  assert.ok(rowStart >= 0, 'The dedicated communication-log filename/control row is missing.');
  const resetRowStart = userscript.indexOf(
    '<div class="tm-row"><button class="tm-icon-button" data-role="reset-communication-log"',
    rowStart
  );
  assert.ok(resetRowStart > rowStart,
    'Reset must appear below the filename/control row.');
  const row = userscript.slice(rowStart, resetRowStart);

  assert.match(row, /data-role="communication-log-name-viewport"/);
  assert.match(row, /data-role="rename-communication-log"/);
  assert.match(row,
    /class="tm-icon-button" data-role="duplicate-communication-log"[^>]*aria-label="Duplicate communication log"/);
  assert.doesNotMatch(row, />Duplicate<\/button>/,
    'Duplicate must be an icon-only action, not a text button.');
  assert.doesNotMatch(row, /data-role="reset-communication-log"/,
    'Reset must remain a separate action below the filename controls.');
});

test('active filename is plain text rather than a button-like field', () => {
  const rule = userscript.match(
    /#\$\{PANEL_ID\} \.tm-log-name-viewport\{([^}]*)\}/
  );
  assert.ok(rule, 'Filename viewport CSS rule is missing.');
  assert.doesNotMatch(rule[1], /(?:^|;)\s*border(?:-radius)?\s*:/,
    'Filename viewport must not have a button-like border or rounded border.');
  assert.doesNotMatch(rule[1], /(?:^|;)\s*background\s*:/,
    'Filename viewport must not have a button-like background.');
  assert.match(userscript, /\.tm-log-name-viewport:hover\s+\.tm-log-name-text/,
    'Long filenames must retain hover scrolling.');
});

test('Duplicate and Reset use their approved icon treatments', () => {
  assert.match(userscript, /function duplicateIconMarkup\(\)/);
  assert.match(userscript,
    /duplicateIconMarkup[\s\S]*<rect[^>]+>[\s\S]*<rect[^>]+>[\s\S]*<rect[^>]+>/,
    'Duplicate icon must use the approved one-source-to-two-target branching metaphor.');
  assert.match(userscript, /function resetIconMarkup\(\)/);
  const resetData = userscript.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  assert.ok(resetData, 'Reset must embed the AgentPanelSpeaker config-reset PNG.');
  assert.equal(
    createHash('sha256').update(Buffer.from(resetData[1], 'base64')).digest('hex'),
    '4592bb94353fd5416a7b372e0e113b66b6e4deeab43338a50505fbfeac11716c',
    'Reset icon bytes must exactly match AgentPanelSpeaker/Assets/UtilityIcons/Reset.png.'
  );
  assert.match(userscript,
    /class="tm-icon-button" data-role="reset-communication-log"[^>]*aria-label="Reset communication log"/);
  assert.doesNotMatch(userscript, />Reset log<\/button>/,
    'Reset must be icon-only rather than a text button.');
});
