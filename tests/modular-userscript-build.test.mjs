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

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const CORE_COMMIT =
  '488a2f633910b7ad26e8a89d0e6621d9961f785a';
const CORE_BLOB =
  'fcd0fc12c7220257d813c7c0c893426d08437f06';
const PLUGIN_COMMIT =
  '24fdd9ad5bd89568aafe3a123100ff37a45951d6';
const PLUGIN_BLOB =
  'bfe6cac52b5e0c3679c6ef985dff7043abd7ae29';
const LEGACY_BLOB =
  '44a4ab373a6515caed5527aeb19cbdff7ce91e07';
const MIGRATION_SNAPSHOT_COMMIT =
  '62571e15af8f7f3e4472258e7a18bb2f2d48cef5';
const USER_SCRIPT_HEADER_END = '// ==/UserScript==\n';

function readSnapshotFile(commit, sourcePath) {
  return execFileSync(
    'git',
    ['show', `${commit}:${sourcePath}`],
    { cwd: root, encoding: 'utf8' }
  );
}

test(
  'manifest groups ordered small source segments under logical modules',
  async () => {
    const manifest = await readUserscriptManifest(root);
    assert.equal(manifest.format_version, 3);
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
    assert.equal(sourcePaths.length, 63);
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
        info.size > 0 && info.size < 16 * 1024,
        `${sourcePath} is not a small source segment.`
      );
    }
  }
);

test(
  'authoritative header preserves semver and document-start execution',
  async () => {
    const manifest = await readUserscriptManifest(root);
    const header = await readUserscriptHeader(root, manifest);
    assert.match(header, /^\/\/ ==UserScript==\n/);
    assert.match(
      header,
      /^\/\/ @version\s+\d+\.\d+\.\d+(?:-issue\.\d+\.\d+)?$/m
    );
    assert.match(header, /^\/\/ @run-at\s+document-start$/m);
    assert.doesNotMatch(header, /^\/\/ @require\b/m);
    assert.match(header, /\/\/ ==\/UserScript==\n$/);
  }
);

test(
  'AIConversationCore build dependency uses exact issue-qualified pinned identity',
  async () => {
    const manifest = await readUserscriptManifest(root);
    assert.equal(manifest.dependencies.length, 1);
    const [dependency] = manifest.dependencies;
    assert.equal(dependency.name, 'AIConversationCore');
    assert.equal(dependency.ref, 'v1.1.0-issue.104.8');
    assert.equal(dependency.commit, CORE_COMMIT);
    assert.equal(dependency.git_blob_sha1, CORE_BLOB);
    assert.equal(dependency.byte_length, 279239);
    assert.equal(
      dependency.repository,
      'Ma-XX-oN/AIConversationCore'
    );
    assert.equal(
      dependency.path,
      'dist/aiconversationcore.chatgpt.browser.js'
    );
    assert.ok(dependency.url.includes(`/${CORE_COMMIT}/`));
  }
);

test(
  'ChatGPT agent plugin build dependency preserves symbolic ref plus exact resolved bytes',
  async () => {
    const manifest = await readUserscriptManifest(root);
    assert.equal(manifest.agent_plugins.length, 1);
    const [plugin] = manifest.agent_plugins;
    assert.equal(plugin.id, 'chatgpt-web');
    assert.equal(plugin.repository, 'Ma-XX-oN/Chat-Gpt-Plugin-2');
    assert.equal(plugin.ref, 'issue-1-chatgpt-agent-plugin');
    assert.equal(plugin.commit, PLUGIN_COMMIT);
    assert.equal(plugin.version, '0.1.0-issue.1.7');
    assert.equal(plugin.api_version, 1);
    assert.equal(plugin.path, 'dist/chatgpt-plugin.mjs');
    assert.equal(plugin.git_blob_sha1, PLUGIN_BLOB);
    assert.equal(plugin.byte_length, 50206);
    assert.ok(plugin.url.includes(`/${PLUGIN_COMMIT}/`));
  }
);

test(
  'pinned dependency validation rejects changed bytes independently',
  () => {
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
      () => validatePinnedDependency(
        { ...dependency, git_blob_sha1: '0'.repeat(40) },
        content
      ),
      /Git blob mismatch/
    );
  }
);

test(
  'ordered source preserves the userscript runtime IIFE boundary',
  async () => {
    const manifest = await readUserscriptManifest(root);
    const source = await readDownloadConversationSource(root, manifest);
    assert.ok(source.startsWith("\n(() => {\n  'use strict';"));
    assert.ok(source.endsWith('})();'));
    assert.match(
      source,
      /const CORE_VERSION = canonicalCore\(\)\.getVersion\(\);/
    );
  }
);

