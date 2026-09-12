from pathlib import Path

USERSCRIPT = Path('chatgpt-conversation-markdown-export.user.js')
TESTS = Path('tests/heading-metadata-controls.test.mjs')
DESIGN = Path('DESIGN.md')


def replace_once(text: str, old: str, new: str, description: str) -> str:
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{description}: expected one match, found {count}')
  return text.replace(old, new, 1)


source = USERSCRIPT.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      0.6.166',
  '// @version      0.6.167',
  'userscript version')
source = replace_once(
  source,
  "    if (timeDiffSeconds < 1) return `Thought for ${totalText}`;",
  "    if (timeDiffSeconds < 1) return 'Thought for less than a sec';",
  'sub-second interval wording')
source = replace_once(
  source,
  '''  function workDurationLabel(timeDiffSeconds) {
    const totalText = workDurationTotalText(timeDiffSeconds);
    if (timeDiffSeconds < -1) return totalText;
    if (timeDiffSeconds < 1) return 'Thought for less than a sec';
    return `Worked for ${totalText}`;
  }

''',
  '''  function workDurationLabel(timeDiffSeconds) {
    const totalText = workDurationTotalText(timeDiffSeconds);
    if (timeDiffSeconds < -1) return totalText;
    if (timeDiffSeconds < 1) return 'Thought for less than a sec';
    return `Worked for ${totalText}`;
  }

  /**
   * Extracts a compact duration from a provider-rendered terminal reasoning recap.
   *
   * Only exact standalone duration recap shapes are accepted. This deliberately
   * excludes arbitrary prose containing similar words.
   *
   * @param {string} line - One rendered top-level line inside a reasoning group.
   * @returns {string|null} Compact summary duration text, or null when the line is not a duration recap.
   */
  function renderedReasoningRecapTotalText(line) {
    const text = String(line ?? '').trim();
    const worked = text.match(/^Worked for ((?:\\d+h )?\\d+m \\d+s)$/);
    if (worked) return worked[1];
    if (text === 'Thought for less than a sec' || text === 'Thought for a sec') return 'a sec';
    if (/^Duration error -?\\d+s$/.test(text)) return text;
    return null;
  }

  /**
   * Applies a terminal rendered recap duration to a reasoning summary when no
   * Commentary boundary consumed that group.
   *
   * A visible User timestamp is still required so Timestamp-off/missing-start
   * cases never gain synthetic timing metadata from this fallback.
   *
   * @param {Array<string>} output - Mutable rendered Markdown lines.
   * @param {Object|null} pendingReasoningGroup - Closed reasoning group awaiting its next structural boundary.
   * @param {number|null} currentUserBoundarySeconds - Visible current User timestamp, in whole seconds.
   * @returns {void} No value is returned.
   */
  function applyRenderedReasoningRecapTotal(output, pendingReasoningGroup, currentUserBoundarySeconds) {
    if (currentUserBoundarySeconds == null || !pendingReasoningGroup?.renderedRecapTotalText) return;
    const summaryIndex = pendingReasoningGroup.summaryIndex;
    output[summaryIndex] = output[summaryIndex].replace(
      '</summary>',
      ` — ${pendingReasoningGroup.renderedRecapTotalText}</summary>`
    );
  }

''',
  'rendered final-recap helpers')
source = replace_once(
  source,
  '''   * A qualifying reasoning group receives the interval label immediately before its outer
   * `</details>`. Its `Having ... thought(s)` summary instead measures from the current User
   * timestamp through the terminating Commentary, so later groups report cumulative response time.
   * A boundary without a rendered timestamp clears timing state so no earlier timestamp is reused.
   * Commentary without an immediately preceding reasoning group receives no annotation.
''',
  '''   * A qualifying reasoning group receives the interval label immediately before its outer
   * `</details>`. Its `Having ... thought(s)` summary measures from the current User timestamp
   * through the terminating Commentary when one exists. If the final group has no Commentary,
   * an exact provider-rendered terminal duration recap already inside that group can supply the
   * summary total; nested tool/detail content is never treated as that recap. A boundary without
   * a rendered timestamp clears timing state so no earlier timestamp is reused. Commentary without
   * an immediately preceding reasoning group receives no annotation.
''',
  'worked-duration JSDoc')
