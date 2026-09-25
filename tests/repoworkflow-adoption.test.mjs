import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoWorkflowSha = '0a051ab09200ff2824e7c901d6fe0efa652a912a';

async function readText(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function assertMissing(relativePath) {
  await assert.rejects(access(path.join(root, relativePath)));
}

function git(...args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('RepoWorkflow is a canonical submodule pinned to released v0.1.0', async () => {
  const modules = await readText('.gitmodules');
  assert.match(modules, /\[submodule "RepoWorkflow"\]/);
  assert.match(modules, /path = RepoWorkflow/);
  assert.match(modules, /url = https:\/\/github\.com\/Ma-XX-oN\/RepoWorkflow\.git/);
  assert.equal(
    git('ls-tree', 'HEAD', 'RepoWorkflow'),
    `160000 commit ${repoWorkflowSha}\tRepoWorkflow`
  );
});

test('consumer configuration preserves the DownloadConversation validation environment', async () => {
  const config = await readJson('.ci/repoworkflow.json');
  assert.deepEqual(config, {
    schema: 1,
    versionCommand: ['python', 'scripts/workflow-version.py'],
    repository: {
      integrationBranch: 'main',
      authoritativeRemote: 'origin'
    },
    environments: [{
      id: 'ubuntu-node22-python313',
      required: true,
      platform: 'linux',
      capabilities: ['node-22', 'python-3.13'],
      validationCommand: ['python', 'scripts/repoworkflow-validate.py']
    }],
    artifacts: [{
      id: 'userscript',
      generatorCommand: ['node', 'scripts/build-userscript.mjs'],
      verifierCommand: ['node', 'scripts/verify-userscript-artifact.mjs'],
      outputs: ['chatgpt-conversation-markdown-export.user.js'],
      committed: true,
      platform: 'linux',
      capabilities: ['node-22']
    }]
  });
});

test('GitHub runner projection and branch ancestry are repository facts', async () => {
  assert.deepEqual(await readJson('.ci/github.json'), {
    schema: 1,
    prepareRunner: 'ubuntu-latest',
    runners: {
      'ubuntu-node22-python313': 'ubuntu-latest'
    }
  });
  assert.deepEqual(await readJson('.ci/branch-policy.json'), {
    schema: 1,
    integrationBranch: 'main',
    branches: {
      'issue-165-repoworkflow-adoption': {
        parent: 'issue-162-ci-request-gating',
        allowedDependencies: [],
        integrationTarget: 'main'
      }
    },
    patterns: [{
      pattern: 'issue-*',
      parent: 'main',
      allowedDependencies: []
    }]
  });
});

test('version and validation hooks are repository-owned and present', async () => {
  await access(path.join(root, 'scripts/workflow-version.py'));
  await access(path.join(root, 'scripts/repoworkflow-validate.py'));
  const result = spawnSync('python', ['scripts/workflow-version.py'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const header = await readText('src/userscript-header.js');
  const versions = [...header.matchAll(/^\/\/\s*@version\s+(\S+)\s*$/gm)]
    .map(match => match[1]);
  assert.equal(versions.length, 1);
  assert.match(versions[0], /^\d+\.\d+\.\d+-issue\.\d+\.\d+$/);
  assert.equal(result.stdout.trim(), versions[0]);
});

test('generated userscript has an independent repository-owned verifier', async () => {
  const verifier = await readText('scripts/verify-userscript-artifact.mjs');
  assert.doesNotMatch(verifier, /userscript-build-lib\.mjs/);
  assert.doesNotMatch(verifier, /build-userscript\.mjs/);
});

test('GitHub CI is the canonical RepoWorkflow adapter byte for byte', async () => {
  const actual = await readText('.github/workflows/ci.yml');
  const canonical = await readText('RepoWorkflow/templates/github/ci.yml');
  assert.equal(actual, canonical);
});

test('superseded standalone issue-development workflow engine is absent after equivalence', async () => {
  for (const relativePath of [
    '.github/workflows/build-userscript-artifact.yml',
    '.ci/ci-config.json',
    '.ci/test-matrix.json',
    'scripts/ci_contract.py',
    'tests/test_ci_contract.py'
  ]) {
    await assertMissing(relativePath);
  }

  const ciDoc = await readText('CI.md');
  assert.match(ciDoc, /RepoWorkflow\/repo_workflow\.py/);
  assert.match(ciDoc, /\.ci\/repoworkflow\.json/);
  assert.doesNotMatch(ciDoc, /scripts\/ci_contract\.py/);
  assert.doesNotMatch(ciDoc, /\.ci\/test-matrix\.json/);
  assert.doesNotMatch(ciDoc, /build-userscript-artifact\.yml/);
});

test('Phase 7 cross-consumer scratch fixture cannot dirty the repository root', async () => {
  const source = await readText('tests/phase7-cross-consumer-markdown-shape.mjs');
  assert.doesNotMatch(source, /path\.join\(root, ['"]\.phase7-h1-filtered\.jsonl['"]\)/);
  assert.match(source, /mkdtemp/);
  assert.match(source, /tmpdir/);
  assert.match(source, /rm\([^)]*recursive:\s*true[^)]*force:\s*true/s);
});
