from pathlib import Path

SOURCE_PATH = Path('chatgpt-conversation-markdown-export.user.js')
TEST_PATH = Path('tests/tool-language-diagnostics.test.mjs')


def replace_once(source, old, new, label):
  count = source.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected exactly one match, found {count}')
  return source.replace(old, new, 1)


source = SOURCE_PATH.read_text(encoding='utf-8')

source = replace_once(
  source,
  '// @version      0.6.162',
  '// @version      0.6.163',
  'version bump'
)

helper_marker = '''  /**
   * Handles diagnostic request path.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `diagnosticRequestPath`.
   */
  function diagnosticRequestPath(url) {'''
helper_insert = '''  /**
   * Computes a deterministic FNV-1a fingerprint for diagnostic correlation without logging transcript content.
   *
   * @param {string} text - The rendered text whose diagnostic fingerprint is required.
   * @returns {string} Eight-character lowercase hexadecimal FNV-1a fingerprint.
   */
  function diagnosticTextHash(text) {
    const value = String(text ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * Summarizes source turn IDs present in rendered Markdown so pipeline stages can be compared without logging message bodies.
   *
   * @param {string} markdown - The rendered Markdown whose turn IDs are summarized.
   * @param {number} tailCount - Maximum number of trailing turn IDs to retain.
   * @returns {Object} Count and trailing source turn IDs found in the rendered Markdown.
   */
  function diagnosticMarkdownTurnInventory(markdown, tailCount = 12) {
    const ids = [...String(markdown ?? '').matchAll(/<!-- turn_id=([^\\s>]+) -->/g)]
      .map(match => match[1]);
    return {
      count: ids.length,
      tail: ids.slice(-Math.max(0, tailCount))
    };
  }

  /**
   * Handles diagnostic request path.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `diagnosticRequestPath`.
   */
  function diagnosticRequestPath(url) {'''
source = replace_once(source, helper_marker, helper_insert, 'diagnostic helpers')

segment_return = '''    return canonicalCore().renderCanonicalMarkdown(projectedEvents).trimEnd();
  }'''
segment_instrumented = '''    const rendered = canonicalCore().renderCanonicalMarkdown(projectedEvents).trimEnd();
    if (diagnosticEnabled('debug')) {
      logDiagnostic('debug', 'canonical-assistant-segment-rendered', {
        source_record_ids: records.map(record => record?.id ?? null),
        final_source_record_id: messageRecord?.id ?? null,
        event_kinds: events.map(event => event?.kind ?? null),
        rendered_length: rendered.length,
        rendered_hash: diagnosticTextHash(rendered),
        rendered_turn_ids: diagnosticMarkdownTurnInventory(rendered)
      });
    }
    return rendered;
  }'''
source = replace_once(
  source,
  segment_return,
  segment_instrumented,
  'canonical segment rendered boundary'
)

routing_fields = '''              complete: canonicalSegmentComplete,
              eligible: canonicalSegmentEligible,
              records: segmentRecords.map((item, index) => ({'''
routing_fields_new = '''              complete: canonicalSegmentComplete,
              eligible: canonicalSegmentEligible,
              rejection_reason: canonicalSegmentEligible
                ? null
                : (!canonicalSegmentComplete ? 'missing-canonical-events' : 'unsupported-canonical-segment'),
              records: segmentRecords.map((item, index) => ({'''
source = replace_once(
  source,
  routing_fields,
  routing_fields_new,
  'segment routing rejection reason'
)

accepted_segment = '''          if (canonicalSegmentEligible) {
            output.push(canonicalAssistantSegmentBlock(segmentRecords, segmentEvents, recordNumberById));
            pendingThoughts = [];
            continue;
          }'''
accepted_segment_new = '''          if (canonicalSegmentEligible) {
            logDiagnostic('debug', 'conversation-markdown-segment-render-request', {
              source_record_ids: segmentRecords.map(item => item?.id ?? null),
              final_source_record_id: record?.id ?? null,
              event_kinds: segmentEvents.map(event => event?.kind ?? null),
              output_index_before_append: output.length
            });
            const renderedSegment = canonicalAssistantSegmentBlock(segmentRecords, segmentEvents, recordNumberById);
            output.push(renderedSegment);
            logDiagnostic('debug', 'conversation-markdown-block-appended', {
              route: 'canonical-assistant-segment',
              output_index: output.length - 1,
              source_record_ids: segmentRecords.map(item => item?.id ?? null),
              final_source_record_id: record?.id ?? null,
              block_length: renderedSegment.length,
              block_hash: diagnosticTextHash(renderedSegment),
              block_turn_ids: diagnosticMarkdownTurnInventory(renderedSegment)
            });
            pendingThoughts = [];
            continue;
          }'''
source = replace_once(
  source,
  accepted_segment,
  accepted_segment_new,
  'accepted segment boundaries'
)

render_tail = '''      if (cgRenderThoughtItem(record, fileRefIndex)) pendingThoughts.push(record);
    }
    flushPendingAssistant();
    return `${output.join('\\n\\n')}\\n`;
  }'''
