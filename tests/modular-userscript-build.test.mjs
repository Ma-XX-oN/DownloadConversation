import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assembleUserscriptSource,
  orderedSourcePaths,
  readUserscriptManifest,
  validatePinnedDependencies
} from '../scripts/userscript-build-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyFixturePath = path.join(root, 'tests/fixtures/legacy-userscript-issue-135.3.user.js');
const verifiedSnapshotCommit = '62571e15af8f7f3e4472258e7a18bb2f2d48cef5';
const currentLegacyFixture = await readFile(legacyFixturePath, 'utf8');

function git(...args) {
  return execFileSync(
    'git',
    args,
    { cwd: root, encoding: 'utf8' }
  );
}

function gitBlobBytes(revision, filePath) {
  return execFileSync(
    'git',
    ['show', `${revision}:${filePath}`],
    { cwd: root }
  );
}

function gitBlobSha1(buffer) {
  return execFileSync(
    'git',
    ['hash-object', '--stdin'],
    { cwd: root, input: buffer, encoding: 'utf8' }
  ).trim();
}

test(
  'manifest groups ordered small source segments under logical modules',
  async () => {
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
        'workstack-continuation',
        'panel-launcher'
      ]
    );
    const workStackModule = manifest.modules.find(module => {
      return module.name === 'workstack-continuation';
    });
    assert.deepEqual(workStackModule?.files, [
      'src/userscript/06-workstack-continuation/01-state.js',
      'src/userscript/06-workstack-continuation/02-dom-extraction.js',
      'src/userscript/06-workstack-continuation/03-ui-control.js',
      'src/userscript/06-workstack-continuation/04-handoff-transaction.js'
    ]);
    const sourcePaths = orderedSourcePaths(manifest);
    const communicationModule = manifest.modules.find(module => {
      return module.name === 'network-communication';
    });
    assert.deepEqual(
      communicationModule?.files.slice(2, 10),
      [
        'src/userscript/02-network-communication/03-communication-lifecycle.js',
        'src/userscript/02-network-communication/06-segment-storage.js',
        'src/userscript/02-network-communication/06-segment-manifest.js',
        'src/userscript/01-runtime/03-conversation-identity.js',
        'src/userscript/02-network-communication/06-segment-recovery.js',
        'src/userscript/02-network-communication/06-segment-snapshot.js',
        'src/userscript/02-network-communication/06-segment-duplicate.js',
        'src/userscript/02-network-communication/04-communication-redaction.js'
      ],
      'identity and segment runtime must remain at verified top-level source boundaries'
    );
    assert.equal(sourcePaths.length, 60);
    assert.equal(new Set(sourcePaths).size, sourcePaths.length);
    assert.ok(sourcePaths.every(sourcePath => {
      return sourcePath.startsWith('src/userscript/');
    }));
    assert.ok(sourcePaths.every(sourcePath => {
      return !sourcePath.includes('/userscript-body/part-');
    }));
    for (const sourcePath of sourcePaths) {
      const info = await stat(path.join(root, sourcePath));
      assert.ok(
        info.isFile(),
        `${sourcePath} must be an authoritative source file`
      );
      assert.ok(
        info.size <= 16 * 1024,
        `${sourcePath} is too large for modular source (${info.size} bytes)`
      );
    }
  }
);

test('authoritative header preserves semver and document-start execution', async () => {
  const manifest = await readUserscriptManifest(root);
  const header = await readFile(path.join(root, manifest.header), 'utf8');
  assert.match(header, /^\/\/\s*@version\s+\d+\.\d+\.\d+(?:-issue\.\d+\.\d+)?$/m);
  assert.match(header, /^\/\/\s*@run-at\s+document-start$/m);
});

test('AIConversationCore build dependency uses exact pinned identity', async () => {
  const manifest = await readUserscriptManifest(root);
  const [dependency] = manifest.dependencies;
  assert.equal(dependency.name, 'AIConversationCore');
  assert.match(dependency.commit, /^[0-9a-f]{40}$/);
  assert.match(dependency.git_blob_sha1, /^[0-9a-f]{40}$/);
  assert.equal(Number.isInteger(dependency.byte_length), true);
  assert.ok(dependency.byte_length > 0);
  assert.equal(
    dependency.url,
    `https://raw.githubusercontent.com/Ma-XX-oN/AIConversationCore/${dependency.commit}/${dependency.path}`
  );
});

