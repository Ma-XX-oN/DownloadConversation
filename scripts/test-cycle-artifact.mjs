import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/** Repository-relative path of the generated installable userscript artifact. */
const ARTIFACT_PATH = 'chatgpt-conversation-markdown-export.user.js';
/** Repository-relative path of the authoritative userscript metadata header. */
const HEADER_PATH = 'src/userscript-header.js';
/** Repository-relative deterministic userscript build entry point. */
const BUILD_SCRIPT = 'scripts/build-userscript.mjs';
/** Accepted stable or issue-qualified userscript version syntax for test-cycle tags. */
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-issue\.([1-9]\d*)\.([1-9]\d*))?$/;
/** Unique userscript metadata version-line matcher. */
const VERSION_LINE_PATTERN = /^\/\/\s*@version\s+(\S+)\s*$/gm;

class InfrastructureError extends Error {}

/**
 * Runs one child process from the repository working directory.
 *
 * @param {string} command - Executable name or absolute path.
 * @param {Array<string>} args - Exact argument vector.
 * @param {boolean} capture - Whether stdout and stderr should be captured.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Completed child-process result.
 */
function commandResult(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit'
  });
  if (result.error) throw result.error;
  return result;
}

/**
 * Runs one required-success child process.
 *
 * @param {string} command - Executable name or absolute path.
 * @param {Array<string>} args - Exact argument vector.
 * @param {boolean} capture - Whether stdout should be returned.
 * @returns {string} Captured stdout, or an empty string when output is inherited.
 */
function run(command, args, capture = false) {
  const result = commandResult(command, args, capture);
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}.${detail}`);
  }
  return capture ? result.stdout : '';
}

/**
 * Runs one required-success Git command.
 *
 * @param {Array<string>} args - Exact Git argument vector.
 * @param {boolean} capture - Whether stdout should be returned.
 * @returns {string} Captured stdout, or an empty string when output is inherited.
 */
function git(args, capture = false) {
  return run('git', args, capture);
}

/**
 * Tests whether tracked working-tree and index content exactly matches HEAD.
 * Untracked diagnostic files are intentionally outside this publication identity.
 *
 * @returns {boolean} True when tracked source and index content are clean.
 */
function trackedTreeIsClean() {
  const worktree = commandResult('git', ['diff', '--quiet'], true);
  if (![0, 1].includes(worktree.status)) {
    throw new Error('Could not inspect tracked working-tree changes.');
  }
  const index = commandResult('git', ['diff', '--cached', '--quiet'], true);
  if (![0, 1].includes(index.status)) {
    throw new Error('Could not inspect staged changes.');
  }
  return worktree.status === 0 && index.status === 0;
}

/**
 * Requires all tracked source changes to be committed before a test-cycle identity is created.
 *
 * @returns {void}
 */
function assertTrackedTreeClean() {
  if (!trackedTreeIsClean()) {
    throw new Error(
      'Test-cycle publication requires all tracked source changes to be committed before testing.'
    );
  }
}

/**
 * Normalizes local, remote, and GitHub branch reference spellings to a branch name.
 *
 * @param {string|null|undefined} value - Candidate branch or ref value.
 * @returns {string} Normalized branch name, or an empty string when absent.
 */
function normalizeBranch(value) {
  return String(value ?? '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/origin\//, '')
    .replace(/^origin\//, '');
}

/**
 * Reads the current named local branch when Git is not detached.
 *
 * @returns {string} Current branch name, or an empty string for detached HEAD.
 */
function currentBranch() {
  return git(['branch', '--show-current'], true).trim();
}

/**
 * Resolves the publication branch from an explicit value, GitHub environment, or local Git.
 *
 * @param {string|null|undefined} explicitBranch - Optional branch explicitly supplied by the caller.
 * @returns {string} Named branch whose commit and tag will be published.
 */
function resolveBranch(explicitBranch) {
  const branch = normalizeBranch(
    explicitBranch
      || process.env.GITHUB_HEAD_REF
      || process.env.GITHUB_REF_NAME
      || currentBranch()
  );
  if (!branch || branch === 'HEAD') {
    throw new Error('Could not determine branch identity; pass --branch explicitly.');
  }
  return branch;
}

/**
 * Extracts and validates the single stable or issue-qualified userscript version.
 *
 * @param {string} text - Userscript header or generated artifact text.
 * @returns {string} Validated version without a leading `v`.
 */
function userscriptVersion(text) {
  const matches = [...String(text).matchAll(VERSION_LINE_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one userscript @version entry, found ${matches.length}.`);
  }
  const version = matches[0][1];
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Unsupported userscript version for test-cycle publication: ${version}.`);
  }
  return version;
}

/**
 * Requires authoritative header and generated artifact to identify the same version.
 *
 * @returns {Promise<string>} Shared validated userscript version.
 */
async function artifactVersion() {
  const header = await readFile(HEADER_PATH, 'utf8');
  const artifact = await readFile(ARTIFACT_PATH, 'utf8');
  const headerVersion = userscriptVersion(header);
  const artifactVersionValue = userscriptVersion(artifact);
  if (headerVersion !== artifactVersionValue) {
    throw new Error(
      `Userscript version mismatch: source ${headerVersion}, artifact ${artifactVersionValue}.`
    );
  }
  return headerVersion;
}

/**
 * Executes the deterministic userscript builder in materialize or check-only mode.
 *
 * @param {boolean} check - True to verify existing bytes without writing them.
 * @returns {void}
 */
function runBuild(check) {
  const args = check ? [BUILD_SCRIPT, '--check'] : [BUILD_SCRIPT];
  const result = commandResult(process.execPath, args);
  if (result.status === 2) {
    throw new InfrastructureError('Pinned dependency could not be reached while building the userscript.');
  }
  if (result.status !== 0) {
    throw new Error(`${process.execPath} ${args.join(' ')} failed with exit ${result.status}.`);
  }
}

/**
 * Requires the generated artifact to be tracked and present in the current HEAD tree.
 *
 * @returns {void}
 */
function assertArtifactTracked() {
  run('git', ['ls-files', '--error-unmatch', ARTIFACT_PATH], true);
  run('git', ['cat-file', '-e', `HEAD:${ARTIFACT_PATH}`], true);
}

/**
 * Verifies the exact committed artifact that the test cycle will exercise.
 *
 * @returns {Promise<string>} Verified userscript version.
 */
async function verifyArtifact() {
  assertArtifactTracked();
  runBuild(true);
  const version = await artifactVersion();
  assertTrackedTreeClean();
  return version;
}

/**
 * Resolves the remote branch head without changing the local checkout.
 *
 * @param {string} branch - Branch whose origin ref should be inspected.
 * @returns {string|null} Remote branch commit SHA, or null when absent.
 */
function remoteBranchTarget(branch) {
  const output = git(
    ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`],
    true
  ).trim();
  if (!output) return null;
  return output.split(/\s+/)[0];
}

