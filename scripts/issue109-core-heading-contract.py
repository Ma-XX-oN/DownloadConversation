from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
CORE_OLD = '3233cba838bbf2d2cea5a2a6f1900ed6014dcfb0'
CORE_NEW = 'b7961cb8dab11611a5af8f4304ae783295998cf2'
AIGM_OLD = '070e7436ca68d4897f99cf86e92f9ee97b87ee02'
AIGM_NEW = '8c642e5f0bb83a596587985db3dae7c0b61b6f36'


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected one occurrence, found {count}')
  return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label, flags=0):
  updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
  if count != 1:
    raise SystemExit(f'{label}: expected one regex match, found {count}')
  return updated


script_path = ROOT / 'chatgpt-conversation-markdown-export.user.js'
script = script_path.read_text(encoding='utf-8')
script = replace_once(script, '// @version      0.6.172', '// @version      0.6.173', 'userscript version')
script = replace_once(script, CORE_OLD, CORE_NEW, 'userscript Core pin')
script = replace_once(
  script,
  "let showTurnIds = localStorage.getItem(SHOW_TURN_IDS_STORAGE_KEY) !== 'false';",
  "let showTurnIds = localStorage.getItem(SHOW_TURN_IDS_STORAGE_KEY) === 'true';",
  'Turn ID default',
)
script = replace_once(
  script,
  "const adapterRecords = conversationId && !hasMetadata\n      ? [...records, {\n          record_type: 'chatgpt_conversation_metadata',\n          schema_version: 1,\n          conversation_id: conversationId\n        }]\n      : records;",
  "const adapterRecords = conversationId && !hasMetadata\n      ? [{\n          record_type: 'chatgpt_conversation_metadata',\n          schema_version: 1,\n          conversation_id: conversationId\n        }, ...records]\n      : records;",
  'prepend metadata record',
)
script = replace_once(
  script,
  '      const original = records[sourceIndex];',
  '      const original = adapterRecords[sourceIndex];',
  'adapter source invariant',
)

old_heading_helpers = '''  /**
   * Formats one ChatGPT source timestamp like AI-transcript.py's default -d output.
   *
   * @param {Object} record - The provider/source record to inspect.
   * @returns {string|null} Local-time YYYY-MM-DD HH:MM:SS, or null when unavailable.
   */
  function transcriptTimestamp(record) {
    const raw = record?.create_time ?? record?.update_time;
    if (raw == null) return null;
    const date = new Date(Number(raw) * 1000);
    if (!Number.isFinite(date.getTime())) return null;
    /**
     * Zero-pads one date/time component to two digits.
     *
     * @param {number} value - Numeric date/time component to pad.
     * @returns {string} Two-character decimal representation.
     */
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  /**
   * Builds shared-core heading metadata for one ChatGPT source record.
   *
   * @param {Object} record - The provider/source record to inspect.
   * @param {number|null} recordNumber - The one-based paired JSONL record number.
   * @returns {Object} Consumer heading metadata understood by AIConversationCore.
   */
  function canonicalHeadingMetadata(record, recordNumber = null) {
    const metadata = {};
    if (showTimestamps) {
      const timestamp = transcriptTimestamp(record);
      if (timestamp) metadata.timestamp = timestamp;
    }
    if (showRecordNumbers && Number.isInteger(recordNumber)) metadata.record_number = recordNumber;
    return metadata;
  }
'''
new_heading_helpers = '''  /**
   * Returns the current AIConversationCore heading-presentation policy.
   *
   * DownloadConversation selects visibility only. Timestamp values, JSONL record
   * numbers, and source turn IDs are derived by Core from canonical provenance.
   *
   * @returns {Object} AIConversationCore Markdown projection options.
   */
  function canonicalHeadingOptions() {
    return {
      heading: {
        timestamp: showTimestamps,
        recordNumber: showRecordNumbers,
        turnId: showTurnIds
      }
    };
  }
'''
script = replace_once(script, old_heading_helpers, new_heading_helpers, 'Core heading policy helper')

