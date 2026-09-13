from pathlib import Path


def replace_once(path, old, new, label):
  text = path.read_text(encoding='utf-8')
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected one match in {path}, found {count}')
  path.write_text(text.replace(old, new, 1), encoding='utf-8')


userscript = Path('chatgpt-conversation-markdown-export.user.js')
replace_once(userscript, '// @version      0.6.174', '// @version      0.6.175', 'userscript version')
replace_once(
  userscript,
  "  /** Local-storage key for Markdown source/provider turn-ID visibility. */\n  const SHOW_TURN_IDS_STORAGE_KEY = 'tm-conversation-recorder-show-turn-ids';\n",
  "  /** Local-storage key for Markdown source/provider turn-ID visibility. */\n  const SHOW_TURN_IDS_STORAGE_KEY = 'tm-conversation-recorder-show-turn-ids';\n  /** Local-storage key for Markdown Core debug-provenance visibility. */\n  const SHOW_DEBUG_PROVENANCE_STORAGE_KEY = 'tm-conversation-recorder-show-debug-provenance';\n",
  'debug storage key')
replace_once(
  userscript,
  "  /** Whether Markdown headings should include source/provider turn IDs. */\n  let showTurnIds = localStorage.getItem(SHOW_TURN_IDS_STORAGE_KEY) === 'true';\n",
  "  /** Whether Markdown headings should include source/provider turn IDs. */\n  let showTurnIds = localStorage.getItem(SHOW_TURN_IDS_STORAGE_KEY) === 'true';\n  /** Whether Markdown headings should include Core-derived source debug provenance. */\n  let showDebugProvenance = localStorage.getItem(SHOW_DEBUG_PROVENANCE_STORAGE_KEY) === 'true';\n",
  'debug state')
replace_once(
  userscript,
  "        timestamp: showTimestamps,\n        recordNumber: showRecordNumbers,\n        turnId: showTurnIds\n",
  "        timestamp: showTimestamps,\n        recordNumber: showRecordNumbers,\n        turnId: showTurnIds,\n        debugProvenance: showDebugProvenance\n",
  'Core heading debug option')
replace_once(
  userscript,
  "    const turnIds = panel.querySelector('[data-role=\"show-turn-ids\"]');\n    const test = panel.querySelector('[data-role=\"test\"]');\n",
  "    const turnIds = panel.querySelector('[data-role=\"show-turn-ids\"]');\n    const debugProvenance = panel.querySelector('[data-role=\"show-debug-provenance\"]');\n    const test = panel.querySelector('[data-role=\"test\"]');\n",
  'updateUi debug query')
replace_once(
  userscript,
  "    if (turnIds) turnIds.disabled = metadataDisabled;\n    if (test) {\n",
  "    if (turnIds) turnIds.disabled = metadataDisabled;\n    if (debugProvenance) debugProvenance.disabled = metadataDisabled;\n    if (test) {\n",
  'updateUi debug disabled')
replace_once(
  userscript,
  '<div class="tm-row tm-md-metadata"><span class="tm-label">MD headings</span><label><input data-role="show-timestamps" type="checkbox"> Timestamp</label><label><input data-role="show-record-numbers" type="checkbox"> Record #</label><label><input data-role="show-turn-ids" type="checkbox"> Turn ID</label></div>',
  '<div class="tm-row tm-md-metadata"><span class="tm-label">MD headings</span><label><input data-role="show-timestamps" type="checkbox"> Timestamp</label><label><input data-role="show-record-numbers" type="checkbox"> Record #</label><label><input data-role="show-turn-ids" type="checkbox"> Turn ID</label><label><input data-role="show-debug-provenance" type="checkbox"> Debug</label></div>',
  'debug checkbox markup')
replace_once(
  userscript,
  "    const turnIds = panel.querySelector('[data-role=\"show-turn-ids\"]');\n    if (timestamps) {\n",
  "    const turnIds = panel.querySelector('[data-role=\"show-turn-ids\"]');\n    const debugProvenance = panel.querySelector('[data-role=\"show-debug-provenance\"]');\n    if (timestamps) {\n",
  'listener debug query')
