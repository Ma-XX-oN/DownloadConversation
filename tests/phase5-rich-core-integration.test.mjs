import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');
const requireMatch = userscript.match(/^\/\/ @require\s+(https:\/\/raw\.githubusercontent\.com\/Ma-XX-oN\/AIConversationCore\/([0-9a-f]{40})\/dist\/aiconversationcore\.chatgpt\.browser\.js)$/m);
assert.ok(requireMatch, 'Production userscript must pin the AIConversationCore browser bundle to an exact commit.');
assert.equal(requireMatch[2], 'b5afdafee5a732b35e491a2227c892b34c86370f');

const response = await fetch(requireMatch[1]);
assert.equal(response.status, 200, `Could not load pinned AIConversationCore bundle: HTTP ${response.status}`);
const bundle = await response.text();
const context = {};
context.globalThis = context;
vm.runInNewContext(bundle, context, { filename: 'aiconversationcore.chatgpt.browser.js' });

const begin = '  // BEGIN AIConversationCore Phase 5 integration';
const end = '  // END AIConversationCore Phase 5 integration';
const start = userscript.indexOf(begin);
const finish = userscript.indexOf(end, start);
assert.ok(start >= 0 && finish > start, 'Production Phase 5 helper block is missing.');
const helperSource = userscript.slice(start + begin.length, finish);

