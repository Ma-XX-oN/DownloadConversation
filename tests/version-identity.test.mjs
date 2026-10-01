import { coreBundle } from './helpers/core-bundle.mjs';
import { coreDependency, coreSourceUrl } from './helpers/core-pin.mjs';
import { chatGPTPluginArtifact, chatGPTPluginPin } from './helpers/agent-plugin-pin.mjs';
import { downloadConversationSource, userscript } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const ciEnvironment = await readFile(new URL('../scripts/ci-environment.mjs', import.meta.url), 'utf8');
const coreIntegration = await readFile(new URL('./core-integration.test.mjs', import.meta.url), 'utf8');
const phase5Integration = await readFile(new URL('./phase5-rich-core-integration.test.mjs', import.meta.url), 'utf8');
const sedimentResolver = await readFile(new URL('./sediment-resolver.test.mjs', import.meta.url), 'utf8');

const OLD_CORE_COMMIT = '1b531a1c92adfa1695db8c644159054e013f0a72';
const CORE_COMMIT = '488a2f633910b7ad26e8a89d0e6621d9961f785a';
const CORE_BLOB_SHA1 = 'fcd0fc12c7220257d813c7c0c893426d08437f06';
const CORE_VERSION = '1.1.0-issue.104.8';
const PLUGIN_COMMIT = '958a163a3d60be42c98b0197bf85202ff717384f';
const PLUGIN_BLOB_SHA1 = 'f29805c7f8d0393f588aacf22661f667b11f8cfa';
const PLUGIN_VERSION = '0.1.0-issue.1.9';

test('DownloadConversation keeps one caller-version authority in userscript metadata and shows it at the top of general status', () => {
  const metadataVersion = userscript.match(/^\/\/ @version\s+(\S+)$/m);
  assert.ok(metadataVersion, 'Userscript metadata version is missing.');
  assert.match(downloadConversationSource, /const VERSION = \(typeof GM_info !== 'undefined' && GM_info\?\.script\?\.version\) \|\| 'unknown';/);
  assert.doesNotMatch(downloadConversationSource, /const VERSION = ['"]\d/);
  assert.match(
    downloadConversationSource,
    /if \(title\) title\.textContent = `ChatGPT Recorder v\$\{VERSION\}`;/,
    'General status title must show the authoritative caller version at the top.'
  );
});

test('build manifest is the issue-qualified Core and ChatGPT plugin pin authority', () => {
  assert.equal(coreDependency.commit, CORE_COMMIT);
  assert.equal(coreDependency.git_blob_sha1, CORE_BLOB_SHA1);
  assert.equal(coreDependency.ref, 'v1.1.0-issue.104.8');
  assert.equal(coreSourceUrl, coreDependency.url);
  assert.equal(coreSourceUrl.includes(`/${CORE_COMMIT}/dist/aiconversationcore.chatgpt.browser.js`), true);
  assert.equal(chatGPTPluginPin.commit, PLUGIN_COMMIT);
  assert.equal(chatGPTPluginPin.git_blob_sha1, PLUGIN_BLOB_SHA1);
  assert.equal(chatGPTPluginPin.ref, 'issue-1-chatgpt-agent-plugin');
  assert.equal(chatGPTPluginPin.version, PLUGIN_VERSION);
  assert.equal(chatGPTPluginArtifact.version, PLUGIN_VERSION);
  assert.doesNotMatch(userscript, /^\/\/ @require\s+/m,
    'Generated userscript must not load AIConversationCore or CGP2 through runtime @require.');
  assert.match(
    userscript,
    new RegExp(`^// BEGIN bundled AIConversationCore commit=${CORE_COMMIT} blob=${CORE_BLOB_SHA1}$`, 'm'),
    'Generated userscript must record the exact build-time Core commit and blob provenance.'
  );
  assert.match(userscript, /\/\/ BEGIN agent plugin descriptors/,
    'Generated userscript must contain the verified ChatGPT plugin descriptor table.');
  assert.doesNotMatch(userscript, /source_base64/,
    'Public generated userscript must not embed provider source bytes.');

  const pinnedConsumers = [
    ['CI environment', ciEnvironment],
    ['core integration', coreIntegration],
    ['phase 5 integration', phase5Integration],
    ['sediment resolver', sedimentResolver]
  ];
  for (const [name, source] of pinnedConsumers) {
    assert.equal(source.includes(OLD_CORE_COMMIT), false,
      `${name} still pins the previous Core commit.`);
    assert.equal(source.includes(CORE_COMMIT), true,
      `${name} does not pin the issue-qualified Core candidate.`);
  }
});

test('the committed manifest-pinned browser bundle reports the issue-qualified Core version', () => {
  const bundle = coreBundle;
  const context = { URL };
  context.globalThis = context;
  vm.runInNewContext(bundle, context, { filename: 'aiconversationcore.chatgpt.browser.js' });
  assert.equal(typeof context.AIConversationCore?.getVersion, 'function');
  assert.equal(context.AIConversationCore.getVersion(), CORE_VERSION);
  assert.equal(typeof context.AIConversationCore.AgentPluginRegistry, 'function');
});

test('runtime diagnostics derive and report caller and Core semantic versions', () => {
  assert.match(downloadConversationSource, /const CORE_VERSION = canonicalCore\(\)\.getVersion\(\);/);
  assert.match(downloadConversationSource, /typeof core\.getVersion === 'function'/);
  assert.match(downloadConversationSource, /logDiagnostic\('debug', 'recorder-panel-created', \{\s*script_version: VERSION,\s*core_version: CORE_VERSION\s*\}\);/s);
  assert.match(downloadConversationSource, /\[DownloadConversation v\$\{VERSION\} \| AIConversationCore v\$\{CORE_VERSION\}\] bootstrap/);
  assert.doesNotMatch(downloadConversationSource, /(?:const CORE_VERSION\s*=|core_version:\s*)['"]1\.1\.0-issue\.104\.8['"]/);
});
