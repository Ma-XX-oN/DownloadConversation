import { downloadConversationSource, userscript } from './helpers/userscript-source.mjs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

test('recorder panel restores dialog/log/switch/extract UI contracts', () => {
  assert.match(userscript, /function installModalContract\(/);
  assert.match(userscript, /event\.key === 'Escape'/);
  assert.match(userscript, /event\.key === 'Tab'/);
  assert.match(userscript, /event\.shiftKey/);
  assert.match(userscript, /event\.key === 'Enter'/);
  assert.match(userscript, /restore\?\.isConnected/);
  assert.doesNotMatch(userscript, /setStatus\(currentTestStatusLines\(\)\.join/,
    'Test results belong in the test dialog, not general status.');

  const htmlStart = userscript.indexOf('panel.innerHTML = `');
  const htmlEnd = userscript.indexOf('`;', htmlStart);
  const ui = userscript.slice(htmlStart, htmlEnd);
  const titleAt = ui.indexOf('data-role="title"');
  const logAt = ui.indexOf('data-role="log-count"');
  const diagnosticsAt = ui.indexOf('data-role="diagnostics"');
  assert.ok(titleAt >= 0 && logAt > titleAt && diagnosticsAt > logAt,
    'Version, log count and diagnostics must retain approved order.');
  assert.match(ui, /data-role="last-log-problem"/);
  assert.match(ui, /data-role="save-log"/);
  assert.match(ui, /data-role="reset-communication-log"/);
  assert.doesNotMatch(ui, /data-role="copy-log"|data-role="toggle-log"|data-role="screen-on"/);
  assert.match(userscript, /checkIconMarkup\(\)/);
  assert.match(userscript, /data-role="log-output" hidden/);
  assert.match(userscript, /\.tm-log-row:nth-child\(even\)/);
  assert.match(ui, /tm-recorder-section tm-recording-section/);
  assert.match(ui, /tm-recorder-section tm-export-section/);
  assert.match(ui, /tm-row tm-tool-actions/);

  assert.match(ui, /data-role="extract" type="button" aria-label="Export conversation"/);
  assert.match(userscript, /data-role="format-jsonl" type="checkbox"> JSONL/);
  assert.doesNotMatch(userscript, /data-role="format-jsonl" type="checkbox" checked/);
  assert.match(userscript, /data-role="format-md" type="checkbox" checked> MD/);
  assert.match(userscript, /data-role="export-compression"[^>]*role="switch"/);
  assert.match(userscript, /exportCompressionIconMarkup/);
  assert.match(userscript, /data-role="show-timestamps" type="checkbox"> Timestamp/);
  assert.match(userscript, /data-role="show-record-numbers" type="checkbox"> Record #/);
  assert.match(userscript, /data-role="show-turn-ids" type="checkbox"> Turn ID/);
  assert.match(userscript, /#\$\{PANEL_ID\} input\[type="checkbox"\]/,
    'Recorder must own checkbox rendering instead of inheriting host-page checkbox suppression.');
  assert.match(userscript, /(?:all:\s*revert|appearance:\s*(?:auto|checkbox)|-webkit-appearance:\s*checkbox)/,
    'Recorder checkbox styles must explicitly restore native appearance.');
  assert.match(userscript, /(?:all:\s*revert|visibility:\s*visible)/,
    'Recorder checkbox styles must explicitly remain visible.');
  assert.match(userscript, /(?:all:\s*revert|opacity:\s*1)/,
    'Recorder checkbox styles must not inherit host opacity suppression.');
  assert.match(userscript, /SHOW_TIMESTAMPS_STORAGE_KEY/);
  assert.match(userscript, /SHOW_RECORD_NUMBERS_STORAGE_KEY/);
  assert.match(userscript, /SHOW_TURN_IDS_STORAGE_KEY/);
  assert.match(userscript, /showTurnIds = localStorage\.getItem\(SHOW_TURN_IDS_STORAGE_KEY\) === 'true'/);
  assert.doesNotMatch(userscript, /data-role="extract-jsonl"/);
  assert.doesNotMatch(userscript, /data-role="extract-md"/);
  assert.match(userscript, /if \(jsonl\?\.checked\) kinds\.push\('jsonl'\)/);
  assert.match(userscript, /if \(md\?\.checked\) kinds\.push\('md'\)/);
  assert.match(userscript, /if \(kinds\.length\) await runExport\(kinds, \{ compressed: exportCompressionEnabled \}\)/);
  assert.match(userscript, /const totalImages = records\.reduce\(\(total, item\) => total \+ userImagePointerCount\(item\?\.message\), 0\);/,
    'Image recovery must calculate the total image count before recovery begins.');
  assert.match(userscript, /recovering image \${imageNumber}\/\${imageCount}/,
    'Image recovery status must display the current image ordinal and total.');
  assert.match(userscript, /Image elapsed: \${formatDuration\(imageElapsed\)}/,
    'Image recovery status must expose elapsed time for the currently awaited image.');
  assert.match(userscript, /recoveredImages = Math\.max\(recoveredImages, context\.image_number\);/,
    'Image recovery progress must advance as each individual image operation completes.');
  assert.match(userscript, /fetching API page \${pageNumber}/,
    'Conversation fetching status must identify the currently awaited API page.');
  assert.match(userscript, /Page elapsed: \${formatDuration\(pageElapsed\)}/,
    'Conversation fetching status must keep a live elapsed heartbeat while a page request is pending.');
  assert.match(userscript, /await new Promise\(resolve => setTimeout\(resolve, 0\)\);/,
    'Image completion must yield once so the next phase can paint before synchronous rendering.');
  assert.doesNotMatch(userscript, /function keepLauncherMounted\(/,
    'Diagnostic build must not restore a launcher that the host removed.');
  assert.match(userscript, /function installLauncherRemovalDiagnostics\(\)/,
    'Launcher-removal call-stack diagnostics must be installed.');
  assert.match(userscript, /Node\.prototype\.removeChild = function\(child\)/,
    'Direct DOM removals must capture the initiating JavaScript stack.');
  assert.match(userscript, /body_child_index: bodyChildIndex/,
    'Removal diagnostics must record the launcher direct-BODY index.');
  assert.match(userscript, /stack: new Error\(`launcher removal via \${operation}`\)\.stack/,
    'Removal diagnostics must capture a pre-operation stack.');
  assert.match(userscript, /function installLauncherTopologyDiagnostics\(\)/,
    'Topology diagnostics must monitor BODY structure and startup timing.');
  assert.match(userscript, /launcherTopologyInitialBodyIndexes = new WeakMap\(\)/,
    'Topology diagnostics must retain stable identity-to-initial-index mapping.');
  assert.match(userscript, /logLauncherTopology\('body-child-mutation'/,
    'Direct BODY child mutations must be logged.');
  assert.match(userscript, /logLauncherTopology\('body-quiet-500ms'\)/,
    'Topology diagnostics must report an empirically quiet BODY interval.');
  assert.match(userscript, /topology: launcherTopologyContext\(\)/,
    'Removal diagnostics must include the full BODY topology at removal time.');
  assert.match(userscript, /const DEEP_LAUNCHER_DIAGNOSTICS = false;/,
    'Invasive launcher diagnostics must be disabled in normal production runs.');
  assert.match(userscript, /if \(DEEP_LAUNCHER_DIAGNOSTICS\) \{\n    installLauncherRemovalDiagnostics\(\);\n    installLauncherTopologyDiagnostics\(\);\n  \}/,
    'Deep launcher diagnostics must remain available behind the disabled flag.');
  assert.match(userscript, /const quietMs = 1000;/,
    'Launcher bootstrap must wait for a full second of direct-BODY quiet.');
  assert.match(userscript, /let loadReady = document\.readyState === 'complete';/,
    'Launcher bootstrap must not consider the host stable before load completes.');
  assert.match(userscript, /bodyObserver\.observe\(body, \{ childList: true \}\);/,
    'Launcher bootstrap must observe direct BODY reconciliation.');
  assert.match(userscript, /window\.addEventListener\('load', \(\) => \{/,
    'Launcher bootstrap must start its quiet timer when load completes.');
  assert.match(userscript, /launcher mounted/,
    'Launcher bootstrap must retain a compact successful-mount lifecycle log.');
  assert.match(userscript, /launcher disconnected; waiting for BODY quiet/,
    'Launcher bootstrap must retain a compact disconnection lifecycle warning.');
  assert.match(userscript, /remount-after-body-reconciliation/,
    'Launcher bootstrap must distinguish a later remount from the initial mount.');
  const bootstrapAt = userscript.indexOf('function bootstrapUi()');
  const bootstrapEnd = userscript.indexOf("document.addEventListener('visibilitychange'", bootstrapAt);
  const bootstrapSource = userscript.slice(bootstrapAt, bootstrapEnd);
  assert.match(bootstrapSource, /makeLauncher\(\);/,
    'Delayed bootstrap must create the launcher after the quiet interval.');
  assert.doesNotMatch(bootstrapSource, /makePanel\(\);/,
    'Recorder panel must remain lazy and must not be inserted during host reconciliation.');
});


test('Issue 220 Save and Reset are beneath recording modes, not in the log header', () => {
  const markup = userscript.slice(userscript.indexOf('panel.innerHTML = `'),
    userscript.indexOf('`;', userscript.indexOf('panel.innerHTML = `')));
  const modesAt = markup.indexOf('tm-row tm-recording-modes');
  const buttonsAt = markup.indexOf('tm-row tm-recording-actions');
  const saveAt = markup.indexOf('data-role="save-log"');
  const resetAt = markup.indexOf('data-role="reset-communication-log"');
  const exportAt = markup.indexOf('tm-recorder-section tm-export-section');
  assert.ok(modesAt >= 0 && buttonsAt > modesAt && saveAt > buttonsAt
    && resetAt > saveAt && exportAt > resetAt);
  assert.match(markup, /aria-label="Save merged log"/);
});

test('Issue 166 diagnostic Save uses a supported deterministic archive member and reports failures', () => {
  assert.ok(downloadConversationSource.includes('diagnosticLogArchiveName('),
    'Diagnostic XZ filename must be owned by the diagnostic-log boundary.');
  assert.match(downloadConversationSource, /diagnostic-log-save-failed/,
    'Diagnostic archive failures must be recorded in the diagnostic log.');
  assert.match(downloadConversationSource, /Diagnostic log save failed during/,
    'Diagnostic archive failures must remain visible to the user.');
});


test('Issue 166 archive runtime is assembled inside the DownloadConversation IIFE', async () => {
  const buildLib = await readFile(
    new URL('../scripts/userscript-build-lib.mjs', import.meta.url),
    'utf8'
  );
  assert.match(buildLib, /const scopedSource = prelude/);
  assert.match(buildLib, /source\.replace\(/);
  assert.match(buildLib, /\$\{prelude\}/);
  assert.doesNotMatch(
    buildLib,
    /result \+= prelude;\s*result \+= source;/,
    'Archive prelude must not be emitted outside the DownloadConversation IIFE.'
  );
});
