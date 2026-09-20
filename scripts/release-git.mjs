import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** Repository root used by release tooling. */
export const RELEASE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Executes one repository command and returns its completed child-process result.
 *
 * @param {string} command - Executable name or path.
 * @param {Array<string>} args - Exact argument vector.
 * @param {boolean} capture - Whether stdout/stderr should be captured.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Completed process result.
 */
export function commandResult(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: RELEASE_ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit'
  });
  if (result.error) throw result.error;
  return result;
}

/**
 * Executes one required-success repository command.
 *
 * @param {string} command - Executable name or path.
 * @param {Array<string>} args - Exact argument vector.
 * @param {boolean} capture - Whether stdout should be returned.
 * @returns {string} Captured stdout, or an empty string for inherited output.
 */
export function run(command, args, capture = false) {
  const result = commandResult(command, args, capture);
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}.${detail}`);
  }
  return capture ? result.stdout : '';
}

/**
 * Executes one required-success Git command.
 *
 * @param {Array<string>} args - Exact Git argument vector.
 * @param {boolean} capture - Whether stdout should be returned.
 * @returns {string} Captured stdout, or an empty string for inherited output.
 */
export function git(args, capture = false) {
  return run('git', args, capture);
}

/**
 * Returns the current named Git branch and rejects detached HEAD.
 *
 * @returns {string} Current branch name.
 */
export function currentBranch() {
  const branch = git(['branch', '--show-current'], true).trim();
  if (!branch) throw new Error('Release operation requires a named branch; detached HEAD is not allowed.');
  return branch;
}

/**
 * Requires the repository working tree and index to be clean.
 *
 * @returns {void}
 */
export function assertCleanWorkingTree() {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'], true);
  if (status.trim()) {
    throw new Error('Release operation requires a completely clean working tree.');
  }
}

/**
 * Returns whether a local Git tag exists.
 *
 * @param {string} tag - Stable release tag name.
 * @returns {boolean} True when the local tag ref exists.
 */
export function localTagExists(tag) {
  const result = commandResult('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], true);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Could not determine whether local tag ${tag} exists.`);
}

/**
 * Returns whether the stable release tag already exists on origin.
 *
 * @param {string} tag - Stable release tag name.
 * @returns {boolean} True when origin already has the tag.
 */
export function remoteTagExists(tag) {
  const result = commandResult(
    'git',
    ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`],
    true
  );
  if (result.status === 0) return true;
  if (result.status === 2) return false;
  throw new Error(`Could not determine whether origin tag ${tag} exists: ${result.stderr || result.stdout || ''}`);
}
