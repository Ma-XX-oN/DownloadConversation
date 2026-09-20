import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const nodeCommand = process.execPath;
const npmCommand = process.platform === 'win32'
  ? (process.env.ComSpec ?? 'cmd.exe')
  : 'npm';
const npmArguments = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm', 'ci']
  : ['ci'];
const pythonCommand = process.env.PYTHON ?? 'python';

const ordinaryStages = [
  ['Build production userscript', nodeCommand, ['scripts/build-userscript.mjs']],
  ['Verify generated userscript is current', nodeCommand, ['scripts/build-userscript.mjs', '--check']],
  ['Modular userscript build regression', nodeCommand, ['--test', 'tests/modular-userscript-build.test.mjs', 'tests/development-version-source.test.mjs']],
  ['Development branch/version identity', nodeCommand, ['scripts/check-development-version.mjs']],
  ['Production JSDoc coverage', nodeCommand, ['scripts/check-jsdoc.mjs']],
  ['JavaScript syntax', nodeCommand, ['--check', 'chatgpt-conversation-markdown-export.user.js']],
  ['Version identity regression', nodeCommand, ['--test', 'tests/version-identity.test.mjs']],
  ['Development version guard regression', nodeCommand, ['--test', 'tests/development-version-guard.test.mjs']],
  ['Development version setter regression', nodeCommand, ['--test', 'tests/set-development-version.test.mjs']],
  ['Release tagging regression', nodeCommand, ['--test', 'tests/release-tagging.test.mjs']],
  ['Single-snapshot export regression', nodeCommand, ['--test', 'tests/export-single-snapshot.test.mjs']],
  ['Agent completion sound regression', nodeCommand, ['--test', 'tests/agent-completion-sounds.test.mjs', 'tests/agent-completion-sound-pending.test.mjs']],
  ['Agent terminal shared dispatch regression', nodeCommand, ['--test', 'tests/agent-terminal-dispatch.test.mjs', 'tests/agent-terminal-dry-contract.test.mjs']],
  ['Agent turn stopwatch regression', nodeCommand, ['--test', 'tests/agent-turn-stopwatch.test.mjs']],
  ['Agent turn stopwatch stream integration', nodeCommand, ['--test', 'tests/agent-resume-metadata-patch.test.mjs', 'tests/agent-turn-stopwatch-stream.test.mjs']],
  ['Agent turn stopwatch live total', nodeCommand, ['--test', 'tests/agent-turn-stopwatch-live-total.test.mjs']],
  ['Agent turn stopwatch reload restoration', nodeCommand, ['--test', 'tests/agent-turn-stopwatch-reload.test.mjs']],
  ['Agent favicon state regression', nodeCommand, ['--test', 'tests/agent-favicon-state.test.mjs', 'tests/agent-favicon-browser-selection.test.mjs']],
  ['Agent terminal polling-timeout regression', nodeCommand, ['--test', 'tests/agent-terminal-polling-timeout.test.mjs', 'tests/agent-terminal-polling-timeout-observer.test.mjs']],
  ['Communication log file controls regression', nodeCommand, ['--test', 'tests/communication-log-file-controls.test.mjs', 'tests/communication-log-layout-contract.test.mjs', 'tests/dry-contract.test.mjs']],
  ['Tail consistency regression', nodeCommand, ['--test', 'tests/tail-consistency.test.mjs']],
  ['Stream tail recovery regression', nodeCommand, ['--test', 'tests/stream-tail-recovery.test.mjs', 'tests/generation-response-clone-timing.test.mjs']],
  ['Stock network diagnostics regression', nodeCommand, ['--test', 'tests/stock-network-diagnostics.test.mjs']],
  ['Disk communication recorder regression', nodeCommand, ['--test', 'tests/disk-communication-recorder.test.mjs']],
  ['Directory picker gesture regression', nodeCommand, ['--test', 'tests/directory-picker-gesture.test.mjs']],
  ['Console lifecycle and provenance controls', nodeCommand, ['--test', 'tests/console-diagnostics.test.mjs']],
  ['Canonical final-render regressions', nodeCommand, ['--test', 'tests/core-integration.test.mjs', 'tests/phase5-rich-core-integration.test.mjs', 'tests/fallback-adaptive-fence.test.mjs', 'tests/tool-language-diagnostics.test.mjs', 'tests/sediment-resolver.test.mjs']],
  ['Built-in test list UI regression', nodeCommand, ['--test', 'tests/test-list-ui.test.mjs']],
  ['Recorder panel UI regression', nodeCommand, ['--test', 'tests/recorder-panel-ui.test.mjs', 'tests/modal-focus-retention.test.mjs', 'tests/heading-metadata-controls.test.mjs']]
];

