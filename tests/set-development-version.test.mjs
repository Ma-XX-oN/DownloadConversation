import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const setterPath = fileURLToPath(new URL('../scripts/set-development-version.mjs', import.meta.url));
const guardPath = fileURLToPath(new URL('../scripts/check-development-version.mjs', import.meta.url));

async function withFixture(bytes, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'downloadconversation-version-setter-'));
  const userscriptPath = join(directory, 'fixture.user.js');
  await writeFile(userscriptPath, bytes);
  try {
    return await callback(userscriptPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runSetter(file, branch, iteration, release = null) {
  const args = [setterPath, '--file', file, '--branch', branch, '--iteration', String(iteration)];
  if (release !== null) args.push('--release', release);
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

function runGuard(file, branch) {
  return spawnSync(process.execPath, [guardPath, '--file', file, '--branch', branch], {
    encoding: 'utf8'
  });
}

function fixture(version, eol = '\n') {
  return Buffer.from([
    '// ==UserScript==',
    '// @name         Fixture',
    `// @version      ${version}`,
    '// ==/UserScript==',
    'const unicode = "café";',
    ''
  ].join(eol), 'utf8');
}

test('setter changes only the version token and preserves LF bytes exactly', async () => {
  const before = fixture('1.5.0-issue.148.3', '\n');
  await withFixture(before, async file => {
    const result = runSetter(file, 'issue-135-agent-completion-sounds', 3);
    assert.equal(result.status, 0, result.stderr);

    const after = await readFile(file);
    const expected = fixture('1.5.0-issue.135.3', '\n');
    assert.deepEqual(after, expected);
    assert.equal(after.includes(Buffer.from('\r\n')), false, 'LF input must remain LF');

    const guard = runGuard(file, 'issue-135-agent-completion-sounds');
    assert.equal(guard.status, 0, guard.stderr);
  });
});

test('setter preserves CRLF bytes exactly outside the version token', async () => {
  const before = fixture('1.5.0-issue.148.3', '\r\n');
  await withFixture(before, async file => {
    const result = runSetter(file, 'refs/heads/issue-135-agent-completion-sounds', 3);
    assert.equal(result.status, 0, result.stderr);

    const after = await readFile(file);
    const expected = fixture('1.5.0-issue.135.3', '\r\n');
    assert.deepEqual(after, expected);
    assert.ok(after.includes(Buffer.from('\r\n')), 'CRLF input must remain CRLF');
  });
});

test('setter preserves current release target unless explicitly overridden', async () => {
  await withFixture(fixture('1.5.0-issue.148.3'), async file => {
    const result = runSetter(file, 'issue-149-version-identity-guard', 2);
    assert.equal(result.status, 0, result.stderr);
    assert.match((await readFile(file, 'utf8')), /@version\s+1\.5\.0-issue\.149\.2/);
  });

  await withFixture(fixture('1.5.0-issue.148.3'), async file => {
    const result = runSetter(file, 'issue-149-version-identity-guard', 2, '1.6.0');
    assert.equal(result.status, 0, result.stderr);
    assert.match((await readFile(file, 'utf8')), /@version\s+1\.6\.0-issue\.149\.2/);
  });
});

test('setter refuses non-issue branches and invalid iterations', async () => {
  await withFixture(fixture('1.5.0-issue.148.3'), async file => {
    const nonIssue = runSetter(file, 'main', 1);
    assert.notEqual(nonIssue.status, 0);
    assert.match(nonIssue.stderr, /does not encode an owning issue/);

    const zero = runSetter(file, 'issue-149-version-identity-guard', 0);
    assert.notEqual(zero.status, 0);
    assert.match(zero.stderr, /iteration must be a positive integer/i);
  });
});

test('setter refuses missing, duplicate, and malformed metadata rather than guessing', async () => {
  await withFixture(Buffer.from('// ==UserScript==\n// ==/UserScript==\n'), async file => {
    const result = runSetter(file, 'issue-149-version-identity-guard', 1);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly one userscript @version entry/i);
  });

  const duplicate = Buffer.from([
    '// ==UserScript==',
    '// @version      1.5.0-issue.148.3',
    '// @version      1.5.0-issue.148.4',
    '// ==/UserScript==',
    ''
  ].join('\n'));
  await withFixture(duplicate, async file => {
    const result = runSetter(file, 'issue-149-version-identity-guard', 1);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly one userscript @version entry/i);
  });

  await withFixture(fixture('not-a-development-version'), async file => {
    const result = runSetter(file, 'issue-149-version-identity-guard', 1);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot derive x\.y\.z release target/i);
  });
});

test('setter runs the read-only guard after mutation', async () => {
  await withFixture(fixture('1.5.0-issue.148.3'), async file => {
    const result = runSetter(file, 'issue-149-version-identity-guard', 2);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Established development version 1\.5\.0-issue\.149\.2/);
    assert.match(result.stdout, /Development version guard: branch issue-149-version-identity-guard issue 149 matches version 1\.5\.0-issue\.149\.2/);
  });
});

test('default production setter regenerates the committed artifact while custom fixture mode stays isolated', async () => {
  const source = await readFile(setterPath, 'utf8');
  assert.match(source, /DEFAULT_VERSION_SOURCE/);
  assert.match(source, /build-userscript\.mjs/);
  assert.match(
    source,
    /options\.file\s*===\s*DEFAULT_VERSION_SOURCE[\s\S]*build-userscript\.mjs/
  );
  assert.match(
    source,
    /execFileSync\(process\.execPath,[\s\S]*build-userscript\.mjs/
  );
});
