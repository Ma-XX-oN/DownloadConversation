from pathlib import Path

script = Path('chatgpt-conversation-markdown-export.user.js')
text = script.read_text(encoding='utf-8')
assert text.count('// @version      0.6.145') == 1
text = text.replace('// @version      0.6.145', '// @version      0.6.146', 1)

old = """      bySourceRecord.set(sourceRecordId,
        canonicalEnrichRecoveredImages(event, recoveredImageMap.get(sourceRecordId) ?? []));
"""
new = """      const enrichedEvent = canonicalEnrichRecoveredImages(
        event, recoveredImageMap.get(sourceRecordId) ?? []);
      bySourceRecord.set(sourceRecordId, enrichedEvent);
      if (diagnosticEnabled('debug')) {
        const diagnosticBlocks = Array.isArray(enrichedEvent?.blocks)
          ? enrichedEvent.blocks.filter(block =>
            block?.type === 'tool_call' || block?.type === 'tool_result')
          : [];
        if (diagnosticBlocks.length) {
          logDiagnostic('debug', 'canonical-tool-normalization', {
            source_record_id: sourceRecordId,
            source_index: sourceIndex,
            source_role: original?.author?.role ?? null,
            source_recipient: original?.recipient ?? null,
            source_channel: original?.channel ?? null,
            source_content_type: original?.content?.content_type ?? null,
            source_language: original?.content?.language ?? null,
            event_kind: enrichedEvent?.kind ?? null,
            event_role: enrichedEvent?.role ?? null,
            event_visibility: enrichedEvent?.visibility ?? null,
            blocks: diagnosticBlocks.map(block => ({
              type: block?.type ?? null,
              name: block?.name ?? null,
              input_format: block?.input_format ?? null,
              language: block?.language ?? null,
              source_language: block?.source_language ?? null,
              input_prefix: boundedDiagnosticText(block?.input ?? '', 240),
              source_input_prefix: boundedDiagnosticText(block?.source_input ?? '', 240)
            }))
          });
        }
      }
"""
assert text.count(old) == 1, 'canonical by-source insertion point changed'
text = text.replace(old, new, 1)

old = """          if (segmentEvents.length === segmentRecords.length &&
              canonicalAssistantSegmentEligible(segmentRecords, segmentEvents)) {
            output.push(canonicalAssistantSegmentBlock(segmentRecords, segmentEvents));
"""
new = """          const canonicalSegmentComplete = segmentEvents.length === segmentRecords.length;
          const canonicalSegmentEligible = canonicalSegmentComplete &&
            canonicalAssistantSegmentEligible(segmentRecords, segmentEvents);
          if (diagnosticEnabled('debug') && segmentRecords.some(item =>
              item?.content?.content_type === 'code' || item?.author?.role === 'tool')) {
            logDiagnostic('debug', 'canonical-tool-segment-routing', {
              complete: canonicalSegmentComplete,
              eligible: canonicalSegmentEligible,
              records: segmentRecords.map((item, index) => ({
                source_record_id: item?.id ?? null,
                source_role: item?.author?.role ?? null,
                source_recipient: item?.recipient ?? null,
                source_channel: item?.channel ?? null,
                source_content_type: item?.content?.content_type ?? null,
                source_language: item?.content?.language ?? null,
                event_kind: segmentEvents[index]?.kind ?? null,
                event_role: segmentEvents[index]?.role ?? null,
                event_blocks: Array.isArray(segmentEvents[index]?.blocks)
                  ? segmentEvents[index].blocks.map(block => ({
                    type: block?.type ?? null,
                    name: block?.name ?? null,
                    input_format: block?.input_format ?? null,
                    language: block?.language ?? null,
                    source_language: block?.source_language ?? null
                  }))
                  : []
              }))
            });
          }
          if (canonicalSegmentEligible) {
            output.push(canonicalAssistantSegmentBlock(segmentRecords, segmentEvents));
"""
assert text.count(old) == 1, 'canonical segment routing insertion point changed'
text = text.replace(old, new, 1)
script.write_text(text, encoding='utf-8')

test = Path('tests/tool-language-diagnostics.test.mjs')
test.write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('tool language diagnostics expose canonical normalization and production routing at debug level', () => {
  assert.match(userscript, /logDiagnostic\\('debug', 'canonical-tool-normalization'/);
  assert.match(userscript, /input_format: block\\?\\.input_format \\?\\? null/);
  assert.match(userscript, /language: block\\?\\.language \\?\\? null/);
  assert.match(userscript, /source_language: block\\?\\.source_language \\?\\? null/);
  assert.match(userscript, /source_input_prefix: boundedDiagnosticText/);
  assert.match(userscript, /logDiagnostic\\('debug', 'canonical-tool-segment-routing'/);
  assert.match(userscript, /complete: canonicalSegmentComplete/);
  assert.match(userscript, /eligible: canonicalSegmentEligible/);
});
""", encoding='utf-8')

rich = Path('tests/phase5-rich-core-integration.test.mjs')
rich_text = rich.read_text(encoding='utf-8')
old = """  currentConversationId() {
    return 'conversation-123';
  },
  CG_INLINE_TOKEN_START: '\\ue200',
"""
new = """  currentConversationId() {
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
  CG_INLINE_TOKEN_START: '\\ue200',
"""
assert rich_text.count(old) == 1, 'rich integration diagnostic harness insertion point changed'
rich.write_text(rich_text.replace(old, new, 1), encoding='utf-8')
