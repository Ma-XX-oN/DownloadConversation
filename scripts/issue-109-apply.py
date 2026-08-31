#!/usr/bin/env python3
from pathlib import Path


def replace_once(text, old, new, label):
  if old not in text:
    raise SystemExit(f'{label} insertion point not found')
  return text.replace(old, new, 1)


path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')
text = replace_once(text, '// @version      0.6.150', '// @version      0.6.151', 'version')
text = replace_once(
  text,
  'AIConversationCore/29a9fea4903f0214d450e1399a7af8e20823fcd1/dist/',
  'AIConversationCore/3233cba838bbf2d2cea5a2a6f1900ed6014dcfb0/dist/',
  'core pin',
)
text = replace_once(
  text,
  "  const SCREEN_ON_STORAGE_KEY = 'tm-conversation-recorder-screen-on-when-capturing';\n",
  "  const SCREEN_ON_STORAGE_KEY = 'tm-conversation-recorder-screen-on-when-capturing';\n"
  "  /** Local-storage key for Markdown heading timestamp visibility. */\n"
  "  const SHOW_TIMESTAMPS_STORAGE_KEY = 'tm-conversation-recorder-show-timestamps';\n"
  "  /** Local-storage key for Markdown JSONL record-number visibility. */\n"
  "  const SHOW_RECORD_NUMBERS_STORAGE_KEY = 'tm-conversation-recorder-show-record-numbers';\n",
  'storage keys',
)
text = replace_once(
  text,
  "  let screenOnWhenCapturing = localStorage.getItem(SCREEN_ON_STORAGE_KEY) !== 'false';\n",
  "  let screenOnWhenCapturing = localStorage.getItem(SCREEN_ON_STORAGE_KEY) !== 'false';\n"
  "  /** Whether Markdown headings should include local-time source timestamps. */\n"
  "  let showTimestamps = localStorage.getItem(SHOW_TIMESTAMPS_STORAGE_KEY) === 'true';\n"
  "  /** Whether Markdown headings should include one-based JSONL record numbers. */\n"
  "  let showRecordNumbers = localStorage.getItem(SHOW_RECORD_NUMBERS_STORAGE_KEY) === 'true';\n",
  'state',
)

marker = "  /**\n   * Renders one eligible canonical message event while preserving DownloadConversation source-turn identity in the transcript heading.\n"
helper_lines = [
  "  /**",
  "   * Formats one ChatGPT source timestamp like AI-transcript.py's default -d output.",
  "   *",
  "   * @param {Object} record - The provider/source record to inspect.",
  "   * @returns {string|null} Local-time YYYY-MM-DD HH:MM:SS, or null when unavailable.",
  "   */",
  "  function transcriptTimestamp(record) {",
  "    const raw = record?.create_time ?? record?.update_time;",
  "    if (raw == null) return null;",
  "    const date = new Date(Number(raw) * 1000);",
  "    if (!Number.isFinite(date.getTime())) return null;",
  "    /** Zero-pads one date/time component to two digits. */",
  "    const pad = value => String(value).padStart(2, '0');",
  "    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +",
  "      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;",
  "  }",
  "",
  "  /**",
  "   * Builds shared-core heading metadata for one ChatGPT source record.",
  "   *",
  "   * @param {Object} record - The provider/source record to inspect.",
  "   * @param {number|null} recordNumber - The one-based paired JSONL record number.",
  "   * @returns {Object} Consumer heading metadata understood by AIConversationCore.",
  "   */",
  "  function canonicalHeadingMetadata(record, recordNumber = null) {",
  "    const metadata = {};",
  "    if (showTimestamps) {",
  "      const timestamp = transcriptTimestamp(record);",
  "      if (timestamp) metadata.timestamp = timestamp;",
  "    }",
  "    if (showRecordNumbers && Number.isInteger(recordNumber)) metadata.record_number = recordNumber;",
  "    return metadata;",
  "  }",
  "",
]
text = replace_once(text, marker, '\n'.join(helper_lines) + '\n' + marker, 'heading helpers')

