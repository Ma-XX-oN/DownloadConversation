import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { coreBundle } from './helpers/core-bundle.mjs';
import { chatGPTPluginArtifact } from './helpers/agent-plugin-pin.mjs';

const bridgeSource = await readFile(
  new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url),
  'utf8'
);
const readinessSource = await readFile(
  new URL('../src/userscript/06-image-export-tests/06-agent-plugin-readiness.js', import.meta.url),
  'utf8'
);

const coreContext = { URL };
coreContext.globalThis = coreContext;
vm.runInNewContext(coreBundle, coreContext, { filename: 'aiconversationcore.chatgpt.browser.js' });
const core = coreContext.AIConversationCore;
assert.equal(typeof core?.loadAgent, 'function');
assert.equal(typeof core?.getAgentPluginArtifact, 'function');
assert.equal(typeof core?.adaptChatGPTRecords, 'function');
assert.equal(typeof core?.renderCanonicalMarkdown, 'function');
assert.equal(typeof core?.projectCanonicalConversation, 'function');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function textRecord(id, role, text) {
  return {
    id,
    author: { role, name: null, metadata: {} },
    create_time: null,
    update_time: null,
    content: { content_type: 'text', parts: [text] },
    metadata: {},
    recipient: 'all',
    channel: role === 'assistant' ? 'final' : null,
    status: 'finished_successfully',
    end_turn: role === 'assistant'
  };
}

function contractEvent(record, sourceIndex) {
  return {
    id: `fixture:${record.id}`,
    kind: 'message',
    role: record.author.role,
    blocks: [{ type: 'text', text: record.content.parts[0] }],
    source_record_id: record.id,
    source_index: sourceIndex,
    source: {
      record_id: record.id,
      record_index: sourceIndex,
      turn_id: record.id,
      create_time: null,
      update_time: null
    }
  };
}

const contractPluginModule = {
  default: {
    id: 'chatgpt-web',
    apiVersion: 1,
    create(context = {}) {
      let records = [];
      return {
        async sendMessage() {
          return null;
        },
        async getResponse() {
          return null;
        },
        getTurns(query = {}) {
          return context.core.deriveTurns(records.map(contractEvent), query);
        },
        currentState() {
          return { record_count: records.length };
        },
        observeState() {
          return () => {};
        },
        commTraffic(data) {
          if (data?.type !== 'persisted_records') return;
          records = Array.isArray(data.records) ? data.records.slice() : [];
          context.core.publishEvents(records.map(contractEvent));
        },
        version() {
          return {
            plugin: 'chatgpt-web',
            version: chatGPTPluginArtifact.version,
            apiVersion: chatGPTPluginArtifact.apiVersion,
            ref: chatGPTPluginArtifact.ref
          };
        }
      };
    }
  }
};

test('AICC owns the complete artifact identity used by DC transport', () => {
  assert.equal(chatGPTPluginArtifact.id, 'chatgpt-web');
  assert.equal(chatGPTPluginArtifact.ref, 'main');
  assert.match(chatGPTPluginArtifact.commit, /^[0-9a-f]{40}$/);
  assert.match(chatGPTPluginArtifact.gitBlobSha1, /^[0-9a-f]{40}$/);
  assert.ok(Number.isSafeInteger(chatGPTPluginArtifact.byteLength));
  assert.equal(chatGPTPluginArtifact.apiVersion, 1);
  assert.equal(Object.hasOwn(chatGPTPluginArtifact, 'source_base64'), false);
});

