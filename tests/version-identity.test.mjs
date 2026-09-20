import { coreDependency, coreUrl } from './helpers/core-pin.mjs';
import { userscript } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const coreIntegration = await readFile(new URL('./core-integration.test.mjs', import.meta.url), 'utf8');
const phase5Integration = await readFile(new URL('./phase5-rich-core-integration.test.mjs', import.meta.url), 'utf8');
const sedimentResolver = await readFile(new URL('./sediment-resolver.test.mjs', import.meta.url), 'utf8');

const OLD_CORE_COMMIT = 'd6d76b54db3d48baf3f5e3a76099be1732d32785';
const CORE_COMMIT = 'cf34d9374f51ac525acfb90cfd6b247006a7bf6e';
const CORE_BLOB_SHA1 = '5a999c8c02f127b4fc03b923a40496961c9cacc0';

test('DownloadConversation keeps one caller-version authority in userscript metadata and shows it at the top of general status', () => {
  const metadataVersion = userscript.match(/^\/\/ @version\s+(\S+)$/m);
  assert.ok(metadataVersion, 'Userscript metadata version is missing.');
  assert.match(userscript, /const VERSION = \(typeof GM_info !== 'undefined' && GM_info\?\.script\?\.version\) \|\| 'unknown';/);
  assert.doesNotMatch(userscript, /const VERSION = ['"]\d/);
  assert.match(
    userscript,
    /if \(title\) title\.textContent = `ChatGPT Recorder v\$\{VERSION\}`;/,
    'General status title must show the authoritative caller version at the top.'
  );
});

test('build manifest is the Core pin authority and generated userscript embeds that exact dependency without @require', () => {
  assert.equal(coreDependency.commit, CORE_COMMIT);
  assert.equal(coreDependency.git_blob_sha1, CORE_BLOB_SHA1);
  assert.equal(coreUrl, coreDependency.url);
  assert.equal(coreUrl.includes(`/${CORE_COMMIT}/dist/aiconversationcore.chatgpt.browser.js`), true);
  assert.doesNotMatch(userscript, /^\/\/ @require\s+/m,
    'Generated userscript must not load AIConversationCore through runtime @require.');
  assert.match(
    userscript,
    new RegExp(`^// BEGIN bundled AIConversationCore commit=${CORE_COMMIT} blob=${CORE_BLOB_SHA1}$`, 'm'),
    'Generated userscript must record the exact build-time Core commit and blob provenance.'
  );

  const pinnedConsumers = [
    ['CI', ci],
    ['core integration', coreIntegration],
    ['phase 5 integration', phase5Integration],
    ['sediment resolver', sedimentResolver]
  ];
  for (const [name, source] of pinnedConsumers) {
    assert.equal(source.includes(OLD_CORE_COMMIT), false, `${name} still pins the pre-version-API Core commit.`);
    assert.equal(source.includes(CORE_COMMIT), true, `${name} does not pin the verified Core 1.0.0 commit.`);
  }
});

test('the manifest-pinned browser bundle reports Core 1.0.0', async () => {
  const response = await fetch(coreUrl);
  assert.equal(response.status, 200, `Could not load pinned AIConversationCore bundle: HTTP ${response.status}`);
  const bundle = await response.text();
  const context = { URL };
  context.globalThis = context;
  vm.runInNewContext(bundle, context, { filename: 'aiconversationcore.chatgpt.browser.js' });
  assert.equal(typeof context.AIConversationCore?.getVersion, 'function');
  assert.equal(context.AIConversationCore.getVersion(), '1.0.0');
});

test('runtime diagnostics derive and report both caller and Core semantic versions', () => {
  assert.match(userscript, /const CORE_VERSION = canonicalCore\(\)\.getVersion\(\);/);
  assert.match(userscript, /typeof core\.getVersion === 'function'/);
  assert.match(userscript, /logDiagnostic\('debug', 'recorder-panel-created', \{\s*script_version: VERSION,\s*core_version: CORE_VERSION\s*\}\);/s);
  assert.match(userscript, /\[DownloadConversation v\$\{VERSION\} \| AIConversationCore v\$\{CORE_VERSION\}\] bootstrap/);
  assert.doesNotMatch(userscript, /(?:const CORE_VERSION\s*=|core_version:\s*)['"]1\.0\.0['"]/);
});