replace_once(
  userscript,
  "    if (turnIds) {\n      turnIds.checked = showTurnIds;\n      turnIds.addEventListener('change', () => {\n        showTurnIds = turnIds.checked;\n        localStorage.setItem(SHOW_TURN_IDS_STORAGE_KEY, String(showTurnIds));\n        updateUi();\n      });\n    }\n",
  "    if (turnIds) {\n      turnIds.checked = showTurnIds;\n      turnIds.addEventListener('change', () => {\n        showTurnIds = turnIds.checked;\n        localStorage.setItem(SHOW_TURN_IDS_STORAGE_KEY, String(showTurnIds));\n        updateUi();\n      });\n    }\n    if (debugProvenance) {\n      debugProvenance.checked = showDebugProvenance;\n      debugProvenance.addEventListener('change', () => {\n        showDebugProvenance = debugProvenance.checked;\n        localStorage.setItem(SHOW_DEBUG_PROVENANCE_STORAGE_KEY, String(showDebugProvenance));\n        updateUi();\n      });\n    }\n",
  'debug checkbox persistence handler')

heading_test = Path('tests/heading-metadata-controls.test.mjs')
replace_once(heading_test, '0\\.6\\.174', '0\\.6\\.175', 'heading test version')
replace_once(
  heading_test,
  "  assert.match(userscript, /showTurnIds = localStorage\\.getItem\\(SHOW_TURN_IDS_STORAGE_KEY\\) === 'true'/);\n",
  "  assert.match(userscript, /showTurnIds = localStorage\\.getItem\\(SHOW_TURN_IDS_STORAGE_KEY\\) === 'true'/);\n  assert.match(userscript, /showDebugProvenance = localStorage\\.getItem\\(SHOW_DEBUG_PROVENANCE_STORAGE_KEY\\) === 'true'/);\n",
  'heading test debug default')
replace_once(
  heading_test,
  "  assert.match(userscript, /turnId: showTurnIds/);\n",
  "  assert.match(userscript, /turnId: showTurnIds/);\n  assert.match(userscript, /debugProvenance: showDebugProvenance/);\n",
  'heading test debug option')
replace_once(
  heading_test,
  "test('three independent Markdown heading controls remain persistent UI state', () => {\n",
  "test('four independent Markdown heading controls remain persistent UI state', () => {\n",
  'heading test count')
replace_once(
  heading_test,
  "  assert.match(userscript, /data-role=\"show-turn-ids\" type=\"checkbox\"> Turn ID/);\n",
  "  assert.match(userscript, /data-role=\"show-turn-ids\" type=\"checkbox\"> Turn ID/);\n  assert.match(userscript, /data-role=\"show-debug-provenance\" type=\"checkbox\"> Debug/);\n",
  'heading test debug UI')
replace_once(
  heading_test,
  "  assert.match(userscript, /localStorage\\.setItem\\(SHOW_TURN_IDS_STORAGE_KEY, String\\(showTurnIds\\)\\)/);\n  assert.match(userscript, /if \\(turnIds\\) turnIds\\.disabled = metadataDisabled/);\n",
  "  assert.match(userscript, /localStorage\\.setItem\\(SHOW_TURN_IDS_STORAGE_KEY, String\\(showTurnIds\\)\\)/);\n  assert.match(userscript, /localStorage\\.setItem\\(SHOW_DEBUG_PROVENANCE_STORAGE_KEY, String\\(showDebugProvenance\\)\\)/);\n  assert.match(userscript, /if \\(turnIds\\) turnIds\\.disabled = metadataDisabled/);\n  assert.match(userscript, /if \\(debugProvenance\\) debugProvenance\\.disabled = metadataDisabled/);\n  assert.doesNotMatch(userscript, /diagnosticsLevel = showDebugProvenance/);\n  assert.doesNotMatch(userscript, /showDebugProvenance = diagnosticsLevel/);\n",
  'heading test persistence independence')

core_test = Path('tests/core-integration.test.mjs')
replace_once(
  core_test,
  "  showTurnIds: false,\n  assert(condition, message) {\n",
  "  showTurnIds: false,\n  showDebugProvenance: false,\n  assert(condition, message) {\n",
  'core test debug context')
