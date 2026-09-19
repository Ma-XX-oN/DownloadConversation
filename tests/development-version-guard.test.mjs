import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardPath = fileURLToPath(new URL('../scripts/check-development-version.mjs', import.meta.url));
const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

async function runGuard({ branch, source, env = {} }) {
  const directory = await mkdtemp(join(tmpdir(), 'downloadconversation-version-guard-'));
  const userscriptPath = join(directory, 'fixture.user.js');
  await writeFile(userscriptPath, source, 'utf8');
  try {
    const args = [guardPath, '--file', userscriptPath];
    if (branch !== undefined) args.push('--branch', branch);
    return spawnSync(process.execPath, args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_HEAD_REF: '',
        GITHUB_REF_NAME: '',
        ...env
      }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function userscript(versionLines) {
  const lines = Array.isArray(versionLines) ? versionLines : [versionLines];
  return [
    '// ==UserScript==',
    '// @name         Fixture',
    ...lines.filter(Boolean).map(version => `// @version      ${version}`),
    '// ==/UserScript=='
  ].join('\n');
}

test('rejects the real dependency-version mismatch: issue-148 branch with issue-140 version', async () => {
  const result = await runGuard({
    branch: 'issue-148-agent-favicon-state',
    source: userscript('1.5.0-issue.140.4')
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr,
    /Development version issue 140 does not match owning branch issue 148/);
});

test('accepts a matching issue-owned branch/version pair including refs/heads form', async () => {
  const result = await runGuard({
    branch: 'refs/heads/issue-148-agent-favicon-state',
    source: userscript('1.5.0-issue.148.3')
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /issue 148 matches version 1\.5\.0-issue\.148\.3/);
});

test('rejects malformed development versions on issue-owned branches', async () => {
  const result = await runGuard({
    branch: 'issue-148-agent-favicon-state',
    source: userscript('1.5.0-issue.148')
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr,
    /Issue-owned branch requires x\.y\.z-issue\.<issue>\.<iteration> development version/);
});

test('requires exactly one userscript @version metadata entry', async () => {
  const missing = await runGuard({
    branch: 'issue-148-agent-favicon-state',
    source: userscript([])
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Expected exactly one userscript @version entry, found 0/);

  const duplicate = await runGuard({
    branch: 'issue-148-agent-favicon-state',
    source: userscript(['1.5.0-issue.148.3', '1.5.0-issue.148.4'])
  });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /Expected exactly one userscript @version entry, found 2/);
});

test('non-issue branches do not invent an owning issue requirement', async () => {
  const release = await runGuard({
    branch: 'main',
    source: userscript('1.5.0')
  });
  assert.equal(release.status, 0, release.stderr);
  assert.match(release.stdout, /No issue owner encoded by branch main/);

  const feature = await runGuard({
    branch: 'feature/provider-research',
    source: userscript('1.5.0-issue.148.3')
  });
  assert.equal(feature.status, 0, feature.stderr);
});

test('derives pull-request source branch from GITHUB_HEAD_REF when --branch is omitted', async () => {
  const result = await runGuard({
    source: userscript('1.5.0-issue.149.1'),
    env: {
      GITHUB_HEAD_REF: 'issue-149-version-identity-guard',
      GITHUB_REF_NAME: '149/merge'
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /issue 149 matches version 1\.5\.0-issue\.149\.1/);
});

test('ordinary CI runs the branch/version guard before feature-specific verification', () => {
  const guardIndex = ci.indexOf('node scripts/check-development-version.mjs');
  const jsdocIndex = ci.indexOf('- name: Production JSDoc coverage');
  const regressionIndex = ci.indexOf('node --test tests/development-version-guard.test.mjs');

  assert.ok(guardIndex >= 0, 'Ordinary CI must invoke the development version guard.');
  assert.ok(jsdocIndex >= 0, 'Could not locate the first production verification step.');
  assert.ok(guardIndex < jsdocIndex,
    'Branch/version identity must be checked before feature-specific verification.');
  assert.ok(regressionIndex >= 0,
    'Ordinary CI must retain the fixed development-version guard regression suite.');
});