script = regex_once(
  script,
  r'''  /\*\*\n   \* Renders one eligible canonical message event[\s\S]*?\n  function canonicalRecordBlock\(record, event, recordNumber = null\) \{[\s\S]*?\n  \}\n\n  /\*\*\n   \* Determines whether one non-message canonical Assistant activity event''',
  '''  /**
   * Renders one eligible canonical message event through AIConversationCore.
   *
   * Source/canonical -> output transformation: DownloadConversation supplies only
   * heading visibility policy. Core derives timestamp, JSONL record number, and
   * provider/source turn identity from canonical source provenance.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The canonical event associated with the source record.
   * @returns {string} Canonical Markdown for the source record.
   */
  function canonicalRecordBlock(record, event) {
    assert(canonicalMessageRecordEligible(record, event),
      `AIConversationCore message record ${record?.id ?? 'unknown'} is not eligible for canonical rendering.`);
    return canonicalCore().renderCanonicalMarkdown([event], canonicalHeadingOptions()).trimEnd();
  }

  /**
   * Determines whether one non-message canonical Assistant activity event''',
  'canonical record renderer',
)

script = regex_once(
  script,
  r'''  /\*\*\n   \* Renders one eligible canonical Assistant activity segment[\s\S]*?\n  function canonicalAssistantSegmentBlock\(records, events, recordNumberById = new Map\(\)\) \{[\s\S]*?\n    return rendered;\n  \}\n''',
  '''  /**
   * Renders one eligible canonical Assistant activity segment through AIConversationCore.
   *
   * Source/canonical -> output transformation: DownloadConversation preserves the
   * ordered canonical segment and supplies only heading visibility policy. Core owns
   * all semantic heading values for the response and Commentary descendants.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @param {Array<Object>} events - The canonical events associated with the source records.
   * @returns {string} Canonical Markdown for the Assistant segment.
   */
  function canonicalAssistantSegmentBlock(records, events) {
    assert(canonicalAssistantSegmentEligible(records, events),
      'AIConversationCore Assistant segment contains an unsupported record.');
    /** Final ordinary Assistant message retained only for compact diagnostics. */
    const messageRecord = [...records].reverse().find((record, indexFromEnd) => {
      const index = records.length - 1 - indexFromEnd;
      return canonicalMessageRecordEligible(record, events[index]);
    }) ?? null;
    const rendered = canonicalCore().renderCanonicalMarkdown(events, canonicalHeadingOptions()).trimEnd();
    if (diagnosticEnabled('debug')) {
      logDiagnostic('debug', 'canonical-assistant-segment-rendered', {
        source_record_ids: records.map(record => record?.id ?? null),
        final_source_record_id: messageRecord?.id ?? null,
        event_kinds: events.map(event => event?.kind ?? null),
        rendered_length: rendered.length
      });
    }
    return rendered;
  }
''',
  'canonical Assistant segment renderer',
)

script = replace_once(
  script,
  '''   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The event or event-like object being handled.
   * @param {number|null} recordNumber - The one-based paired JSONL record number.
   * @returns {boolean} `true` when `canonicalPlainRecordBlock` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalPlainRecordBlock(record, event, recordNumber = null) {
    return canonicalRecordBlock(record, event, recordNumber);
  }''',
  '''   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The canonical event associated with the source record.
   * @returns {string} Canonical Markdown for the plain record.
   */
  function canonicalPlainRecordBlock(record, event) {
    return canonicalRecordBlock(record, event);
  }''',
  'plain record compatibility renderer',
)

