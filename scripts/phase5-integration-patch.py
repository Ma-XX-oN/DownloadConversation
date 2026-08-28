from pathlib import Path
import re

SOURCE_PATH = Path('chatgpt-conversation-markdown-export.user.js')
source = SOURCE_PATH.read_text(encoding='utf-8')


def replace_once(old, new):
  global source
  count = source.count(old)
  assert count == 1, f'Expected exactly one patch anchor, found {count}: {old[:120]!r}'
  source = source.replace(old, new, 1)


replace_once('// @version      0.6.133', '// @version      0.6.134')
replace_once(
  '// @match        https://chat.openai.com/*\n// @run-at       document-start',
  '// @match        https://chat.openai.com/*\n'
  '// @require      https://raw.githubusercontent.com/Ma-XX-oN/AIConversationCore/456b14c565e0745b1cc89e6522a7f1a160a290ba/dist/aiconversationcore.chatgpt.browser.js\n'
  '// @run-at       document-start'
)

integration = r'''  // BEGIN AIConversationCore Phase 5 integration
  function canonicalCore() {
    const core = globalThis.AIConversationCore;
    assert(core && typeof core === 'object', 'AIConversationCore browser bundle is not loaded.');
    assert(typeof core.adaptChatGPTRecords === 'function', 'AIConversationCore ChatGPT adapter is unavailable.');
    assert(typeof core.renderCanonicalMarkdown === 'function', 'AIConversationCore Markdown renderer is unavailable.');
    return core;
  }

  function canonicalEventsBySourceRecord(records) {
    const events = canonicalCore().adaptChatGPTRecords(records);
    assert(Array.isArray(events), 'AIConversationCore ChatGPT adapter did not return canonical events.');
    const bySourceRecord = new Map();
    for (const event of events) {
      const sourceIndex = event?.source_index;
      const sourceRecordId = event?.source_record_id;
      if (!Number.isInteger(sourceIndex) || typeof sourceRecordId !== 'string' || !sourceRecordId) continue;
      const original = records[sourceIndex];
      assert(original?.id === sourceRecordId,
        `AIConversationCore source record mismatch at JSONL index ${sourceIndex}.`);
      assert(event?.source?.record_id === sourceRecordId,
        `AIConversationCore did not preserve source record ID ${sourceRecordId}.`);
      assert(event?.source?.record_index === sourceIndex,
        `AIConversationCore did not preserve source record index ${sourceIndex}.`);
      assert(event?.source?.record_number === sourceIndex + 1,
        `AIConversationCore did not preserve 1-based record number ${sourceIndex + 1}.`);
      assert(event?.source?.turn_id === sourceRecordId,
        `AIConversationCore source turn identity differs from record ${sourceRecordId}.`);
      assert(event?.source?.create_time === (original?.create_time ?? null),
        `AIConversationCore did not preserve create_time for ${sourceRecordId}.`);
      assert(event?.source?.update_time === (original?.update_time ?? null),
        `AIConversationCore did not preserve update_time for ${sourceRecordId}.`);
      bySourceRecord.set(sourceRecordId, event);
    }
    return bySourceRecord;
  }

  function canonicalPlainRecordEligible(record) {
    if (cgIsHidden(record)) return false;
    if (!['user', 'assistant'].includes(record?.author?.role)) return false;
    if (record?.content?.content_type !== 'text') return false;
    const parts = record?.content?.parts;
    if (!Array.isArray(parts) || !parts.length || parts.some(part => typeof part !== 'string')) return false;
    if (!parts.some(part => part.trim())) return false;
    const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    if (Array.isArray(metadata.content_references) && metadata.content_references.length) return false;
    if (Array.isArray(metadata.citations) && metadata.citations.length) return false;
    const text = parts.join('');
    if (text.includes(CG_INLINE_TOKEN_START)) return false;
    if (/sandbox:\/\/?/i.test(text)) return false;
    return true;
  }

  function canonicalPlainRecordBlock(record, event) {
    const role = record?.author?.role;
    const plainHeading = role === 'user'
      ? '## User'
      : record?.channel === 'commentary' ? '## ChatGPT Commentary' : '## ChatGPT';
    const rendered = canonicalCore().renderCanonicalMarkdown([event]).trimEnd();
    assert(rendered === plainHeading || rendered.startsWith(`${plainHeading}\n`),
      `AIConversationCore rendered an unexpected heading for source record ${record?.id ?? 'unknown'}.`);
    return `${transcriptHeading(record)}${rendered.slice(plainHeading.length)}`;
  }
  // END AIConversationCore Phase 5 integration

'''
replace_once('  function transcriptHeading(record) {', integration + '  function transcriptHeading(record) {')

replace_once(
  '    const fileRefIndex = cgBuildFileReferenceIndex(records);\n    let pendingThoughts = [];',
  '    const fileRefIndex = cgBuildFileReferenceIndex(records);\n'
  '    const canonicalEventBySourceRecord = canonicalEventsBySourceRecord(records);\n'
  '    let pendingThoughts = [];'
)

pattern = re.compile(
  r'''      const recoveredImages = recoveredImageMap\.get\(record\.id\) \?\? \[\];\n'''
  r'''      const userText = cgVisibleUserText\(record, fileRefIndex, recoveredImages\);\n'''
  r'''      if \(userText\) \{\n'''
  r'''        flushAssistantBlock\(\);\n'''
  r'''        output\.push\(`\$\{transcriptHeading\(record\)\}\\n\\n\$\{quoteMarkdown\(userText\)\}`\);\n'''
  r'''        continue;\n'''
  r'''      \}\n'''
  r'''      const assistantText = cgVisibleAssistantMarkdown\(record, fileRefIndex, recoveredImages\);\n'''
  r'''      if \(assistantText\) \{\n'''
  r'''        flushAssistantBlock\(assistantText, record\);\n'''
  r'''        continue;\n'''
  r'''      \}\n'''
)
matches = list(pattern.finditer(source))
assert len(matches) == 1, f'Expected one renderer loop anchor, found {len(matches)}.'
replacement = '''      const recoveredImages = recoveredImageMap.get(record.id) ?? [];
      const canonicalEvent = canonicalEventBySourceRecord.get(record.id) ?? null;
      if (canonicalEvent && canonicalPlainRecordEligible(record)) {
        if (record?.author?.role === 'user') {
          flushAssistantBlock();
          output.push(canonicalPlainRecordBlock(record, canonicalEvent));
          continue;
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length === 0) {
          output.push(canonicalPlainRecordBlock(record, canonicalEvent));
          continue;
        }
      }
      const userText = cgVisibleUserText(record, fileRefIndex, recoveredImages);
      if (userText) {
        flushAssistantBlock();
        output.push(`${transcriptHeading(record)}\\n\\n${quoteMarkdown(userText)}`);
        continue;
      }
      const assistantText = cgVisibleAssistantMarkdown(record, fileRefIndex, recoveredImages);
      if (assistantText) {
        flushAssistantBlock(assistantText, record);
        continue;
      }
'''
source = pattern.sub(lambda _: replacement, source, count=1)

assert source.count('BEGIN AIConversationCore Phase 5 integration') == 1
assert source.count('456b14c565e0745b1cc89e6522a7f1a160a290ba/dist/aiconversationcore.chatgpt.browser.js') == 1
SOURCE_PATH.write_text(source, encoding='utf-8')
