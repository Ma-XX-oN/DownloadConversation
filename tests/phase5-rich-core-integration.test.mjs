import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');
const coreSourceUrl = 'https://raw.githubusercontent.com/Ma-XX-oN/AIConversationCore/2b746b121ed0e44cfe86ba8377969b8d8bf197c7/dist/aiconversationcore.chatgpt.browser.js';
const coreSource = await (await fetch(coreSourceUrl)).text();

const context = {
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  console,
  atob: value => Buffer.from(value, 'base64').toString('binary'),
  btoa: value => Buffer.from(value, 'binary').toString('base64')
};
context.globalThis = context;
vm.runInNewContext(coreSource, context, { filename: 'aiconversationcore.chatgpt.browser.js' });

function functionSource(name) {
  const start = userscript.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} is missing from production userscript`);
  const next = userscript.indexOf('\n\n  /**', start);
  assert.ok(next > start, `could not delimit ${name}`);
  return userscript.slice(start, next);
}

function integrationSource() {
  const begin = userscript.indexOf('  // BEGIN AIConversationCore Phase 5 integration');
  const end = userscript.indexOf('  // END AIConversationCore Phase 5 integration');
  assert.ok(begin >= 0 && end > begin, 'Phase 5 integration block is missing');
  return userscript.slice(begin, end);
}

const diagnosticEvents = [];
Object.assign(context, {
  assert(condition, message) {
    if (!condition) throw new Error(message);
  },
  cgIsHidden(record) {
    return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
  },
  currentConversationId() {
    return 'fixture-conversation';
  },
  CG_INLINE_TOKEN_START: '\ue200',
  diagnosticEnabled(level) {
    return level === 'debug';
  },
  logDiagnostic(level, event, data) {
    diagnosticEvents.push({ level, event, data });
  },
  boundedDiagnosticText(value, maxChars = 2000) {
    const text = String(value ?? '');
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
  }
});

vm.runInNewContext(`${integrationSource()}\nthis.__phase5 = {
  canonicalEventsBySourceRecord,
  canonicalMessageRecordEligible,
  canonicalThoughtRecordEligible,
  canonicalAssistantSegmentEligible,
  canonicalAssistantSegmentBlock,
  canonicalPlainRecordBlock,
  canonicalPlainRecordEligible
};`, context);
const phase5 = context.__phase5;

function textRecord(id, role, text, extra = {}) {
  return {
    id,
    author: { role },
    channel: extra.channel ?? 'final',
    end_turn: extra.end_turn ?? true,
    content: {
      content_type: 'text',
      parts: [text]
    },
    metadata: extra.metadata ?? {}
  };
}

function toolCallRecord(id, recipient, text, language = 'unknown') {
  return {
    id,
    author: { role: 'assistant' },
    recipient,
    channel: 'commentary',
    end_turn: false,
    content: {
      content_type: 'code',
      text,
      language
    },
    metadata: {}
  };
}

function toolResultRecord(id, contentType, output, authorName = 'tool') {
  const content = contentType === 'multimodal_text'
    ? { content_type: contentType, parts: output }
    : { content_type: contentType, text: output };
  return {
    id,
    author: { role: 'tool', name: authorName },
    channel: 'commentary',
    end_turn: false,
    content,
    metadata: {}
  };
}

function renderRecord(record, recoveredImageMap = new Map()) {
  const byRecord = phase5.canonicalEventsBySourceRecord([record], recoveredImageMap);
  const event = byRecord.get(record.id);
  assert.ok(event, `no canonical event for ${record.id}`);
  return phase5.canonicalPlainRecordBlock(record, event);
}

test('rich web citation renders through AIConversationCore while preserving source turn_id', () => {
  const matched = 'citeturn1search0';
  const record = textRecord('citation-message', 'assistant', `See this ${matched}.`, {
    metadata: {
      content_references: [{
        type: 'webpage',
        matched_text: matched,
        title: 'Example Source',
        url: 'https://example.com/article?utm_source=chatgpt.com'
      }],
      search_result_groups: [{
        entries: [{
          url: 'https://example.com/article',
          title: 'Example Source',
          attribution: 'example.com',
          snippet: 'Evidence snippet'
        }]
      }]
    }
  });
  const rendered = renderRecord(record);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=citation-message -->/);
  assert.match(rendered, /Example Source/);
  assert.match(rendered, /google\.com\/s2\/favicons/);
});

test('memory citation renders through AIConversationCore', () => {
  const marker = 'memcite';
  const record = textRecord('memory-message', 'assistant', `Remembered ${marker}`, {
    metadata: {
      content_references: [{ type: 'memory', matched_text: marker }]
    }
  });
  const rendered = renderRecord(record);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=memory-message -->/);
  assert.doesNotMatch(rendered, /memcite/);
});

test('retrieved file citation resolves using the complete record set', () => {
  const retrieval = textRecord('retrieval-meta', 'assistant', 'hidden', {
    metadata: {
      is_visually_hidden_from_conversation: true,
      retrieval_turn_number: 3,
      retrieval_file_index: 0,
      citation_metadata: {
        title: 'report.txt',
        url: 'https://chatgpt.com/backend-api/files/file_abc'
      }
    }
  });
  const marker = 'fileciteturn3file0';
  const final = textRecord('retrieved-message', 'assistant', `Read ${marker}`, {
    metadata: {
      content_references: [{ type: 'file', matched_text: marker }]
    }
  });
  const byRecord = phase5.canonicalEventsBySourceRecord([retrieval, final]);
  const event = byRecord.get(final.id);
  assert.ok(event);
  const rendered = phase5.canonicalPlainRecordBlock(final, event);
  assert.match(rendered, /report\.txt/);
});

test('generated Assistant sandbox link uses browser conversation identity through canonical resource metadata', () => {
  const record = textRecord(
    'generated-file-message',
    'assistant',
    '[Download report](sandbox:/mnt/data/report (final).txt)'
  );
  const rendered = renderRecord(record);
  assert.match(rendered, /backend-api\/conversation\/fixture-conversation\/interpreter\/download/);
  assert.match(rendered, /report%20%28final%29\.txt/);
});

test('recovered image bytes enrich canonical image resources and preserve image-before-text order', () => {
  const record = {
    id: 'image-message',
    author: { role: 'user' },
    channel: 'final',
    end_turn: true,
    content: {
      content_type: 'multimodal_text',
      parts: [
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image' },
        'after image'
      ]
    },
    metadata: {}
  };
  const rendered = renderRecord(record, new Map([[record.id, ['data:image/png;base64,AAAA']]]));
  assert.ok(rendered.indexOf('data:image/png;base64,AAAA') < rendered.indexOf('after image'));
});

test('unavailable and missing recovered-image states remain distinct in canonical resources', () => {
  const record = {
    id: 'missing-image-message',
    author: { role: 'user' },
    channel: 'final',
    end_turn: true,
    content: {
      content_type: 'multimodal_text',
      parts: [
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image' },
        { content_type: 'image_asset_pointer' }
      ]
    },
    metadata: {}
  };
  const rendered = renderRecord(record, new Map([[
    record.id,
    ['[image not available](sediment://file_image)', '[image missing]']
  ]]));
  assert.match(rendered, /\[image not available\]/);
  assert.match(rendered, /\[image missing\]/);
});

test('Thoughts, tool call/result, and final Assistant message render as one canonical Assistant segment', () => {
  const thought = {
    id: 'thought-message',
    author: { role: 'assistant' },
    channel: 'commentary',
    end_turn: false,
    content: {
      content_type: 'thoughts',
      thoughts: [{ summary: 'Plan', content: 'Use the tool.' }]
    },
    metadata: {}
  };
  const call = toolCallRecord('tool-call', 'container.exec', 'bash -lc "echo ok"');
  const result = toolResultRecord('tool-result', 'execution_output', 'ok\n');
  const final = textRecord('final-message', 'assistant', 'Done.');
  const records = [thought, call, result, final];
  const byRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => byRecord.get(record.id));
  assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true);
  const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=final-message -->/);
  assert.match(rendered, /<summary>Having a thought<\/summary>/);
  assert.match(rendered, /```bash/);
  assert.match(rendered, /> Done\./);
});

