import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const incomplete = [];
const nodeCommand = process.execPath;
const npmCommand = process.platform === 'win32'
  ? (process.env.ComSpec ?? 'cmd.exe')
  : 'npm';
const npmArguments = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm', 'ci']
  : ['ci'];
const pythonCommand = process.env.PYTHON ?? 'python';

const ordinaryStages = [
  ['Modular userscript build regression', nodeCommand, ['--test', 'tests/modular-userscript-build.test.mjs', 'tests/development-version-source.test.mjs']],
  ['Agent plugin authenticated background fetch regression', nodeCommand, ['--test', 'tests/agent-plugin-background-fetch.test.mjs']],
  ['#243 provenance and #274 lifecycle regressions', nodeCommand, ['--test',
    'tests/comm-duplicate-version-header.test.mjs',
    'tests/export-preferences-persistence.test.mjs',
    'tests/gen-boundary-version.test.mjs',
    'tests/gen-provenance-convergence.test.mjs',
    'tests/gen-snapshot-restore.test.mjs',
    'tests/gen-startup-version.test.mjs',
    'tests/gen-version-convergence.test.mjs',
    'tests/issue-243-startup-tdz-regression.test.mjs',
    'tests/issue238-immutable-comm-version-header.test.mjs',
    'tests/issue247-comm-sealed-version-preservation.test.mjs',
    'tests/log-extraction-dialog.test.mjs',
    'tests/merged-log-extraction.test.mjs',
    'tests/merged-log-save-integration.test.mjs',
    'tests/merged-log-storage-integration.test.mjs',
    'tests/nonmonotonic-log-filter-order.test.mjs',
    'tests/recording-group-chromium.test.mjs',
    'tests/recording-group-tab-identity.test.mjs',
    'tests/recording-panel-chromium-layout.test.mjs',
    'tests/recording-panel-modes.test.mjs',
    'tests/agent-stopwatch-v1-identity.test.mjs'
  ]],
  ['DC #347 favicon provenance and settings regression', nodeCommand, ['--test',
    'tests/issue347-favicon-provenance.test.mjs',
    'tests/issue347-log-category-settings.test.mjs',
    'tests/issue347-startup-order.test.mjs',
    'tests/issue347-favicon-source-preview.test.mjs']],
  ['DC #359 parent Worker contract regression', nodeCommand, ['--test',
    'tests/issue359-parent-worker-contract.test.mjs',
    'tests/issue359-writer-boundary.test.mjs',
    'tests/issue359-provider-host-integration.test.mjs',
    'tests/issue359-early-navigation-integration.test.mjs',
    'tests/issue309-csc-canonical-ingress.test.mjs',
    'tests/issue306-csc-queue-host-integration.test.mjs',
    'tests/issue359-current-network-interception.test.mjs',
    'tests/issue359-xhr-websocket-interception.test.mjs',
    'tests/issue359-registered-realm-contract.test.mjs',
    'tests/issue359-worker-writer-cycle.test.mjs',
    'tests/issue359-durable-port.test.mjs',
    'tests/issue359-durable-port-correlation.test.mjs',
    'tests/issue359-worker-bundle.test.mjs']],
  ['CI test inventory regression', nodeCommand, ['--test', 'tests/ci-test-inventory.test.mjs']],
  ['Actions policy regression', nodeCommand, ['--test', 'tests/actions-policy.test.mjs']],
  ['RepoWorkflow adoption contract', nodeCommand, ['--test', 'tests/repoworkflow-adoption.test.mjs']],
  ['Development branch/version identity', nodeCommand, ['scripts/check-development-version.mjs']],
  ['Production JSDoc coverage', nodeCommand, ['scripts/check-jsdoc.mjs']],
  ['JavaScript syntax', nodeCommand, ['--check', 'chatgpt-conversation-markdown-export.user.js']],
  ['TypeScript assembled-userscript semantics', nodeCommand, ['scripts/check-userscript-types.mjs']],
  ['Version identity regression', nodeCommand, ['--test', 'tests/version-identity.test.mjs']],
  ['Development version guard regression', nodeCommand, ['--test', 'tests/development-version-guard.test.mjs']],
  ['Development version setter regression', nodeCommand, ['--test', 'tests/set-development-version.test.mjs']],
  ['Test-cycle artifact publication regression', nodeCommand, ['--test', 'tests/test-cycle-artifact-publication.test.mjs']],
  ['Integration test-cycle preparation regression', nodeCommand, ['--test', 'tests/prepare-integration-test-cycle.test.mjs']],
  ['Release tagging regression', nodeCommand, ['--test', 'tests/release-tagging.test.mjs']],
  ['Single-snapshot export regression', nodeCommand, ['--test', 'tests/export-single-snapshot.test.mjs']],
  ['Issue 172 canonical filename regression', nodeCommand, ['--test', 'tests/issue172-canonical-filenames.test.mjs']],
  ['Export compression toggle regression', nodeCommand, ['--test', 'tests/export-compression-toggle.test.mjs']],
  ['Agent completion sound regression', nodeCommand, ['--test', 'tests/agent-completion-sounds.test.mjs', 'tests/agent-completion-sound-pending.test.mjs']],
  ['Agent terminal shared dispatch regression', nodeCommand, ['--test', 'tests/agent-terminal-dispatch.test.mjs', 'tests/agent-terminal-dry-contract.test.mjs', 'tests/agent-terminal-conversation-turn-complete.test.mjs', 'tests/agent-lifecycle-audit.test.mjs']],
  ['Agent turn stopwatch regression', nodeCommand, ['--test', 'tests/agent-turn-stopwatch.test.mjs']],
  ['Agent turn stopwatch stream integration', nodeCommand, ['--test', 'tests/agent-resume-metadata-patch.test.mjs', 'tests/agent-turn-stopwatch-stream.test.mjs']],
  ['Agent turn stopwatch live total', nodeCommand, ['--test', 'tests/agent-turn-stopwatch-live-total.test.mjs']],
  ['Agent turn stopwatch reload restoration', nodeCommand, ['--test', 'tests/agent-turn-stopwatch-reload.test.mjs']],
  ['DC #352 ACTIVE-only favicon heartbeat', nodeCommand, ['--test',
    'tests/issue352-active-favicon-heartbeat.test.mjs', 'tests/issue356-interm-subject-title.test.mjs']],
  ['DC #349 animation-independent two-frame contract', nodeCommand, ['--test',
    'tests/issue349-animation-v2.test.mjs']],
  ['DC #332 V2 Node and consumer contracts', nodeCommand, ['--test',
    'tests/issue334-v2-sequence.test.mjs',
    'tests/agent-favicon-cached-lookup.test.mjs',
    'tests/agent-favicon-v2-provisional.test.mjs',
    'tests/issue336-v2-sequence-contract.test.mjs']],
  ['DC #332 real Chromium multi-tab renderer/cache', nodeCommand, ['--test',
    'tests/issue332-v2-real-integration.test.mjs']],
  ['DC #332 24-second real Chromium warm pulse performance', nodeCommand, ['--test',
    'tests/issue332-v2-warm-performance.test.mjs']],
  ['DC #334 unsupported favicon backoff regression', nodeCommand, ['--test',
    'tests/issue332-v2-failure-backoff.test.mjs'], { timeoutMs: 90000 }],
  ['DC #334 Chromium cross-tab storage acceptance', nodeCommand, ['--test',
    'tests/issue334-v2-chromium.test.mjs']],
  ['DC #333 renderer real-time Chromium responsiveness', nodeCommand, ['--test',
    'tests/issue333-realtime-browser.test.mjs']],
  ['DC #333 renderer pixel parity Chromium', nodeCommand, ['--test',
    'tests/issue333-v2-sequence.test.mjs']],
  ['DC #336 CSS-sensitive SVG Chromium', nodeCommand, ['--test',
    'tests/issue336-v2-theme-chromium.test.mjs']],
  ['Agent favicon state regression', nodeCommand, ['--test', 'tests/agent-favicon-state.test.mjs', 'tests/agent-favicon-browser-selection.test.mjs', 'tests/agent-favicon-thirty-minute-ring.test.mjs', 'tests/agent-favicon-heartbeat.test.mjs']],
  ['Agent WebSocket delayed-final regression', nodeCommand, ['--test', 'tests/agent-websocket-delayed-final.test.mjs']],
  ['Agent sound readiness regression', nodeCommand, ['--test', 'tests/agent-sound-initialization-indicator.test.mjs']],
  ['Agent terminal polling-timeout regression', nodeCommand, ['--test', 'tests/agent-terminal-polling-timeout.test.mjs', 'tests/agent-terminal-polling-timeout-observer.test.mjs', 'tests/agent-terminal-polling-timeout-integration.test.mjs']],
  ['Communication log file controls regression', nodeCommand, ['--test', 'tests/communication-log-file-controls.test.mjs', 'tests/communication-log-layout-contract.test.mjs', 'tests/communication-log-reset.test.mjs', 'tests/dry-contract.test.mjs']],
  ['Issue 166 archive runtime regression', nodeCommand, ['--test', 'tests/archive-runtime.test.mjs', 'tests/issue188-compressor-contract.test.mjs', 'tests/issue166-segment-archive-integration.test.mjs', 'tests/issue166-remaining-acceptance.test.mjs', 'tests/issue166-dual-active-rotation.test.mjs', 'tests/communication-log-duplicate-progress.test.mjs', 'tests/local-datetime-range-dialog.test.mjs']],
  ['Tail consistency regression', nodeCommand, ['--test', 'tests/tail-consistency.test.mjs']],
  ['Connection recovery warning regression', nodeCommand, ['--test', 'tests/connection-recovery-observer.test.mjs']],
  ['Startup dark-theme guard regression', nodeCommand, ['--test', 'tests/startup-dark-theme-guard.test.mjs']],
  ['Stream tail recovery regression', nodeCommand, ['--test', 'tests/stream-tail-recovery.test.mjs', 'tests/generation-response-clone-timing.test.mjs']],
  ['Stock network diagnostics regression', nodeCommand, ['--test', 'tests/stock-network-diagnostics.test.mjs']],
  ['Conversation API rate-limit regression', nodeCommand, ['--test', 'tests/conversation-api-rate-limit.test.mjs']],
  ['Disk communication recorder regression', nodeCommand, ['--test', 'tests/disk-communication-recorder.test.mjs']],
  ['Directory picker gesture regression', nodeCommand, ['--test', 'tests/directory-picker-gesture.test.mjs']],
  ['#330 shared COMM directory authorisation regression', nodeCommand, ['--test', 'tests/issue330-comm-directory-cross-tab.test.mjs']],
  ['#338 malformed COMM manifest recovery regression', nodeCommand, ['--test', 'tests/issue338-comm-malformed-manifest.test.mjs']],
  ['Console lifecycle and provenance controls', nodeCommand, ['--test', 'tests/console-diagnostics.test.mjs']],
  ['CGP2 provider/Core integration', nodeCommand, ['--test', 'tests/cgp2-core-integration.test.mjs', 'tests/issue156-core-plugin-boundary.test.mjs', 'tests/private-agent-plugin-loading.test.mjs']],
  ['Canonical final-render regressions', nodeCommand, ['--test', 'tests/core-integration.test.mjs', 'tests/phase5-rich-core-integration.test.mjs', 'tests/fallback-adaptive-fence.test.mjs', 'tests/tool-language-diagnostics.test.mjs', 'tests/sediment-resolver.test.mjs']],
  ['Built-in test list UI regression', nodeCommand, ['--test', 'tests/test-list-ui.test.mjs']],
  ['Recorder panel UI regression', nodeCommand, ['--test', 'tests/recorder-panel-ui.test.mjs', 'tests/modal-focus-retention.test.mjs', 'tests/heading-metadata-controls.test.mjs']]
];