old_transcript_heading = '''  /**
   * Builds the DownloadConversation transcript heading from the actual provider/source record.
   *
   * Source -> output transformation: the source record ID is emitted as the `turn_id` comment; it is intentionally not replaced by AIConversationCore derived turn identity.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {number|null} recordNumber - The one-based paired JSONL record number.
   * @returns {string} The string produced by `transcriptHeading`.
   */
  function transcriptHeading(record, recordNumber = null) {
    const id = typeof record?.id === 'string' ? record.id : '';
    const headingMetadata = canonicalHeadingMetadata(record, recordNumber);
    const fields = [];
    if (headingMetadata.timestamp != null) fields.push(`[${headingMetadata.timestamp}]:`);
    if (headingMetadata.record_number != null) fields.push(`${headingMetadata.record_number}:`);
    const metadata = fields.length ? ` ${fields.join(' ')}` : '';
    const turnId = showTurnIds && id ? ` <!-- turn_id=${id} -->` : '';
    if (record?.author?.role === 'user') return `## User${metadata}${turnId}`;
    if (record?.author?.role === 'assistant' && record?.channel === 'commentary') {
      return `## ChatGPT Commentary${metadata}${turnId}`;
    }
    if (record?.author?.role === 'assistant') return `## ChatGPT${metadata}${turnId}`;
    return '';
  }
'''
new_transcript_heading = '''  /**
   * Returns the Core-rendered heading for a fallback-rendered source record.
   *
   * The fallback body remains host-rendered, but heading metadata is serialized by
   * AIConversationCore from the same canonical event and visibility policy used by
   * canonical bodies. If no canonical event exists, the established plain speaker
   * heading is preserved without inventing metadata.
   *
   * @param {Object} record - The provider/source record whose speaker heading is required.
   * @param {Event|Object|null} event - The canonical event supplying source provenance, when available.
   * @returns {string} Core-rendered transcript heading or the existing plain speaker heading.
   */
  function transcriptHeading(record, event = null) {
    if (event) {
      const rendered = canonicalCore().renderCanonicalMarkdown([event], canonicalHeadingOptions()).trimEnd();
      const lines = rendered.split('\\n');
      if (record?.author?.role === 'assistant' && record?.channel === 'commentary') {
        const commentary = lines.find(line => /^### ChatGPT Commentary(?: |$)/.test(line));
        if (commentary) return commentary.replace(/^### /, '## ');
      }
      const topLevel = lines.find(line => /^## (?:User|ChatGPT)(?: |$)/.test(line));
      if (topLevel) return topLevel;
    }
    if (record?.author?.role === 'user') return '## User';
    if (record?.author?.role === 'assistant' && record?.channel === 'commentary') return '## ChatGPT Commentary';
    if (record?.author?.role === 'assistant') return '## ChatGPT';
    return '';
  }
'''
script = replace_once(script, old_transcript_heading, new_transcript_heading, 'fallback Core-owned heading')

record_map_pattern = r'''    const recordNumberById = new Map\(\);\n    spine\.records\.forEach\(\(item, index\) => \{\n      if \(typeof item\?\.message\?\.id === 'string'\) recordNumberById\.set\(item\.message\.id, index \+ 2\);\n    \}\);\n'''
script = regex_once(script, record_map_pattern, '', 'remove consumer record-number map')
script = script.replace('canonicalAssistantSegmentBlock(pendingThoughts, events, recordNumberById)', 'canonicalAssistantSegmentBlock(pendingThoughts, events)')
script = script.replace('canonicalAssistantSegmentBlock(segmentRecords, segmentEvents, recordNumberById)', 'canonicalAssistantSegmentBlock(segmentRecords, segmentEvents)')
script = script.replace('canonicalRecordBlock(record, canonicalEvent, recordNumberById.get(record.id) ?? null)', 'canonicalRecordBlock(record, canonicalEvent)')
script = replace_once(
  script,
  'const parts = [transcriptHeading(headingRecord, recordNumberById.get(headingRecord?.id) ?? null)];',
  'const parts = [transcriptHeading(headingRecord, canonicalEventBySourceRecord.get(headingRecord?.id) ?? null)];',
  'fallback Assistant heading event',
)
script = replace_once(
  script,
  'output.push(`${transcriptHeading(record, recordNumberById.get(record.id) ?? null)}\\n\\n${quoteMarkdown(userText)}`);',
  'output.push(`${transcriptHeading(record, canonicalEvent)}\\n\\n${quoteMarkdown(userText)}`);',
  'fallback User heading event',
)

