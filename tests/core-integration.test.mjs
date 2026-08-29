import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');
const requireMatch = userscript.match(/^\/\/ @require\s+(https:\/\/raw\.githubusercontent\.com\/Ma-XX-oN\/AIConversationCore\/([0-9a-f]{40})\/dist\/aiconversationcore\.chatgpt\.browser\.js)$/m);
assert.ok(requireMatch, 'Production userscript must pin the AIConversationCore browser bundle to an exact commit.');
assert.equal(requireMatch[2], 'fdf4cfef6c387fcb6e130486a18af4045c30bd9b');

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
vm.runInNewContext(`${helperSource}\nthis.__phase5 = { canonicalEventsBySourceRecord, canonicalPlainRecordEligible, canonicalPlainRecordBlock, canonicalPlainAssistantSegmentEligible, canonicalPlainAssistantSegmentBlock };`, context);
const phase5 = context.__phase5;

const quoteStart = userscript.indexOf('  function quoteMarkdown(markdown) {');
const quoteEnd = userscript.indexOf('\n  }', quoteStart);
assert.ok(quoteStart >= 0 && quoteEnd > quoteStart, 'Production quoteMarkdown implementation is missing.');
const quoteSource = userscript.slice(quoteStart, quoteEnd + '\n  }'.length);
vm.runInNewContext(`${quoteSource}\nthis.__productionQuoteMarkdown = quoteMarkdown;`, context);
assert.equal(typeof context.__productionQuoteMarkdown, 'function');

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

function productionPlainBlock(record) {
  const text = record.content.parts.join('');
  return `${context.transcriptHeading(record)}\n\n${context.__productionQuoteMarkdown(text)}`;
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
  assert.equal(userEvent.source.record_index + 1, 1);
  assert.equal(Object.hasOwn(userEvent.source, 'record_number'), false);
  assert.equal(userEvent.source.record_id, user.id);
  assert.equal(userEvent.source.turn_id, user.id);
  assert.equal(userEvent.source.create_time, 101.25);
  assert.equal(userEvent.source.update_time, 102.5);
  assert.equal(phase5.canonicalPlainRecordBlock(user, userEvent), productionPlainBlock(user));
  assert.equal(phase5.canonicalPlainRecordBlock(assistant, events.get(assistant.id)), productionPlainBlock(assistant));
});

test('migrated canonical plain renderer is byte-identical to production legacy quoting for rich Markdown syntax', () => {
  const markdown = [
    '# H1 Heading',
    '',
    '## H2 Heading',
    '',
    'This paragraph shows **bold**, *italic*, ***bold-italic***, ~~strikethrough~~, `inline code`, and a [link](https://example.com).',
    '',
    '```python',
    'def greet(name):',
    '  return `Hello`',
    '',
    'print(greet("world"))',
    '```',
    '',
    '> Level one',
    '>',
    '> > Level two',
    '',
    '| Left | Center | Right |',
    '|:-----|:------:|------:|',
    '| a | b | c |',
    '',
    'A sentence with a footnote.[^1]',
    '',
    '[^1]: The footnote text.'
  ].join('\n');
  for (const record of [
    textRecord('markdown-user', 'user', markdown),
    textRecord('markdown-assistant', 'assistant', markdown),
    textRecord('markdown-commentary', 'assistant', markdown, { channel: 'commentary' })
  ]) {
    const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
    assert.equal(phase5.canonicalPlainRecordBlock(record, event), productionPlainBlock(record));
  }
});

test('literal Markdown footnotes round-trip through the production canonical slice', () => {
  const record = textRecord(
    'footnote-source-id',
    'assistant',
    'A sentence with a footnote.[^1]\n\n[^1]: The footnote text.'
  );
  const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
  const rendered = phase5.canonicalPlainRecordBlock(record, event);
  assert.equal(rendered, productionPlainBlock(record));
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
});

test('plain Assistant thought segments use the canonical renderer', () => {
  const thought = {
    id: 'thought-1',
    author: { role: 'assistant', name: null, metadata: {} },
    create_time: 200,
    update_time: null,
    content: {
      content_type: 'thoughts',
      thoughts: [{ summary: 'Checking', content: 'Inspecting the request.' }]
    },
    metadata: {},
    recipient: 'all',
    channel: 'analysis',
    status: 'finished_successfully',
    end_turn: false
  };
  const final = textRecord('assistant-final', 'assistant', 'Done.', { create_time: 201 });
  const records = [thought, final];
  const eventsByRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => eventsByRecord.get(record.id));
  assert.equal(phase5.canonicalPlainAssistantSegmentEligible(records), true);
  const rendered = phase5.canonicalPlainAssistantSegmentBlock(records, events);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=assistant-final -->/);
  assert.match(rendered, /<summary>Thoughts<\/summary>/);
  assert.match(rendered, /Inspecting the request\./);
  assert.match(rendered, /> Done\./);
});