const crossConsumerRepositories = [
  ['Ma-XX-oN/AIConversationCore', '1b531a1c92adfa1695db8c644159054e013f0a72', 'phase7-core'],
  ['Ma-XX-oN/AI-General-Memory', 'b2cc257cb586bd944ebca352e316780841217cc1', 'phase7-aigm'],
  ['Ma-XX-oN/AIConversationCore', '4b1bebe6fd7d82d8bbb15f4ad5c1a59cfd03132a', 'phase7-aigm-core']
];

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function recordProblem(name, infrastructure) {
  (infrastructure ? incomplete : failures).push(name);
}

function runStage(name, command, args, options = {}) {
  console.log(`\n=== ${name} ===`);
  console.log(`$ ${commandText(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: 'inherit',
    shell: false,
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {})
  });
  if (result.error) {
    console.error(`${name}: ${result.error.message}`);
    recordProblem(name, options.infrastructure === true);
    return false;
  }
  if (result.status !== 0) {
    console.error(`${name}: ${options.infrastructure ? 'INCOMPLETE' : 'FAILED'} (exit ${result.status ?? 'unknown'})`);
    recordProblem(name, options.infrastructure === true);
    return false;
  }
  console.log(`${name}: PASS`);
  return true;
}

function clonePinnedRepository(repository, commit, destination) {
  if (!runStage(
    `Clone ${repository}`,
    'git',
    ['clone', '--quiet', `https://github.com/${repository}.git`, destination],
    { infrastructure: true }
  )) return false;
  return runStage(
    `Pin ${repository} at ${commit}`,
    'git',
    ['-C', destination, 'checkout', '--quiet', '--detach', commit]
  );
}