script = replace_once(
  script,
  '''    const u1 = markdown.indexOf('<!-- turn_id=u1 -->');
    const a1 = markdown.indexOf('<!-- turn_id=a1 -->');
    const u2 = markdown.indexOf('<!-- turn_id=u2 -->');
    const a2 = markdown.indexOf('<!-- turn_id=a2 -->');
    assert(u1 >= 0 && a1 >= 0 && u2 >= 0 && a2 >= 0,
      'chronological rendering test did not emit all expected headings.');
    assert(u1 < a1 && a1 < u2 && u2 < a2,
      'Conversation API Markdown rendering did not preserve chronological record order.');''',
  '''    const u1 = markdown.indexOf('First User');
    const a1 = markdown.indexOf('First Assistant');
    const u2 = markdown.indexOf('Second User');
    const a2 = markdown.indexOf('Second Assistant');
    assert(u1 >= 0 && a1 >= 0 && u2 >= 0 && a2 >= 0,
      'chronological rendering test did not emit all expected source content.');
    assert(u1 < a1 && a1 < u2 && u2 < a2,
      'Conversation API Markdown rendering did not preserve chronological record order.');''',
  'built-in chronology test',
)
script_path.write_text(script, encoding='utf-8')

# DESIGN: replace both obsolete duplicate sections with the final Core-owned contract.
design_path = ROOT / 'DESIGN.md'
design = design_path.read_text(encoding='utf-8')
heading_start = design.index('## Optional Markdown heading metadata')
heading_end = design.index('## Image recovery and export performance diagnostics', heading_start)
new_design = '''## Optional Markdown heading metadata

DownloadConversation exposes three independent persistent Markdown-heading controls:

- **Timestamp**: Core derives the source create/update timestamp and renders local
  `YYYY-MM-DD HH:MM:SS` presentation. Default: off.
- **Record #**: Core derives the one-based JSONL record number from canonical
  source provenance. DownloadConversation prepends conversation metadata as JSONL
  record 1, so the first visible ChatGPT source message is record 2. Default: off.
- **Turn ID**: Core derives the ChatGPT native source/message ID and renders it as
  visible `turn_id=...` heading metadata. Default: off.

The visible order is speaker, timestamp, record number, then Turn ID. Ordinary
Markdown does not encode Turn ID as an HTML comment. DownloadConversation supplies
only these presentation visibility switches to AIConversationCore; it does not
format timestamps, compute record numbers, or inject semantic turn IDs itself.
Canonical and host fallback bodies therefore use the same Core-owned heading
serialization. These controls do not change chronology, grouping, UAP association,
API pagination, recovery, or canonical normalization.

'''
design = design[:heading_start] + new_design + design[heading_end:]
design_path.write_text(design, encoding='utf-8')

# Update the permanent dependency pins first.
ci_path = ROOT / '.github/workflows/ci.yml'
ci = ci_path.read_text(encoding='utf-8').replace(CORE_OLD, CORE_NEW).replace(AIGM_OLD, AIGM_NEW)
ci_path.write_text(ci, encoding='utf-8')

