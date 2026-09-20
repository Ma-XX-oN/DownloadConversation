const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const USERSCRIPT_VERSION_PATTERN = /^\/\/\s*@version\s+(\S+)\s*$/gm;

/**
 * Validates one plain stable semantic version.
 *
 * @param {string} value - Requested stable release version without a leading `v`.
 * @returns {string} Validated plain semantic version.
 */
export function parseReleaseVersion(value) {
  if (typeof value !== 'string' || !RELEASE_VERSION_PATTERN.test(value)) {
    throw new Error('Release version must be a plain semantic version such as 1.6.0.');
  }
  return value;
}

/**
 * Reads the single userscript metadata version from source or generated artifact text.
 *
 * @param {string} text - Complete userscript header/source/artifact text.
 * @returns {string} The unique userscript `@version` value.
 */
export function userscriptVersion(text) {
  const matches = [...String(text).matchAll(USERSCRIPT_VERSION_PATTERN)];
  if (matches.length !== 1) {
    throw new Error('Userscript text must contain exactly one @version metadata entry.');
  }
  return matches[0][1];
}

/**
 * Requires source and generated userscript text to identify the requested stable release.
 *
 * @param {string} sourceHeader - Authoritative `src/userscript-header.js` text.
 * @param {string} generatedArtifact - Generated installable userscript text.
 * @param {string} requestedVersion - Requested plain stable semantic version.
 * @returns {void}
 */
export function assertUserscriptReleaseVersion(sourceHeader, generatedArtifact, requestedVersion) {
  const version = parseReleaseVersion(requestedVersion);
  const sourceVersion = userscriptVersion(sourceHeader);
  const generatedVersion = userscriptVersion(generatedArtifact);
  if (sourceVersion !== version || generatedVersion !== version) {
    throw new Error(
      `Release version mismatch: requested ${version}, source ${sourceVersion}, generated ${generatedVersion}.`
    );
  }
}

/**
 * Builds the immutable post-merge stable-tag publication plan.
 *
 * @param {string} version - Requested plain stable semantic version.
 * @param {string} branch - Current Git branch, which must be `main`.
 * @returns {Object<string, *>} Exact tag identity and atomic push argument vector.
 */
export function buildReleasePlan(version, branch) {
  const releaseVersion = parseReleaseVersion(version);
  if (branch !== 'main') {
    throw new Error('Stable release tagging must run on main after the issue is closed and merged.');
  }
  const tag = `v${releaseVersion}`;
  return {
    version: releaseVersion,
    tag,
    branch,
    tagMessage: `DownloadConversation ${tag}`,
    pushArgs: [
      'push',
      '--atomic',
      'origin',
      'HEAD:main',
      `refs/tags/${tag}`
    ]
  };
}
