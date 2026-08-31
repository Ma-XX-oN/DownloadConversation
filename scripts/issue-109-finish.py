from pathlib import Path


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


root = Path('.')
user_path = root / 'chatgpt-conversation-markdown-export.user.js'
text = user_path.read_text(encoding='utf-8')

text = replace_once(text, '// @version      0.6.151', '// @version      0.6.152', 'version')
text = replace_once(
  text,
  "  /** Session-storage key for the retained recorder diagnostic log. */\n  const DIAGNOSTIC_LOG_STORAGE_KEY",
  "  /** Local-storage key for Markdown source/provider turn-ID visibility. */\n  const SHOW_TURN_IDS_STORAGE_KEY = 'tm-conversation-recorder-show-turn-ids';\n  /** Session-storage key for the retained recorder diagnostic log. */\n  const DIAGNOSTIC_LOG_STORAGE_KEY",
  'turn-id storage key')
text = replace_once(
  text,
  "  /** Active screen wake-lock handle, or null when no lock is held. */\n  let wakeLockSentinel",
  "  /** Whether Markdown headings should include source/provider turn IDs. */\n  let showTurnIds = localStorage.getItem(SHOW_TURN_IDS_STORAGE_KEY) !== 'false';\n  /** Active screen wake-lock handle, or null when no lock is held. */\n  let wakeLockSentinel",
  'turn-id state')
text = replace_once(
  text,
  "    const sourceId = typeof record?.id === 'string' ? record.id : '';",
  "    const sourceId = showTurnIds && typeof record?.id === 'string' ? record.id : '';",
  'canonical source id')
text = replace_once(
  text,
  "    const headingSourceId = typeof headingRecord?.id === 'string' ? headingRecord.id : '';",
  "    const headingSourceId = showTurnIds && typeof headingRecord?.id === 'string' ? headingRecord.id : '';",
  'assistant heading source id')
text = replace_once(
  text,
  "      const commentarySourceId = event?.kind === 'commentary' && typeof records[index]?.id === 'string'",
  "      const commentarySourceId = showTurnIds && event?.kind === 'commentary' && typeof records[index]?.id === 'string'",
  'commentary source id')
text = replace_once(
  text,
  "    const turnId = id ? ` <!-- turn_id=${id} -->` : '';",
  "    const turnId = showTurnIds && id ? ` <!-- turn_id=${id} -->` : '';",
  'fallback turn id')
text = replace_once(
  text,
  "    const recordNumbers = panel.querySelector('[data-role=\"show-record-numbers\"]');\n    const test = panel.querySelector",
  "    const recordNumbers = panel.querySelector('[data-role=\"show-record-numbers\"]');\n    const turnIds = panel.querySelector('[data-role=\"show-turn-ids\"]');\n    const test = panel.querySelector",
  'updateUi turn ids query')
text = replace_once(
  text,
  "    if (recordNumbers) recordNumbers.disabled = metadataDisabled;\n    if (test)",
  "    if (recordNumbers) recordNumbers.disabled = metadataDisabled;\n    if (turnIds) turnIds.disabled = metadataDisabled;\n    if (test)",
  'updateUi turn ids disabled')
text = replace_once(
  text,
  '<label><input data-role="show-record-numbers" type="checkbox"> Record #</label></div>',
  '<label><input data-role="show-record-numbers" type="checkbox"> Record #</label><label><input data-role="show-turn-ids" type="checkbox"> Turn ID</label></div>',
  'panel turn id checkbox')
text = replace_once(
  text,
  "    const recordNumbers = panel.querySelector('[data-role=\"show-record-numbers\"]');\n    if (timestamps)",
  "    const recordNumbers = panel.querySelector('[data-role=\"show-record-numbers\"]');\n    const turnIds = panel.querySelector('[data-role=\"show-turn-ids\"]');\n    if (timestamps)",
  'makePanel turn ids query')
text = replace_once(
  text,
  "    /**\n     * Handles run selected exports.",
  "    if (turnIds) {\n      turnIds.checked = showTurnIds;\n      turnIds.addEventListener('change', () => {\n        showTurnIds = turnIds.checked;\n        localStorage.setItem(SHOW_TURN_IDS_STORAGE_KEY, String(showTurnIds));\n        updateUi();\n      });\n    }\n    /**\n     * Handles run selected exports.",
  'turn id listener')
user_path.write_text(text, encoding='utf-8')

phase5 = root / 'tests/phase5-rich-core-integration.test.mjs'
text = phase5.read_text(encoding='utf-8')
text = replace_once(
  text,
  '  showTimestamps: false,\n  showRecordNumbers: false,',
  '  showTimestamps: false,\n  showRecordNumbers: false,\n  showTurnIds: true,',
  'phase5 globals')
phase5.write_text(text, encoding='utf-8')