# Static heading-control regression: final defaults and ownership boundary.
heading_test = ROOT / 'tests/heading-metadata-controls.test.mjs'
heading_test.write_text('''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('heading metadata controls default off and Core owns semantic values', () => {
  assert.match(userscript, /\\/\\/ @version      0\\.6\\.173/);
  assert.match(userscript, /showTimestamps = localStorage\\.getItem\\(SHOW_TIMESTAMPS_STORAGE_KEY\\) === 'true'/);
  assert.match(userscript, /showRecordNumbers = localStorage\\.getItem\\(SHOW_RECORD_NUMBERS_STORAGE_KEY\\) === 'true'/);
  assert.match(userscript, /showTurnIds = localStorage\\.getItem\\(SHOW_TURN_IDS_STORAGE_KEY\\) === 'true'/);
  assert.match(userscript, /function canonicalHeadingOptions\\(\\)/);
  assert.match(userscript, /timestamp: showTimestamps/);
  assert.match(userscript, /recordNumber: showRecordNumbers/);
  assert.match(userscript, /turnId: showTurnIds/);
  assert.doesNotMatch(userscript, /function transcriptTimestamp\\(/,
    'DownloadConversation must not format Core-owned heading timestamps.');
  assert.doesNotMatch(userscript, /function canonicalHeadingMetadata\\(/,
    'DownloadConversation must not construct semantic Core heading metadata.');
  assert.doesNotMatch(userscript, /heading_suffix: ` <!-- turn_id=/,
    'Ordinary Markdown Turn IDs must not be injected as HTML comments.');
  assert.match(userscript, /\\{[\\s\\S]*record_type: 'chatgpt_conversation_metadata'[\\s\\S]*\\}, \\.\\.\\.records/,
    'Conversation metadata must prefix the Core source records so the first message is JSONL record 2.');
});

test('three independent Markdown heading controls remain persistent UI state', () => {
  assert.match(userscript, /data-role="show-timestamps" type="checkbox"> Timestamp/);
  assert.match(userscript, /data-role="show-record-numbers" type="checkbox"> Record #/);
  assert.match(userscript, /data-role="show-turn-ids" type="checkbox"> Turn ID/);
  assert.match(userscript, /localStorage\\.setItem\\(SHOW_TURN_IDS_STORAGE_KEY, String\\(showTurnIds\\)\\)/);
  assert.match(userscript, /if \\(turnIds\\) turnIds\\.disabled = metadataDisabled/);
});
''', encoding='utf-8')

# Recorder-panel contract should verify the new persisted default.
panel_path = ROOT / 'tests/recorder-panel-ui.test.mjs'
panel = panel_path.read_text(encoding='utf-8')
panel = replace_once(
  panel,
  "/showTurnIds = localStorage\\.getItem\\(SHOW_TURN_IDS_STORAGE_KEY\\) !== 'false'/",
  "/showTurnIds = localStorage\\.getItem\\(SHOW_TURN_IDS_STORAGE_KEY\\) === 'true'/",
  'panel Turn ID default',
)
panel_path.write_text(panel, encoding='utf-8')

# Exact Core pin and version assertions used by focused integration tests.
for relative in [
  'tests/core-integration.test.mjs',
  'tests/phase5-rich-core-integration.test.mjs',
  'tests/sediment-resolver.test.mjs',
]:
  path = ROOT / relative
  text = path.read_text(encoding='utf-8').replace(CORE_OLD, CORE_NEW)
  text = text.replace('0\\.6\\.172', '0\\.6\\.173').replace('0.6.172', '0.6.173')
  path.write_text(text, encoding='utf-8')

