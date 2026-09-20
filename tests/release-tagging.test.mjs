import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertUserscriptReleaseVersion,
  buildReleasePlan,
  parseReleaseVersion,
  userscriptVersion
} from '../scripts/release-lib.mjs';

const versioningDocUrl = new URL('../docs/DEVELOPMENT-VERSIONING.md', import.meta.url);
const ciWorkflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url);

test('stable release versions are plain semantic versions only', () => {
  assert.equal(parseReleaseVersion('1.6.0'), '1.6.0');
  assert.throws(() => parseReleaseVersion('1.6.0-issue.150.7'), /plain semantic version/);
  assert.throws(() => parseReleaseVersion('v1.6.0'), /plain semantic version/);
  assert.throws(() => parseReleaseVersion('1.6'), /plain semantic version/);
});

test('userscript version parser requires exactly one metadata entry', () => {
  assert.equal(userscriptVersion('// @version      1.6.0\n'), '1.6.0');
  assert.throws(() => userscriptVersion('// no version\n'), /exactly one/);
  assert.throws(
    () => userscriptVersion('// @version 1.6.0\n// @version 1.6.1\n'),
    /exactly one/
  );
});

test('source and generated artifact must both equal the requested stable release version', () => {
  assert.doesNotThrow(() => assertUserscriptReleaseVersion(
    '// @version      1.6.0\n',
    '// @version      1.6.0\n(function () {})();\n',
    '1.6.0'
  ));
  assert.throws(
    () => assertUserscriptReleaseVersion(
      '// @version      1.6.0\n',
      '// @version      1.5.0\n',
      '1.6.0'
    ),
    /Release version mismatch/
  );
});

test('release plan is main-only and atomically publishes main plus the exact tag', () => {
  assert.deepEqual(buildReleasePlan('1.6.0', 'main'), {
    version: '1.6.0',
    tag: 'v1.6.0',
    branch: 'main',
    tagMessage: 'DownloadConversation v1.6.0',
    pushArgs: [
      'push',
      '--atomic',
      'origin',
      'HEAD:main',
      'refs/tags/v1.6.0'
    ]
  });
  assert.throws(
    () => buildReleasePlan('1.6.0', 'issue-150-modular-userscript-build'),
    /main/
  );
});

test('durable documentation and CI require scripted release tagging and missing-tag detection', async () => {
  const documentation = await readFile(versioningDocUrl, 'utf8');
  const workflow = await readFile(ciWorkflowUrl, 'utf8');

  assert.match(documentation, /node scripts\/release\.mjs <version>/);
  assert.match(documentation, /close the owning issue/i);
  assert.match(documentation, /merge.*`main`/i);
  assert.match(documentation, /git push --atomic/);
  assert.match(documentation, /annotated `vX\.Y\.Z` tag/);
  assert.match(documentation, /Do not manually publish/);
  assert.match(documentation, /main CI.*fail/i);

  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /Stable main release tag guard/);
  assert.match(workflow, /git fetch --force --tags/);
  assert.match(workflow, /node scripts\/check-release-tag\.mjs --branch main/);
});
