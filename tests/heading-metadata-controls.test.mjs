import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('heading metadata controls retain historical defaults and JSONL numbering', () => {
  assert.match(userscript, /\/\/ @version      0\.6\.166/);
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
  `${workedDurationSource}\nthis.__workedDuration = { renderedTranscriptTimestampSeconds, workDurationTotalText, workDurationLabel, annotateRenderedWorkDurations };`,
  workedDurationContext
);
const workedDuration = workedDurationContext.__workedDuration;

function annotateWorkedDuration(markdown, showTimestamps = true) {
  workedDurationContext.showTimestamps = showTimestamps;
  return workedDuration.annotateRenderedWorkDurations(markdown);
}

test('worked-duration labels preserve the specified signed thresholds and complete time fields', () => {
  assert.equal(workedDuration.workDurationLabel(-2), 'Duration error -2s');
  assert.equal(workedDuration.workDurationLabel(-1), 'Thought for a sec');
  assert.equal(workedDuration.workDurationLabel(0), 'Thought for a sec');
  assert.equal(workedDuration.workDurationLabel(1), 'Worked for 0m 1s');
  assert.equal(workedDuration.workDurationLabel(1598), 'Worked for 26m 38s');
  assert.equal(workedDuration.workDurationLabel(5198), 'Worked for 1h 26m 38s');
  assert.equal(workedDuration.workDurationLabel(7205), 'Worked for 2h 0m 5s');
  assert.equal(workedDuration.workDurationTotalText(-2), 'Duration error -2s');
  assert.equal(workedDuration.workDurationTotalText(0), 'a sec');
  assert.equal(workedDuration.workDurationTotalText(5198), '1h 26m 38s');
});

test('worked-duration annotation stays inside the reasoning group and ignores the enclosing ChatGPT timestamp', () => {
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
  assert.match(annotated, /<summary>Having a thought — a sec<\/summary>/);
  assert.match(annotated,
    /agent work\n\nThought for a sec\n\n<\/details>\n\n### ChatGPT Commentary/);
  assert.doesNotMatch(annotated, /<\/details>\n\nThought for a sec/);
  assert.doesNotMatch(annotated, /Duration error -59s/);
});

test('worked-duration annotation exposes negative errors while keeping User as the cumulative summary origin', () => {
  const negative = [
    '## User [2026-01-15 00:00:02]:',
    '',
    '> prompt',
    '',
    '<details><summary>Having a thought</summary>',
    '',
    'work',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:00]:',
    '',
    '> report'
  ].join('\n');
  const negativeAnnotated = annotateWorkedDuration(negative);
  assert.match(negativeAnnotated, /Having a thought — Duration error -2s<\/summary>/);
  assert.match(negativeAnnotated, /Duration error -2s\n\n<\/details>\n\n### ChatGPT Commentary/);

  const successive = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '<details><summary>Having a thought</summary>',
    '',
    'first work',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:05]:',
    '',
    '> first',
    '',
    '<details><summary>Having 2 thoughts</summary>',
    '',
    'second work',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:10]:',
    '',
    '> second'
  ].join('\n');
  const successiveAnnotated = annotateWorkedDuration(successive);
  assert.equal((successiveAnnotated.match(/Worked for 0m 5s/g) ?? []).length, 2);
  assert.equal((successiveAnnotated.match(/ — 0m 5s<\/summary>/g) ?? []).length, 1);
  assert.equal((successiveAnnotated.match(/ — 0m 10s<\/summary>/g) ?? []).length, 1);
  assert.doesNotMatch(successiveAnnotated, /<\/details>\n\nWorked for/);
});

test('multi-thought summary totals are cumulative from User while interval labels stay boundary-to-boundary', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '<details><summary>Having 8 thoughts</summary>',
    '',
    'first phase',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:02:00]:',
    '',
    '> first output',
    '',
    '<details><summary>Having 14 thoughts</summary>',
    '',
    'second phase',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:05:30]:',
    '',
    '> second output',
    '',
    '<details><summary>Having 10 thoughts</summary>',
    '',
    'third phase',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:09:00]:',
    '',
    '> last output'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.match(annotated, /Having 8 thoughts — 2m 0s<\/summary>/);
  assert.match(annotated, /Having 14 thoughts — 5m 30s<\/summary>/);
  assert.match(annotated, /Having 10 thoughts — 9m 0s<\/summary>/);
  assert.equal((annotated.match(/Worked for 2m 0s/g) ?? []).length, 1);
  assert.equal((annotated.match(/Worked for 3m 30s/g) ?? []).length, 2);
});