test(
  'verified #150 snapshot preserves legacy runtime bytes in source order',
  async () => {
    const manifest = await readUserscriptManifest(root);
    assert.equal(
      manifest.migration_source.snapshot_commit,
      MIGRATION_SNAPSHOT_COMMIT
    );

    const snapshotManifest = JSON.parse(
      readSnapshotFile(
        MIGRATION_SNAPSHOT_COMMIT,
        'src/userscript-manifest.json'
      )
    );
    assert.equal(
      snapshotManifest.migration_source.git_blob_sha1,
      LEGACY_BLOB
    );

    const fixture = await readFile(
      path.join(root, manifest.migration_source.path),
      'utf8'
    );
    const headerEnd = fixture.indexOf(USER_SCRIPT_HEADER_END);
    assert.ok(
      headerEnd >= 0,
      'Legacy fixture userscript metadata terminator is missing.'
    );
    const legacyBody = fixture.slice(
      headerEnd + USER_SCRIPT_HEADER_END.length
    );
    let cursor = 0;

    for (const sourcePath of orderedSourcePaths(snapshotManifest)) {
      const segment = readSnapshotFile(
        MIGRATION_SNAPSHOT_COMMIT,
        sourcePath
      );
      const payload = segment.trim();
      assert.ok(
        payload,
        `${sourcePath} contains no non-whitespace source bytes.`
      );
      const match = legacyBody.indexOf(payload, cursor);
      assert.ok(
        match >= cursor,
        `${sourcePath} does not occur in legacy runtime order.`
      );
      assert.match(
        legacyBody.slice(cursor, match),
        /^\s*$/,
        `${sourcePath} has non-whitespace bytes before its segment.`
      );
      cursor = match + payload.length;
    }

    assert.match(
      legacyBody.slice(cursor),
      /^\s*$/,
      'Legacy runtime has bytes after the final migration segment.'
    );
  }
);


test(
  'assembled communication startup resolves the segment runtime contract',
  async () => {
    const manifest = await readUserscriptManifest(root);
    const built = await readDownloadConversationSource(root, manifest);
    const activation = built.indexOf(
      'async function communicationLogActivateDirectory(handle)'
    );
    const initializer = built.indexOf(
      'async function communicationLogInitializeSegmentStorage()'
    );
    const redaction = built.indexOf(
      'function communicationLogCreateRedactionState()'
    );
    assert.ok(activation >= 0, 'assembled activation function must exist');
    assert.ok(initializer >= 0, 'assembled segment initializer must exist');
    assert.ok(redaction > initializer, 'verified top-level boundary must follow initializer');

    const activationSource = built.slice(
      activation,
      built.indexOf(
        'function communicationLogDisarmDirectoryGesture()',
        activation
      )
    );
    assert.match(
      activationSource,
      /typeof communicationLogInitializeSegmentStorage/
    );
    assert.match(
      activationSource,
      /await communicationLogInitializeSegmentStorage\(\)/
    );

    const initializerSource = built.slice(
      initializer,
      redaction
    );
    assert.match(
      initializerSource,
      /getDirectoryHandle\(\s*directoryName,\s*\{ create: true \}\s*\)/s
    );

    const probeSource = [
      'return (() => {',
      activationSource,
      initializerSource,
      'return {',
      '  initializerType: typeof communicationLogInitializeSegmentStorage,',
      '  activationType: typeof communicationLogActivateDirectory',
      '};',
      '})();'
    ].join('\n');
    const probe = Function(probeSource)();
    assert.equal(probe.initializerType, 'function');
    assert.equal(probe.activationType, 'function');
  }
);

test(
  'assembly is deterministic and places dependency before DC runtime',
  () => {
    const header = [
      '// ==UserScript==',
      '// @run-at document-start',
      '// ==/UserScript==',
      ''
    ].join('\n');
    const content = 'globalThis.AIConversationCore = {};\n';
    const dependency = {
      name: 'fixture-core',
      commit: '1'.repeat(40),
      url: `https://example.test/${'1'.repeat(40)}/fixture.js`,
      git_blob_sha1: 'b82dac162a42aa04170be5265afc69061dc0de30',
      byte_length: 36
    };
    const source = [
      '',
      '(() => {',
      '  globalThis.downloadConversationLoaded = true;',
      '})();'
    ].join('\n');
    const inputs = [{ manifest: dependency, content }];
    const first = assembleUserscript(header, inputs, source);
    const second = assembleUserscript(header, inputs, source);
    assert.equal(first, second);
    assert.ok(
      first.indexOf(content) <
      first.indexOf('downloadConversationLoaded')
    );
    assert.match(first, /BEGIN bundled fixture-core commit=/);
    assert.match(first, /\/\/ source https:\/\/example\.test\//);
    assert.doesNotMatch(first, /^\/\/ @require\b/m);
  }
);

test(
  'legacy monolith remains provenance-only with original Git blob',
  async () => {
    const manifest = await readUserscriptManifest(root);
    assert.equal(
      manifest.migration_source.git_blob_sha1,
      LEGACY_BLOB
    );
    assert.equal(
      manifest.migration_source.snapshot_commit,
      MIGRATION_SNAPSHOT_COMMIT
    );
    assert.match(
      manifest.migration_source.note,
      /not authoritative source/i
    );
    const fixture = await readFile(
      path.join(root, manifest.migration_source.path)
    );
    assert.equal(gitBlobSha1(fixture), LEGACY_BLOB);
  }
);
