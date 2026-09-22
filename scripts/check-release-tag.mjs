import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseReleaseVersion, userscriptVersion } from './release-lib.mjs';
import { RELEASE_ROOT, currentBranch, git, localTagExists } from './release-git.mjs';

/** Authoritative userscript metadata header. */
const SOURCE_HEADER_PATH = resolve(RELEASE_ROOT, 'src/userscript-header.js');

/**
 * Returns an explicitly supplied `--branch` value, or derives the current branch.
 *
 * @param {Array<string>} argv - Command-line arguments after the script name.
 * @returns {string} Branch name to validate.
 */
function branchArgument(argv) {
  if (!argv.length) return currentBranch();
  if (argv.length === 2 && argv[0] === '--branch' && argv[1]) return argv[1];
  throw new Error('Usage: node scripts/check-release-tag.mjs [--branch <branch>]');
}

/**
 * Requires stable `main` HEAD to carry the exact tag derived from the authoritative userscript version.
 *
 * @param {string} branch - Branch name represented by the current checkout.
 * @returns {Promise<void>}
 */
async function checkReleaseTag(branch) {
  if (branch !== 'main') {
    console.log(`Stable release tag guard: ${branch} is not main; no stable tag is required.`);
    return;
  }

  const sourceHeader = await readFile(SOURCE_HEADER_PATH, 'utf8');
  const version = parseReleaseVersion(userscriptVersion(sourceHeader));
  const tag = `v${version}`;
  if (!localTagExists(tag)) {
    throw new Error(`Stable main ${version} is missing required tag ${tag}.`);
  }

  const head = git(['rev-parse', 'HEAD'], true).trim();
  const tagTarget = git(['rev-list', '-n', '1', tag], true).trim();
  if (tagTarget !== head) {
    throw new Error(`Required tag ${tag} points to ${tagTarget}, not main HEAD ${head}.`);
  }
  console.log(`Stable release tag guard: ${tag} points to main HEAD ${head}.`);
}

try {
  await checkReleaseTag(branchArgument(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
