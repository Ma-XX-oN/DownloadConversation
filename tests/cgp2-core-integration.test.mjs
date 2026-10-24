import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { coreBundle } from './helpers/core-bundle.mjs';


const bridgeSource = await readFile(
  new URL('../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url),
  'utf8'
);
const readinessSource = await readFile(
  new URL('../src/userscript/06-image-export-tests/06-agent-plugin-readiness.js', import.meta.url),
  'utf8'
);

const coreContext = { URL, setTimeout, clearTimeout };
coreContext.globalThis = coreContext;
vm.runInNewContext(coreBundle, coreContext, { filename: 'aiconversationcore.chatgpt.browser.js' });
const core = coreContext.AIConversationCore;
assert.equal(typeof core?.createAgent, 'function');
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
    apiVersion: 1, name: 'Independent fixture', iconUrl: 'https://example.com/icon.png',
    recognize: input => input.provider === 'chatgpt',
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
            version: 'fixture-366',
            apiVersion: 1,
            ref: 'fixture'
          };
        }
      };
    }
  }
};

test('Core registration owns canonical session and persisted-inventory replacement', async () => {
  core.registerAgentPlugin(contractPluginModule.default);
  const loaded = core.createAgent('chatgpt-web');
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
  assert.match(bridgeSource, /core\.createAgent\(descriptor\.id/);
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

test('registration failures remain visible and no obsolete loader survives', () => {
  assert.doesNotMatch(bridgeSource, /ChatGPTWebAgentPlugin|loadAgent|getAgentPluginArtifact|setTimeout/);
  assert.match(readinessSource, /agent-plugin-readiness-failure/);
  assert.match(readinessSource, /Export setup failed:/);
});

test('production bridge publishes through the real registered Core session and preserves source/image identity', async () => {
  const host = {
    canonicalCore: () => core,
    assert: (ok, message) => assert.ok(ok, message),
    currentConversationId: () => null,
    logDiagnostic() {},
    canonicalEnrichRecoveredImages: event => event
  };
  vm.runInNewContext(bridgeSource + `
    this.ready = ensureChatGPTCanonicalAgent;
    this.events = canonicalEventsFromChatGPTAgent;
    this.byRecord = canonicalEventsBySourceRecord;
    this.images = canonicalImageResourcesByRecordAndPart;
  `, host);
  await host.ready();
  const records = [textRecord('bridge-u', 'user', 'Question'),
    textRecord('bridge-a', 'assistant', 'Answer')];
  assert.deepEqual([...host.byRecord(records).keys()], ['bridge-u', 'bridge-a']);
  assert.deepEqual(plain(host.events(records)), plain(records.map(contractEvent)));
  assert.equal(host.images(records).size, 0);
  assert.deepEqual(plain(host.events([records[1]]).map(event => event.source_record_id)),
    ['bridge-a'], 'Prior inventory must not survive production bridge replacement.');
});