test('pinned dependency validation rejects changed bytes independently', async () => {
  const manifest = await readUserscriptManifest(root);
  const [dependency] = manifest.dependencies;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), dependency.url);
    return new Response('tampered dependency payload', { status: 200 });
  };
  try {
    await assert.rejects(
      validatePinnedDependencies(manifest),
      /failed (?:byte-length|Git blob SHA-1) validation/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ordered source preserves the userscript runtime IIFE boundary', async () => {
  const manifest = await readUserscriptManifest(root);
  const sourcePaths = orderedSourcePaths(manifest);
  const first = await readFile(path.join(root, sourcePaths[0]), 'utf8');
  const last = await readFile(path.join(root, sourcePaths.at(-1)), 'utf8');
  assert.match(first, /^\(function\(\)\s*\{/);
  assert.match(last, /\}\)\(\);\s*$/);
});

test('verified #150 snapshot preserves legacy runtime bytes in source order', async () => {
  const manifest = await readUserscriptManifest(root);
  const snapshotSource = gitBlobBytes(
    verifiedSnapshotCommit,
    'chatgpt-conversation-markdown-export.user.js'
  ).toString('utf8');
  const assembled = await assembleUserscriptSource(root, manifest);
  const header = await readFile(path.join(root, manifest.header), 'utf8');
  const dependencyMarker = '// BEGIN PINNED DEPENDENCY: AIConversationCore';
  const snapshotDependencyStart = snapshotSource.indexOf(dependencyMarker);
  const snapshotRuntimeStart = snapshotSource.indexOf('(function() {');
  assert.ok(snapshotDependencyStart >= 0);
  assert.ok(snapshotRuntimeStart > snapshotDependencyStart);
  const snapshotDependency = snapshotSource.slice(snapshotDependencyStart, snapshotRuntimeStart);
  const assembledDependencyStart = assembled.indexOf(dependencyMarker);
  const assembledRuntimeStart = assembled.indexOf('(function() {');
  assert.ok(assembledDependencyStart >= 0);
  assert.ok(assembledRuntimeStart > assembledDependencyStart);
  const assembledDependency = assembled.slice(assembledDependencyStart, assembledRuntimeStart);
  assert.equal(assembledDependency, snapshotDependency);
  assert.equal(assembled.slice(assembledRuntimeStart), snapshotSource.slice(snapshotRuntimeStart));
  assert.equal(assembled.slice(0, assembledDependencyStart), header);
});

test('assembled communication startup resolves the segment runtime contract', async () => {
  const manifest = await readUserscriptManifest(root);
  const assembled = await assembleUserscriptSource(root, manifest);
  const storageIndex = assembled.indexOf('function communicationLogEnsureSegmentRuntime');
  const lifecycleIndex = assembled.indexOf('async function communicationLogEnsureOpenWriter');
  assert.ok(storageIndex >= 0, 'segment storage runtime must be assembled');
  assert.ok(lifecycleIndex > storageIndex, 'lifecycle writer must assemble after segment storage runtime');
});

test('assembly is deterministic and places dependency before DC runtime', async () => {
  const manifest = await readUserscriptManifest(root);
  const first = await assembleUserscriptSource(root, manifest);
  const second = await assembleUserscriptSource(root, manifest);
  assert.equal(first, second);
  const dependencyIndex = first.indexOf('// BEGIN PINNED DEPENDENCY: AIConversationCore');
  const runtimeIndex = first.indexOf('(function() {');
  assert.ok(dependencyIndex >= 0);
  assert.ok(runtimeIndex > dependencyIndex);
});

test('legacy monolith remains provenance-only with original Git blob', async () => {
  const manifest = await readUserscriptManifest(root);
  assert.equal(
    manifest.migration_source.path,
    'tests/fixtures/legacy-userscript-issue-135.3.user.js'
  );
  const currentBlob = gitBlobSha1(Buffer.from(currentLegacyFixture));
  assert.equal(currentBlob, manifest.migration_source.git_blob_sha1);
  const historicalBlob = gitBlobSha1(gitBlobBytes(
    manifest.migration_source.snapshot_commit,
    manifest.migration_source.path
  ));
  assert.equal(historicalBlob, manifest.migration_source.git_blob_sha1);
  assert.equal(git('status', '--porcelain', '--', manifest.migration_source.path), '');
});
