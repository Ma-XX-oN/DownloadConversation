import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardPath = fileURLToPath(new URL('../../scripts/check-main-integration-pr.mjs', import.meta.url));

async function runGuard({ base, head, version }) {
  const directory = await mkdtemp(join(tmpdir(), 'downloadconversation-main-integration-'));
  const file = join(directory, 'header.js');
  await writeFile(file, `// ==UserScript==\n// @version      ${version}\n// ==/UserScript==\n`, 'utf8');
  try {
    return spawnSync(process.execPath, [
      guardPath,
      '--base', base,
      '--head', head,
      '--file', file
    ], { encoding: 'utf8' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('rejects a direct issue-branch PR into main before merge', async () => {
  const result = await runGuard({
    base: 'main',
    head: 'issue-175-agent-last-waiting-timers',
    version: '1.9.0-issue.175.3'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Direct integration from issue branch .* to main is forbidden/);
});

test('rejects any main-targeting PR that has not promoted to a stable version', async () => {
  const result = await runGuard({
    base: 'main',
    head: 'integration-175-agent-last-waiting-timers',
    version: '1.9.0-issue.175.3'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /require a plain stable x\.y\.z userscript version before merge/);
});

test('accepts a separately prepared integration branch with a stable version', async () => {
  const result = await runGuard({
    base: 'main',
    head: 'integration-175-agent-last-waiting-timers',
    version: '1.10.0'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /carries stable version 1\.10\.0/);
});

test('does not impose main integration policy on other PR targets', async () => {
  const result = await runGuard({
    base: 'issue-200-something',
    head: 'issue-175-agent-last-waiting-timers',
    version: '1.9.0-issue.175.3'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /is not main/);
});
