import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { coreBundle } from './helpers/core-bundle.mjs';
import {
  chatGPTPluginArtifact,
  chatGPTPluginPin
} from './helpers/agent-plugin-pin.mjs';

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
assert.equal(typeof core?.AgentPluginRegistry, 'function');
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
        commTraffic(data) {
          if (data?.type !== 'persisted_records') return;
          records = Array.isArray(data.records) ? data.records.slice() : [];
          context.core.publishEvents(records.map(contractEvent));
        },
        currentState() {
          return { record_count: records.length };
        },
        getTurns(query = {}) {
          return context.core.deriveTurns(records.map(contractEvent), query);
        },
        version() {
          return {
            plugin: 'chatgpt-web',
            version: chatGPTPluginArtifact.version,
            api_version: 1,
            ref: chatGPTPluginArtifact.ref
          };
        }
      };
    }
  }
};

test('public descriptor identifies the exact verified issue-qualified CGP2 candidate', () => {
  assert.equal(chatGPTPluginPin.ref, 'issue-1-chatgpt-agent-plugin');
  assert.equal(chatGPTPluginPin.commit, '958a163a3d60be42c98b0197bf85202ff717384f');
  assert.equal(chatGPTPluginPin.git_blob_sha1, 'f29805c7f8d0393f588aacf22661f667b11f8cfa');
  assert.equal(chatGPTPluginPin.byte_length, 50204);
  assert.equal(chatGPTPluginPin.version, '0.1.0-issue.1.9');
  assert.equal(chatGPTPluginArtifact.api_version, 1);
  assert.equal(Object.hasOwn(chatGPTPluginArtifact, 'source_base64'), false);
});

test('Core-owned registered-agent session replaces complete persisted inventories', () => {
  const registry = new core.AgentPluginRegistry({ apiVersion: chatGPTPluginArtifact.api_version });
  registry.registerModule(contractPluginModule);
  const agent = registry.create('chatgpt-web', { ref: chatGPTPluginArtifact.ref });
  const session = registry.session(agent);
  assert.ok(session, 'Core did not retain a canonical session for the registered agent.');

  const first = [
    textRecord('u1', 'user', 'Question'),
    textRecord('a1', 'assistant', 'Answer')
  ];
  const second = [
    textRecord('u9', 'user', 'Replacement question'),
    textRecord('a9', 'assistant', 'Replacement answer')
  ];
  agent.commTraffic({ type: 'persisted_records', records: first });
  assert.deepEqual(
    plain(session.events),
    plain(first.map(contractEvent))
  );
  agent.commTraffic({ type: 'persisted_records', records: second });
  assert.deepEqual(
    plain(session.events),
    plain(second.map(contractEvent))
  );
  assert.deepEqual(
    session.events.map(event => event.source_record_id),
    ['u9', 'a9'],
    'Events from the previous complete provider inventory must not survive replacement.'
  );

  const identity = agent.version();
  assert.equal(identity.plugin, 'chatgpt-web');
  assert.equal(identity.version, chatGPTPluginArtifact.version);
  assert.equal(identity.ref, chatGPTPluginArtifact.ref);
});

test('DC production bridge has no direct adapter fallback and all canonical entry points await plugin readiness', () => {
  assert.doesNotMatch(bridgeSource, /adaptChatGPTRecords/,
    'Production bridge must not call the legacy Core ChatGPT adapter.');
  assert.match(bridgeSource,
    /canonicalEventsBySourceRecord = function canonicalEventsBySourceRecordViaAgent/);
  assert.match(bridgeSource,
    /canonicalImageResourcesByRecordAndPart = function canonicalImageResourcesViaAgent/);
  assert.match(bridgeSource, /chatGPTAgent\.commTraffic\(\{ type: 'persisted_records', records \}\)/);
  assert.match(bridgeSource, /chatGPTPluginRegistry\.session\(chatGPTAgent\)/);
  assert.doesNotMatch(bridgeSource, /fallback/i,
    'Production registered-agent bridge must not introduce an implicit fallback path.');
  assert.match(readinessSource, /await ensureChatGPTCanonicalAgent\(\)/);
  assert.match(readinessSource, /return runExportWithCanonicalAgent\(kinds, options\)/);
  assert.match(readinessSource, /return runOneTestWithCanonicalAgent\(name, fn\)/);
  assert.match(readinessSource, /return runTestsWithCanonicalAgent\(\)/);
});
