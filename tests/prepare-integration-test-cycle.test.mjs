import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'prepare-integration-test-cycle.mjs');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function createFixture() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'downloadconversation-integration-'));
  const remoteRoot = `${fixtureRoot}-remote.git`;
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true });

  await writeFile(
    path.join(fixtureRoot, 'src', 'userscript-header.js'),
    '// ==UserScript==\n// @version      1.5.0-issue.135.10\n// ==/UserScript==\n'
  );
  await writeFile(
    path.join(fixtureRoot, 'chatgpt-conversation-markdown-export.user.js'),
    '// ==UserScript==\n// @version      1.5.0-issue.150.10\n// ==/UserScript==\n'
  );
  await writeFile(
    path.join(fixtureRoot, 'scripts', 'check-development-version.mjs'),
    "process.exit(process.argv.includes('--branch') ? 0 : 1);\n"
  );
  await writeFile(
    path.join(fixtureRoot, 'scripts', 'test-cycle-artifact.mjs'),
    [
      "import { readFile, writeFile } from 'node:fs/promises';",
      "import { execFileSync } from 'node:child_process';",
      "const command = process.argv[2];",
      "const branchIndex = process.argv.indexOf('--branch');",
      "const branch = branchIndex >= 0 ? process.argv[branchIndex + 1] : '';",
      "const header = await readFile('src/userscript-header.js', 'utf8');",
      "const version = /@version\\s+(\\S+)/.exec(header)?.[1];",
      "if (!version || !branch) process.exit(2);",
      "if (command === 'prepare') {",
      "  await writeFile('chatgpt-conversation-markdown-export.user.js', `// ==UserScript==\\n// @version      ${version}\\n// ==/UserScript==\\n`);",
      "  execFileSync('git', ['add', 'chatgpt-conversation-markdown-export.user.js']);",
      "  execFileSync('git', ['commit', '-m', `build(test-cycle): materialize ${version} [skip ci]`]);",
      "  if (process.argv.includes('--push')) execFileSync('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], { stdio: 'ignore' });",
      "}",
      "const artifact = await readFile('chatgpt-conversation-markdown-export.user.js', 'utf8');",
      "if (!artifact.includes(`@version      ${version}`)) process.exit(3);",
      ''
    ].join('\n')
  );

  git(fixtureRoot, ['init', '-b', 'issue-135-integration-150']);
  git(fixtureRoot, ['config', 'user.name', 'Fixture User']);
  git(fixtureRoot, ['config', 'user.email', 'fixture@example.invalid']);
  git(fixtureRoot, ['add', '.']);
  git(fixtureRoot, ['commit', '-m', 'fixture']);
  execFileSync('git', ['init', '--bare', remoteRoot], { encoding: 'utf8' });
  git(fixtureRoot, ['remote', 'add', 'origin', remoteRoot]);
  git(fixtureRoot, ['push', '-u', 'origin', 'issue-135-integration-150']);
  git(fixtureRoot, ['switch', '-c', 'scratch']);
  return { fixtureRoot, remoteRoot };
}

test('one command prepares and pushes the integration test-cycle branch safely', async () => {
  const { fixtureRoot, remoteRoot } = await createFixture();
  try {
    const result = spawnSync(
      process.execPath,
      [script, '--branch', 'issue-135-integration-150'],
      { cwd: fixtureRoot, encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(git(fixtureRoot, ['branch', '--show-current']), 'issue-135-integration-150');
    assert.match(result.stdout, /1\.5\.0-issue\.135\.10/);
    const localHead = git(fixtureRoot, ['rev-parse', 'HEAD']);
    const remoteHead = execFileSync(
      'git',
      ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/issue-135-integration-150'],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(remoteHead, localHead);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(remoteRoot, { recursive: true, force: true });
  }
});

test('refuses to overwrite a divergent local integration branch', async () => {
  const { fixtureRoot, remoteRoot } = await createFixture();
  try {
    git(fixtureRoot, ['switch', 'issue-135-integration-150']);
    await writeFile(path.join(fixtureRoot, 'local-only.txt'), 'local commit\n');
    git(fixtureRoot, ['add', 'local-only.txt']);
    git(fixtureRoot, ['commit', '-m', 'local-only']);
    git(fixtureRoot, ['switch', 'scratch']);

    const result = spawnSync(
      process.execPath,
      [script, '--branch', 'issue-135-integration-150'],
      { cwd: fixtureRoot, encoding: 'utf8' }
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /differs|refus/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(remoteRoot, { recursive: true, force: true });
  }
});

test('refuses to begin from a dirty working tree', async () => {
  const { fixtureRoot, remoteRoot } = await createFixture();
  try {
    await writeFile(path.join(fixtureRoot, 'dirty.txt'), 'dirty\n');
    const result = spawnSync(
      process.execPath,
      [script, '--branch', 'issue-135-integration-150'],
      { cwd: fixtureRoot, encoding: 'utf8' }
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /working tree.*clean|clean.*working tree/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(remoteRoot, { recursive: true, force: true });
  }
});