render_tail_new = '''      const fallbackThought = cgRenderThoughtItem(record, fileRefIndex);
      if (fallbackThought) {
        pendingThoughts.push(record);
        continue;
      }
      if (diagnosticEnabled('debug') && i >= Math.max(0, records.length - 32)) {
        logDiagnostic('debug', 'conversation-markdown-record-excluded', {
          source_index: i,
          source_record_id: record?.id ?? null,
          source_role: record?.author?.role ?? null,
          source_recipient: record?.recipient ?? null,
          source_channel: record?.channel ?? null,
          source_content_type: record?.content?.content_type ?? null,
          event_kind: canonicalEvent?.kind ?? null,
          event_visibility: canonicalEvent?.visibility ?? null,
          reason: 'no-canonical-or-fallback-renderer-produced-output'
        });
      }
    }
    flushPendingAssistant();
    const markdown = `${output.join('\\n\\n')}\\n`;
    if (diagnosticEnabled('debug')) {
      logDiagnostic('debug', 'conversation-markdown-assembled', {
        source_record_count: records.length,
        output_block_count: output.length,
        markdown_length: markdown.length,
        markdown_hash: diagnosticTextHash(markdown),
        markdown_turn_ids: diagnosticMarkdownTurnInventory(markdown, 32),
        source_tail: records.slice(-32).map((record, offset) => ({
          source_index: records.length - Math.min(32, records.length) + offset,
          source_record_id: record?.id ?? null,
          source_role: record?.author?.role ?? null,
          source_recipient: record?.recipient ?? null,
          source_channel: record?.channel ?? null,
          source_content_type: record?.content?.content_type ?? null
        }))
      });
    }
    return markdown;
  }'''
source = replace_once(source, render_tail, render_tail_new, 'assembled markdown boundary')

download_start = '''  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);'''
download_start_new = '''  function downloadBlob(blob, filename) {
    logDiagnostic('debug', 'conversation-download-triggered', {
      filename: String(filename ?? ''),
      blob_size: Number.isFinite(blob?.size) ? blob.size : null,
      blob_type: typeof blob?.type === 'string' ? blob.type : null
    });
    const url = URL.createObjectURL(blob);'''
source = replace_once(source, download_start, download_start_new, 'download trigger boundary')

markdown_download = '''        const filename = `${sanitizeFileName(conversationTitle())}.md`;
        downloadBlob(
          new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
          filename
        );'''
markdown_download_new = '''        const filename = `${sanitizeFileName(conversationTitle())}.md`;
        logDiagnostic('debug', 'conversation-export-markdown-ready', {
          filename,
          source_record_count: spine.records.length,
          source_tail: spine.records.slice(-32).map(item => ({
            source_record_id: item?.message_id ?? item?.message?.id ?? null,
            source_role: item?.role ?? item?.message?.author?.role ?? null,
            source_channel: item?.channel ?? item?.message?.channel ?? null,
            source_content_type: item?.content_type ?? item?.message?.content?.content_type ?? null
          })),
          markdown_length: markdown.length,
          markdown_hash: diagnosticTextHash(markdown),
          markdown_turn_ids: diagnosticMarkdownTurnInventory(markdown, 32)
        });
        const markdownBlob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        logDiagnostic('debug', 'conversation-export-blob-created', {
          filename,
          markdown_length: markdown.length,
          markdown_hash: diagnosticTextHash(markdown),
          blob_size: markdownBlob.size,
          blob_type: markdownBlob.type
        });
        downloadBlob(markdownBlob, filename);'''
source = replace_once(source, markdown_download, markdown_download_new, 'markdown blob boundary')

SOURCE_PATH.write_text(source, encoding='utf-8')

test_source = TEST_PATH.read_text(encoding='utf-8')
if "test('issue 114 traces an accepted assistant segment" in test_source:
  raise RuntimeError('issue 114 instrumentation test already exists')
test_source = test_source.rstrip() + '''


test('issue 114 traces an accepted assistant segment through Markdown assembly and download boundaries', () => {
  assert.match(userscript, /logDiagnostic\\('debug', 'canonical-assistant-segment-rendered'/);
  assert.match(userscript, /logDiagnostic\\('debug', 'conversation-markdown-segment-render-request'/);
  assert.match(userscript, /logDiagnostic\\('debug', 'conversation-markdown-block-appended'/);
  assert.match(userscript, /logDiagnostic\\('debug', 'conversation-markdown-assembled'/);
  assert.match(userscript, /logDiagnostic\\('debug', 'conversation-export-markdown-ready'/);
  assert.match(userscript, /logDiagnostic\\('debug', 'conversation-export-blob-created'/);
  assert.match(userscript, /logDiagnostic\\('debug', 'conversation-download-triggered'/);
  assert.match(userscript, /rejection_reason: canonicalSegmentEligible/);
  assert.match(userscript, /reason: 'no-canonical-or-fallback-renderer-produced-output'/);
  assert.match(userscript, /function diagnosticTextHash\\(text\\)/);
  assert.match(userscript, /function diagnosticMarkdownTurnInventory\\(markdown, tailCount = 12\\)/);
});
'''
TEST_PATH.write_text(test_source, encoding='utf-8')
