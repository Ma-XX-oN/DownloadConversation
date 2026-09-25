import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cycleScript = path.join(root, 'scripts', 'test-cycle-artifact.mjs');
const runCiPath = path.join(root, 'scripts', 'run-ci.mjs');
const environmentPath = path.join(root, 'scripts', 'ci-environment.mjs');
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
const repoWorkflowConfigPath = path.join(root, '.ci', 'repoworkflow.json');
const requestAdapterPath = path.join(root, 'RepoWorkflow', 'repo_workflow', 'github_adapter.py');
const versioningDocPath = path.join(root, 'docs', 'DEVELOPMENT-VERSIONING.md');
const ciDocPath = path.join(root, 'CI.md');
const artifactPath = 'chatgpt-conversation-markdown-export.user.js';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function runCycle(cwd, command, branch = 'issue-9-fixture', extraArgs = []) {
  return spawnSync(
    process.execPath,
    [cycleScript, command, '--branch', branch, ...extraArgs],
    { cwd, encoding: 'utf8' }
  );
}

async function createFixture() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'downloadconversation-test-cycle-'));
  const remoteRoot = `${fixtureRoot}-remote.git`;
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true });

  await writeFile(
    path.join(fixtureRoot, 'src', 'userscript-header.js'),
    '// ==UserScript==\n// @version      1.2.0-issue.9.1\n// ==/UserScript==\n'
  );
  await writeFile(
    path.join(fixtureRoot, 'scripts', 'build-userscript.mjs'),
    [
      "import { readFile, writeFile } from 'node:fs/promises';",
      "const artifact = 'chatgpt-conversation-markdown-export.user.js';",
      "const header = await readFile('src/userscript-header.js', 'utf8');",
      "const built = `${header}console.log('fixture');\\n`;",
      "if (process.argv.includes('--check')) {",
      "  const existing = await readFile(artifact, 'utf8').catch(() => '');",
      "  if (existing !== built) {",
      "    console.error('Generated userscript is stale.');",
      "    process.exitCode = 1;",
      "  }",
      "} else {",
      "  await writeFile(artifact, built);",
      "}",
      ''
    ].join('\n')
  );

  git(fixtureRoot, ['init', '-b', 'issue-9-fixture']);
  git(fixtureRoot, ['config', 'user.name', 'Fixture User']);
  git(fixtureRoot, ['config', 'user.email', 'fixture@example.invalid']);
  git(fixtureRoot, ['add', 'src/userscript-header.js', 'scripts/build-userscript.mjs']);
  git(fixtureRoot, ['commit', '-m', 'fixture source']);
  execFileSync('git', ['init', '--bare', remoteRoot], { encoding: 'utf8' });
  git(fixtureRoot, ['remote', 'add', 'origin', remoteRoot]);
  git(fixtureRoot, ['push', '-u', 'origin', 'issue-9-fixture']);

  return { fixtureRoot, remoteRoot };
}

async function withFixture(callback) {
  const { fixtureRoot, remoteRoot } = await createFixture();
  try {
    await callback(fixtureRoot, remoteRoot);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(remoteRoot, { recursive: true, force: true });
  }
}

test('test-cycle artifact publisher exposes prepare, verify, publish, and prepare-push commands', async () => {
  const source = await readFile(cycleScript, 'utf8');
  assert.match(source, /\bprepare\b/);
  assert.match(source, /\bverify\b/);
  assert.match(source, /\bpublish\b/);
  assert.match(source, /--push/);
  assert.match(source, /v\$\{version\}/);
  assert.match(source, /git[\s\S]*push[\s\S]*--atomic/);
});

test('prepare materializes and commits the exact generated artifact before tests', async () => {
  await withFixture(async fixtureRoot => {
    const before = git(fixtureRoot, ['rev-parse', 'HEAD']);
    const result = runCycle(fixtureRoot, 'prepare');
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const after = git(fixtureRoot, ['rev-parse', 'HEAD']);
    assert.notEqual(after, before);
    assert.equal(git(fixtureRoot, ['ls-files', '--error-unmatch', artifactPath]), artifactPath);
    assert.equal(git(fixtureRoot, ['status', '--porcelain']), '');
    assert.match(git(fixtureRoot, ['log', '-1', '--pretty=%s']), /materialize 1\.2\.0-issue\.9\.1/);

    const artifact = await readFile(path.join(fixtureRoot, artifactPath), 'utf8');
    assert.match(artifact, /@version\s+1\.2\.0-issue\.9\.1/);
  });
});

test('prepare-push publishes one shared artifact commit before validation request', async () => {
  await withFixture(async (fixtureRoot, remoteRoot) => {
    const result = runCycle(fixtureRoot, 'prepare', 'issue-9-fixture', ['--push']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const preparedHead = git(fixtureRoot, ['rev-parse', 'HEAD']);
    const remoteHead = execFileSync(
      'git',
      ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/issue-9-fixture'],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(remoteHead, preparedHead);
  });
});

test('verify fails closed when the committed artifact is stale', async () => {
  await withFixture(async fixtureRoot => {
    const prepared = runCycle(fixtureRoot, 'prepare');
    assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);

    await writeFile(path.join(fixtureRoot, artifactPath), 'stale artifact\n');
    git(fixtureRoot, ['add', artifactPath]);
    git(fixtureRoot, ['commit', '-m', 'make artifact stale']);

    const result = runCycle(fixtureRoot, 'verify');
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /stale|deterministic|current/i);
  });
});

