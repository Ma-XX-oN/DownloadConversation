import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('heading metadata controls retain historical defaults and JSONL numbering', () => {
  assert.match(userscript, /\/\/ @version      0\.6\.164/);
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

const workedDurationBegin = '  // BEGIN DownloadConversation worked-duration annotation';
const workedDurationEnd = '  // END DownloadConversation worked-duration annotation';
const workedDurationStart = userscript.indexOf(workedDurationBegin);
const workedDurationFinish = userscript.indexOf(workedDurationEnd, workedDurationStart);
assert.ok(workedDurationStart >= 0 && workedDurationFinish > workedDurationStart,
  'Production worked-duration helper block is missing.');
const workedDurationSource = userscript.slice(
  workedDurationStart + workedDurationBegin.length,
  workedDurationFinish
);
const workedDurationContext = { showTimestamps: false };
vm.runInNewContext(
  `${workedDurationSource}\nthis.__workedDuration = { renderedTranscriptTimestampSeconds, workDurationLabel, annotateRenderedWorkDurations };`,
  workedDurationContext
);
const workedDuration = workedDurationContext.__workedDuration;

function annotateWorkedDuration(markdown, showTimestamps = true) {
  workedDurationContext.showTimestamps = showTimestamps;
  return workedDuration.annotateRenderedWorkDurations(markdown);
}

test('worked-duration labels preserve the specified signed thresholds and complete time fields', () => {
  assert.equal(workedDuration.workDurationLabel(-2), 'Duration error -2s');
  assert.equal(workedDuration.workDurationLabel(-1), 'Thought for less than a sec');
  assert.equal(workedDuration.workDurationLabel(0), 'Thought for less than a sec');
  assert.equal(workedDuration.workDurationLabel(1), 'Worked for 0m 1s');
  assert.equal(workedDuration.workDurationLabel(1598), 'Worked for 26m 38s');
  assert.equal(workedDuration.workDurationLabel(5198), 'Worked for 1h 26m 38s');
  assert.equal(workedDuration.workDurationLabel(7205), 'Worked for 2h 0m 5s');
});

test('worked-duration annotation is disabled with Timestamp and ignores the enclosing ChatGPT timestamp', () => {
  const markdown = [
    '## User [2026-09-11 20:29:42]:',
    '',
    '> prompt',
    '',
    '## ChatGPT [2026-09-11 20:28:43]:',
    '',
    '<details><summary>Having a thought</summary>',
    '',
    'agent work',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-09-11 20:29:42]:',
    '',
    '> report'
  ].join('\n');
  assert.equal(annotateWorkedDuration(markdown, false), markdown);
  const annotated = annotateWorkedDuration(markdown, true);
  assert.match(annotated,
    /Thought for less than a sec\n\n### ChatGPT Commentary \[2026-09-11 20:29:42\]:/);
  assert.doesNotMatch(annotated, /Duration error -59s/);
});

test('worked-duration annotation exposes negative errors and uses Commentary as the next boundary', () => {
  const negative = [
    '## User [2026-01-15 00:00:02]:',
    '',
    '> prompt',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:00]:',
    '',
    '> report'
  ].join('\n');
  assert.match(annotateWorkedDuration(negative), /Duration error -2s\n\n### ChatGPT Commentary/);

  const successive = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:05]:',
    '',
    '> first',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:10]:',
    '',
    '> second'
  ].join('\n');
  const successiveAnnotated = annotateWorkedDuration(successive);
  assert.equal((successiveAnnotated.match(/Worked for 0m 5s/g) ?? []).length, 2);
});

test('worked-duration annotation clears timing when a boundary has no rendered timestamp', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> first prompt',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:05]:',
    '',
    '> first report',
    '',
    '## User 8: <!-- turn_id=user-without-time -->',
    '',
    '> second prompt',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:10]:',
    '',
    '> second report'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.equal((annotated.match(/Worked for 0m 5s/g) ?? []).length, 1);
});

test('final ChatGPT response headings are not external-report timing boundaries', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '## ChatGPT [2026-01-15 00:00:20]:',
    '',
    '> final answer'
  ].join('\n');
  assert.doesNotMatch(annotateWorkedDuration(markdown), /Worked for|Thought for|Duration error/);
});