source = replace_once(
  source,
  '''          pendingReasoningGroup = {
            summaryIndex: activeReasoningGroup.summaryIndex,
            closeIndex: output.length
          };
''',
  '''          pendingReasoningGroup = {
            summaryIndex: activeReasoningGroup.summaryIndex,
            closeIndex: output.length,
            renderedRecapTotalText: activeReasoningGroup.renderedRecapTotalText
          };
''',
  'pending rendered recap state')
source = replace_once(
  source,
  '''        if (detailsDepth === 0) {
          pendingReasoningGroup = null;
          activeReasoningGroup = reasoningSummaryPattern.test(line)
            ? { summaryIndex: output.length }
            : null;
        }
''',
  '''        if (detailsDepth === 0) {
          applyRenderedReasoningRecapTotal(output, pendingReasoningGroup, currentUserBoundarySeconds);
          pendingReasoningGroup = null;
          activeReasoningGroup = reasoningSummaryPattern.test(line)
            ? { summaryIndex: output.length, renderedRecapTotalText: null }
            : null;
        }
''',
  'reasoning group opening state')
source = replace_once(
  source,
  '''      if (detailsDepth > 0) {
        output.push(line);
        continue;
      }
''',
  '''      if (detailsDepth > 0) {
        if (detailsDepth === 1 && activeReasoningGroup && trimmed !== '') {
          activeReasoningGroup.renderedRecapTotalText = renderedReasoningRecapTotalText(line);
        }
        output.push(line);
        continue;
      }
''',
  'top-level rendered recap capture')
source = replace_once(
  source,
  '''      if (fenceStart) {
        if (detailsDepth === 0) pendingReasoningGroup = null;
        fence = { char: fenceStart[1][0], length: fenceStart[1].length };
''',
  '''      if (fenceStart) {
        if (detailsDepth === 0) {
          applyRenderedReasoningRecapTotal(output, pendingReasoningGroup, currentUserBoundarySeconds);
          pendingReasoningGroup = null;
        }
        fence = { char: fenceStart[1][0], length: fenceStart[1].length };
''',
  'top-level fence finalization')
source = replace_once(
  source,
  '''        if (match[1] === '## User') {
          currentUserBoundarySeconds = timestampSeconds;
''',
  '''        if (match[1] === '## User') {
          applyRenderedReasoningRecapTotal(output, pendingReasoningGroup, currentUserBoundarySeconds);
          currentUserBoundarySeconds = timestampSeconds;
''',
  'User boundary finalization')
source = replace_once(
  source,
  '''      if (pendingReasoningGroup && trimmed !== '') pendingReasoningGroup = null;
      output.push(line);
    }
    return output.join('\\n');
''',
  '''      if (pendingReasoningGroup && trimmed !== '') {
        applyRenderedReasoningRecapTotal(output, pendingReasoningGroup, currentUserBoundarySeconds);
        pendingReasoningGroup = null;
      }
      output.push(line);
    }
    applyRenderedReasoningRecapTotal(output, pendingReasoningGroup, currentUserBoundarySeconds);
    return output.join('\\n');
''',
  'final response recap finalization')
USERSCRIPT.write_text(source, encoding='utf-8')


tests = TESTS.read_text(encoding='utf-8')
tests = replace_once(
  tests,
  "assert.match(userscript, /\\/\\/ @version      0\\.6\\.166/);",
  "assert.match(userscript, /\\/\\/ @version      0\\.6\\.167/);",
  'test version assertion')
tests = tests.replace("'Thought for a sec'", "'Thought for less than a sec'")
tests = tests.replace('/Thought for a sec/g', '/Thought for less than a sec/g')