test('verify preserves builder infrastructure exit 2 for CI classification', async () => {
  await withFixture(async fixtureRoot => {
    const prepared = runCycle(fixtureRoot, 'prepare');
    assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);

    const builder = path.join(fixtureRoot, 'scripts', 'build-userscript.mjs');
    await writeFile(builder, "console.error('simulated network outage');\nprocess.exitCode = 2;\n");
    const result = runCycle(fixtureRoot, 'verify');
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /dependency|network|reach/i);
  });
});

test('publish creates immutable version tag on the exact tested artifact commit', async () => {
  await withFixture(async (fixtureRoot, remoteRoot) => {
    assert.equal(runCycle(fixtureRoot, 'prepare').status, 0);
    const testedHead = git(fixtureRoot, ['rev-parse', 'HEAD']);
    const published = runCycle(fixtureRoot, 'publish');
    assert.equal(published.status, 0, published.stderr || published.stdout);

    assert.equal(git(fixtureRoot, ['rev-list', '-n', '1', 'v1.2.0-issue.9.1']), testedHead);
    const remoteTagTarget = execFileSync(
      'git',
      ['--git-dir', remoteRoot, 'rev-list', '-n', '1', 'v1.2.0-issue.9.1'],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(remoteTagTarget, testedHead);
  });
});

test('publish refuses to move an existing version tag to a later commit', async () => {
  await withFixture(async fixtureRoot => {
    assert.equal(runCycle(fixtureRoot, 'prepare').status, 0);
    assert.equal(runCycle(fixtureRoot, 'publish').status, 0);

    await writeFile(path.join(fixtureRoot, 'notes.txt'), 'later commit, same version\n');
    git(fixtureRoot, ['add', 'notes.txt']);
    git(fixtureRoot, ['commit', '-m', 'later same-version commit']);

    const result = runCycle(fixtureRoot, 'publish');
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /tag.*different|different.*tag|version.*already/i);
  });
});

test('stable artifact path remains separate while RepoWorkflow owns shared lifecycle', async () => {
  const [runCi, environment, workflow, repoWorkflowConfig, requestAdapter] = await Promise.all([
    readFile(runCiPath, 'utf8'),
    readFile(environmentPath, 'utf8'),
    readFile(workflowPath, 'utf8'),
    readFile(repoWorkflowConfigPath, 'utf8'),
    readFile(requestAdapterPath, 'utf8')
  ]);

  assert.match(runCi, /test-cycle-artifact\.mjs', 'prepare'/);
  assert.match(runCi, /ci-environment\.mjs/);
  assert.match(runCi, /tagRequested/);
  assert.match(runCi, /test-cycle-artifact\.mjs', 'publish'/);

  assert.match(environment, /runOrdinaryCi\(\);[\s\S]*runCrossConsumerCi\(\);/);
  assert.match(environment, /process\.exitCode = 2/);
  assert.match(environment, /process\.exitCode = 1/);

  assert.match(repoWorkflowConfig, /"validationCommand"\s*:\s*\["python", "scripts\/repoworkflow-validate\.py"\]/);
  assert.match(repoWorkflowConfig, /"generatorCommand"\s*:\s*\["node", "scripts\/build-userscript\.mjs"\]/);
  assert.match(repoWorkflowConfig, /"verifierCommand"\s*:\s*\["node", "scripts\/verify-userscript-artifact\.mjs"\]/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py github-mode/);
  assert.match(workflow, /needs\.policy\.outputs\.mode != 'none'/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py materialize-artifacts/);
  assert.match(workflow, /materialize-artifacts --stable/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py stable-run/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py run/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py stable-finalize/);
  assert.match(workflow, /RepoWorkflow\/repo_workflow\.py finalize/);
  assert.match(requestAdapter, /\.ci\/run-ci-request/);
  assert.doesNotMatch(workflow, /ci_contract\.py/);
  assert.doesNotMatch(workflow, /test-cycle-artifact\.mjs prepare/);
  assert.doesNotMatch(workflow, /test-cycle-artifact\.mjs publish/);
});

test('durable documentation requires generated artifact first and complete-matrix tagging second', async () => {
  const [versioning, ciDoc] = await Promise.all([
    readFile(versioningDocPath, 'utf8'),
    readFile(ciDocPath, 'utf8')
  ]);

  assert.match(versioning, /generated.*tracked|tracked.*generated/is);
  assert.match(versioning, /\.ci\/run-ci-request/);
  assert.match(versioning, /CI-FAIL/);
  assert.match(versioning, /INCOMPLETE/);
  assert.match(versioning, /RepoWorkflow\/repo_workflow\.py/);
  assert.match(ciDoc, /generated.*artifact/is);
  assert.match(ciDoc, /required.*environment|required.*matrix|matrix.*required/is);
  assert.match(ciDoc, /--tag/);
  assert.match(ciDoc, /RepoWorkflow\/repo_workflow\.py/);
});