/**
 * Pushes the prepared artifact commit to the branch when a CI fan-out requires it remotely.
 *
 * @param {string} branch - Branch receiving the exact prepared test-cycle commit.
 * @returns {void}
 */
function pushPreparedBranch(branch) {
  const head = git(['rev-parse', 'HEAD'], true).trim();
  const remote = remoteBranchTarget(branch);
  if (remote !== head) {
    git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  }
  if (remoteBranchTarget(branch) !== head) {
    throw new Error(`Prepared branch publication failed for ${branch}; expected ${head}.`);
  }
}

/**
 * Materializes the deterministic artifact and commits only that artifact when its bytes changed.
 * Source changes must already be committed so the resulting HEAD is the exact state tests exercise.
 *
 * @param {string|null|undefined} explicitBranch - Optional branch for detached CI checkout.
 * @param {boolean} pushBranch - Whether to push the prepared commit before CI fan-out.
 * @returns {Promise<void>}
 */
async function prepareArtifact(explicitBranch, pushBranch) {
  const branch = resolveBranch(explicitBranch);
  assertTrackedTreeClean();
  runBuild(false);
  git(['add', '--', ARTIFACT_PATH]);

  const staged = commandResult(
    'git',
    ['diff', '--cached', '--quiet', '--', ARTIFACT_PATH],
    true
  );
  if (![0, 1].includes(staged.status)) {
    throw new Error('Could not inspect staged artifact changes.');
  }
  if (staged.status === 1) {
    const version = await artifactVersion();
    git([
      'commit',
      '-m',
      `build(test-cycle): materialize ${version} [skip ci]`,
      '--',
      ARTIFACT_PATH
    ]);
    console.log(`Committed ${ARTIFACT_PATH} for ${version}.`);
  }

  const version = await verifyArtifact();
  if (pushBranch) pushPreparedBranch(branch);
  console.log(`Test-cycle artifact ready on ${branch}: ${version}.`);
}

/**
 * Resolves a local annotated or lightweight tag to its target commit.
 *
 * @param {string} tag - Version-derived tag name.
 * @returns {string|null} Target commit SHA, or null when the local tag is absent.
 */
