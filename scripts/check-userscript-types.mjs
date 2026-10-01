#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentPluginPrelude,
  injectUserscriptPrelude,
  orderedSourcePaths,
  readDownloadConversationSource,
  readUserscriptManifest
} from './userscript-build-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPESCRIPT_VERSION = '7.0.2';
const BROKEN_COMMIT = 'c16c2beb71e210ceb3110b69b61a92de6483deb3';
const BROKEN_PLUGIN_REF = 'v1.9.0-issue.156.8';
const BROKER_PATH = 'src/userscript/01-runtime/02-github-agent-plugin-broker.js';
const BRIDGE_PATH = 'src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js';

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

function historicalPluginAssembledSource(ref) {
  const manifest = JSON.parse(gitShow(ref, 'src/userscript-manifest.json'));
  const source = orderedSourcePaths(manifest)
    .map(relativePath => gitShow(ref, relativePath))
    .join('');
  const prelude = buildAgentPluginPrelude(
    manifest.agent_plugins,
    gitShow(ref, BROKER_PATH),
    gitShow(ref, BRIDGE_PATH)
  );
  return injectUserscriptPrelude(source, prelude);
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
        'declare function GM_getValue(name: string, defaultValue?: any): any;',
        'declare function GM_setValue(name: string, value: any): void;',
        'declare function GM_addValueChangeListener(name: string, callback: (...args: any[]) => void): number;',
        'declare function GM_removeValueChangeListener(listenerId: number): void;',
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
const source = await readDownloadConversationSource(root, manifest);
const currentPrelude = buildAgentPluginPrelude(
  manifest.agent_plugins,
  readFileSync(path.join(root, BROKER_PATH), 'utf8'),
  readFileSync(path.join(root, BRIDGE_PATH), 'utf8')
);
const currentSource = injectUserscriptPrelude(source, currentPrelude);
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

const brokenPlugin = runTsc(
  historicalPluginAssembledSource(BROKEN_PLUGIN_REF),
  'issue-156.8-plugin-prelude'
);
const brokenPluginUnresolved = unresolvedDiagnostics(brokenPlugin);
if (brokenPlugin.error) {
  console.error(
    `Plugin-prelude negative-control TypeScript execution failed: ${brokenPlugin.error.message}`
  );
  process.exit(2);
}
for (const missingName of [
  'AGENT_PLUGIN_CACHE_PREFIX',
  'AGENT_PLUGIN_BROKER_TIMEOUT_MS'
]) {
  if (!brokenPluginUnresolved.some(line => line.includes(`Cannot find name '${missingName}'`))) {
    console.error(brokenPluginUnresolved.join('\n'));
    console.error(
      `TypeScript negative control did not detect the .156.8 missing ${missingName}.`
    );
    process.exit(1);
  }
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
  + 'in the actual current plugin-prelude + DC runtime assembly, detects the '
  + '.156.8 missing broker constants, and detects the broken .87 initializer.'
);
