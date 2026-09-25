import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  parseReleaseVersion,
  userscriptVersion
} from './release-lib.mjs';
import {
  RELEASE_ROOT,
  currentBranch,
  git,
  run
} from './release-git.mjs';

/** Authoritative userscript metadata header. */
const SOURCE_HEADER_PATH = resolve(RELEASE_ROOT, 'src/userscript-header.js');

/**
 * Resolves and validates the stable version requested by the release wrapper.
 *
 * The authoritative source remains the userscript header. An explicit version
 * is a recovery/diagnostic assertion only; it cannot override the source value.
 *
 * @param {string} releaseArgument - Explicit plain semantic version or `--from-source`.
 * @returns {Promise<string>} Validated stable userscript version.
 */
async function requestedStableVersion(releaseArgument) {
  const sourceHeader = await readFile(SOURCE_HEADER_PATH, 'utf8');
  const sourceVersion = parseReleaseVersion(userscriptVersion(sourceHeader));
  if (releaseArgument === '--from-source') return sourceVersion;

  const explicitVersion = parseReleaseVersion(releaseArgument);
  if (explicitVersion !== sourceVersion) {
    throw new Error(
      `Requested release ${explicitVersion} does not match authoritative source ${sourceVersion}.`
    );
  }
  return explicitVersion;
}

/**
 * Runs the repository-owned stable validation path and explicitly publishes its tag.
 *
 * Issue-development CI uses `scripts/ci_contract.py` and complete-matrix result
 * finalization. Stable main releases retain this wrapper, but publication now
 * requires the explicit `--tag` authorization passed to `scripts/run-ci.mjs`.
 *
 * @param {string} version - Validated plain stable semantic version.
 * @returns {Promise<void>}
 */
async function publishStableRelease(version) {
  const branch = currentBranch();
  if (branch !== 'main') {
    throw new Error(`Stable release publication requires branch main, got ${branch || '<detached>'}.`);
  }

  run(process.execPath, ['scripts/run-ci.mjs', '--tag']);
  git(['fetch', '--force', '--tags']);
  run(process.execPath, ['scripts/check-release-tag.mjs', '--branch', 'main']);
  console.log(`Verified stable release v${version} through the repository-owned test path.`);
}

/** Release version argument supplied explicitly or derived from authoritative stable source. */
const releaseArgument = process.argv[2];
if (!releaseArgument || process.argv.length !== 3) {
  console.error('Usage: node scripts/release.mjs <version> | --from-source');
  process.exitCode = 2;
} else {
  try {
    const version = await requestedStableVersion(releaseArgument);
    await publishStableRelease(version);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
