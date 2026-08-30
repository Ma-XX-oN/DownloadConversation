from pathlib import Path

script = Path('chatgpt-conversation-markdown-export.user.js')
text = script.read_text(encoding='utf-8')

assert text.count('// @version      0.6.147') == 1, 'userscript version changed'
text = text.replace('// @version      0.6.147', '// @version      0.6.148', 1)

old = """    let messageIndex = -1;
    let hasAssistantSource = false;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const event = events[index];
      if (record?.author?.role === 'assistant') hasAssistantSource = true;
      if (canonicalMessageRecordEligible(record, event)) {
        if (record?.author?.role !== 'assistant' || messageIndex >= 0) return false;
        messageIndex = index;
        continue;
      }
      if (!canonicalThoughtRecordEligible(record, event)) return false;
    }
    if (!hasAssistantSource) return false;
    if (messageIndex >= 0 && messageIndex !== records.length - 1) return false;
    const rendered = canonicalCore().renderCanonicalMarkdown(events);
"""
new = """    let messageIndex = -1;
    let messageEventKind = null;
    let hasAssistantSource = false;
    let hasCommentaryEvent = false;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const event = events[index];
      if (record?.author?.role === 'assistant') hasAssistantSource = true;
      if (event?.kind === 'commentary') hasCommentaryEvent = true;
      if (canonicalMessageRecordEligible(record, event)) {
        if (record?.author?.role !== 'assistant' || messageIndex >= 0) return false;
        messageIndex = index;
        messageEventKind = event?.kind ?? null;
        continue;
      }
      if (!canonicalThoughtRecordEligible(record, event)) return false;
    }
    if (!hasAssistantSource) return false;
    if (messageIndex >= 0 && messageIndex !== records.length - 1) return false;
    // AIConversationCore projects commentary and a final Assistant message as
    // separate transcript sections. Reject that semantic combination here
    // rather than scanning rendered payload text for heading-looking lines.
    if (messageEventKind === 'message' && hasCommentaryEvent) return false;
    const rendered = canonicalCore().renderCanonicalMarkdown(events);
"""
assert text.count(old) == 1, 'canonicalAssistantSegmentEligible target changed'
text = text.replace(old, new, 1)

old = """    assert(rendered === plainHeading || rendered.startsWith(`${plainHeading}\\n`),
      'AIConversationCore rendered an unexpected Assistant segment heading.');
    assert(!rendered.slice(plainHeading.length).includes('\\n## ChatGPT'),
      'AIConversationCore Assistant segment unexpectedly produced multiple transcript sections.');
    return `${transcriptHeading(headingRecord)}${rendered.slice(plainHeading.length)}`;
"""
new = """    assert(rendered === plainHeading || rendered.startsWith(`${plainHeading}\\n`),
      'AIConversationCore rendered an unexpected Assistant segment heading.');
    return `${transcriptHeading(headingRecord)}${rendered.slice(plainHeading.length)}`;
"""
assert text.count(old) == 1, 'canonicalAssistantSegmentBlock raw heading scan changed'
text = text.replace(old, new, 1)

old = """    } catch (error) {
      setStatus(
        `${kind === 'md' ? 'Markdown' : 'JSONL'} extraction failed: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
"""
new = """    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDiagnostic('errors', 'conversation-export-failure', {
        kind,
        stage: progressState?.stage ?? null,
        record_number: progressState?.record_number ?? null,
        record_count: progressState?.record_count ?? null,
        message
      });
      setStatus(
        `${kind === 'md' ? 'Markdown' : 'JSONL'} extraction failed: ${message}`
      );
"""
assert text.count(old) == 1, 'runExport catch target changed'
text = text.replace(old, new, 1)
script.write_text(text, encoding='utf-8')

test = Path('tests/phase5-rich-core-integration.test.mjs')
value = test.read_text(encoding='utf-8')
assert "literal ChatGPT heading inside tool output stays opaque" not in value, 'regression already present'
value += r'''

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
'''
test.write_text(value, encoding='utf-8')

core = Path('tests/core-integration.test.mjs')
value = core.read_text(encoding='utf-8')
assert "conversation-export-failure" not in value, 'failure diagnostic regression already present'
value += r'''

test('production export catch records exact extraction failure diagnostics', () => {
  const start = userscript.indexOf('  async function runExport(kind)');
  const end = userscript.indexOf('\n  async function testApiPaginationLogic()', start);
  assert.ok(start >= 0 && end > start, 'runExport production function is missing.');
  const production = userscript.slice(start, end);
  assert.match(production, /logDiagnostic\('errors', 'conversation-export-failure'/);
  assert.match(production, /record_number: progressState\?\.record_number \?\? null/);
  assert.match(production, /record_count: progressState\?\.record_count \?\? null/);
});
'''
core.write_text(value, encoding='utf-8')