function localTagTarget(tag) {
  const result = commandResult(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`],
    true
  );
  if (result.status === 1) return null;
  if (result.status !== 0) throw new Error(`Could not inspect local tag ${tag}.`);
  return git(['rev-list', '-n', '1', tag], true).trim();
}

/**
 * Resolves a remote annotated or lightweight tag to its commit without moving any refs.
 *
 * @param {string} tag - Version-derived tag name.
 * @returns {string|null} Remote target commit SHA, or null when the tag is absent.
 */
function remoteTagTarget(tag) {
  const output = git([
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`
  ], true).trim();
  if (!output) return null;

  let direct = null;
  let peeled = null;
  for (const line of output.split(/\r?\n/)) {
    const [sha, ref] = line.split(/\s+/);
    if (ref === `refs/tags/${tag}^{}`) peeled = sha;
    else if (ref === `refs/tags/${tag}`) direct = sha;
  }
  return peeled ?? direct;
}

/**
 * Publishes the already-passed test-cycle HEAD and immutable version tag to origin.
 * Existing tags are accepted only when they already identify the same exact commit.
 *
 * @param {string|null|undefined} explicitBranch - Optional branch for detached CI checkout.
 * @returns {Promise<void>}
 */
async function publishArtifact(explicitBranch) {
  const branch = resolveBranch(explicitBranch);
  const version = await verifyArtifact();
  const tag = `v${version}`;
  const head = git(['rev-parse', 'HEAD'], true).trim();
  const remoteTag = remoteTagTarget(tag);

  if (remoteTag !== null) {
    if (remoteTag !== head) {
      throw new Error(
        `Version tag ${tag} already exists on a different commit ${remoteTag}; `
        + `current HEAD is ${head}. Advance the version before another test cycle.`
      );
    }
    if (remoteBranchTarget(branch) !== head) {
      git(['push', '--atomic', 'origin', `HEAD:refs/heads/${branch}`]);
    }
    console.log(`Test-cycle artifact already published as ${tag} at ${head}.`);
    return;
  }

  const localTarget = localTagTarget(tag);
  if (localTarget !== null && localTarget !== head) {
    throw new Error(
      `Local version tag ${tag} points to different commit ${localTarget}; `
      + `current HEAD is ${head}. Advance the version before another test cycle.`
    );
  }
  if (localTarget === null) {
    git(['tag', '-a', tag, '-m', `Verified test cycle ${tag}`]);
  }

  git([
    'push',
    '--atomic',
    'origin',
    `HEAD:refs/heads/${branch}`,
    `refs/tags/${tag}`
  ]);

  const publishedTag = remoteTagTarget(tag);
  const publishedBranch = remoteBranchTarget(branch);
  if (publishedTag !== head || publishedBranch !== head) {
    throw new Error(
      `Publication verification failed for ${branch} / ${tag}; expected ${head}.`
    );
  }
  console.log(`Published tested artifact ${tag} on ${branch} at ${head}.`);
}

/**
 * Parses the required lifecycle command, optional branch, and prepare-push flag.
 *
 * @param {Array<string>} argv - CLI arguments after the script name.
 * @returns {{command: string, branch: string|null, pushBranch: boolean}} Parsed lifecycle options.
 */
function parseArgs(argv) {
  const command = argv[0];
  if (!['prepare', 'verify', 'publish'].includes(command)) {
    throw new Error(
      'Usage: node scripts/test-cycle-artifact.mjs <prepare|verify|publish> '
      + '[--branch <name>] [--push]'
    );
  }

  let branch = null;
  let pushBranch = false;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--push') {
      if (command !== 'prepare') {
        throw new Error('--push is valid only with prepare.');
      }
      pushBranch = true;
      continue;
    }
    if (
      argv[index] !== '--branch'
      || !argv[index + 1]
      || argv[index + 1].startsWith('--')
    ) {
      throw new Error(`Unknown or incomplete argument: ${argv[index] ?? ''}`);
    }
    branch = argv[index + 1];
    index += 1;
  }
  return { command, branch, pushBranch };
}

try {
  const { command, branch, pushBranch } = parseArgs(process.argv.slice(2));
  if (command === 'prepare') {
    await prepareArtifact(branch, pushBranch);
  } else if (command === 'verify') {
    const version = await verifyArtifact();
    console.log(`Verified committed test-cycle artifact ${version}.`);
  } else {
    await publishArtifact(branch);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof InfrastructureError ? 2 : 1;
}