for name in [
  'phase7-cross-consumer-parity.mjs',
  'phase7-cross-consumer-markdown-shape.mjs',
  'phase7-cross-consumer-adversarial.mjs'
]:
  path = root / 'tests' / name
  text = path.read_text(encoding='utf-8')
  marker = 'Object.assign(context, {\n'
  if 'showTimestamps:' not in text:
    text = replace_once(
      text,
      marker,
      marker + '  showTimestamps: false,\n  showRecordNumbers: false,\n  showTurnIds: true,\n',
      f'{name} globals')
  elif 'showTurnIds:' not in text:
    text = replace_once(
      text,
      '  showRecordNumbers: false,\n',
      '  showRecordNumbers: false,\n  showTurnIds: true,\n',
      f'{name} turn id global')
  path.write_text(text, encoding='utf-8')

panel = root / 'tests/recorder-panel-ui.test.mjs'
text = panel.read_text(encoding='utf-8')
text = replace_once(
  text,
  "  assert.match(userscript, /data-role=\"show-record-numbers\" type=\"checkbox\"> Record #/);\n  assert.match(userscript, /SHOW_TIMESTAMPS_STORAGE_KEY/);",
  "  assert.match(userscript, /data-role=\"show-record-numbers\" type=\"checkbox\"> Record #/);\n  assert.match(userscript, /data-role=\"show-turn-ids\" type=\"checkbox\"> Turn ID/);\n  assert.match(userscript, /SHOW_TIMESTAMPS_STORAGE_KEY/);",
  'panel checkbox assertion')
text = replace_once(
  text,
  "  assert.match(userscript, /SHOW_RECORD_NUMBERS_STORAGE_KEY/);",
  "  assert.match(userscript, /SHOW_RECORD_NUMBERS_STORAGE_KEY/);\n  assert.match(userscript, /SHOW_TURN_IDS_STORAGE_KEY/);\n  assert.match(userscript, /showTurnIds = localStorage\\.getItem\\(SHOW_TURN_IDS_STORAGE_KEY\\) !== 'false'/);",
  'panel storage assertion')
panel.write_text(text, encoding='utf-8')

focused = root / 'tests/heading-metadata-controls.test.mjs'
focused.write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('heading metadata controls retain historical defaults and JSONL numbering', () => {
  assert.match(userscript, /\/\/ @version      0\\.6\\.152/);
  assert.match(userscript, /showTimestamps = localStorage\\.getItem\\(SHOW_TIMESTAMPS_STORAGE_KEY\\) === 'true'/);
  assert.match(userscript, /showRecordNumbers = localStorage\\.getItem\\(SHOW_RECORD_NUMBERS_STORAGE_KEY\\) === 'true'/);
  assert.match(userscript, /showTurnIds = localStorage\\.getItem\\(SHOW_TURN_IDS_STORAGE_KEY\\) !== 'false'/);
  assert.match(userscript, /recordNumberById\\.set\\(item\\.message\\.id, index \\+ 2\\)/,
    'First visible source message must be JSONL record 2 because record 1 is conversation metadata.');
});

test('turn ID visibility is applied to canonical, grouped, and fallback headings', () => {
  assert.match(userscript, /const sourceId = showTurnIds && typeof record\\?\\.id === 'string'/);
  assert.match(userscript, /const headingSourceId = showTurnIds && typeof headingRecord\\?\\.id === 'string'/);
  assert.match(userscript, /const commentarySourceId = showTurnIds && event\\?\\.kind === 'commentary'/);
  assert.match(userscript, /const turnId = showTurnIds && id \\? ` <!-- turn_id=\\$\\{id\\} -->` : ''/);
});

test('three independent Markdown heading controls are persistent UI state', () => {
  assert.match(userscript, /data-role="show-timestamps" type="checkbox"> Timestamp/);
  assert.match(userscript, /data-role="show-record-numbers" type="checkbox"> Record #/);
  assert.match(userscript, /data-role="show-turn-ids" type="checkbox"> Turn ID/);
  assert.match(userscript, /localStorage\\.setItem\\(SHOW_TURN_IDS_STORAGE_KEY, String\\(showTurnIds\\)\\)/);
  assert.match(userscript, /if \\(turnIds\\) turnIds\\.disabled = metadataDisabled/);
});
""", encoding='utf-8')

ci = root / '.github/workflows/ci.yml'
text = ci.read_text(encoding='utf-8')
text = replace_once(
  text,
  'run: node --test tests/recorder-panel-ui.test.mjs',
  'run: node --test tests/recorder-panel-ui.test.mjs tests/heading-metadata-controls.test.mjs',
  'ci focused test')
ci.write_text(text, encoding='utf-8')

design = root / 'DESIGN.md'
text = design.read_text(encoding='utf-8').rstrip() + """

## Optional Markdown heading metadata

DownloadConversation exposes three independent persistent Markdown-heading controls:

- **Timestamp**: source create/update time rendered in local `YYYY-MM-DD HH:MM:SS`
  form.  Default: off.
- **Record #**: the one-based JSONL record number.  Because JSONL record 1 is
  conversation metadata, the first visible source message is record 2.  Default:
  off.
- **Turn ID**: the ChatGPT source message ID rendered using the established
  `<!-- turn_id=... -->` heading comment.  Default: on so existing Markdown output
  remains unchanged unless the user disables it.

These are presentation-only controls.  They do not change chronology, grouping,
UAP association, API pagination, recovery, or canonical normalization.
"""
design.write_text(text + '\n', encoding='utf-8')