old = '\n'.join([
  "   * @param {Event|Object} event - The event or event-like object being handled.",
  "   * @returns {string} The string produced by `canonicalRecordBlock`.",
  "   */",
  "  function canonicalRecordBlock(record, event) {",
])
new = '\n'.join([
  "   * @param {Event|Object} event - The event or event-like object being handled.",
  "   * @param {number|null} recordNumber - The one-based paired JSONL record number.",
  "   * @returns {string} The string produced by `canonicalRecordBlock`.",
  "   */",
  "  function canonicalRecordBlock(record, event, recordNumber = null) {",
])
text = replace_once(text, old, new, 'canonicalRecordBlock signature')
old = '\n'.join([
  "    // Provider/source ID projected onto renderer-generated headings for this record.",
  "    const sourceId = typeof record?.id === 'string' ? record.id : '';",
  "    // Canonical event clone carrying only DownloadConversation heading decoration.",
  "    const projectedEvent = sourceId",
  "      ? {",
  "          ...event,",
  "          projection: {",
  "            ...(event?.projection ?? {}),",
  "            heading_suffix: ` <!-- turn_id=${sourceId} -->`",
  "          }",
  "        }",
  "      : event;",
])
new = '\n'.join([
  "    // Provider/source ID projected onto renderer-generated headings for this record.",
  "    const sourceId = typeof record?.id === 'string' ? record.id : '';",
  "    const headingMetadata = canonicalHeadingMetadata(record, recordNumber);",
  "    const hasHeadingMetadata = Object.keys(headingMetadata).length > 0;",
  "    // Canonical event clone carrying DownloadConversation presentation metadata.",
  "    const projectedEvent = (sourceId || hasHeadingMetadata)",
  "      ? {",
  "          ...event,",
  "          projection: {",
  "            ...(event?.projection ?? {}),",
  "            ...(hasHeadingMetadata ? {",
  "              heading_metadata: {",
  "                ...(event?.projection?.heading_metadata ?? {}),",
  "                ...headingMetadata",
  "              }",
  "            } : {}),",
  "            ...(sourceId ? { heading_suffix: ` <!-- turn_id=${sourceId} -->` } : {})",
  "          }",
  "        }",
  "      : event;",
])
text = replace_once(text, old, new, 'canonicalRecordBlock projection')

old = '\n'.join([
  "   * @param {Array<Object>} events - The canonical events associated with the source records.",
  "   * @returns {string} The string produced by `canonicalAssistantSegmentBlock`.",
  "   */",
  "  function canonicalAssistantSegmentBlock(records, events) {",
])
new = '\n'.join([
  "   * @param {Array<Object>} events - The canonical events associated with the source records.",
  "   * @param {Map<unknown, unknown>} recordNumberById - Paired JSONL record numbers keyed by source ID.",
  "   * @returns {string} The string produced by `canonicalAssistantSegmentBlock`.",
  "   */",
  "  function canonicalAssistantSegmentBlock(records, events, recordNumberById = new Map()) {",
])
text = replace_once(text, old, new, 'canonicalAssistantSegmentBlock signature')
old = '\n'.join([
  "      const responseHeadingSuffix = index === 0 && headingSourceId",
  "        ? ` <!-- turn_id=${headingSourceId} -->`",
  "        : '';",
  "      if (!sourceId && !responseHeadingSuffix) return event;",
  "      return {",
  "        ...event,",
  "        projection: {",
  "          ...(event?.projection ?? {}),",
  "          ...(sourceId ? { heading_suffix: ` <!-- turn_id=${sourceId} -->` } : {}),",
  "          ...(responseHeadingSuffix ? { response_heading_suffix: responseHeadingSuffix } : {})",
  "        }",
  "      };",
])
new = '\n'.join([
  "      const responseHeadingSuffix = index === 0 && headingSourceId",
  "        ? ` <!-- turn_id=${headingSourceId} -->`",
  "        : '';",
  "      const headingMetadata = canonicalHeadingMetadata(",
  "        records[index], recordNumberById.get(records[index]?.id) ?? null",
  "      );",
  "      const hasHeadingMetadata = Object.keys(headingMetadata).length > 0;",
  "      if (!sourceId && !responseHeadingSuffix && !hasHeadingMetadata) return event;",
  "      return {",
  "        ...event,",
  "        projection: {",
  "          ...(event?.projection ?? {}),",
  "          ...(hasHeadingMetadata ? {",
  "            heading_metadata: {",
  "              ...(event?.projection?.heading_metadata ?? {}),",
  "              ...headingMetadata",
  "            }",
  "          } : {}),",
  "          ...(sourceId ? { heading_suffix: ` <!-- turn_id=${sourceId} -->` } : {}),",
  "          ...(responseHeadingSuffix ? { response_heading_suffix: responseHeadingSuffix } : {})",
  "        }",
  "      };",
])
text = replace_once(text, old, new, 'assistant projection')

