import { userscript } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

test('filename stays beside Rename while Save and Reset occupy a separate row', () => {
  assert.match(userscript,
    /#\$\{PANEL_ID\} \.tm-communication-log-row\{[^}]*flex-wrap:nowrap[^}]*\}/);
  const filenameRow = userscript.slice(
    userscript.indexOf('class="tm-row tm-communication-log-row"'),
    userscript.indexOf('class="tm-row tm-recording-modes"')
  );
  assert.match(filenameRow, /data-role="communication-log-name-viewport"/);
  assert.match(filenameRow, /data-role="rename-communication-log"/);
  assert.doesNotMatch(filenameRow, /data-role="reset-communication-log"/);
  assert.doesNotMatch(filenameRow, /data-role="duplicate-communication-log"/);
  const actionRow = userscript.slice(
    userscript.indexOf('class="tm-row tm-recording-actions"'),
    userscript.indexOf('class="tm-recorder-section tm-export-section"')
  );
  assert.match(actionRow, /data-role="save-log"/);
  assert.match(actionRow, /data-role="reset-communication-log"/);
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

test('Rename, disk Save and circular-arrow Reset use approved icon actions', () => {
  assert.match(userscript, /function renameIconMarkup\(\)/);
  assert.match(userscript, /renameCommunicationLogButton\.innerHTML = renameIconMarkup\(\)/);
  assert.match(userscript, /function saveIconMarkup\(\)/);
  assert.match(userscript, /<path d="M4 3h13l3 3v15H4z"/);
  assert.match(userscript, /resetCommunicationLogButton\.innerHTML/);
  assert.match(userscript, /<path d="M4 6v5h5"/);
  assert.match(userscript, /data-role="reset-communication-log"/);
  assert.doesNotMatch(userscript, /data-role="duplicate-communication-log"/);
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


test('Issue 166 records through the segmented storage interface, not the legacy raw append interface', () => {
  assert.match(userscript,
    /await communicationLogStorage\.appendRecord\(record\);/,
    'Communication records must enter the Issue 166 storage abstraction.');
  assert.doesNotMatch(userscript,
    /function communicationLogAppendLine\(/,
    'The legacy raw JSONL append interface must be removed rather than left on the execution path.');
  assert.doesNotMatch(userscript,
    /await communicationLogAppendLine\(/,
    'No recorder call site may continue through the legacy raw append interface.');
});
