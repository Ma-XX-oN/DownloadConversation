import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('heading metadata controls retain historical defaults and JSONL numbering', () => {
  assert.match(userscript, /\/\/ @version      0\.6\.172/);
  assert.match(userscript, /showTimestamps = localStorage\.getItem\(SHOW_TIMESTAMPS_STORAGE_KEY\) === 'true'/);
  assert.match(userscript, /showRecordNumbers = localStorage\.getItem\(SHOW_RECORD_NUMBERS_STORAGE_KEY\) === 'true'/);
  assert.match(userscript, /showTurnIds = localStorage\.getItem\(SHOW_TURN_IDS_STORAGE_KEY\) !== 'false'/);
  assert.match(userscript, /recordNumberById\.set\(item\.message\.id, index \+ 2\)/,
    'First visible source message must be JSONL record 2 because record 1 is conversation metadata.');
});

test('turn ID visibility is applied to canonical, grouped, and fallback headings', () => {
  assert.match(userscript, /const sourceId = showTurnIds && typeof record\?\.id === 'string'/);
  assert.match(userscript, /const headingSourceId = showTurnIds && typeof headingRecord\?\.id === 'string'/);
  assert.match(userscript, /const commentarySourceId = showTurnIds && event\?\.kind === 'commentary'/);
  assert.match(userscript, /const turnId = showTurnIds && id \? ` <!-- turn_id=\$\{id\} -->` : ''/);
});

test('three independent Markdown heading controls are persistent UI state', () => {
  assert.match(userscript, /data-role="show-timestamps" type="checkbox"> Timestamp/);
  assert.match(userscript, /data-role="show-record-numbers" type="checkbox"> Record #/);
  assert.match(userscript, /data-role="show-turn-ids" type="checkbox"> Turn ID/);
  assert.match(userscript, /localStorage\.setItem\(SHOW_TURN_IDS_STORAGE_KEY, String\(showTurnIds\)\)/);
  assert.match(userscript, /if \(turnIds\) turnIds\.disabled = metadataDisabled/);
});