old = '\n'.join([
  "   * @param {Event|Object} event - The event or event-like object being handled.",
  "   * @returns {boolean} `true` when `canonicalPlainRecordBlock` succeeds or its predicate is satisfied; otherwise `false`.",
  "   */",
  "  function canonicalPlainRecordBlock(record, event) {",
  "    return canonicalRecordBlock(record, event);",
  "  }",
])
new = '\n'.join([
  "   * @param {Event|Object} event - The event or event-like object being handled.",
  "   * @param {number|null} recordNumber - The one-based paired JSONL record number.",
  "   * @returns {boolean} `true` when `canonicalPlainRecordBlock` succeeds or its predicate is satisfied; otherwise `false`.",
  "   */",
  "  function canonicalPlainRecordBlock(record, event, recordNumber = null) {",
  "    return canonicalRecordBlock(record, event, recordNumber);",
  "  }",
])
text = replace_once(text, old, new, 'plain record wrapper')

old = '\n'.join([
  "   * @param {Object} record - The provider/source record to process.",
  "   * @returns {string} The string produced by `transcriptHeading`.",
  "   */",
  "  function transcriptHeading(record) {",
  "    const id = typeof record?.id === 'string' ? record.id : '';",
  "    if (record?.author?.role === 'user') {",
  "      return `## User${id ? ` <!-- turn_id=${id} -->` : ''}`;",
  "    }",
  "    if (record?.author?.role === 'assistant' && record?.channel === 'commentary') {",
  "      return `## ChatGPT Commentary${id ? ` <!-- turn_id=${id} -->` : ''}`;",
  "    }",
  "    if (record?.author?.role === 'assistant') {",
  "      return `## ChatGPT${id ? ` <!-- turn_id=${id} -->` : ''}`;",
  "    }",
  "    return '';",
  "  }",
])
new = '\n'.join([
  "   * @param {Object} record - The provider/source record to process.",
  "   * @param {number|null} recordNumber - The one-based paired JSONL record number.",
  "   * @returns {string} The string produced by `transcriptHeading`.",
  "   */",
  "  function transcriptHeading(record, recordNumber = null) {",
  "    const id = typeof record?.id === 'string' ? record.id : '';",
  "    const headingMetadata = canonicalHeadingMetadata(record, recordNumber);",
  "    const fields = [];",
  "    if (headingMetadata.timestamp != null) fields.push(`[${headingMetadata.timestamp}]:`);",
  "    if (headingMetadata.record_number != null) fields.push(`${headingMetadata.record_number}:`);",
  "    const metadata = fields.length ? ` ${fields.join(' ')}` : '';",
  "    const turnId = id ? ` <!-- turn_id=${id} -->` : '';",
  "    if (record?.author?.role === 'user') return `## User${metadata}${turnId}`;",
  "    if (record?.author?.role === 'assistant' && record?.channel === 'commentary') {",
  "      return `## ChatGPT Commentary${metadata}${turnId}`;",
  "    }",
  "    if (record?.author?.role === 'assistant') return `## ChatGPT${metadata}${turnId}`;",
  "    return '';",
  "  }",
])
text = replace_once(text, old, new, 'fallback heading')