test('Core loadAgent owns registration and complete persisted-inventory replacement', async () => {
  let transported = null;
  const loaded = await core.loadAgent('chatgpt-web', {
    async loadModule(artifact) {
      transported = artifact;
      return contractPluginModule;
    }
  });
  assert.deepEqual(plain(transported), plain(chatGPTPluginArtifact));
  const { agent, session } = loaded;
  assert.ok(session, 'Core did not retain a canonical session for the loaded agent.');

  const first = [
    textRecord('u1', 'user', 'Question'),
    textRecord('a1', 'assistant', 'Answer')
  ];
  const second = [
    textRecord('u9', 'user', 'Replacement question'),
    textRecord('a9', 'assistant', 'Replacement answer')
  ];
  agent.commTraffic({ type: 'persisted_records', records: first });
  assert.deepEqual(plain(session.events), plain(first.map(contractEvent)));
  agent.commTraffic({ type: 'persisted_records', records: second });
  assert.deepEqual(plain(session.events), plain(second.map(contractEvent)));
  assert.deepEqual(
    plain(session.events.map(event => event.source_record_id)),
    ['u9', 'a9'],
    'Events from the previous complete provider inventory must not survive replacement.'
  );
});

test('DC production bridge delegates agent orchestration to AICC with no direct adapter fallback', () => {
  assert.doesNotMatch(bridgeSource, /adaptChatGPTRecords/,
    'Production bridge must not call the legacy Core ChatGPT adapter.');
  assert.match(bridgeSource, /await core\.loadAgent\('chatgpt-web'/);
  assert.doesNotMatch(bridgeSource, /new core\.AgentPluginRegistry/);
  assert.doesNotMatch(bridgeSource, /\.registerModule\(/);
  assert.match(bridgeSource,
    /canonicalEventsBySourceRecord = function canonicalEventsBySourceRecordViaAgent/);
  assert.match(bridgeSource,
    /canonicalImageResourcesByRecordAndPart = function canonicalImageResourcesViaAgent/);
  assert.match(bridgeSource, /chatGPTAgent\.commTraffic\(\{ type: 'persisted_records', records \}\)/);
  assert.doesNotMatch(bridgeSource, /fallback/i,
    'Production registered-agent bridge must not introduce an implicit fallback path.');
  assert.match(readinessSource, /await ensureChatGPTCanonicalAgent\(\)/);
  assert.match(readinessSource, /return runExportWithCanonicalAgent\(kinds, options\)/);
  assert.match(readinessSource, /return runOneTestWithCanonicalAgent\(name, fn\)/);
  assert.match(readinessSource, /return runTestsWithCanonicalAgent\(\)/);
});

test('cache miss opens the GitHub broker before its first asynchronous wait and failures are visible', () => {
  const loadStart = bridgeSource.indexOf('  async function loadAgentPlugin(descriptor) {');
  const loadEnd = bridgeSource.indexOf('\n  /**\n   * Imports one AICC-selected ESM artifact', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart,
    'Could not isolate the production plugin loading function.');
  const loadSource = bridgeSource.slice(loadStart, loadEnd);
  const cacheReadAt = loadSource.indexOf('const cachedSource = cachedAgentPluginSource(descriptor);');
  const brokerRequestAt = loadSource.indexOf(
    'const brokerSourcePromise = requestAgentPluginFromGitHub(descriptor);'
  );
  const cacheMissAwaitAt = loadSource.indexOf('await ', brokerRequestAt);
  assert.ok(cacheReadAt >= 0 && brokerRequestAt > cacheReadAt,
    'Production loader must synchronously inspect the cache before requesting GitHub.');
  assert.ok(cacheMissAwaitAt > brokerRequestAt,
    'A cache miss must request/open the GitHub broker before that path first waits asynchronously.');
  assert.doesNotMatch(loadSource, /await cachedAgentPluginSource/,
    'Cache lookup must remain synchronous on the first-use broker path.');

  assert.match(bridgeSource, /chatGPTPluginModulePromise = null;\n      throw error;/,
    'A failed first load must be retryable without reloading the ChatGPT page.');
  assert.match(readinessSource, /agent-plugin-readiness-failure/,
    'Plugin readiness failures must be recorded in diagnostics.');
  assert.match(readinessSource, /setStatus\(`Export setup failed: \$\{message\}`\)/,
    'Plugin readiness failures must be visible in the recorder status UI.');
});
