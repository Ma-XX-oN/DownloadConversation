import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');
const requireMatch = userscript.match(/^\/\/ @require\s+(https:\/\/raw\.githubusercontent\.com\/Ma-XX-oN\/AIConversationCore\/([0-9a-f]{40})\/dist\/aiconversationcore\.chatgpt\.browser\.js)$/m);
assert.ok(requireMatch, 'Production userscript must pin the AIConversationCore browser bundle to an exact commit.');
assert.equal(requireMatch[2], 'd6d5f90aabab4d106265113bad09fc5984f4808e');

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
  diagnosticEnabled() {
    return false;
  },
  logDiagnostic() {},
  boundedDiagnosticText(value, maxChars = 2000) {
    const text = String(value ?? '');
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
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
  assert.match(rendered, /sandbox_path=%2Fmnt%2Fdata%2Fa\(b\)\.txt/);
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

test('commentary plus tool activity uses canonical adaptive containment', () => {
  const call = textRecord('commentary-call', 'assistant', '', {
    channel: 'analysis',
    recipient: 'api_tool',
    end_turn: false,
    content: { content_type: 'code', text: 'inspect()', language: 'javascript' }
  });
  const payload = [
    '[L1] literal tool payload',
    '````',
    '[L2] nested four-backtick fence',
    '````',
    "[L3] reference?.matched_text === 'memcite'"
  ].join('\n');
  const result = textRecord('commentary-result', 'tool', '', {
    author_name: 'api_tool',
    end_turn: false,
    content: {
      content_type: 'multimodal_text',
      parts: [
        'Make sure to include a file citation in your response.',
        payload
      ]
    }
  });
  const commentary = textRecord('commentary-message', 'assistant', 'Continuing after the tool.', {
    channel: 'commentary',
    end_turn: false
  });
  const records = [call, result, commentary];
  const byRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => byRecord.get(record.id));
  assert.deepEqual(events.map(event => [event?.kind, event?.role, event?.visibility]), [
    ['tool_call', 'assistant', 'visible'],
    ['tool_result', 'tool', 'visible'],
    ['commentary', 'assistant', 'visible']
  ]);
  assert.equal(phase5.canonicalThoughtRecordEligible(call, events[0]), true, 'tool call eligibility');
  assert.equal(phase5.canonicalThoughtRecordEligible(result, events[1]), true, 'tool result eligibility');
  assert.equal(phase5.canonicalMessageRecordEligible(commentary, events[2]), true, 'commentary eligibility');
  assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true, 'whole segment eligibility');
  const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
  assert.match(rendered, /^## ChatGPT Commentary <!-- turn_id=commentary-message -->/);
  assert.equal((rendered.match(/^## ChatGPT$/gm) ?? []).length, 0,
    'Commentary + tool activity must not manufacture a second ChatGPT section.');
  assert.match(rendered, /\n`````\n\[L1\] literal tool payload/);
  assert.match(rendered, /\n`````\n\n<\/details>/);
  assert.match(rendered, /reference\?\.matched_text === 'memcite'/);
  assert.equal((rendered.match(/\*\*\(memory:/g) ?? []).length, 0,
    'Literal memcite text inside tool output must not become a semantic memory citation.');
  const payloadAt = rendered.indexOf(payload);
  const closeFenceAt = rendered.indexOf('`````', payloadAt + payload.length);
  const commentaryAt = rendered.indexOf('> Continuing after the tool.');
  assert.ok(payloadAt >= 0 && closeFenceAt > payloadAt && commentaryAt > closeFenceAt,
    'Commentary following the tool must remain outside the adaptive fence.');
});

test('pinned core normalizes the live tool-call language and Python -c shapes', () => {
  const apiSource = '{"path":"/files/list","args":{"surface":"conversation","limit":20}}';
  const apiCall = textRecord('api-tool-language', 'assistant', '', {
    channel: 'commentary',
    recipient: 'api_tool.call_tool',
    end_turn: false,
    content: { content_type: 'code', text: apiSource, language: 'python3' }
  });
  const bashSource = 'bash -lc grep -n -F "browser packaging" file.md | head -5';
  const bashCall = textRecord('bash-tool-language', 'assistant', '', {
    channel: 'commentary',
    recipient: 'container.exec',
    end_turn: false,
    content: { content_type: 'code', text: bashSource, language: 'unknown' }
  });
  const pythonSource = [
    'python -c from pathlib import Path',
    "p=Path('/mnt/data/H1 Heading.jsonl')",
    "print(p.read_text(encoding='utf-8', errors='replace')[:12000])"
  ].join('\n');
  const pythonCall = textRecord('python-tool-language', 'assistant', '', {
    channel: 'commentary',
    recipient: 'container.exec',
    end_turn: false,
    content: { content_type: 'code', text: pythonSource, language: 'unknown' }
  });

  const byRecord = phase5.canonicalEventsBySourceRecord([apiCall, bashCall, pythonCall]);
  const apiBlock = byRecord.get(apiCall.id).blocks[0];
  const bashBlock = byRecord.get(bashCall.id).blocks[0];
  const pythonBlock = byRecord.get(pythonCall.id).blocks[0];

  assert.equal(apiBlock.language, 'json');
  assert.equal(apiBlock.input_format, 'json');
  assert.equal(apiBlock.source_language, 'python3');
  assert.equal(apiBlock.input, apiSource);

  assert.equal(bashBlock.language, 'bash');
  assert.equal(bashBlock.source_language, 'unknown');
  assert.equal(bashBlock.input, bashSource);

  assert.equal(pythonBlock.language, 'python');
  assert.equal(pythonBlock.source_language, 'unknown');
  assert.equal(pythonBlock.source_input, pythonSource);
  assert.equal(pythonBlock.input.startsWith('from pathlib import Path\n'), true);
  assert.equal(pythonBlock.input.includes('python -c '), false);

  const rendered = context.AIConversationCore.renderCanonicalMarkdown([
    byRecord.get(apiCall.id),
    byRecord.get(bashCall.id),
    byRecord.get(pythonCall.id)
  ]);
  assert.match(rendered, /<summary>api_tool\.call_tool code<\/summary>\n\n```json\n/);
  assert.match(rendered, /<summary>container\.exec code<\/summary>\n\n```bash\n/);
  assert.match(rendered, /<summary>container\.exec code<\/summary>\n\n```python\nfrom pathlib import Path\n/);
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


test('tool-role text/code results keep complete Assistant segments canonical', () => {
  for (const [contentType, content, expectedOutput] of [
    ['text', { content_type: 'text', parts: ['text tool output'] }, 'text tool output'],
    ['code', { content_type: 'code', text: '{"code":true}', language: 'json' }, '{"code":true}']
  ]) {
    const call = textRecord(`call-${contentType}`, 'assistant', '', {
      channel: 'analysis',
      recipient: 'example_tool',
      end_turn: false,
      content: { content_type: 'code', text: '{"request":true}', language: 'json' }
    });
    const result = textRecord(`result-${contentType}`, 'tool', '', {
      author_name: 'example_tool',
      channel: 'commentary',
      end_turn: false,
      content
    });
    const commentary = textRecord(`commentary-${contentType}`, 'assistant', 'After tool.', {
      channel: 'commentary',
      end_turn: false
    });
    const records = [call, result, commentary];
    const byRecord = phase5.canonicalEventsBySourceRecord(records);
    const events = records.map(record => byRecord.get(record.id));

    assert.equal(events[1]?.kind, 'tool_result', `${contentType} tool record kind`);
    assert.equal(events[1]?.blocks?.[0]?.type, 'tool_result', `${contentType} tool block type`);
    assert.equal(events[1]?.blocks?.[0]?.output_format, contentType, `${contentType} source format`);
    assert.equal(events[1]?.blocks?.[0]?.output, expectedOutput, `${contentType} payload`);
    assert.equal(phase5.canonicalThoughtRecordEligible(result, events[1]), true,
      `${contentType} result must be eligible thought/tool activity`);
    assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true,
      `${contentType} complete Assistant/tool segment must stay canonical`);

    const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
    assert.match(rendered, new RegExp(`^## ChatGPT Commentary <!-- turn_id=commentary-${contentType} -->`));
    assert.match(rendered, /<summary>example_tool output<\/summary>/);
    assert.ok(rendered.includes(expectedOutput), `${contentType} output must be rendered`);
    assert.match(rendered, /> After tool\./);
  }
});


test('literal ChatGPT heading inside tool output stays opaque', () => {
  const call = textRecord('opaque-heading-call', 'assistant', '', {
    channel: 'analysis',
    recipient: 'file_search',
    end_turn: false,
    content: { content_type: 'code', text: '{"query":"heading"}', language: 'json' }
  });
  const result = textRecord('opaque-heading-result', 'tool', '', {
    author_name: 'file_search',
    end_turn: false,
    content: {
      content_type: 'text',
      parts: ['retrieved transcript snippet\n\n## ChatGPT\n\nThis is literal tool payload.']
    }
  });
  const final = textRecord('opaque-heading-final', 'assistant', 'Done.');
  const records = [call, result, final];
  const byRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => byRecord.get(record.id));

  assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true);
  const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=opaque-heading-final -->/);
  assert.match(rendered, /retrieved transcript snippet/);
  assert.match(rendered, /## ChatGPT\n\nThis is literal tool payload\./);
  assert.match(rendered, /> Done\./);
});

test('commentary plus final message is rejected semantically before canonical block rendering', () => {
  const commentary = textRecord('split-commentary', 'assistant', 'Interim.', {
    channel: 'commentary',
    end_turn: false
  });
  const final = textRecord('split-final', 'assistant', 'Final.');
  const records = [commentary, final];
  const byRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => byRecord.get(record.id));
  assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), false);
});