test('commentary plus tool activity uses canonical adaptive containment', () => {
  const commentary = textRecord('commentary-message', 'assistant', 'Working.', {
    channel: 'commentary',
    end_turn: false
  });
  const call = toolCallRecord('nested-tool-call', 'container.exec', 'bash -lc "printf \'```\\ninside\\n```\'"');
  const records = [call, commentary];
  const byRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => byRecord.get(record.id));
  assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true);
  const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=commentary-message -->/);
  assert.match(rendered, /^### ChatGPT Commentary <!-- turn_id=commentary-message -->$/m);
});

test('pinned core normalizes the live tool-call language and Python -c shapes', () => {
  const bash = toolCallRecord('bash-call', 'container.exec', 'bash -lc "echo ok"');
  const python = toolCallRecord('python-call', 'container.exec', 'python -c print(1)');
  const byRecord = phase5.canonicalEventsBySourceRecord([bash, python]);
  const bashEvent = byRecord.get('bash-call');
  const pythonEvent = byRecord.get('python-call');
  assert.equal(bashEvent.blocks[0].language, 'bash');
  assert.equal(pythonEvent.blocks[0].language, 'python');
  assert.equal(pythonEvent.blocks[0].input, 'print(1)');
});

test('defensive host fallback remains for unresolved inline tokens, hidden records, and User sandbox links', () => {
  const userSandbox = textRecord('user-sandbox', 'user', '[file](sandbox:/mnt/data/a.txt)');
  const hidden = textRecord('hidden', 'assistant', 'secret', {
    metadata: { is_visually_hidden_from_conversation: true }
  });
  const byRecord = phase5.canonicalEventsBySourceRecord([userSandbox, hidden]);
  assert.equal(phase5.canonicalMessageRecordEligible(userSandbox, byRecord.get(userSandbox.id)), false);
  assert.equal(phase5.canonicalMessageRecordEligible(hidden, byRecord.get(hidden.id)), false);
});

