#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  orderedSourcePaths,
  readDownloadConversationSource,
  readUserscriptManifest
} from './userscript-build-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPESCRIPT_VERSION = '7.0.2';
const BROKEN_COMMIT = 'c16c2beb71e210ceb3110b69b61a92de6483deb3';

function gitShow(commit, relativePath) {
  const result = spawnSync(
    'git',
    ['show', `${commit}:${relativePath}`],
    { cwd: root, encoding: 'utf8', shell: false }
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not read ${relativePath} from ${commit}: ${result.stderr}`
    );
  }
  return result.stdout;
}

function historicalSource(commit) {
  const manifest = JSON.parse(
    gitShow(commit, 'src/userscript-manifest.json')
  );
  return orderedSourcePaths(manifest)
    .map(relativePath => gitShow(commit, relativePath))
    .join('');
}

function runTsc(source, label) {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), `dc-typescript-${label}-`)
  );
  try {
    const sourcePath = path.join(temporaryRoot, `${label}.js`);
    const ambientPath = path.join(temporaryRoot, 'injected-runtime.d.ts');
    writeFileSync(sourcePath, source, 'utf8');
    writeFileSync(
      ambientPath,
      [
        'declare function create7zArchive(',
        '  bytes: Uint8Array, memberName: string, mtime?: number',
        '): Promise<Uint8Array>;',
        'declare function extract7zArchive(',
        '  archiveBytes: Uint8Array',
        '): Promise<Uint8Array>;',
        ''
      ].join('\n'),
      'utf8'
    );
    return spawnSync(
      process.platform === 'win32'
        ? (process.env.ComSpec ?? 'cmd.exe')
        : 'npx',
      process.platform === 'win32'
        ? [
            '/d', '/s', '/c', 'npx', '--yes', '--package',
            `typescript@${TYPESCRIPT_VERSION}`, 'tsc',
            '--allowJs', '--checkJs', '--noEmit', '--skipLibCheck',
            '--strict', 'false', '--target', 'ES2023',
            '--lib', 'ES2023,DOM,DOM.Iterable',
            sourcePath, ambientPath
          ]
        : [
            '--yes', '--package', `typescript@${TYPESCRIPT_VERSION}`,
            'tsc', '--allowJs', '--checkJs', '--noEmit', '--skipLibCheck',
            '--strict', 'false', '--target', 'ES2023',
            '--lib', 'ES2023,DOM,DOM.Iterable',
            sourcePath, ambientPath
          ],
      { cwd: root, encoding: 'utf8', shell: false }
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const manifest = await readUserscriptManifest(root);
const currentSource = await readDownloadConversationSource(root, manifest);
const current = runTsc(currentSource, 'current');
if (current.error) {
  console.error(
    `TypeScript ${TYPESCRIPT_VERSION} could not execute: ${current.error.message}`
  );
  process.exit(2);
}
if (current.status !== 0) {
  process.stdout.write(current.stdout ?? '');
  process.stderr.write(current.stderr ?? '');
  console.error(
    'Current assembled DownloadConversation source failed TypeScript checking.'
  );
  process.exit(1);
}

const broken = runTsc(historicalSource(BROKEN_COMMIT), 'issue-166.87');
const output = `${broken.stdout ?? ''}\n${broken.stderr ?? ''}`;
if (broken.error) {
  console.error(
    `Negative-control TypeScript execution failed: ${broken.error.message}`
  );
  process.exit(2);
}
if (broken.status === 0) {
  console.error(
    'TypeScript negative control unexpectedly accepted broken .87 source.'
  );
  process.exit(1);
}
if (!output.includes(
  "Cannot find name 'communicationLogInitializeSegmentStorage'"
)) {
  process.stdout.write(output);
  console.error(
    'TypeScript rejected .87, but not for the known missing initializer.'
  );
  process.exit(1);
}
console.log(
  `PASS: TypeScript ${TYPESCRIPT_VERSION} accepts current assembled DC source `
  + 'and rejects .87 for the known missing initializer symbol.'
);
