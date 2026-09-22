import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const HEADER_PATH = 'src/userscript-header.js';
const ARTIFACT_PATH = 'chatgpt-conversation-markdown-export.user.js';
const VERSION_LINE_PATTERN = /^\/\/\s*@version\s+(\S+)\s*$/gm;

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}.${detail}`);
  }
  return capture ? result.stdout.trim() : '';
}

function git(args, capture = false) {
  return run('git', args, capture);
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--branch' || !argv[1]) {
    throw new Error(
      'Usage: node scripts/prepare-integration-test-cycle.mjs --branch <integration-branch>'
    );
  }
  return { branch: argv[1] };
}

function assertTrackedWorkingTreeClean() {
  const status = git(['status', '--porcelain', '--untracked-files=no'], true);
  if (status) {
    throw new Error(
      'Integration preparation requires tracked working-tree and index content to be clean; '
      + 'refusing to switch branches.'
    );
  }
}

function localBranchTarget(branch) {
  const result = spawnSync('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (result.error) throw result.error;
  if (result.status === 1 || result.status === 128) return null;
  if (result.status !== 0) {
    throw new Error(`Could not inspect local branch ${branch}.`);
  }
  return result.stdout.trim();
}

function remoteBranchTarget(branch) {
  return git(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], true);
}

function switchToExactRemoteBranch(branch) {
  git(['fetch', '--prune', 'origin']);
  const remote = remoteBranchTarget(branch);
  const local = localBranchTarget(branch);

  if (local !== null && local !== remote) {
    throw new Error(
      `Local integration branch ${branch} differs from origin/${branch}; refusing to overwrite it.`
    );
  }

  const current = git(['branch', '--show-current'], true);
  if (current === branch) {
    if (git(['rev-parse', 'HEAD'], true) !== remote) {
      throw new Error(
        `Current integration branch ${branch} differs from origin/${branch}; refusing to reset it.`
      );
    }
    return;
  }

  if (local === null) {
    git(['switch', '--track', '-c', branch, `origin/${branch}`]);
  } else {
    git(['switch', branch]);
  }
}

function extractVersion(text, sourceName) {
  const matches = [...text.matchAll(VERSION_LINE_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(`${sourceName} must contain exactly one userscript @version line.`);
  }
  return matches[0][1];
}

async function verifyVersions() {
  const header = await readFile(HEADER_PATH, 'utf8');
  const artifact = await readFile(ARTIFACT_PATH, 'utf8');
  const headerVersion = extractVersion(header, HEADER_PATH);
  const artifactVersion = extractVersion(artifact, ARTIFACT_PATH);
  if (headerVersion !== artifactVersion) {
    throw new Error(
      `Prepared version mismatch: source ${headerVersion}, artifact ${artifactVersion}.`
    );
  }
  return headerVersion;
}

async function main() {
  const { branch } = parseArgs(process.argv.slice(2));
  assertTrackedWorkingTreeClean();
  switchToExactRemoteBranch(branch);

  run(process.execPath, ['scripts/check-development-version.mjs', '--branch', branch]);
  run(process.execPath, [
    'scripts/test-cycle-artifact.mjs',
    'prepare',
    '--branch',
    branch,
    '--push'
  ]);
  run(process.execPath, ['scripts/check-development-version.mjs', '--branch', branch]);
  run(process.execPath, ['scripts/test-cycle-artifact.mjs', 'verify', '--branch', branch]);

  const localHead = git(['rev-parse', 'HEAD'], true);
  git(['fetch', 'origin', branch]);
  const remoteHead = remoteBranchTarget(branch);
  if (localHead !== remoteHead) {
    throw new Error(
      `Prepared integration branch ${branch} was not published exactly; local ${localHead}, remote ${remoteHead}.`
    );
  }

  const version = await verifyVersions();
  console.log(`Integration test-cycle branch ready: ${branch}`);
  console.log(`Version: ${version}`);
  console.log(`Commit: ${localHead}`);
  console.log('No version tag was created.');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
