import { userscript } from './helpers/userscript-source.mjs';
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
  assert.match(userscript, /data-role="show-timestamps" type="checkbox"> Timestamp/);
  assert.match(userscript, /data-role="show-record-numbers" type="checkbox"> Record #/);
  assert.match(userscript, /data-role="show-turn-ids" type="checkbox"> Turn ID/);
  assert.match(userscript, /SHOW_TIMESTAMPS_STORAGE_KEY/);
  assert.match(userscript, /SHOW_RECORD_NUMBERS_STORAGE_KEY/);
  assert.match(userscript, /SHOW_TURN_IDS_STORAGE_KEY/);
  assert.match(userscript, /showTurnIds = localStorage\.getItem\(SHOW_TURN_IDS_STORAGE_KEY\) === 'true'/);
  assert.doesNotMatch(userscript, /data-role="extract-jsonl"/);
  assert.doesNotMatch(userscript, /data-role="extract-md"/);
  assert.match(userscript, /if \(jsonl\?\.checked\) kinds\.push\('jsonl'\)/);
  assert.match(userscript, /if \(md\?\.checked\) kinds\.push\('md'\)/);
  assert.match(userscript, /if \(kinds\.length\) await runExport\(kinds\)/);
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
