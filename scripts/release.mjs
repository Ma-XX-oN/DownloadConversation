import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  assertUserscriptReleaseVersion,
  buildReleasePlan,
  parseReleaseVersion
} from './release-lib.mjs';
import {
  RELEASE_ROOT,
  assertCleanWorkingTree,
  currentBranch,
  git,
  localTagExists,
  remoteTagExists,
  run
} from './release-git.mjs';

/** Authoritative userscript metadata header. */
const SOURCE_HEADER_PATH = resolve(RELEASE_ROOT, 'src/userscript-header.js');
/** Generated installable Tampermonkey artifact. */
const GENERATED_ARTIFACT_PATH = resolve(RELEASE_ROOT, 'chatgpt-conversation-markdown-export.user.js');

/**
 * Verifies merged stable main state, creates/reuses the exact local tag, and publishes it atomically.
 *
 * @param {string} requestedVersion - Requested plain stable semantic version.
 * @returns {Promise<void>}
 */
async function publishRelease(requestedVersion) {
  const version = parseReleaseVersion(requestedVersion);
  const plan = buildReleasePlan(version, currentBranch());

  assertCleanWorkingTree();
  git(['fetch', 'origin', 'main', '--tags', '--prune']);

  const head = git(['rev-parse', 'HEAD'], true).trim();
  const originMain = git(['rev-parse', 'origin/main'], true).trim();
  if (head !== originMain) {
    throw new Error(`Release requires local main HEAD ${head} to equal origin/main ${originMain}.`);
  }

  if (remoteTagExists(plan.tag)) {
    throw new Error(`Release tag ${plan.tag} already exists on origin.`);
  }

  const sourceHeader = await readFile(SOURCE_HEADER_PATH, 'utf8');
  const generatedArtifact = await readFile(GENERATED_ARTIFACT_PATH, 'utf8');
  assertUserscriptReleaseVersion(sourceHeader, generatedArtifact, version);

  run(process.execPath, ['scripts/build-userscript.mjs', '--check']);
  run(process.execPath, ['scripts/run-ci.mjs']);
  assertCleanWorkingTree();

  if (localTagExists(plan.tag)) {
    const localTarget = git(['rev-list', '-n', '1', plan.tag], true).trim();
    if (localTarget !== head) {
      throw new Error(`Existing local tag ${plan.tag} points to ${localTarget}, not verified main ${head}.`);
    }
  } else {
    git(['tag', '-a', plan.tag, '-m', plan.tagMessage]);
  }

  const tagTarget = git(['rev-list', '-n', '1', plan.tag], true).trim();
  if (tagTarget !== head) {
    throw new Error(`Release tag ${plan.tag} does not point to verified main ${head}.`);
  }

  git(plan.pushArgs);
  console.log(`Published ${plan.tag} on verified main commit ${head}.`);
}

const requestedVersion = process.argv[2];
if (!requestedVersion || process.argv.length !== 3) {
  console.error('Usage: node scripts/release.mjs <version>');
  process.exitCode = 2;
} else {
  try {
    await publishRelease(requestedVersion);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
