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
        'declare const GM_info: any;',
        'declare const unsafeWindow: any;',
        'declare const STREAM7Z_WASM_GZIP_BASE64: string;',
        'declare const Stream7zModule: any;',
        'declare const STREAMING7Z_WASM_GZIP_BASE64: string;',
        'declare const Streaming7zModule: any;',
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

function unresolvedDiagnostics(result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return output.split(/\r?\n/).filter(line => {
    return /error TS(?:2304|2552):/.test(line);
  });
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
const currentUnresolved = unresolvedDiagnostics(current);
if (currentUnresolved.length > 0) {
  console.error(currentUnresolved.join('\n'));
  console.error(
    'Current assembled DownloadConversation source has unresolved identifiers.'
  );
  process.exit(1);
}

const broken = runTsc(historicalSource(BROKEN_COMMIT), 'issue-166.87');
const brokenUnresolved = unresolvedDiagnostics(broken);
if (broken.error) {
  console.error(
    `Negative-control TypeScript execution failed: ${broken.error.message}`
  );
  process.exit(2);
}
if (!brokenUnresolved.some(line => {
  return line.includes(
    "Cannot find name 'communicationLogInitializeSegmentStorage'"
  );
})) {
  console.error(brokenUnresolved.join('\n'));
  console.error(
    'TypeScript negative control did not detect the .87 missing initializer.'
  );
  process.exit(1);
}
console.log(
  `PASS: TypeScript ${TYPESCRIPT_VERSION} reports zero unresolved identifiers `
  + 'in current assembled DC source and detects the broken .87 initializer.'
);
