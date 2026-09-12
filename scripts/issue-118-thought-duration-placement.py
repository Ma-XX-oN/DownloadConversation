from pathlib import Path

ROOT = Path('.')
USERSCRIPT = ROOT / 'chatgpt-conversation-markdown-export.user.js'
TEST = ROOT / 'tests' / 'heading-metadata-controls.test.mjs'
DESIGN = ROOT / 'DESIGN.md'

source = USERSCRIPT.read_text(encoding='utf-8')
if source.count('// @version      0.6.164') != 1:
  raise SystemExit('expected DownloadConversation version 0.6.164 exactly once')
source = source.replace('// @version      0.6.164', '// @version      0.6.165', 1)

start_marker = (
  '  /**\n'
  '   * Formats the elapsed whole-second difference between two rendered transcript boundaries.\n'
)
end_marker = '  // END DownloadConversation worked-duration annotation'
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end <= start:
  raise SystemExit('worked-duration implementation block not found')

replacement = r'''  /**
   * Formats the elapsed whole-second duration for a reasoning-group summary.
   *
   * @param {number} timeDiffSeconds - Signed whole-second difference between rendered boundary timestamps.
   * @returns {string} Compact elapsed text appended to the outer reasoning-group summary.
   */
  function workDurationTotalText(timeDiffSeconds) {
    if (timeDiffSeconds < -1) return `Duration error ${timeDiffSeconds}s`;
    if (timeDiffSeconds < 1) return 'less than a sec';
    const hours = Math.floor(timeDiffSeconds / 3600);
    const minutes = Math.floor((timeDiffSeconds % 3600) / 60);
    const seconds = timeDiffSeconds % 60;
    const hourText = hours > 0 ? `${hours}h ` : '';
    return `${hourText}${minutes}m ${seconds}s`;
  }

  /**
   * Formats the elapsed whole-second difference between two rendered transcript boundaries.
   *
   * @param {number} timeDiffSeconds - Signed whole-second difference between rendered boundary timestamps.
   * @returns {string} The synthetic Thought, Worked, or Duration error annotation text.
   */
  function workDurationLabel(timeDiffSeconds) {
    const totalText = workDurationTotalText(timeDiffSeconds);
    if (timeDiffSeconds < -1) return totalText;
    if (timeDiffSeconds < 1) return `Thought for ${totalText}`;
    return `Worked for ${totalText}`;
  }

  /**
   * Adds DownloadConversation-only duration annotations inside rendered reasoning groups.
   *
   * The input and timing source are already-rendered Markdown heading timestamps. User prompts
   * and Commentary reports are timing boundaries; the enclosing ChatGPT response heading is
   * deliberately ignored because its rendered timestamp can represent older in-progress activity.
   * A qualifying reasoning group receives the interval label immediately before its outer
   * `</details>` and receives the same total duration at the end of its `Having ... thought(s)`
   * summary. A boundary without a rendered timestamp clears timing state so no earlier timestamp
   * is reused. Commentary without an immediately preceding reasoning group receives no annotation.
   *
   * @param {string} markdown - Core-rendered conversation Markdown to annotate.
   * @returns {string} Markdown with synthetic duration annotations, or the original Markdown when timestamps are disabled.
   */
  function annotateRenderedWorkDurations(markdown) {
    if (!showTimestamps) return markdown;
    const boundaryPattern = /^(## User|### ChatGPT Commentary)(?: \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]:)?(?:\s|$)/;
    const reasoningSummaryPattern = /^ {0,3}<details><summary>Having (?:a thought|\d+ thoughts)<\/summary>(?:\s*<!--.*-->)?\s*$/;
    const lines = String(markdown ?? '').split('\n');
    const output = [];
    let previousBoundarySeconds = null;
    // Structural disclosure depth keeps transcript-looking content inside disclosures opaque.
    let detailsDepth = 0;
    // Active fenced block delimiter; headings and disclosure text inside fences remain opaque.
    let fence = null;
    // Top-level reasoning group currently being copied into output.
    let activeReasoningGroup = null;
    // Most recently completed top-level reasoning group, eligible for the next Commentary boundary.
    let pendingReasoningGroup = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (fence) {
        output.push(line);
        if (trimmed.length >= fence.length &&
            [...trimmed].every(char => char === fence.char)) {
          fence = null;
        }
        continue;
      }
      const fenceStart = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceStart) {
        if (detailsDepth === 0) pendingReasoningGroup = null;
        fence = { char: fenceStart[1][0], length: fenceStart[1].length };
        output.push(line);
        continue;
      }
      if (/^ {0,3}<\/details\s*>(?:\s*<!--.*-->)?\s*$/i.test(line) && detailsDepth > 0) {
        detailsDepth -= 1;
        if (detailsDepth === 0 && activeReasoningGroup) {
          pendingReasoningGroup = {
            summaryIndex: activeReasoningGroup.summaryIndex,
            closeIndex: output.length
          };
          activeReasoningGroup = null;
        }
        output.push(line);
        continue;
      }
      if (/^ {0,3}<details(?:\s|>)/i.test(line)) {
        if (detailsDepth === 0) {
          pendingReasoningGroup = null;
          activeReasoningGroup = reasoningSummaryPattern.test(line)
            ? { summaryIndex: output.length }
            : null;
        }
        detailsDepth += 1;
        output.push(line);
        continue;
      }
      if (detailsDepth > 0) {
        output.push(line);
        continue;
      }
      const match = line.match(boundaryPattern);
      if (match) {
        const timestampSeconds = match[2]
          ? renderedTranscriptTimestampSeconds(match[2])
          : null;
        if (match[1] === '### ChatGPT Commentary' &&
            timestampSeconds != null && previousBoundarySeconds != null &&
            pendingReasoningGroup) {
          const timeDiffSeconds = timestampSeconds - previousBoundarySeconds;
          const totalText = workDurationTotalText(timeDiffSeconds);
          const summaryIndex = pendingReasoningGroup.summaryIndex;
          const closeIndex = pendingReasoningGroup.closeIndex;
          output[summaryIndex] = output[summaryIndex].replace(
            '</summary>',
            ` — ${totalText}</summary>`
          );
          const annotationLines = [];
          if (closeIndex > 0 && output[closeIndex - 1] !== '') annotationLines.push('');
          annotationLines.push(workDurationLabel(timeDiffSeconds));
          if (output[closeIndex] !== '') annotationLines.push('');
          output.splice(closeIndex, 0, ...annotationLines);
        }
        previousBoundarySeconds = timestampSeconds;
        pendingReasoningGroup = null;
        output.push(line);
        continue;
      }
      if (pendingReasoningGroup && trimmed !== '') pendingReasoningGroup = null;
      output.push(line);
    }
    return output.join('\n');
  }
'''
source = source[:start] + replacement + source[end:]
USERSCRIPT.write_text(source, encoding='utf-8')

