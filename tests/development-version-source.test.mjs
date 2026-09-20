import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardPath = fileURLToPath(new URL('../scripts/check-development-version.mjs', import.meta.url));

test('issue-owned development version is read from the authoritative source header', () => {
  const output = execFileSync(
    process.execPath,
    [guardPath, '--branch', 'issue-150-modular-userscript-build'],
    { encoding: 'utf8' }
  );

  assert.match(output, /issue 150 matches version 1\.5\.0-issue\.150\.1/);
});