function runOrdinaryCi() {
  for (const stage of ordinaryStages) runStage(...stage);
}

function runCrossConsumerCi() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'downloadconversation-ci-'));
  console.log(`\nCross-consumer temporary root: ${temporaryRoot}`);
  try {
    const roots = {};
    for (const [repository, commit, directoryName] of crossConsumerRepositories) {
      const destination = path.join(temporaryRoot, directoryName);
      if (!clonePinnedRepository(repository, commit, destination)) {
        console.error('\nCross-consumer setup could not complete; dependent parity gates are skipped.');
        return;
      }
      roots[directoryName] = destination;
    }

    if (!runStage(
      'Install DownloadConversation AIConversationCore dependencies',
      npmCommand,
      npmArguments,
      { cwd: roots['phase7-core'], infrastructure: true }
    )) return;

    const venvRoot = path.join(temporaryRoot, 'python-venv');
    if (!runStage(
      'Create cross-consumer Python virtual environment',
      pythonCommand,
      ['-m', 'venv', venvRoot],
      { infrastructure: true }
    )) return;

    const pythonExecutable = process.platform === 'win32'
      ? path.join(venvRoot, 'Scripts', 'python.exe')
      : path.join(venvRoot, 'bin', 'python');
    if (!runStage(
      'Install AI-transcript presentation dependencies',
      pythonExecutable,
      ['-m', 'pip', 'install', 'colorama', 'regex'],
      { infrastructure: true }
    )) return;

    const env = {
      ...process.env,
      PYTHON: pythonExecutable,
      PHASE7_CORE_ROOT: roots['phase7-core'],
      PHASE7_AIGM_ROOT: roots['phase7-aigm'],
      PHASE7_AIGM_CORE_ROOT: roots['phase7-aigm-core']
    };

    runStage('Mixed rich final-render parity', nodeCommand, ['tests/phase7-cross-consumer-parity.mjs'], { env });
    runStage('Markdown-shape and multi-exchange parity', nodeCommand, ['tests/phase7-cross-consumer-markdown-shape.mjs'], { env });
    runStage('Adversarial containment and normalization parity', nodeCommand, ['tests/phase7-cross-consumer-adversarial.mjs'], { env });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

console.log('DownloadConversation CI validation environment');
console.log(`Repository: ${root}`);
console.log(`Node: ${process.version}`);
if (Number(process.versions.node.split('.')[0]) !== 22) {
  console.warn('WARNING: required GitHub validation uses Node 22; this run is using a different Node major version.');
}

runOrdinaryCi();
runCrossConsumerCi();

console.log('\n=== CI environment summary ===');
if (incomplete.length > 0) {
  console.warn(`INCOMPLETE: ${incomplete.length} infrastructure/prerequisite stage(s) could not execute:`);
  for (const name of incomplete) console.warn(`- ${name}`);
  if (failures.length > 0) {
    console.error(`Also observed ${failures.length} genuine validation failure(s):`);
    for (const name of failures) console.error(`- ${name}`);
  }
  process.exitCode = 2;
} else if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} validation stage(s) failed:`);
  for (const name of failures) console.error(`- ${name}`);
  process.exitCode = 1;
} else {
  console.log('PASS: all repository-owned validation stages completed successfully.');
}