const crossConsumerRepositories = [
  ['Ma-XX-oN/AIConversationCore', 'cf34d9374f51ac525acfb90cfd6b247006a7bf6e', 'phase7-core'],
  ['Ma-XX-oN/AI-General-Memory', 'b2cc257cb586bd944ebca352e316780841217cc1', 'phase7-aigm'],
  ['Ma-XX-oN/AIConversationCore', '4b1bebe6fd7d82d8bbb15f4ad5c1a59cfd03132a', 'phase7-aigm-core']
];

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function runStage(name, command, args, options = {}) {
  console.log(`\n=== ${name} ===`);
  console.log(`$ ${commandText(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) {
    console.error(`${name}: ${result.error.message}`);
    failures.push(name);
    return false;
  }
  if (result.status !== 0) {
    console.error(`${name}: FAILED (exit ${result.status ?? 'unknown'})`);
    failures.push(name);
    return false;
  }
  console.log(`${name}: PASS`);
  return true;
}

function clonePinnedRepository(repository, commit, destination) {
  if (!runStage(
    `Clone ${repository}`,
    'git',
    ['clone', '--quiet', `https://github.com/${repository}.git`, destination]
  )) return false;
  return runStage(
    `Pin ${repository} at ${commit}`,
    'git',
    ['-C', destination, 'checkout', '--quiet', '--detach', commit]
  );
}

function runOrdinaryCi() {
  const buildPassed = runStage(...ordinaryStages[0]);
  if (!buildPassed) {
    console.error('\nProduction build failed; bundled-code tests are not trustworthy against a stale artifact.');
    return false;
  }
  const checkPassed = runStage(...ordinaryStages[1]);
  if (!checkPassed) {
    console.error('\nGenerated-artifact verification failed; bundled-code tests are not trustworthy.');
    return false;
  }
  for (const stage of ordinaryStages.slice(2)) runStage(...stage);
  return true;
}

function runCrossConsumerCi() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'downloadconversation-ci-'));
  console.log(`\nCross-consumer temporary root: ${temporaryRoot}`);
  try {
    const roots = {};
    for (const [repository, commit, directoryName] of crossConsumerRepositories) {
      const destination = path.join(temporaryRoot, directoryName);
      if (!clonePinnedRepository(repository, commit, destination)) {
        console.error('\nCross-consumer setup failed; dependent cross-consumer tests are skipped.');
        return;
      }
      roots[directoryName] = destination;
    }

    if (!runStage(
      'Install DownloadConversation AIConversationCore dependencies',
      npmCommand,
      npmArguments,
      { cwd: roots['phase7-core'] }
    )) {
      console.error('\nCross-consumer dependency installation failed; dependent tests are skipped.');
      return;
    }

    const venvRoot = path.join(temporaryRoot, 'python-venv');
    if (!runStage('Create cross-consumer Python virtual environment', pythonCommand, ['-m', 'venv', venvRoot])) {
      console.error('\nPython environment setup failed; dependent tests are skipped.');
      return;
    }
    const pythonExecutable = process.platform === 'win32'
      ? path.join(venvRoot, 'Scripts', 'python.exe')
      : path.join(venvRoot, 'bin', 'python');
    if (!runStage(
      'Install AI-transcript presentation dependencies',
      pythonExecutable,
      ['-m', 'pip', 'install', 'colorama', 'regex']
    )) {
      console.error('\nPython dependency installation failed; dependent tests are skipped.');
      return;
    }

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

console.log('DownloadConversation local CI');
console.log(`Repository: ${root}`);
console.log(`Node: ${process.version}`);
if (Number(process.versions.node.split('.')[0]) !== 22) {
  console.warn('WARNING: GitHub CI uses Node 22; this local run is using a different Node major version.');
}

const ordinaryPrerequisitesPassed = runOrdinaryCi();
if (ordinaryPrerequisitesPassed) runCrossConsumerCi();

console.log('\n=== Local CI summary ===');
if (failures.length === 0) {
  console.log('PASS: all local CI stages passed.');
} else {
  console.error(`FAIL: ${failures.length} stage(s) failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