text = replace_once(
  text,
  "    const records = spine.records.map(item => item.message).filter(Boolean);\n    const output = [];",
  "    const records = spine.records.map(item => item.message).filter(Boolean);\n"
  "    const recordNumberById = new Map();\n"
  "    spine.records.forEach((item, index) => {\n"
  "      if (typeof item?.message?.id === 'string') recordNumberById.set(item.message.id, index + 2);\n"
  "    });\n"
  "    const output = [];",
  'record number map',
)
text = replace_once(
  text,
  "      const parts = [transcriptHeading(headingRecord)];",
  "      const parts = [transcriptHeading(headingRecord, recordNumberById.get(headingRecord?.id) ?? null)];",
  'fallback assistant heading call',
)
text = text.replace(
  "output.push(canonicalRecordBlock(record, canonicalEvent));",
  "output.push(canonicalRecordBlock(record, canonicalEvent, recordNumberById.get(record.id) ?? null));",
)
text = text.replace(
  "output.push(canonicalAssistantSegmentBlock(segmentRecords, segmentEvents));",
  "output.push(canonicalAssistantSegmentBlock(segmentRecords, segmentEvents, recordNumberById));",
)
text = replace_once(
  text,
  "output.push(`${transcriptHeading(record)}\\n\\n${quoteMarkdown(userText)}`);",
  "output.push(`${transcriptHeading(record, recordNumberById.get(record.id) ?? null)}\\n\\n${quoteMarkdown(userText)}`);",
  'fallback user heading call',
)

text = replace_once(
  text,
  "    const md = panel.querySelector('[data-role=\"format-md\"]');\n    const test = panel.querySelector('[data-role=\"test\"]');",
  "    const md = panel.querySelector('[data-role=\"format-md\"]');\n"
  "    const timestamps = panel.querySelector('[data-role=\"show-timestamps\"]');\n"
  "    const recordNumbers = panel.querySelector('[data-role=\"show-record-numbers\"]');\n"
  "    const test = panel.querySelector('[data-role=\"test\"]');",
  'UI lookup',
)
text = replace_once(
  text,
  "    if (jsonl) jsonl.disabled = exportInProgress || testInProgress || jumpInProgress;\n"
  "    if (md) md.disabled = exportInProgress || testInProgress || jumpInProgress;",
  "    if (jsonl) jsonl.disabled = exportInProgress || testInProgress || jumpInProgress;\n"
  "    if (md) md.disabled = exportInProgress || testInProgress || jumpInProgress;\n"
  "    const metadataDisabled = exportInProgress || testInProgress || jumpInProgress || !md?.checked;\n"
  "    if (timestamps) timestamps.disabled = metadataDisabled;\n"
  "    if (recordNumbers) recordNumbers.disabled = metadataDisabled;",
  'UI disabled state',
)
text = replace_once(
  text,
  "      <div class=\"tm-row tm-extract-formats\"><button data-role=\"extract\" type=\"button\">Extract</button><label><input data-role=\"format-jsonl\" type=\"checkbox\"> JSONL</label><label><input data-role=\"format-md\" type=\"checkbox\" checked> MD</label></div>\n",
  "      <div class=\"tm-row tm-extract-formats\"><button data-role=\"extract\" type=\"button\">Extract</button><label><input data-role=\"format-jsonl\" type=\"checkbox\"> JSONL</label><label><input data-role=\"format-md\" type=\"checkbox\" checked> MD</label></div>\n"
  "      <div class=\"tm-row tm-md-metadata\"><span class=\"tm-label\">MD headings</span><label><input data-role=\"show-timestamps\" type=\"checkbox\"> Timestamp</label><label><input data-role=\"show-record-numbers\" type=\"checkbox\"> Record #</label></div>\n",
  'UI metadata controls',
)
listener_marker = "    /**\n     * Handles run selected exports.\n"
listener_lines = [
  "    const timestamps = panel.querySelector('[data-role=\"show-timestamps\"]');",
  "    const recordNumbers = panel.querySelector('[data-role=\"show-record-numbers\"]');",
  "    if (timestamps) {",
  "      timestamps.checked = showTimestamps;",
  "      timestamps.addEventListener('change', () => {",
  "        showTimestamps = timestamps.checked;",
  "        localStorage.setItem(SHOW_TIMESTAMPS_STORAGE_KEY, String(showTimestamps));",
  "        updateUi();",
  "      });",
  "    }",
  "    if (recordNumbers) {",
  "      recordNumbers.checked = showRecordNumbers;",
  "      recordNumbers.addEventListener('change', () => {",
  "        showRecordNumbers = recordNumbers.checked;",
  "        localStorage.setItem(SHOW_RECORD_NUMBERS_STORAGE_KEY, String(showRecordNumbers));",
  "        updateUi();",
  "      });",
  "    }",
  "",
]
text = replace_once(text, listener_marker, '\n'.join(listener_lines) + listener_marker, 'UI listeners')
path.write_text(text, encoding='utf-8')