test('tool-role text/code results keep complete Assistant segments canonical', () => {
  for (const contentType of ['text', 'code']) {
    const commentary = textRecord(`commentary-${contentType}`, 'assistant', 'Working.', {
      channel: 'commentary',
      end_turn: false
    });
    const call = toolCallRecord(`call-${contentType}`, 'container.exec', 'bash -lc "echo ok"');
    const result = toolResultRecord(`result-${contentType}`, contentType, contentType === 'text' ? undefined : 'ok\n');
    if (contentType === 'text') result.content.parts = ['ok'];
    const records = [call, result, commentary];
    const byRecord = phase5.canonicalEventsBySourceRecord(records);
    const events = records.map(record => byRecord.get(record.id));
    assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true);
    const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
    assert.match(rendered, new RegExp(`^## ChatGPT <!-- turn_id=commentary-${contentType} -->`));
    assert.match(rendered, new RegExp(`^### ChatGPT Commentary <!-- turn_id=commentary-${contentType} -->$`, 'm'));
  }
});

test('literal ChatGPT heading inside tool output stays opaque', () => {
  const call = toolCallRecord('opaque-heading-call', 'container.exec', 'bash -lc "cat transcript"');
  const result = toolResultRecord(
    'opaque-heading-result',
    'execution_output',
    'retrieved transcript snippet\n\n## ChatGPT\n\nThis is literal tool payload.\n'
  );
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

test('commentary plus final message is accepted as one canonical ChatGPT response', () => {
  const commentary = textRecord('split-commentary', 'assistant', 'Interim.', {
    channel: 'commentary',
    end_turn: false
  });
  const final = textRecord('split-final', 'assistant', 'Final.');
  const records = [commentary, final];
  const byRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => byRecord.get(record.id));
  assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true);
  const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=split-final -->/);
  assert.match(rendered, /^### ChatGPT Commentary <!-- turn_id=split-commentary -->$/m);
  assert.match(rendered, /> Interim\./);
  assert.match(rendered, /> Final\./);
  assert.equal((rendered.match(/^## ChatGPT(?: |$)/gm) ?? []).length, 1);
});
