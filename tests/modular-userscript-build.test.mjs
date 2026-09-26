import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assembleUserscript,
  gitBlobSha1,
  orderedSourcePaths,
  readDownloadConversationSource,
  readUserscriptHeader,
  readUserscriptManifest,
  validatePinnedDependency
} from '../scripts/userscript-build-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_COMMIT = '1b531a1c92adfa1695db8c644159054e013f0a72';
const CORE_BLOB = '84a1fcf72a8da76f837a791a142c1c95ed37d607';
const LEGACY_BLOB = '44a4ab373a6515caed5527aeb19cbdff7ce91e07';
const MIGRATION_SNAPSHOT_COMMIT = '62571e15af8f7f3e4472258e7a18bb2f2d48cef5';
const USER_SCRIPT_HEADER_END = '// ==/UserScript==\n';

function readSnapshotFile(commit, sourcePath) {
  return execFileSync(
    'git',
    ['show', `${commit}:${sourcePath}`],
    { cwd: root, encoding: 'utf8' }
  );
}

test('manifest groups ordered small source segments under logical subsystem modules', async () => {
  const manifest = await readUserscriptManifest(root);
  assert.equal(manifest.format_version, 2);
  assert.deepEqual(
    manifest.modules.map(module => module.name),
    [
      'runtime',
      'network-communication',
      'agent-lifecycle',
      'conversation-rendering',
      'live-navigation',
      'image-export-tests',
      'panel-launcher'
    ]
  );
  const sourcePaths = orderedSourcePaths(manifest);
  assert.equal(sourcePaths.length, 47);
  assert.equal(new Set(sourcePaths).size, sourcePaths.length);
  assert.ok(sourcePaths.every(sourcePath => sourcePath.startsWith('src/userscript/')));
  assert.ok(sourcePaths.every(sourcePath => !sourcePath.includes('/userscript-body/part-')));
  for (const sourcePath of sourcePaths) {
    const info = await stat(path.join(root, sourcePath));
    assert.ok(info.isFile(), `${sourcePath} is not a source file.`);
    assert.ok(info.size > 0 && info.size < 16 * 1024, `${sourcePath} is not a small source segment.`);
  }
});

test('authoritative header preserves supported semantic version and document-start execution without runtime @require', async () => {
  const manifest = await readUserscriptManifest(root);
  const header = await readUserscriptHeader(root, manifest);
  assert.match(header, /^\/\/ ==UserScript==\n/);
  assert.match(header, /^\/\/ @version\s+\d+\.\d+\.\d+(?:-issue\.\d+\.\d+)?$/m);
  assert.match(header, /^\/\/ @run-at\s+document-start$/m);
  assert.doesNotMatch(header, /^\/\/ @require\b/m);
  assert.match(header, /\/\/ ==\/UserScript==\n$/);
});

test('AIConversationCore build dependency is pinned by commit, byte length, and Git blob identity', async () => {
  const manifest = await readUserscriptManifest(root);
  assert.equal(manifest.dependencies.length, 1);
  const [dependency] = manifest.dependencies;
  assert.equal(dependency.name, 'AIConversationCore');
  assert.equal(dependency.commit, CORE_COMMIT);
  assert.equal(dependency.git_blob_sha1, CORE_BLOB);
  assert.equal(dependency.byte_length, 265877);
  assert.equal(dependency.repository, 'Ma-XX-oN/AIConversationCore');
  assert.equal(dependency.path, 'dist/aiconversationcore.chatgpt.browser.js');
  assert.ok(dependency.url.includes(`/${CORE_COMMIT}/`));
});

test('pinned dependency validation rejects changed bytes independently of assembly', () => {
  const content = 'globalThis.AIConversationCore = {};\n';
  const dependency = {
    name: 'fixture-core',
    byte_length: 36,
    git_blob_sha1: 'b82dac162a42aa04170be5265afc69061dc0de30'
  };
  validatePinnedDependency(dependency, content);
  assert.throws(
    () => validatePinnedDependency(dependency, `${content} `),
    /byte length mismatch/
  );
  assert.throws(
    () => validatePinnedDependency({ ...dependency, git_blob_sha1: '0'.repeat(40) }, content),
    /Git blob mismatch/
  );
});