test('worked-duration annotation clears timing when a boundary has no rendered timestamp', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> first prompt',
    '',
    '<details><summary>Having a thought</summary>',
    '',
    'first work',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:05]:',
    '',
    '> first report',
    '',
    '## User 8: <!-- turn_id=user-without-time -->',
    '',
    '> second prompt',
    '',
    '<details><summary>Having a thought</summary>',
    '',
    'second work',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:10]:',
    '',
    '> second report'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.equal((annotated.match(/Worked for 0m 5s/g) ?? []).length, 1);
  assert.equal((annotated.match(/Having a thought — 0m 5s/g) ?? []).length, 1);
});

test('final ChatGPT response headings are not timing boundaries and an unterminated reasoning group gets no total', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '## ChatGPT [2026-01-15 00:00:20]:',
    '',
    '<details><summary>Having a thought</summary>',
    '',
    'work',
    '',
    '</details>',
    '',
    '> final answer'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.doesNotMatch(annotated, /Worked for|Thought for|Duration error/);
  assert.match(annotated, /<summary>Having a thought<\/summary>/);
  assert.doesNotMatch(annotated, /Having a thought —/);
});

test('commentary without an immediately preceding reasoning group receives no outside duration annotation', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:05]:',
    '',
    '> report'
  ].join('\n');
  assert.doesNotMatch(annotateWorkedDuration(markdown), /Worked for|Thought for|Duration error/);
});

test('worked-duration annotation ignores transcript-looking headings inside opaque rendered content', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '## ChatGPT [2026-01-15 00:00:01]:',
    '',
    '<details><summary>Having a thought</summary>',
    '',
    '```text',
    '## User [2025-12-31 23:59:00]:',
    '',
    '### ChatGPT Commentary [2025-12-31 23:59:59]:',
    '```',
    '',
    '<details><summary>tool output</summary>',
    '',
    '### ChatGPT Commentary [2025-12-31 23:59:58]:',
    '',
    '</details>',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:05]:',
    '',
    '> real report'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.equal((annotated.match(/Worked for 0m 5s/g) ?? []).length, 1);
  assert.equal((annotated.match(/Having a thought — 0m 5s/g) ?? []).length, 1);
  assert.equal((annotated.match(/Thought for a sec/g) ?? []).length, 0);
  assert.equal((annotated.match(/Duration error/g) ?? []).length, 0);
  assert.match(annotated,
    /## User \[2025-12-31 23:59:00\]:\n\n### ChatGPT Commentary \[2025-12-31 23:59:59\]:/);
  assert.match(annotated, /Worked for 0m 5s\n\n<\/details>\n\n### ChatGPT Commentary/);
});

test('worked-duration annotation ignores transcript-looking headings in top-level fenced content', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '````text',
    '### ChatGPT Commentary [2025-12-31 23:59:59]:',
    '```',
    '````',
    '',
    '<details><summary>Having 3 thoughts</summary>',
    '',
    'real work',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:03]:',
    '',
    '> real report'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.equal((annotated.match(/Worked for 0m 3s/g) ?? []).length, 1);
  assert.match(annotated, /Having 3 thoughts — 0m 3s<\/summary>/);
  assert.equal((annotated.match(/Duration error/g) ?? []).length, 0);
});

test('real observed reasoning shape moves the interval annotation inside and adds the total to Having N thoughts', () => {
  const markdown = [
    '## User [2026-09-12 12:00:43]:',
    '',
    '> prompt',
    '',
    '## ChatGPT [2026-09-12 12:00:43]:',
    '',
    '<details><summary>Having 9 thoughts</summary>',
    '',
    '<details>',
    '<summary>python code</summary>',
    '',
    '```python',
    'print("work")',
    '```',
    '',
    '</details>',
    '',
    '**Investigated issue branches, transcript follow logging, and playback migration logic**',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-09-12 12:02:28]:',
    '',
    '> report'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.match(annotated, /<summary>Having 9 thoughts — 1m 45s<\/summary>/);
  assert.match(annotated,
    /\*\*Investigated issue branches, transcript follow logging, and playback migration logic\*\*\n\nWorked for 1m 45s\n\n<\/details>\n\n### ChatGPT Commentary/);
  assert.doesNotMatch(annotated, /<\/details>\n\nWorked for 1m 45s\n\n### ChatGPT Commentary/);
});
