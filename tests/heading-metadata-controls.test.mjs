import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('heading metadata controls default off and Core owns semantic values', () => {
  assert.match(userscript, /\/\/ @version      0\.6\.173/);
  assert.match(userscript, /showTimestamps = localStorage\.getItem\(SHOW_TIMESTAMPS_STORAGE_KEY\) === 'true'/);
  assert.match(userscript, /showRecordNumbers = localStorage\.getItem\(SHOW_RECORD_NUMBERS_STORAGE_KEY\) === 'true'/);
  assert.match(userscript, /showTurnIds = localStorage\.getItem\(SHOW_TURN_IDS_STORAGE_KEY\) === 'true'/);
  assert.match(userscript, /function canonicalHeadingOptions\(\)/);
  assert.match(userscript, /timestamp: showTimestamps/);
  assert.match(userscript, /recordNumber: showRecordNumbers/);
  assert.match(userscript, /turnId: showTurnIds/);
  assert.doesNotMatch(userscript, /function transcriptTimestamp\(/,
    'DownloadConversation must not format Core-owned heading timestamps.');
  assert.doesNotMatch(userscript, /function canonicalHeadingMetadata\(/,
    'DownloadConversation must not construct semantic Core heading metadata.');
  assert.doesNotMatch(userscript, /heading_suffix: ` <!-- turn_id=/,
    'Ordinary Markdown Turn IDs must not be injected as HTML comments.');
  assert.match(userscript, /\{[\s\S]*record_type: 'chatgpt_conversation_metadata'[\s\S]*\}, \.\.\.records/,
    'Conversation metadata must prefix the Core source records so the first message is JSONL record 2.');
});

test('three independent Markdown heading controls remain persistent UI state', () => {
  assert.match(userscript, /data-role="show-timestamps" type="checkbox"> Timestamp/);
  assert.match(userscript, /data-role="show-record-numbers" type="checkbox"> Record #/);
  assert.match(userscript, /data-role="show-turn-ids" type="checkbox"> Turn ID/);
  assert.match(userscript, /localStorage\.setItem\(SHOW_TURN_IDS_STORAGE_KEY, String\(showTurnIds\)\)/);
  assert.match(userscript, /if \(turnIds\) turnIds\.disabled = metadataDisabled/);
});