test('ordered source preserves the userscript runtime IIFE boundary', async () => {
  const manifest = await readUserscriptManifest(root);
  const source = await readDownloadConversationSource(root, manifest);
  assert.ok(source.startsWith("\n(() => {\n  'use strict';"));
  assert.ok(source.endsWith('})();'));
  assert.match(source, /const CORE_VERSION = canonicalCore\(\)\.getVersion\(\);/);
});

test('verified #150 migration snapshot preserves every non-whitespace legacy runtime byte in source order', async () => {
  const manifest = await readUserscriptManifest(root);
  assert.equal(manifest.migration_source.snapshot_commit, MIGRATION_SNAPSHOT_COMMIT);

  const snapshotManifest = JSON.parse(
    readSnapshotFile(MIGRATION_SNAPSHOT_COMMIT, 'src/userscript-manifest.json')
  );
  assert.equal(snapshotManifest.migration_source.git_blob_sha1, LEGACY_BLOB);

  const fixture = await readFile(path.join(root, manifest.migration_source.path), 'utf8');
  const headerEnd = fixture.indexOf(USER_SCRIPT_HEADER_END);
  assert.ok(headerEnd >= 0, 'Legacy fixture userscript metadata terminator is missing.');
  const legacyBody = fixture.slice(headerEnd + USER_SCRIPT_HEADER_END.length);
  let cursor = 0;

  for (const sourcePath of orderedSourcePaths(snapshotManifest)) {
    const segment = readSnapshotFile(MIGRATION_SNAPSHOT_COMMIT, sourcePath);
    const payload = segment.trim();
    assert.ok(payload, `${sourcePath} contains no non-whitespace source bytes.`);
    const match = legacyBody.indexOf(payload, cursor);
    assert.ok(match >= cursor, `${sourcePath} does not occur in legacy runtime order.`);
    assert.match(
      legacyBody.slice(cursor, match),
      /^\s*$/,
      `${sourcePath} is separated from the previous source segment by non-whitespace legacy bytes.`
    );
    cursor = match + payload.length;
  }

  assert.match(
    legacyBody.slice(cursor),
    /^\s*$/,
    'Legacy runtime contains non-whitespace bytes after the final migration source segment.'
  );
});

test('assembly is deterministic and places verified dependency before DownloadConversation runtime', () => {
  const header = '// ==UserScript==\n// @run-at document-start\n// ==/UserScript==\n';
  const content = 'globalThis.AIConversationCore = {};\n';
  const dependency = {
    name: 'fixture-core',
    commit: '1'.repeat(40),
    url: `https://example.test/${'1'.repeat(40)}/fixture.js`,
    git_blob_sha1: 'b82dac162a42aa04170be5265afc69061dc0de30',
    byte_length: 36
  };
  const source = '\n(() => {\n  globalThis.downloadConversationLoaded = true;\n})();';
  const inputs = [{ manifest: dependency, content }];
  const first = assembleUserscript(header, inputs, source);
  const second = assembleUserscript(header, inputs, source);
  assert.equal(first, second);
  assert.ok(first.indexOf(content) < first.indexOf('downloadConversationLoaded'));
  assert.match(first, /BEGIN bundled fixture-core commit=/);
  assert.match(first, /\/\/ source https:\/\/example\.test\//);
  assert.doesNotMatch(first, /^\/\/ @require\b/m);
});

test('legacy monolith is retained only as a provenance fixture with its original Git blob identity', async () => {
  const manifest = await readUserscriptManifest(root);
  assert.equal(manifest.migration_source.git_blob_sha1, LEGACY_BLOB);
  assert.equal(manifest.migration_source.snapshot_commit, MIGRATION_SNAPSHOT_COMMIT);
  assert.match(manifest.migration_source.note, /not authoritative source/i);
  const fixture = await readFile(path.join(root, manifest.migration_source.path));
  assert.equal(gitBlobSha1(fixture), LEGACY_BLOB);
});
