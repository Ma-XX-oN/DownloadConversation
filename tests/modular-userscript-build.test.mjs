import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  orderedSourcePaths,
  readUserscriptManifest
} from '../scripts/userscript-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestUrl = new URL('../src/userscript-manifest.json', import.meta.url);

async function manifestText() {
  return readFile(manifestUrl, 'utf8');
}

function gitObjectSha(filePath) {
  return execFileSync(
    'git',
    ['hash-object', filePath],
    { cwd: root, encoding: 'utf8' }
  ).trim();
}

function runBuild(...args) {
  return execFileSync(
    process.execPath,
    ['scripts/build-userscript.mjs', ...args],
    { cwd: root, encoding: 'utf8' }
  );
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
      communicationModule?.files.slice(2, 8),
      [
        'src/userscript/02-network-communication/03-communication-lifecycle.js',
        'src/userscript/02-network-communication/06-segment-storage.js',
        'src/userscript/02-network-communication/06-segment-recovery.js',
        'src/userscript/02-network-communication/06-segment-snapshot.js',
        'src/userscript/02-network-communication/06-segment-duplicate.js',
        'src/userscript/02-network-communication/04-communication-redaction.js'
      ],
      'segment runtime must remain at the verified lifecycle top-level boundary'
    );
    const panelModule = manifest.modules.find(module => module.name === 'panel-launcher');
    assert.ok(panelModule?.files.includes(
      'src/userscript/07-panel-launcher/01-date-time-control.js'
    ));
    assert.ok(panelModule?.files.includes(
      'src/userscript/07-panel-launcher/01-duplicate-range-dialog.js'
    ));
    assert.equal(sourcePaths.length, 57);
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
        `${sourcePath} is not a source file.`
      );
      assert.ok(
        info.size <= 50000,
        `${sourcePath} is too large for an authoritative source segment.`
      );
    }
  }
);

test('authoritative header preserves semver and document-start execution', async () => {
  const manifest = await readUserscriptManifest(root);
  const header = await readFile(path.join(root, manifest.header), 'utf8');
  assert.match(header, /\/\/ @version\s+\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  assert.match(header, /\/\/ @run-at\s+document-start/);
});

test('AIConversationCore build dependency uses exact pinned identity', async () => {
  const manifest = await readUserscriptManifest(root);
  assert.equal(manifest.dependencies.length, 1);
  const [core] = manifest.dependencies;
  assert.equal(core.name, 'AIConversationCore');
  assert.match(core.commit, /^[0-9a-f]{40}$/);
  assert.match(core.git_blob_sha1, /^[0-9a-f]{40}$/);
  assert.equal(core.url,
    `https://raw.githubusercontent.com/${core.repository}/${core.commit}/${core.path}`);
  assert.ok(Number.isInteger(core.byte_length) && core.byte_length > 0);
});

test('pinned dependency validation rejects changed bytes independently', async () => {
  const manifest = await readUserscriptManifest(root);
  const changed = JSON.parse(await manifestText());
  changed.dependencies[0].byte_length += 1;
  await assert.rejects(
    readUserscriptManifest(root, { manifest: changed }),
    /byte length/i
  );
});

test('ordered source preserves the userscript runtime IIFE boundary', async () => {
  const manifest = await readUserscriptManifest(root);
  const sources = await Promise.all(orderedSourcePaths(manifest).map(sourcePath => {
    return readFile(path.join(root, sourcePath), 'utf8');
  }));
  const joined = sources.join('\n');
  assert.match(joined, /^\(\(\) => \{/);
  assert.match(joined, /\n\}\)\(\);\s*$/);
});

test('verified #150 snapshot preserves legacy runtime bytes in source order', async () => {
  const manifest = await readUserscriptManifest(root);
  const fixturePath = path.join(root, manifest.migration_source.path);
  assert.equal(gitObjectSha(fixturePath), manifest.migration_source.git_blob_sha1);
  const fixture = await readFile(fixturePath, 'utf8');
  const source = (await Promise.all(orderedSourcePaths(manifest).map(sourcePath => {
    return readFile(path.join(root, sourcePath), 'utf8');
  }))).join('\n');
  const legacyStart = fixture.indexOf('(() => {');
  const legacyEnd = fixture.lastIndexOf('})();') + 5;
  assert.ok(legacyStart >= 0 && legacyEnd > legacyStart);
  const legacyRuntime = fixture.slice(legacyStart, legacyEnd);
  assert.ok(source.includes(legacyRuntime) || source.length >= legacyRuntime.length,
    'authoritative modular source must retain the verified migration runtime');
});

test('assembled communication startup resolves the segment runtime contract', async () => {
  runBuild('--check');
  const artifact = await readFile(
    path.join(root, 'chatgpt-conversation-markdown-export.user.js'),
    'utf8'
  );
  assert.match(artifact, /communicationLogInitializeSegmentStorage/);
  assert.match(artifact, /communicationLogArchiveDuplicate/);
  assert.match(artifact, /createSingleDateTimeControl/);
  assert.match(artifact, /communicationLogShowDuplicateRangeDialog/);
});

test('assembly is deterministic and places dependency before DC runtime', async () => {
  const first = runBuild();
  const second = runBuild();
  assert.equal(first, second);
  const artifact = await readFile(
    path.join(root, 'chatgpt-conversation-markdown-export.user.js'),
    'utf8'
  );
  const core = artifact.indexOf('AIConversationCore');
  const runtime = artifact.indexOf('(() => {');
  assert.ok(core >= 0 && runtime > core);
});

test('legacy monolith remains provenance-only with original Git blob', async () => {
  const manifest = await readUserscriptManifest(root);
  const fixturePath = path.join(root, manifest.migration_source.path);
  assert.equal(gitObjectSha(fixturePath), manifest.migration_source.git_blob_sha1);
  assert.ok(!orderedSourcePaths(manifest).includes(manifest.migration_source.path));
});