marker = "test('worked-duration annotation clears timing when a boundary has no rendered timestamp', () => {"
real_fixture_test = r'''test('real 03:07 response gives every Having-N group its verified cumulative total, including the final recap-only group', () => {
  const markdown = [
    '## User [2026-09-12 03:07:32]: <!-- turn_id=4992cda1-969d-4b9b-bfe9-50a03ed9a927 -->',
    '',
    '> prompt',
    '',
    '## ChatGPT [2026-09-12 03:07:33]: <!-- turn_id=21a25614-d1f5-448f-9927-675934e27aa2 -->',
    '',
    '### ChatGPT Commentary [2026-09-12 03:07:33]:',
    '',
    '> opening output',
    '',
    '<details><summary>Having 14 thoughts</summary>',
    '',
    'first phase',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-09-12 03:13:23]:',
    '',
    '> second output',
    '',
    '<details><summary>Having 13 thoughts</summary>',
    '',
    'second phase',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-09-12 03:18:16]: <!-- turn_id=3311e2f7-13bd-495e-9474-f828cba2d72e -->',
    '',
    '> third output',
    '',
    '<details><summary>Having 8 thoughts</summary>',
    '',
    '<details>',
    '<summary>tool output</summary>',
    '',
    'Worked for 99m 0s',
    '',
    '</details>',
    '',
    'final reasoning',
    '',
    'Worked for 13m 57s',
    '',
    '</details>',
    '',
    '> ## Why I wasn\'t catching them'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.match(annotated, /Having 14 thoughts — 5m 51s<\/summary>/);
  assert.match(annotated, /Having 13 thoughts — 10m 44s<\/summary>/);
  assert.match(annotated, /Having 8 thoughts — 13m 57s<\/summary>/);
  assert.equal((annotated.match(/Worked for 5m 50s/g) ?? []).length, 1);
  assert.equal((annotated.match(/Worked for 4m 53s/g) ?? []).length, 1);
  assert.equal((annotated.match(/Worked for 13m 57s/g) ?? []).length, 1,
    'The rendered final recap supplies the summary total and must not be duplicated.');
  assert.match(annotated,
    /final reasoning\n\nWorked for 13m 57s\n\n<\/details>\n\n> ## Why I wasn\\'t catching them/);
  assert.doesNotMatch(annotated, /Having 8 thoughts — 99m 0s<\/summary>/,
    'Nested tool/detail text must not be mistaken for the terminal reasoning recap.');
});

'''
if marker not in tests:
  raise RuntimeError('missing timestamp-boundary test marker')
tests = tests.replace(marker, real_fixture_test + marker, 1)
TESTS.write_text(tests, encoding='utf-8')


design = DESIGN.read_text(encoding='utf-8')
design = replace_once(
  design,
  '''When the **Timestamp** Markdown-heading control is enabled, DownloadConversation
adds consumer-only elapsed-time information to a rendered reasoning group when
that group is immediately followed by a structural `### ChatGPT Commentary`
report. This experimental annotation is deliberately computed from the timestamp
text already present in the rendered Markdown; it does not consult raw provider
timestamps and does not change AIConversationCore or its pinned version. When
Timestamp is disabled, no duration annotation is emitted.
''',
  '''When the **Timestamp** Markdown-heading control is enabled, DownloadConversation
adds consumer-only elapsed-time information to rendered reasoning groups.
Commentary-terminated groups are calculated from structural rendered heading
timestamps. A final group with no Commentary may instead reuse an exact terminal
duration recap already rendered as the group's last top-level reasoning line.
This experimental annotation does not consult raw provider timestamps and does
not change AIConversationCore or its pinned version. When Timestamp is disabled,
no duration annotation is emitted.
''',
  'design timing source')
design = replace_once(
  design,
  '''Commentary without an immediately preceding reasoning group receives no duration
annotation, and a reasoning group without a terminating Commentary boundary
receives no total because no rendered end timestamp is available.
''',
  '''Commentary without an immediately preceding reasoning group receives no duration
annotation. A final reasoning group without a terminating Commentary receives no
total unless its last top-level rendered reasoning line is an exact duration recap
such as `Worked for 13m 57s`; nested tool/detail content is ignored. A visible
current User timestamp is still required. The real 2026-09-12 03:07 fixture
verifies that its rendered `Worked for 13m 57s` recap equals the 837-second
User-to-reasoning-end span in the paired JSONL, without making raw JSONL metadata
a production timing source.
''',
  'design final recap behavior')
design = replace_once(
  design,
  '''- `Thought for a sec` when `-1 <= time_diff < 1`;
''',
  '''- `Thought for less than a sec` when `-1 <= time_diff < 1`;
''',
  'design sub-second wording')
DESIGN.write_text(design, encoding='utf-8')