# Core integration harness: explicit default-off globals, metadata-prefix provenance,
# and runtime verification of all three controls and ordering.
core_test_path = ROOT / 'tests/core-integration.test.mjs'
core_test = core_test_path.read_text(encoding='utf-8')
core_test = replace_once(core_test, '  showTurnIds: true,', '  showTurnIds: false,', 'core harness Turn ID default')
core_test = replace_once(
  core_test,
  '''  cgIsHidden(record) {
    return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
  },''',
  '''  cgIsHidden(record) {
    return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
  },
  currentConversationId() {
    return 'heading-contract-conversation';
  },''',
  'core harness conversation identity',
)
# The old harness-only transcriptHeading stub encoded the superseded comment contract.
core_test = regex_once(
  core_test,
  r'''  CG_INLINE_TOKEN_START: '\\ue200',\n  transcriptHeading\(record\) \{[\s\S]*?\n  \}\n\}\);''',
  '''  CG_INLINE_TOKEN_START: '\\ue200'
});''',
  'remove core harness heading stub',
)
core_test = replace_once(
  core_test,
  '''vm.runInNewContext(`${helperSource}\\nthis.__phase5 = { canonicalEventsBySourceRecord, canonicalPlainRecordEligible, canonicalPlainRecordBlock, canonicalPlainAssistantSegmentEligible, canonicalPlainAssistantSegmentBlock };`, context);''',
  '''vm.runInNewContext(`${helperSource}\\nthis.__phase5 = { canonicalEventsBySourceRecord, canonicalPlainRecordEligible, canonicalPlainRecordBlock, canonicalPlainAssistantSegmentEligible, canonicalPlainAssistantSegmentBlock };`, context);''',
  'core helper exposure',
)
core_test = regex_once(
  core_test,
  r'''function productionPlainBlock\(record\) \{[\s\S]*?\n\}\n\ntest\('canonical heading metadata uses the shared core and paired JSONL numbering',[\s\S]*?\n\}\);''',
  '''function productionPlainBlock(record) {
  const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
  return context.AIConversationCore.renderCanonicalMarkdown([event], {
    heading: {
      timestamp: context.showTimestamps,
      recordNumber: context.showRecordNumbers,
      turnId: context.showTurnIds
    }
  }).trimEnd();
}

test('canonical heading controls are Core-owned, independent, ordered, and JSONL-offset', () => {
  const record = textRecord('metadata-user', 'user', 'Hello', { create_time: 1767225600 });
  const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
  assert.equal(event.source.record_index, 1, 'Conversation metadata must occupy JSONL record 1.');

  const render = () => phase5.canonicalPlainRecordBlock(record, event);
  assert.match(render(), /^## User$/m);

  context.showRecordNumbers = true;
  assert.match(render(), /^## User 2:$/m);
  context.showRecordNumbers = false;

  context.showTimestamps = true;
  assert.match(render(), /^## User \\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\\]:$/m);
  context.showTimestamps = false;

  context.showTurnIds = true;
  assert.match(render(), /^## User turn_id=metadata-user$/m);
  assert.doesNotMatch(render(), /<!-- turn_id=/);

  context.showTimestamps = true;
  context.showRecordNumbers = true;
  const combined = render();
  assert.match(combined,
    /^## User \\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\\]: 2: turn_id=metadata-user$/m);
  context.showTimestamps = false;
  context.showRecordNumbers = false;
  context.showTurnIds = false;
});''',
  'runtime heading-control regression',
)
core_test = core_test.replace('assert.equal(userEvent.source.record_index, 0);', 'assert.equal(userEvent.source.record_index, 1);')
core_test = core_test.replace('assert.equal(userEvent.source.record_index + 1, 1);', 'assert.equal(userEvent.source.record_index + 1, 2);')
core_test = core_test.replace("  assert.match(commentaryRendered, /^## ChatGPT <!-- turn_id=markdown-commentary -->/);\n  assert.match(commentaryRendered, /^### ChatGPT Commentary <!-- turn_id=markdown-commentary -->$/m);",
                              "  assert.match(commentaryRendered, /^## ChatGPT$/m);\n  assert.match(commentaryRendered, /^### ChatGPT Commentary$/m);")
core_test = core_test.replace("  assert.match(rendered, /^## ChatGPT <!-- turn_id=assistant-final -->/);",
                              "  assert.match(rendered, /^## ChatGPT$/m);")
core_test_path.write_text(core_test, encoding='utf-8')

