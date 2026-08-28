import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');
const requireMatch = userscript.match(/^\/\/ @require\s+(https:\/\/raw\.githubusercontent\.com\/Ma-XX-oN\/AIConversationCore\/([0-9a-f]{40})\/dist\/aiconversationcore\.chatgpt\.browser\.js)$/m);
assert.ok(requireMatch, 'Production userscript must pin the AIConversationCore browser bundle to an exact commit.');
assert.equal(requireMatch[2], '456b14c565e0745b1cc89e6522a7f1a160a290ba');

const response = await fetch(requireMatch[1]);
assert.equal(response.status, 200, `Could not load pinned AIConversationCore bundle: HTTP ${response.status}`);
const bundle = await response.text();
const context = {};
context.globalThis = context;
vm.runInNewContext(bundle, context, { filename: 'aiconversationcore.chatgpt.browser.js' });
assert.equal(typeof context.AIConversationCore?.adaptChatGPTRecords, 'function');
assert.equal(typeof context.AIConversationCore?.renderCanonicalMarkdown, 'function');

const begin = '  // BEGIN AIConversationCore Phase 5 integration';
const end = '  // END AIConversationCore Phase 5 integration';
const start = userscript.indexOf(begin);
const finish = userscript.indexOf(end, start);
assert.ok(start >= 0 && finish > start, 'Production integration helper block is missing.');
const helperSource = userscript.slice(start + begin.length, finish);

Object.assign(context, {
  assert(condition, message) {
    if (!condition) throw new Error(message);
  },
  cgIsHidden(record) {
    return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
  },
  CG_INLINE_TOKEN_START: '\ue200',
  transcriptHeading(record) {
    const id = typeof record?.id === 'string' ? record.id : '';
    if (record?.author?.role === 'user') return `## User${id ? ` <!-- turn_id=${id} -->` : ''}`;
    if (record?.author?.role === 'assistant' && record?.channel === 'commentary') {
      return `## ChatGPT Commentary${id ? ` <!-- turn_id=${id} -->` : ''}`;
    }
    if (record?.author?.role === 'assistant') return `## ChatGPT${id ? ` <!-- turn_id=${id} -->` : ''}`;
    return '';
  }
});
vm.runInNewContext(`${helperSource}\nthis.__phase5 = { canonicalEventsBySourceRecord, canonicalPlainRecordEligible, canonicalPlainRecordBlock };`, context);
const phase5 = context.__phase5;

function textRecord(id, role, text, extra = {}) {
  return {
    id,
    author: { role, name: null, metadata: {} },
    create_time: extra.create_time ?? null,
    update_time: extra.update_time ?? null,
    content: { content_type: 'text', parts: [text] },
    metadata: {
      turn_exchange_id: extra.turn_exchange_id ?? null,
      ...(extra.metadata ?? {})
    },
    recipient: 'all',
    channel: extra.channel ?? (role === 'assistant' ? 'final' : null),
    status: 'finished_successfully',
    end_turn: role === 'assistant'
  };
}

test('canonical plain production slice preserves source heading identity and JSONL provenance', () => {
  const user = textRecord('user-source-id', 'user', 'Hello', {
    create_time: 101.25,
    update_time: 102.5,
    turn_exchange_id: 'exchange-1'
  });
  const assistant = textRecord('assistant-source-id', 'assistant', 'Answer', {
    create_time: 103.75,
    turn_exchange_id: 'exchange-1'
  });
  const records = [user, assistant];
  const events = phase5.canonicalEventsBySourceRecord(records);
  const userEvent = events.get(user.id);
  assert.equal(userEvent.source.record_index, 0);
  assert.equal(userEvent.source.record_number, 1);
  assert.equal(userEvent.source.record_id, user.id);
  assert.equal(userEvent.source.turn_id, user.id);
  assert.equal(userEvent.source.create_time, 101.25);
  assert.equal(userEvent.source.update_time, 102.5);
  assert.equal(phase5.canonicalPlainRecordBlock(user, userEvent),
    '## User <!-- turn_id=user-source-id -->\n\n> Hello');
  assert.equal(phase5.canonicalPlainRecordBlock(assistant, events.get(assistant.id)),
    '## ChatGPT <!-- turn_id=assistant-source-id -->\n\n> Answer');
});

test('literal Markdown footnotes round-trip through the production canonical slice', () => {
  const record = textRecord(
    'footnote-source-id',
    'assistant',
    'A sentence with a footnote.[^1]\n\n[^1]: The footnote text.'
  );
  const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
  const rendered = phase5.canonicalPlainRecordBlock(record, event);
  assert.ok(rendered.includes('A sentence with a footnote.[^1]'));
  assert.ok(rendered.includes('[^1]: The footnote text.'));
  assert.equal(event.citations.length, 0);
});

test('provider-specific rich records stay on the existing DownloadConversation renderer path', () => {
  const cited = textRecord('cited', 'assistant', 'Token \ue200cite\ue201', {
    metadata: { content_references: [{ type: 'grouped_webpages' }] }
  });
  const sandbox = textRecord('sandbox', 'assistant', '[file](sandbox:/mnt/data/test.txt)');
  const hidden = textRecord('hidden', 'assistant', 'hidden', {
    metadata: { is_visually_hidden_from_conversation: true }
  });
  assert.equal(phase5.canonicalPlainRecordEligible(cited), false);
  assert.equal(phase5.canonicalPlainRecordEligible(sandbox), false);
  assert.equal(phase5.canonicalPlainRecordEligible(hidden), false);
  assert.match(userscript, /pendingThoughts\.length === 0/,
    'Assistant records with pending thoughts must remain on the existing host composition path.');
});
