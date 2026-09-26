import { userscript } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

test('Issue 134 keeps filename and all three file actions on one non-wrapping row', () => {
  assert.match(userscript,
    /#\$\{PANEL_ID\} \.tm-communication-log-row\{[^}]*flex-wrap:nowrap[^}]*\}/,
    'The active filename/control row must explicitly prohibit wrapping.');

  const rowStart = userscript.indexOf('class="tm-row tm-communication-log-row"');
  assert.ok(rowStart >= 0, 'The dedicated communication-log filename/control row is missing.');
  const nextRowStart = userscript.indexOf('<div class="tm-row">', rowStart + 1);
  assert.ok(nextRowStart > rowStart, 'The row following the communication-log controls is missing.');
  const row = userscript.slice(rowStart, nextRowStart);

  assert.match(row, /data-role="communication-log-name-viewport"/);
  assert.match(row, /class="tm-icon-button" data-role="rename-communication-log"/);
  assert.match(row,
    /class="tm-icon-button" data-role="duplicate-communication-log"[^>]*aria-label="Duplicate communication log"/);
  assert.match(row,
    /class="tm-icon-button" data-role="reset-communication-log"[^>]*aria-label="Reset communication log"/,
    'Reset must share the same row as the filename, Rename, and Duplicate controls.');
  assert.doesNotMatch(row, />Duplicate<\/button>/,
    'Duplicate must be an icon-only action, not a text button.');
  assert.doesNotMatch(row, />Reset log<\/button>/,
    'Reset must be an icon-only action, not a text button.');
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

test('Rename, Duplicate and Reset use their approved icon treatments', () => {
  assert.match(userscript, /function renameIconMarkup\(\)/);
  assert.match(userscript, /renameCommunicationLogButton\.innerHTML = renameIconMarkup\(\)/);
  assert.match(userscript, /function duplicateIconMarkup\(\)/);
  assert.match(userscript,
    /duplicateIconMarkup[\s\S]*<rect[^>]+>[\s\S]*<rect[^>]+>[\s\S]*<rect[^>]+>/,
    'Duplicate icon must use the approved one-source-to-two-target branching metaphor.');

  const resetStart = userscript.indexOf('  function resetIconMarkup() {');
  assert.ok(resetStart >= 0, 'Reset icon helper is missing.');
  const resetEnd = userscript.indexOf('\n  /**', resetStart + 3);
  assert.ok(resetEnd > resetStart, 'Reset icon helper boundary is missing.');
  const resetSource = userscript.slice(resetStart, resetEnd);
  const resetData = resetSource.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
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


test('Issue 166 owns the communication segment target in one named symbol', () => {
  assert.match(userscript,
    /const COMMUNICATION_LOG_SEGMENT_TARGET_BYTES = 10 \* 1024 \* 1024;/,
    'The initial 10 MiB segment target must be one named, easily changed symbol.');
  assert.equal(
    (userscript.match(/const COMMUNICATION_LOG_SEGMENT_TARGET_BYTES\s*=/g) || []).length,
    1,
    'The segment target must have exactly one authoritative declaration.');
});