# Rich integration harness: explicit default-off state. Keep one focused native-ID
# regression by enabling Turn ID only for that render; all other old comment checks
# become plain default headings.
rich_path = ROOT / 'tests/phase5-rich-core-integration.test.mjs'
rich = rich_path.read_text(encoding='utf-8')
rich = replace_once(rich, '  showTurnIds: true,', '  showTurnIds: false,', 'rich harness Turn ID default')
rich = regex_once(
  rich,
  r'''  CG_INLINE_TOKEN_START: '\\ue200',\n  transcriptHeading\(record\) \{[\s\S]*?\n  \}\n\}\);''',
  '''  CG_INLINE_TOKEN_START: '\\ue200'
});''',
  'remove rich harness heading stub',
)
rich = replace_once(
  rich,
  '''  const rendered = phase5.canonicalRecordBlock(record, event);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=assistant-citation -->/);''',
  '''  context.showTurnIds = true;
  const rendered = phase5.canonicalRecordBlock(record, event);
  context.showTurnIds = false;
  assert.match(rendered, /^## ChatGPT turn_id=assistant-citation$/m);
  assert.doesNotMatch(rendered, /<!-- turn_id=/);''',
  'rich visible Turn ID regression',
)
# Remaining old comment expectations are default-off and therefore plain.
replacements = {
  "assert.match(rendered, /^## User <!-- turn_id=user-image -->/);": "assert.match(rendered, /^## User$/m);",
  "assert.match(rendered, /^## ChatGPT <!-- turn_id=assistant-final-rich -->/);": "assert.match(rendered, /^## ChatGPT$/m);",
  "assert.match(rendered, /^## ChatGPT <!-- turn_id=commentary-message -->/);": "assert.match(rendered, /^## ChatGPT$/m);",
  "assert.match(rendered, /^### ChatGPT Commentary <!-- turn_id=commentary-message -->$/m);": "assert.match(rendered, /^### ChatGPT Commentary$/m);",
  "assert.match(rendered, /^## ChatGPT <!-- turn_id=opaque-heading-final -->/);": "assert.match(rendered, /^## ChatGPT$/m);",
  "assert.match(rendered, /^## ChatGPT <!-- turn_id=split-final -->/);": "assert.match(rendered, /^## ChatGPT$/m);",
  "assert.match(rendered, /^### ChatGPT Commentary <!-- turn_id=split-commentary -->$/m);": "assert.match(rendered, /^### ChatGPT Commentary$/m);",
}
for old, new in replacements.items():
  if old not in rich:
    raise SystemExit(f'rich expectation missing: {old}')
  rich = rich.replace(old, new)
# Dynamic commentary content-type checks.
rich = rich.replace(
  "    assert.match(rendered, new RegExp(`^## ChatGPT <!-- turn_id=commentary-${contentType} -->`));\n    assert.match(rendered, new RegExp(`^### ChatGPT Commentary <!-- turn_id=commentary-${contentType} -->$`, 'm'));",
  "    assert.match(rendered, /^## ChatGPT$/m);\n    assert.match(rendered, /^### ChatGPT Commentary$/m);",
)
rich_path.write_text(rich, encoding='utf-8')

# Cross-consumer tests now compare the default-off presentation directly; the only
# DownloadConversation-specific difference is its single EOF newline transport rule.
for relative in [
  'tests/phase7-cross-consumer-parity.mjs',
  'tests/phase7-cross-consumer-adversarial.mjs',
]:
  path = ROOT / relative
  text = path.read_text(encoding='utf-8')
  text = regex_once(
    text,
    r'''function projectedDownloadConversationGolden\(canonical\) \{[\s\S]*?\n\}\n''',
    '''function projectedDownloadConversationGolden(canonical) {
  let rendered = canonical;
  if (rendered.endsWith('\\n\\n')) rendered = rendered.slice(0, -1);
  return rendered;
}
''',
    f'{relative} projected golden',
  )
  text = replace_once(text, '    showTurnIds: true,', '    showTurnIds: false,', f'{relative} default Turn ID')
  path.write_text(text, encoding='utf-8')

shape_path = ROOT / 'tests/phase7-cross-consumer-markdown-shape.mjs'
shape = shape_path.read_text(encoding='utf-8')
shape = regex_once(shape, r'''function decorateSequential\([\s\S]*?\n\}\n\nfunction projectedDownloadConversationGolden\(canonical\) \{[\s\S]*?\n\}\n''',
                   '''function projectedDownloadConversationGolden(canonical) {
  let rendered = canonical;
  if (rendered.endsWith('\\n\\n')) rendered = rendered.slice(0, -1);
  return rendered;
}
''', 'shape projected golden')
shape = replace_once(shape, '    showTurnIds: true,', '    showTurnIds: false,', 'shape default Turn ID')
shape_path.write_text(shape, encoding='utf-8')

# Final safety: no current #109 tests may still encode the obsolete HTML-comment
# presentation contract, and all exact Core pins in active tests move together.
for path in (ROOT / 'tests').glob('*.mjs'):
  text = path.read_text(encoding='utf-8')
  if CORE_OLD in text:
    text = text.replace(CORE_OLD, CORE_NEW)
  if '0\\.6\\.172' in text:
    text = text.replace('0\\.6\\.172', '0\\.6\\.173')
  path.write_text(text, encoding='utf-8')