core_test = Path('tests/core-integration.test.mjs')
test_text = core_test.read_text(encoding='utf-8')
test_text = replace_once(
  test_text,
  "assert.equal(requireMatch[2], '29a9fea4903f0214d450e1399a7af8e20823fcd1');",
  "assert.equal(requireMatch[2], '3233cba838bbf2d2cea5a2a6f1900ed6014dcfb0');",
  'test core pin',
)
test_text = replace_once(
  test_text,
  "Object.assign(context, {\n  assert(condition, message) {",
  "Object.assign(context, {\n  showTimestamps: false,\n  showRecordNumbers: false,\n  assert(condition, message) {",
  'test metadata globals',
)
needle = "test('canonical plain production slice preserves source heading identity and JSONL provenance', () => {\n"
feature = '\n'.join([
  "test('canonical heading metadata uses the shared core and paired JSONL numbering', () => {",
  "  const record = textRecord('metadata-user', 'user', 'Hello', { create_time: 1767225600 });",
  "  const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);",
  "  context.showRecordNumbers = true;",
  "  const numbered = phase5.canonicalPlainRecordBlock(record, event, 2);",
  "  assert.match(numbered, /^## User 2: <!-- turn_id=metadata-user -->/);",
  "  context.showTimestamps = true;",
  "  const dated = phase5.canonicalPlainRecordBlock(record, event, 2);",
  "  assert.match(dated, /^## User \\[\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\]: 2: <!-- turn_id=metadata-user -->/);",
  "  context.showTimestamps = false;",
  "  context.showRecordNumbers = false;",
  "});",
  "",
  "",
])
test_text = replace_once(test_text, needle, feature + needle, 'feature regression')
core_test.write_text(test_text, encoding='utf-8')

ui_test = Path('tests/recorder-panel-ui.test.mjs')
ui_text = ui_test.read_text(encoding='utf-8')
ui_needle = "  assert.match(userscript, /data-role=\"format-md\" type=\"checkbox\" checked> MD/);\n"
ui_extra = '\n'.join([
  "  assert.match(userscript, /data-role=\"show-timestamps\" type=\"checkbox\"> Timestamp/);",
  "  assert.match(userscript, /data-role=\"show-record-numbers\" type=\"checkbox\"> Record #/);",
  "  assert.match(userscript, /SHOW_TIMESTAMPS_STORAGE_KEY/);",
  "  assert.match(userscript, /SHOW_RECORD_NUMBERS_STORAGE_KEY/);",
  "",
])
ui_text = replace_once(ui_text, ui_needle, ui_needle + ui_extra, 'UI regression')
ui_test.write_text(ui_text, encoding='utf-8')

design = Path('DESIGN.md')
design_text = design.read_text(encoding='utf-8')
if '## Optional Markdown heading metadata' not in design_text:
  design_text = design_text.rstrip() + '\n\n' + '\n'.join([
    '## Optional Markdown heading metadata',
    '',
    'The recorder exposes independent **Timestamp** and **Record #** controls for',
    'Markdown exports.  Both are presentation-only.  Timestamp formatting matches',
    '`AI-transcript.py -d` (`YYYY-MM-DD HH:MM:SS` in local time), while record',
    'numbers are the one-based JSONL line numbers from the paired export.  Because',
    'DownloadConversation prepends a conversation-metadata record, the first',
    'Conversation API message is JSONL record 2.  Existing source `turn_id` comments',
    'remain unchanged.  Canonical records pass this metadata through',
    'AIConversationCore; the legacy fallback path preserves the same visible format.',
    '',
  ])
  design.write_text(design_text, encoding='utf-8')