replace_once(
  core_test,
  "      timestamp: context.showTimestamps,\n      recordNumber: context.showRecordNumbers,\n      turnId: context.showTurnIds\n",
  "      timestamp: context.showTimestamps,\n      recordNumber: context.showRecordNumbers,\n      turnId: context.showTurnIds,\n      debugProvenance: context.showDebugProvenance\n",
  'core test production debug option')
replace_once(
  core_test,
  "  context.showTurnIds = true;\n  assert.match(render(), /^## User metadata-user$/m);\n  assert.doesNotMatch(render(), /turn_id=/);\n\n  context.showTimestamps = true;\n",
  "  context.showTurnIds = true;\n  assert.match(render(), /^## User metadata-user$/m);\n  assert.doesNotMatch(render(), /turn_id=/);\n  context.showTurnIds = false;\n\n  context.showDebugProvenance = true;\n  assert.match(render(), /^## User <!-- record_id=metadata-user record_index=1 -->$/m);\n  context.showDebugProvenance = false;\n  assert.doesNotMatch(render(), /record_id=metadata-user/);\n\n  context.showTurnIds = true;\n  context.showDebugProvenance = true;\n  context.showTimestamps = true;\n",
  'core test debug-only and combined setup')
replace_once(
  core_test,
  "  assert.match(combined,\n    /^## User \\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\\]: 2: metadata-user$/m);\n  context.showTimestamps = false;\n  context.showRecordNumbers = false;\n  context.showTurnIds = false;\n",
  "  assert.match(combined,\n    /^## User \\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\\]: 2: metadata-user <!-- record_id=metadata-user record_index=1 -->$/m);\n  context.showTimestamps = false;\n  context.showRecordNumbers = false;\n  context.showTurnIds = false;\n  context.showDebugProvenance = false;\n",
  'core test combined debug expectation')

sediment_test = Path('tests/sediment-resolver.test.mjs')
replace_once(sediment_test, '0\\.6\\.174', '0\\.6\\.175', 'sediment version expectation')

path = Path('DESIGN.md')
text = path.read_text(encoding='utf-8')
old = 'DownloadConversation exposes three independent persistent Markdown-heading controls:'
new = 'DownloadConversation exposes four independent persistent Markdown-heading controls:'
if old not in text:
  raise RuntimeError('DESIGN heading control count not found')
text = text.replace(old, new, 1)
old = "- **Turn ID**: Core derives the ChatGPT native source/message ID and renders the\n  bare native ID value as visible heading metadata, without a `turn_id=` prefix.\n  Default: off.\n"
new = old + "- **Debug**: Core derives source debug provenance and appends the canonical\n  `record_id=... record_index=...` HTML comment to the heading. One checkbox controls\n  the provenance channel as a unit; DownloadConversation does not construct either\n  field. Default: off.\n"
if old not in text:
  raise RuntimeError('DESIGN Turn ID bullet not found')
text = text.replace(old, new, 1)
old = ('The visible order is speaker, timestamp, record number, then Turn ID. Ordinary\nMarkdown does not encode Turn ID as an HTML comment. DownloadConversation supplies\nonly these presentation visibility switches to AIConversationCore; it does not\nformat timestamps, compute record numbers, or inject semantic turn IDs itself.\nCanonical and host fallback bodies therefore use the same Core-owned heading\nserialization. These controls do not change chronology, grouping, UAP association,\nAPI pagination, recovery, or canonical normalization.')
new = ('The visible order is speaker, timestamp, record number, then Turn ID; when Debug\nis enabled, the Core-owned provenance comment follows that heading metadata. Ordinary\nMarkdown does not encode Turn ID as an HTML comment. DownloadConversation supplies\nonly these presentation visibility switches to AIConversationCore; it does not\nformat timestamps, compute record numbers, inject semantic turn IDs, or construct\ndebug provenance itself. The Debug export checkbox is independent of the recorder\ndiagnostic-log level (`errors` / `warnings` / `debug` / `verbose`). Canonical and\nhost fallback bodies therefore use the same Core-owned heading serialization. These\ncontrols do not change chronology, grouping, UAP association, API pagination,\nrecovery, or canonical normalization.')
if old not in text:
  raise RuntimeError('DESIGN heading contract paragraph not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
