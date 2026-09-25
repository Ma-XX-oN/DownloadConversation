import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardPath = fileURLToPath(new URL('../scripts/check-development-version.mjs', import.meta.url));
const headerPath = fileURLToPath(new URL('../src/userscript-header.js', import.meta.url));

test('issue-owned development version is read from the authoritative source header', async t => {
  const header = await readFile(headerPath, 'utf8');
  const versionMatch = /^\/\/ @version\s+(\d+\.\d+\.\d+(?:-issue\.(\d+)\.\d+)?)$/m.exec(header);
  assert.ok(versionMatch, 'Authoritative source header must contain a supported semantic version.');
  const [, version, issue] = versionMatch;
  if (!issue) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    t.skip('Stable source version; issue-development branch guard is not applicable.');
    return;
  }

  const output = execFileSync(
    process.execPath,
    [guardPath, '--branch', `issue-${issue}-version-source-test`],
    { encoding: 'utf8' }
  );

  assert.ok(output.includes(`issue ${issue} matches version ${version}`));
});