Object.assign(context, {
  assert(condition, message) {
    if (!condition) throw new Error(message);
  },
  cgIsHidden(record) {
    return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
  },
  currentConversationId() {
    return 'conversation-123';
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

vm.runInNewContext(`${helperSource}\nthis.__phase5rich = { canonicalEventsBySourceRecord, canonicalMessageRecordEligible, canonicalRecordBlock, canonicalThoughtRecordEligible, canonicalAssistantSegmentEligible, canonicalAssistantSegmentBlock };`, context);
const phase5 = context.__phase5rich;

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

test('production render loop routes rich messages and thought/tool segments through canonical helpers', () => {
  const renderStart = userscript.indexOf('  function renderConversationMarkdown(');
  const renderEnd = userscript.indexOf('\n  function conversationMetadataJsonlRecord', renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  const production = userscript.slice(renderStart, renderEnd);
  assert.match(production, /canonicalEventsBySourceRecord\(records, recoveredImageMap\)/);
  assert.match(production, /canonicalMessageRecordEligible\(record, canonicalEvent\)/);
  assert.match(production, /canonicalThoughtRecordEligible\(record, canonicalEvent\)/);
  assert.match(production, /canonicalAssistantSegmentEligible\(segmentRecords, segmentEvents\)/);
  assert.match(production, /canonicalRecordBlock\(record, canonicalEvent\)/);
});

test('rich web citation renders through AIConversationCore while preserving source turn_id', () => {
  const marker = '\ue200cite\ue201';
  const record = textRecord('assistant-citation', 'assistant', `Answer ${marker}`, {
    metadata: {
      content_references: [{
        type: 'grouped_webpages',
        matched_text: marker,
        items: [{
          url: 'https://example.com/source',
          title: 'Example title',
          attribution: 'Example',
          snippet: 'Example snippet'
        }]
      }]
    }
  });
  const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
  assert.equal(phase5.canonicalMessageRecordEligible(record, event), true);
  const rendered = phase5.canonicalRecordBlock(record, event);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=assistant-citation -->/);
  assert.match(rendered, /\*\*\(cite:/);
  assert.match(rendered, /Example<\/a>/);
  assert.equal(rendered.includes(marker), false);
});

test('memory citation renders through AIConversationCore', () => {
  const marker = 'memcite';
  const record = textRecord('assistant-memory', 'assistant', `Memory ${marker}`, {
    metadata: {
      content_references: [{ type: 'hidden', invalid: false, matched_text: marker }],
      conversation_context_citation_metadata: [{
        citation_uuid: 'memory-1',
        citation: {
          title: 'Prior note',
          url: 'https://example.com/memory',
          snippet: 'Remembered detail'
        }
      }]
    }
  });
  const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
  const rendered = phase5.canonicalRecordBlock(record, event);
  assert.match(rendered, /\*\*\(memory:/);
  assert.match(rendered, /Prior note<\/a>/);
});

test('retrieved file citation resolves using the complete record set', () => {
  const marker = 'fileciteturn1file0L2-L3';
  const retrieval = textRecord('retrieval-source', 'tool', '', {
    author_name: 'file_search',
    content: { content_type: 'execution_output', text: 'retrieved' },
    metadata: {
      retrieval_turn_number: 1,
      retrieval_file_index: 0,
      citation_metadata: {
        title: 'notes.md',
        url: 'https://example.com/notes.md'
      }
    },
    end_turn: false
  });
  const final = textRecord('assistant-file', 'assistant', `See ${marker}`, {
    metadata: {
      content_references: [{ type: 'hidden', invalid: true, matched_text: marker }]
    }
  });
  const events = phase5.canonicalEventsBySourceRecord([retrieval, final]);
  const rendered = phase5.canonicalRecordBlock(final, events.get(final.id));
  assert.match(rendered, /href="https:\/\/example\.com\/notes\.md"/);
  assert.match(rendered, /notes\.md L2-L3/);
});

test('generated Assistant sandbox link uses browser conversation identity through canonical resource metadata', () => {
  const record = textRecord('assistant-sandbox', 'assistant', '[Download](sandbox:/mnt/data/a(b).txt)');
  const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
  assert.equal(phase5.canonicalMessageRecordEligible(record, event), true);
  const rendered = phase5.canonicalRecordBlock(record, event);
  assert.match(rendered, /\/backend-api\/conversation\/conversation-123\/interpreter\/download\?/);
  assert.match(rendered, /message_id=assistant-sandbox/);
  assert.match(rendered, /sandbox_path=%2Fmnt%2Fdata%2Fa%28b%29\.txt/);
  assert.match(rendered, /download_intent=true/);
  assert.equal(rendered.includes('sandbox:/mnt/data/a(b).txt'), false);
});

test('recovered image bytes enrich canonical image resources and preserve image-before-text order', () => {
  const record = textRecord('user-image', 'user', '', {
    content: {
      content_type: 'multimodal_text',
      parts: [
        { content_type: 'image_asset_pointer', asset_pointer: 'https://example.com/image.png' },
        'After image'
      ]
    }
  });
  const recovered = new Map([[
    record.id,
    ['![image-user-image-1](data:image/png;base64,AAAA)']
  ]]);
  const event = phase5.canonicalEventsBySourceRecord([record], recovered).get(record.id);
  const imageResource = event.resources.find(resource => resource.type === 'image');
  assert.equal(imageResource.status, 'available');
  assert.equal(imageResource.data_url, 'data:image/png;base64,AAAA');
  const rendered = phase5.canonicalRecordBlock(record, event);
  const imageAt = rendered.indexOf('![image](data:image/png;base64,AAAA)');
  const textAt = rendered.indexOf('After image');
  assert.ok(imageAt >= 0 && textAt > imageAt, 'Recovered image must stay before adjacent source text.');
  assert.match(rendered, /^## User <!-- turn_id=user-image -->/);
});

test('unavailable and missing recovered-image states remain distinct in canonical resources', () => {
  const record = textRecord('user-images', 'user', '', {
    content: {
      content_type: 'multimodal_text',
      parts: [
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_one' },
        { content_type: 'image_asset_pointer' }
      ]
    }
  });
  const recovered = new Map([[
    record.id,
    ['[image not available](sediment://file_one)', '[image missing]']
  ]]);
  const event = phase5.canonicalEventsBySourceRecord([record], recovered).get(record.id);
  const images = event.resources.filter(resource => resource.type === 'image');
  assert.equal(images[0].status, 'unavailable');
  assert.equal(images[0].source_pointer, 'sediment://file_one');
  assert.equal(images[1].status, 'missing');
  const rendered = phase5.canonicalRecordBlock(record, event);
  assert.match(rendered, /\[image not available\]\(sediment:\/\/file_one\)/);
  assert.match(rendered, /\[image missing\]/);
});

test('Thoughts, tool call/result, and final Assistant message render as one canonical Assistant segment', () => {
  const thought = textRecord('thought', 'assistant', '', {
    channel: 'analysis',
    end_turn: false,
    content: {
      content_type: 'thoughts',
      thoughts: [{ summary: 'Checking', content: 'Inspecting.' }]
    }
  });
  const call = textRecord('call', 'assistant', '', {
    channel: 'analysis',
    recipient: 'container.exec',
    end_turn: false,
    content: { content_type: 'code', text: 'echo hi', language: 'bash' }
  });
  const result = textRecord('result', 'tool', '', {
    author_name: 'container.exec',
    end_turn: false,
    content: { content_type: 'execution_output', text: 'hi' }
  });
  const final = textRecord('assistant-final-rich', 'assistant', 'Done.');
  const records = [thought, call, result, final];
  const byRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => byRecord.get(record.id));
  assert.equal(phase5.canonicalThoughtRecordEligible(thought, events[0]), true);
  assert.equal(phase5.canonicalThoughtRecordEligible(call, events[1]), true);
  assert.equal(phase5.canonicalThoughtRecordEligible(result, events[2]), true);
  assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true);
  const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=assistant-final-rich -->/);
  assert.match(rendered, /<summary>Thoughts<\/summary>/);
  assert.match(rendered, /Inspecting\./);
  assert.match(rendered, /container\.exec code/);
  assert.match(rendered, /container\.exec output/);
  assert.match(rendered, /> Done\./);
});

test('defensive host fallback remains for unresolved inline tokens, hidden records, and User sandbox links', () => {
  const unresolved = textRecord('unresolved', 'assistant', 'raw \ue200unknown\ue201 token');
  const hidden = textRecord('hidden', 'assistant', 'hidden', {
    metadata: { is_visually_hidden_from_conversation: true }
  });
  const userSandbox = textRecord('user-sandbox', 'user', '[file](sandbox:/mnt/data/user.txt)');
  for (const record of [unresolved, hidden, userSandbox]) {
    const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
    assert.equal(phase5.canonicalMessageRecordEligible(record, event), false);
  }
});
