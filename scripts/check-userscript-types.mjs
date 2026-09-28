#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPESCRIPT_VERSION = '7.0.2';
const BROKEN_COMMIT = 'c16c2beb71e210ceb3110b69b61a92de6483deb3';
const USERSCRIPT = 'chatgpt-conversation-markdown-export.user.js';

function downloadConversationProgram(userscript) {
  const marker = '// END bundled AIConversationCore\\n';
  const markerIndex = userscript.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error('Exact AIConversationCore dependency terminator is missing.');
  }
  return userscript.slice(markerIndex + marker.length);
}

function runTsc(filePath) {
  return spawnSync(
    process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npx',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npx', '--yes', '--package', `typescript@${TYPESCRIPT_VERSION}`, 'tsc',
          '--allowJs', '--checkJs', '--noEmit', '--skipLibCheck',
          '--target', 'ES2023', '--lib', 'ES2023,DOM,DOM.Iterable', filePath]
      : ['--yes', '--package', `typescript@${TYPESCRIPT_VERSION}`, 'tsc',
          '--allowJs', '--checkJs', '--noEmit', '--skipLibCheck',
          '--target', 'ES2023', '--lib', 'ES2023,DOM,DOM.Iterable', filePath],
    { cwd: root, encoding: 'utf8', shell: false }
  );
}

const currentRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-typescript-current-'));
const currentPath = path.join(currentRoot, 'downloadconversation-current.js');
writeFileSync(
  currentPath,
  downloadConversationProgram(readFileSync(path.join(root, USERSCRIPT), 'utf8')),
  'utf8'
);
const current = runTsc(currentPath);
if (current.error) {
  console.error(`TypeScript ${TYPESCRIPT_VERSION} could not execute: ${current.error.message}`);
  process.exit(2);
}
if (current.status !== 0) {
  process.stdout.write(current.stdout ?? '');
  process.stderr.write(current.stderr ?? '');
  console.error('Current assembled userscript failed TypeScript semantic checking.');
  process.exit(1);
}

rmSync(currentRoot, { recursive: true, force: true });

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-typescript-negative-'));
try {
  const historical = spawnSync(
    'git',
    ['show', `${BROKEN_COMMIT}:${USERSCRIPT}`],
    { cwd: root, encoding: 'utf8', shell: false }
  );
  if (historical.status !== 0) {
    process.stderr.write(historical.stderr ?? '');
    console.error('Could not load the immutable .87 negative-control artifact.');
    process.exit(2);
  }
  const brokenPath = path.join(temporaryRoot, 'issue-166.87.user.js');
  writeFileSync(
    brokenPath,
    downloadConversationProgram(historical.stdout),
    'utf8'
  );
  const broken = runTsc(brokenPath);
  const output = `${broken.stdout ?? ''}\n${broken.stderr ?? ''}`;
  if (broken.error) {
    console.error(`Negative-control TypeScript execution failed: ${broken.error.message}`);
    process.exit(2);
  }
  if (broken.status === 0) {
    console.error('TypeScript negative control unexpectedly accepted the broken .87 artifact.');
    process.exit(1);
  }
  if (!output.includes("Cannot find name 'communicationLogInitializeSegmentStorage'")) {
    process.stdout.write(output);
    console.error('TypeScript rejected .87, but not for the known missing initializer symbol.');
    process.exit(1);
  }
  console.log(`PASS: TypeScript ${TYPESCRIPT_VERSION} accepts the shipped artifact and rejects .87 for the known missing initializer.`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
