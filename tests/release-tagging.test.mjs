import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertUserscriptReleaseVersion,
  buildReleasePlan,
  parseReleaseVersion,
  userscriptVersion
} from '../scripts/release-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = 'chatgpt-conversation-markdown-export.user.js';
const versioningDocUrl = new URL('../docs/DEVELOPMENT-VERSIONING.md', import.meta.url);
const ciWorkflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url);
const releaseScriptUrl = new URL('../scripts/release.mjs', import.meta.url);
const runCiScriptUrl = new URL('../scripts/run-ci.mjs', import.meta.url);
const cycleScriptUrl = new URL('../scripts/test-cycle-artifact.mjs', import.meta.url);
const gitignoreUrl = new URL('../.gitignore', import.meta.url);

test('stable release versions are plain semantic versions only', () => {
  assert.equal(parseReleaseVersion('1.6.0'), '1.6.0');
  assert.throws(() => parseReleaseVersion('1.6.0-issue.150.9'), /plain semantic version/);
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

test('legacy stable release plan remains main-only and atomic', () => {
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

test('generated installable userscript is tracked and the test-cycle path owns materialization', async () => {
  const gitignore = await readFile(gitignoreUrl, 'utf8');
  const runCiScript = await readFile(runCiScriptUrl, 'utf8');
  const cycleScript = await readFile(cycleScriptUrl, 'utf8');
  const workflow = await readFile(ciWorkflowUrl, 'utf8');

  assert.doesNotMatch(gitignore, /^\/chatgpt-conversation-markdown-export\.user\.js$/m);
  const tracked = execFileSync(
    'git',
    ['ls-files', '--error-unmatch', artifactPath],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  assert.equal(tracked.trim(), artifactPath);

  assert.match(cycleScript, /build-userscript\.mjs/);
  assert.match(cycleScript, /git[\s\S]*commit[\s\S]*build\(test-cycle\): materialize/);
  assert.match(cycleScript, /\[skip ci\]/);
  assert.match(cycleScript, /const tag = `v\$\{version\}`/);
  assert.match(cycleScript, /git\(\[\s*'push',\s*'--atomic'/);

  const orchestrationStart = runCiScript.indexOf("console.log('DownloadConversation local CI');");
  assert.ok(orchestrationStart >= 0, 'local CI orchestration entry point is missing');
  const orchestration = runCiScript.slice(orchestrationStart);
  const prepareIndex = orchestration.indexOf("['scripts/test-cycle-artifact.mjs', 'prepare']");
  const ordinaryIndex = orchestration.indexOf('runOrdinaryCi();');
  const crossIndex = orchestration.indexOf('runCrossConsumerCi();');
  const publishIndex = orchestration.indexOf("['scripts/test-cycle-artifact.mjs', 'publish']");
  assert.ok(prepareIndex >= 0 && ordinaryIndex > prepareIndex);
  assert.ok(crossIndex > ordinaryIndex && publishIndex > crossIndex);
  assert.match(orchestration, /failures\.length === 0[\s\S]*test-cycle-artifact\.mjs[\s\S]*publish/);

  const prepareJob = workflow.indexOf('  prepare-test-cycle:');
  const testJob = workflow.indexOf('  test:');
  const crossJob = workflow.indexOf('  cross-consumer-final-render:');
  const publishJob = workflow.indexOf('  publish-test-cycle:');
  assert.ok(prepareJob >= 0 && testJob > prepareJob && crossJob > testJob && publishJob > crossJob);
  assert.match(workflow.slice(prepareJob, testJob), /test-cycle-artifact\.mjs prepare[\s\S]*--push/);
  assert.match(workflow.slice(testJob, crossJob), /test-cycle-artifact\.mjs verify/);
  assert.match(workflow.slice(crossJob, publishJob), /test-cycle-artifact\.mjs verify/);
  assert.match(workflow.slice(publishJob), /test-cycle-artifact\.mjs publish/);
});

test('stable release wrapper delegates verification and publication through the unified test-cycle path', async () => {
  const [releaseScript, runCiScript] = await Promise.all([
    readFile(releaseScriptUrl, 'utf8'),
    readFile(runCiScriptUrl, 'utf8')
  ]);

  assert.match(releaseScript, /parseReleaseVersion/);
  assert.match(releaseScript, /userscriptVersion/);
  assert.match(releaseScript, /scripts\/run-ci\.mjs/);
  assert.match(runCiScript, /test-cycle-artifact\.mjs/);
  assert.match(releaseScript, /check-release-tag\.mjs/);
  assert.doesNotMatch(releaseScript, /git\(\['tag'/);
  assert.doesNotMatch(releaseScript, /remoteTagExists/);
  assert.doesNotMatch(releaseScript, /buildReleasePlan/);
});

test('durable documentation and CI use one version-derived artifact tag contract for development and stable cycles', async () => {
  const documentation = await readFile(versioningDocUrl, 'utf8');
  const workflow = await readFile(ciWorkflowUrl, 'utf8');

  assert.match(documentation, /generated.*committed|committed.*generated/is);
  assert.doesNotMatch(documentation, /generated.*ignored|ignored.*generated/is);
  assert.match(documentation, /v<version>/i);
  assert.match(documentation, /v1\.5\.0-issue\.150\.9|vX\.Y\.Z-issue\.<issue>\.<iteration>/i);
  assert.match(documentation, /failed.*not.*tag|not.*tag.*failed/is);
  assert.match(documentation, /collision.*advance.*version|advance.*version.*collision/is);
  assert.match(documentation, /test cycle.*commit.*tag|commit.*tag.*test cycle/is);
  assert.match(documentation, /node scripts\/release\.mjs <version>/);
  assert.match(documentation, /node scripts\/release\.mjs --from-source/);

  assert.match(workflow, /prepare-test-cycle:/);
  assert.match(workflow, /publish-test-cycle:/);
  assert.match(workflow, /needs:\s*\n\s*- prepare-test-cycle\s*\n\s*- test\s*\n\s*- cross-consumer-final-render/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /git config user\.name "github-actions\[bot\]"/);
  assert.match(workflow, /node scripts\/test-cycle-artifact\.mjs publish/);
  assert.match(workflow, /verify-release-tag:/);
  assert.match(workflow, /needs: publish-test-cycle/);
  assert.match(workflow, /node scripts\/check-release-tag\.mjs --branch main/);

  const prepareJob = workflow.indexOf('  prepare-test-cycle:');
  const publishJob = workflow.indexOf('  publish-test-cycle:');
  const tagGuard = workflow.indexOf('  verify-release-tag:');
  assert.ok(prepareJob >= 0 && publishJob > prepareJob);
  assert.ok(tagGuard > publishJob, 'stable tag guard must run only after successful test-cycle publication');
  assert.equal(
    workflow.slice(0, publishJob).includes('node scripts/check-release-tag.mjs --branch main'),
    false,
    'pre-publication verification must not fail solely because the version tag is not created yet'
  );
});
