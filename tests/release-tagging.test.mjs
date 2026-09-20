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
const releaseScriptUrl = new URL('../scripts/release.mjs', import.meta.url);
const gitignoreUrl = new URL('../.gitignore', import.meta.url);

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

test('release builds ignored generated artifact before validating and publishing it', async () => {
  const releaseScript = await readFile(releaseScriptUrl, 'utf8');
  const gitignore = await readFile(gitignoreUrl, 'utf8');
  const buildIndex = releaseScript.indexOf("['scripts/build-userscript.mjs']");
  const generatedReadIndex = releaseScript.indexOf("readFile(GENERATED_ARTIFACT_PATH");
  const versionCheckIndex = releaseScript.indexOf('assertUserscriptReleaseVersion(');
  const ciIndex = releaseScript.indexOf("['scripts/run-ci.mjs']");

  assert.match(gitignore, /^\/chatgpt-conversation-markdown-export\.user\.js$/m);
  assert.ok(buildIndex >= 0, 'release script must generate the ignored production artifact');
  assert.ok(generatedReadIndex > buildIndex, 'generated artifact must be read only after build');
  assert.ok(versionCheckIndex > generatedReadIndex, 'version identity must be checked after generation');
  assert.ok(ciIndex > versionCheckIndex, 'full CI must run after generated version verification');
  assert.match(releaseScript, /--from-source/);
});

test('durable documentation and CI automatically publish then independently verify stable main tags', async () => {
  const documentation = await readFile(versioningDocUrl, 'utf8');
  const workflow = await readFile(ciWorkflowUrl, 'utf8');

  assert.match(documentation, /node scripts\/release\.mjs <version>/);
  assert.match(documentation, /node scripts\/release\.mjs --from-source/);
  assert.match(documentation, /generated.*ignored|ignored.*generated/is);
  assert.match(documentation, /push.*`main`.*automatic|automatic.*push.*`main`/is);
  assert.match(documentation, /git push --atomic/);
  assert.match(documentation, /annotated `vX\.Y\.Z` tag/);
  assert.match(documentation, /Do not manually publish/);
  assert.match(documentation, /after.*publish.*guard|guard.*after.*publish/is);

  assert.match(workflow, /publish-release:/);
  assert.match(workflow, /needs:\s*\n\s*- test\s*\n\s*- cross-consumer-final-render/);
  assert.match(workflow, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /git config user\.name "github-actions\[bot\]"/);
  assert.match(workflow, /node scripts\/release\.mjs --from-source/);
  assert.match(workflow, /verify-release-tag:/);
  assert.match(workflow, /needs: publish-release/);
  assert.match(workflow, /Verify published stable release tag/);
  assert.match(workflow, /git fetch --force --tags/);
  assert.match(workflow, /node scripts\/check-release-tag\.mjs --branch main/);

  const buildStep = workflow.indexOf('- name: Build production userscript');
  const publishJob = workflow.indexOf('  publish-release:');
  const tagGuard = workflow.indexOf('  verify-release-tag:');
  assert.ok(buildStep >= 0 && publishJob > buildStep, 'main publisher must follow ordinary verification');
  assert.ok(tagGuard > publishJob, 'stable tag guard must run only after automatic publication');
  assert.equal(
    workflow.slice(0, publishJob).includes('node scripts/check-release-tag.mjs --branch main'),
    false,
    'pre-publication verification must not fail solely because the publisher has not created the tag yet'
  );
});