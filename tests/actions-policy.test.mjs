import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.resolve(here, '..', 'scripts', 'check-actions-policy.mjs');

function makeRoot(workflows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'actions-policy-'));
  const dir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(workflows)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
}

test('accepts permanent CI using only the approved deterministic write path', () => {
  const root = makeRoot({
    'ci.yml': `name: CI\njobs:\n  prepare:\n    permissions:\n      contents: write\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n      - run: node scripts/test-cycle-artifact.mjs prepare --branch x --push\n`,
  });
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('accepts the dedicated generated-artifact workflow with top-level write permission', () => {
  const root = makeRoot({
    'ci.yml': 'name: CI\njobs:\n  test:\n    steps: []\n',
    'build-userscript-artifact.yml': `name: Build\npermissions:\n  contents: write\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n      - run: node scripts/test-cycle-artifact.mjs prepare --branch x --push\n`,
  });
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a repository missing the permanent CI workflow', () => {
  const root = makeRoot({});
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required permanent workflow/);
});

test('rejects any additional workflow even if it is read-only', () => {
  const root = makeRoot({
    'ci.yml': 'name: CI\njobs:\n  test:\n    steps: []\n',
    'issue-999-apply.yml': 'name: One shot\njobs:\n  apply:\n    steps: []\n',
  });
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected workflow file/);
});

test('rejects direct git push from a write-capable permanent job', () => {
  const root = makeRoot({
    'ci.yml': `name: CI\njobs:\n  prepare:\n    permissions:\n      contents: write\n    steps:\n      - uses: actions/checkout@v4\n      - run: node scripts/test-cycle-artifact.mjs prepare --branch x --push\n      - run: git push origin HEAD\n`,
  });
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /direct repository mutation command/);
});

test('rejects an issue-specific local script from a write-capable job', () => {
  const root = makeRoot({
    'ci.yml': `name: CI\njobs:\n  prepare:\n    permissions:\n      contents: write\n    steps:\n      - uses: actions/checkout@v4\n      - run: node scripts/test-cycle-artifact.mjs prepare --branch x --push\n      - run: node scripts/issue-999-apply.mjs\n`,
  });
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unapproved local script/);
});

test('rejects an unapproved external action from a write-capable job', () => {
  const root = makeRoot({
    'ci.yml': `name: CI\njobs:\n  prepare:\n    permissions:\n      contents: write\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/github-script@v7\n      - run: node scripts/test-cycle-artifact.mjs prepare --branch x --push\n`,
  });
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unapproved action/);
});

test('rejects contents write without an approved publication command', () => {
  const root = makeRoot({
    'ci.yml': `name: CI\njobs:\n  prepare:\n    permissions:\n      contents: write\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo no-publication\n`,
  });
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contents: write without an approved/);
});

test('current repository satisfies the Actions policy', () => {
  const root = path.resolve(here, '..');
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});
