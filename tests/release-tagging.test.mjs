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
const ciDocUrl = new URL('../CI.md', import.meta.url);
const ciWorkflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url);
const artifactWorkflowUrl = new URL('../.github/workflows/build-userscript-artifact.yml', import.meta.url);
const requestAdapterUrl = new URL('../RepoWorkflow/repo_workflow/github_adapter.py', import.meta.url);
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

test('generated userscript remains tracked and legacy artifact publication stays available during migration', async () => {
  const [gitignore, cycleScript, artifactWorkflow] = await Promise.all([
    readFile(gitignoreUrl, 'utf8'),
    readFile(cycleScriptUrl, 'utf8'),
    readFile(artifactWorkflowUrl, 'utf8')
  ]);

  assert.doesNotMatch(gitignore, /^\/chatgpt-conversation-markdown-export\.user\.js$/m);
  const tracked = execFileSync(
    'git',
    ['ls-files', '--error-unmatch', artifactPath],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  assert.equal(tracked.trim(), artifactPath);

  assert.match(cycleScript, /build-userscript\.mjs/);
  assert.match(cycleScript, /git[\s\S]*commit[\s\S]*build\(test-cycle\): materialize/);
  assert.match(artifactWorkflow, /test-cycle-artifact\.mjs prepare[\s\S]*--push/);
  assert.match(artifactWorkflow, /chatgpt-conversation-markdown-export\.user\.js/);
  assert.match(artifactWorkflow, /contents: write/);
  assert.match(artifactWorkflow, /cancel-in-progress: true/);
});

test('issue-development CI delegates request gating and finalizer owns result tags', async () => {
  const [workflow, requestAdapter] = await Promise.all([
    readFile(ciWorkflowUrl, 'utf8'),
    readFile(requestAdapterUrl, 'utf8')
  ]);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py github-request/);
  assert.match(workflow, /needs\.policy\.outputs\.run_ci == 'true'/);
  assert.match(requestAdapter, /\.ci\/run-ci-request/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py preflight/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py run/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py finalize/);
  assert.doesNotMatch(workflow, /ci_contract\.py/);
  assert.match(workflow, /--tag --push/);
  assert.match(workflow, /finalize:[\s\S]*permissions:[\s\S]*contents: write/);
  assert.doesNotMatch(workflow, /prepare-test-cycle:/);
  assert.doesNotMatch(workflow, /publish-test-cycle:/);
});

test('stable release wrapper requires explicit tag authorization through local CI', async () => {
  const [releaseScript, runCiScript] = await Promise.all([
    readFile(releaseScriptUrl, 'utf8'),
    readFile(runCiScriptUrl, 'utf8')
  ]);

  assert.match(releaseScript, /parseReleaseVersion/);
  assert.match(releaseScript, /userscriptVersion/);
  assert.match(releaseScript, /scripts\/run-ci\.mjs', '--tag'/);
  assert.match(releaseScript, /check-release-tag\.mjs/);
  assert.doesNotMatch(releaseScript, /git\(\['tag'/);

  assert.match(runCiScript, /Usage: node scripts\/run-ci\.mjs \[--tag\]/);
  assert.match(runCiScript, /ci-environment\.mjs/);
  assert.match(runCiScript, /tagRequested/);
  assert.match(runCiScript, /test-cycle-artifact\.mjs', 'publish'/);
});

test('durable documentation records request, PASS, CI-FAIL, INCOMPLETE and immutable tag semantics', async () => {
  const [versioning, ciDoc] = await Promise.all([
    readFile(versioningDocUrl, 'utf8'),
    readFile(ciDocUrl, 'utf8')
  ]);

  for (const documentation of [versioning, ciDoc]) {
    assert.match(documentation, /\.ci\/run-ci-request/);
    assert.match(documentation, /CI-FAIL/);
    assert.match(documentation, /INCOMPLETE/);
    assert.match(documentation, /immutable/i);
    assert.match(documentation, /complete|required.*matrix|matrix.*required/is);
  }
  assert.match(versioning, /generated.*tracked|tracked.*generated/is);
  assert.match(versioning, /node scripts\/release\.mjs <version>/);
  assert.match(versioning, /node scripts\/release\.mjs --from-source/);
});
