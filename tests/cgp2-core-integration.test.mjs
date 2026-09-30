import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { coreBundle } from './helpers/core-bundle.mjs';
import {
  chatGPTPluginArtifact,
  chatGPTPluginModuleUrl,
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

const pluginModule = await import(chatGPTPluginModuleUrl);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function textRecord(id, role, text, extra = {}) {
  return {
    id,
    author: { role, name: extra.author_name ?? null, metadata: {} },
    create_time: extra.create_time ?? null,
    update_time: extra.update_time ?? null,
    content: extra.content ?? { content_type: 'text', parts: [text] },
    metadata: extra.metadata ?? {},
    recipient: extra.recipient ?? 'all',
    channel: extra.channel ?? (role === 'assistant' ? 'final' : null),
    status: 'finished_successfully',
    end_turn: extra.end_turn ?? (role === 'assistant')
  };
}

function fixtureRecords() {
  const user = textRecord('u1', 'user', 'Question', {
    create_time: 100,
    metadata: { turn_exchange_id: 'exchange-1' }
  });
  const thought = textRecord('t1', 'assistant', '', {
    create_time: 101,
    channel: 'analysis',
    end_turn: false,
    metadata: { turn_exchange_id: 'exchange-1' },
    content: {
      content_type: 'thoughts',
      thoughts: [{ summary: 'Checking', content: 'Inspecting.' }]
    }
  });
  const final = textRecord('a1', 'assistant', 'Answer', {
    create_time: 102,
    metadata: { turn_exchange_id: 'exchange-1' }
  });
  const nextUser = textRecord('u2', 'user', 'Next', {
    create_time: 103,
    metadata: { turn_exchange_id: 'exchange-2' }
  });
  return [user, thought, final, nextUser];
}

test('pinned issue-qualified AICC and CGP2 artifacts expose the registered-agent contract', () => {
  assert.equal(chatGPTPluginPin.ref, 'issue-1-chatgpt-agent-plugin');
  assert.equal(chatGPTPluginPin.commit, '24fdd9ad5bd89568aafe3a123100ff37a45951d6');
  assert.equal(chatGPTPluginPin.version, '0.1.0-issue.1.7');
  assert.equal(chatGPTPluginArtifact.api_version, 1);
  assert.equal(pluginModule.default.id, 'chatgpt-web');
  assert.equal(pluginModule.default.apiVersion, 1);
});

test('same provider records are byte-semantically identical through legacy oracle and CGP2 registered-agent session', () => {
  const records = fixtureRecords();
  const legacyEvents = core.adaptChatGPTRecords(records);

  const registry = new core.AgentPluginRegistry({ apiVersion: chatGPTPluginArtifact.api_version });
  registry.registerModule(pluginModule);
  const agent = registry.create('chatgpt-web', { ref: chatGPTPluginArtifact.ref });
  const session = registry.session(agent);
  assert.ok(session, 'Core did not retain a canonical session for the registered ChatGPT agent.');

  agent.commTraffic({ type: 'persisted_records', records });
  assert.deepEqual(plain(session.events), plain(legacyEvents));
  assert.equal(session.renderMarkdown(), core.renderCanonicalMarkdown(legacyEvents));
  assert.deepEqual(
    plain(session.project()),
    plain(core.projectCanonicalConversation(legacyEvents))
  );

  const identity = agent.version();
  assert.equal(identity.plugin, 'chatgpt-web');
  assert.equal(identity.version, chatGPTPluginArtifact.version);
  assert.equal(identity.ref, chatGPTPluginArtifact.ref);
});

test('subsequent complete provider inventory replaces Core session state exactly', () => {
  const first = fixtureRecords().slice(0, 3);
  const second = [
    textRecord('u9', 'user', 'Replacement question', {
      create_time: 900,
      metadata: { turn_exchange_id: 'exchange-9' }
    }),
    textRecord('a9', 'assistant', 'Replacement answer', {
      create_time: 901,
      metadata: { turn_exchange_id: 'exchange-9' }
    })
  ];
  const registry = new core.AgentPluginRegistry({ apiVersion: 1 });
  registry.registerModule(pluginModule);
  const agent = registry.create('chatgpt-web', { ref: chatGPTPluginArtifact.ref });
  const session = registry.session(agent);

  agent.commTraffic({ type: 'persisted_records', records: first });
  assert.deepEqual(plain(session.events), plain(core.adaptChatGPTRecords(first)));
  agent.commTraffic({ type: 'persisted_records', records: second });
  assert.deepEqual(plain(session.events), plain(core.adaptChatGPTRecords(second)));
  assert.deepEqual(
    session.events.map(event => event.source_record_id),
    ['u9', 'a9'],
    'Events from the previous complete provider inventory must not survive replacement.'
  );
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