test_source = TEST.read_text(encoding='utf-8')
if test_source.count(r'0\.6\.164') != 1:
  raise SystemExit('expected version assertion 0.6.164 exactly once')
test_source = test_source.replace(r'0\.6\.164', r'0\.6\.165', 1)
old_export = (
  'this.__workedDuration = { renderedTranscriptTimestampSeconds, workDurationLabel, '
  'annotateRenderedWorkDurations };'
)
new_export = (
  'this.__workedDuration = { renderedTranscriptTimestampSeconds, workDurationTotalText, '
  'workDurationLabel, annotateRenderedWorkDurations };'
)
if test_source.count(old_export) != 1:
  raise SystemExit('worked-duration test export marker not found exactly once')
test_source = test_source.replace(old_export, new_export, 1)

test_marker = "test('worked-duration labels preserve the specified signed thresholds and complete time fields'"
test_start = test_source.find(test_marker)
if test_start < 0:
  raise SystemExit('worked-duration tests marker not found')
new_tests = r'''test('worked-duration labels preserve the specified signed thresholds and complete time fields', () => {
  assert.equal(workedDuration.workDurationLabel(-2), 'Duration error -2s');
  assert.equal(workedDuration.workDurationLabel(-1), 'Thought for less than a sec');
  assert.equal(workedDuration.workDurationLabel(0), 'Thought for less than a sec');
  assert.equal(workedDuration.workDurationLabel(1), 'Worked for 0m 1s');
  assert.equal(workedDuration.workDurationLabel(1598), 'Worked for 26m 38s');
  assert.equal(workedDuration.workDurationLabel(5198), 'Worked for 1h 26m 38s');
  assert.equal(workedDuration.workDurationLabel(7205), 'Worked for 2h 0m 5s');
  assert.equal(workedDuration.workDurationTotalText(-2), 'Duration error -2s');
  assert.equal(workedDuration.workDurationTotalText(0), 'less than a sec');
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
  assert.match(annotated, /<summary>Having a thought — less than a sec<\/summary>/);
  assert.match(annotated,
    /agent work\n\nThought for less than a sec\n\n<\/details>\n\n### ChatGPT Commentary/);
  assert.doesNotMatch(annotated, /<\/details>\n\nThought for less than a sec/);
  assert.doesNotMatch(annotated, /Duration error -59s/);
});

test('worked-duration annotation exposes negative errors inside reasoning groups and uses Commentary as the next boundary', () => {
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
  assert.equal((successiveAnnotated.match(/ — 0m 5s<\/summary>/g) ?? []).length, 2);
  assert.doesNotMatch(successiveAnnotated, /<\/details>\n\nWorked for/);
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
  assert.equal((annotated.match(/Thought for less than a sec/g) ?? []).length, 0);
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
'''
test_source = test_source[:test_start] + new_tests
TEST.write_text(test_source, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
design_start = design.find('## Experimental rendered work-duration annotations\n')
if design_start < 0:
  raise SystemExit('worked-duration design section not found')
new_design = '''## Experimental rendered work-duration annotations

When the **Timestamp** Markdown-heading control is enabled, DownloadConversation
adds consumer-only elapsed-time information to a rendered reasoning group when
that group is immediately followed by a structural `### ChatGPT Commentary`
report. This experimental annotation is deliberately computed from the timestamp
text already present in the rendered Markdown; it does not consult raw provider
timestamps and does not change AIConversationCore or its pinned version. When
Timestamp is disabled, no duration annotation is emitted.

The preceding rendered `## User` prompt or `### ChatGPT Commentary` report is
the timing boundary. Only structural headings are eligible: transcript-looking
text inside fenced blocks or rendered `<details>` content remains opaque. The
enclosing `## ChatGPT` response heading is ignored for timing because real
ChatGPT data can make that heading inherit an older in-progress activity
timestamp. A boundary without a rendered timestamp clears the timing state
rather than reusing an earlier boundary.

For a qualifying outer `<details><summary>Having ... thought(s)</summary>` group,
the interval annotation is inserted immediately before that group's closing
`</details>`, so timing information never sits outside the reasoning disclosure.
The same whole interval is appended to the summary, for example
`Having 9 thoughts — 1m 45s`. Commentary without an immediately preceding
reasoning group receives no duration annotation, and a reasoning group without a
terminating Commentary boundary receives no total because no rendered end
timestamp is available.

For a signed whole-second difference `time_diff`, DownloadConversation renders:

- `Duration error <time_diff>s` when `time_diff < -1`;
- `Thought for less than a sec` when `-1 <= time_diff < 1`;
- `Worked for Xm Ys` when `time_diff >= 1`, adding `Xh` only when hours are
  non-zero while retaining both minute and second fields.

The summary uses the matching compact total (`Duration error ...`, `less than a
sec`, or `Xh Ym Zs`). Negative source anomalies are surfaced rather than silently
clamped or repaired.
'''
design = design[:design_start] + new_design
DESIGN.write_text(design, encoding='utf-8')
