import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');
const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const coreIntegration = await readFile(new URL('./core-integration.test.mjs', import.meta.url), 'utf8');
const phase5Integration = await readFile(new URL('./phase5-rich-core-integration.test.mjs', import.meta.url), 'utf8');
const sedimentResolver = await readFile(new URL('./sediment-resolver.test.mjs', import.meta.url), 'utf8');

const OLD_CORE_COMMIT = 'd6d76b54db3d48baf3f5e3a76099be1732d32785';
const CORE_COMMIT = 'cf34d9374f51ac525acfb90cfd6b247006a7bf6e';

function pinnedCoreUrl() {
  const match = userscript.match(/^\/\/ @require\s+(https:\/\/raw\.githubusercontent\.com\/Ma-XX-oN\/AIConversationCore\/([0-9a-f]{40})\/dist\/aiconversationcore\.chatgpt\.browser\.js)$/m);
  assert.ok(match, 'Production userscript must pin AIConversationCore to an exact commit.');
  assert.equal(match[2], CORE_COMMIT);
  return match[1];
}

test('DownloadConversation keeps one caller-version authority in userscript metadata', () => {
  const metadataVersion = userscript.match(/^\/\/ @version\s+(\S+)$/m);
  assert.ok(metadataVersion, 'Userscript metadata version is missing.');
  assert.match(userscript, /const VERSION = \(typeof GM_info !== 'undefined' && GM_info\?\.script\?\.version\) \|\| 'unknown';/);
  assert.doesNotMatch(userscript, /const VERSION = ['"]\d/);
});

test('every configured DownloadConversation Core pin uses the verified versioned Core commit', () => {
  const pinnedConsumers = [
    ['userscript', userscript],
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

test('the actually pinned browser bundle reports Core 1.0.0', async () => {
  const response = await fetch(pinnedCoreUrl());
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
