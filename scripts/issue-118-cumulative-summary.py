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
  '// @version      0.6.165',
  '// @version      0.6.166',
  'userscript version')
source = replace_once(
  source,
  '''    let previousBoundarySeconds = null;
    // Structural disclosure depth keeps transcript-looking content inside disclosures opaque.
''',
  '''    let previousBoundarySeconds = null;
    // Current User timestamp anchors cumulative reasoning totals for this response.
    let currentUserBoundarySeconds = null;
    // Structural disclosure depth keeps transcript-looking content inside disclosures opaque.
''',
  'cumulative User timestamp state')
source = replace_once(
  source,
  '''   * A qualifying reasoning group receives the interval label immediately before its outer
   * `</details>` and receives the same total duration at the end of its `Having ... thought(s)`
   * summary. A boundary without a rendered timestamp clears timing state so no earlier timestamp
   * is reused. Commentary without an immediately preceding reasoning group receives no annotation.
''',
  '''   * A qualifying reasoning group receives the interval label immediately before its outer
   * `</details>`. Its `Having ... thought(s)` summary instead measures from the current User
   * timestamp through the terminating Commentary, so later groups report cumulative response time.
   * A boundary without a rendered timestamp clears timing state so no earlier timestamp is reused.
   * Commentary without an immediately preceding reasoning group receives no annotation.
''',
  'worked-duration JSDoc')
source = replace_once(
  source,
  '''          const timeDiffSeconds = timestampSeconds - previousBoundarySeconds;
          const totalText = workDurationTotalText(timeDiffSeconds);
          const summaryIndex = pendingReasoningGroup.summaryIndex;
          const closeIndex = pendingReasoningGroup.closeIndex;
          output[summaryIndex] = output[summaryIndex].replace(
            '</summary>',
            ` — ${totalText}</summary>`
          );
''',
  '''          const timeDiffSeconds = timestampSeconds - previousBoundarySeconds;
          const totalTimeDiffSeconds = currentUserBoundarySeconds == null
            ? null
            : timestampSeconds - currentUserBoundarySeconds;
          const summaryIndex = pendingReasoningGroup.summaryIndex;
          const closeIndex = pendingReasoningGroup.closeIndex;
          if (totalTimeDiffSeconds != null) {
            const totalText = workDurationTotalText(totalTimeDiffSeconds);
            output[summaryIndex] = output[summaryIndex].replace(
              '</summary>',
              ` — ${totalText}</summary>`
            );
          }
''',
  'cumulative reasoning summary calculation')
source = replace_once(
  source,
  '''        previousBoundarySeconds = timestampSeconds;
        pendingReasoningGroup = null;
''',
  '''        if (match[1] === '## User') {
          currentUserBoundarySeconds = timestampSeconds;
        } else if (timestampSeconds == null) {
          currentUserBoundarySeconds = null;
        }
        previousBoundarySeconds = timestampSeconds;
        pendingReasoningGroup = null;
''',
  'cumulative User timestamp update')
USERSCRIPT.write_text(source, encoding='utf-8')


tests = TESTS.read_text(encoding='utf-8')
tests = replace_once(
  tests,
  r'0\.6\.165',
  r'0\.6\.166',
  'test version assertion')
tests = replace_once(
  tests,
  "test('worked-duration annotation exposes negative errors inside reasoning groups and uses Commentary as the next boundary', () => {",
  "test('worked-duration annotation exposes negative errors while keeping User as the cumulative summary origin', () => {",
  'successive-boundary test name')
tests = replace_once(
  tests,
  '''  assert.equal((successiveAnnotated.match(/Worked for 0m 5s/g) ?? []).length, 2);
  assert.equal((successiveAnnotated.match(/ — 0m 5s<\\/summary>/g) ?? []).length, 2);
  assert.doesNotMatch(successiveAnnotated, /<\\/details>\\n\\nWorked for/);
});
''',
  '''  assert.equal((successiveAnnotated.match(/Worked for 0m 5s/g) ?? []).length, 2);
  assert.equal((successiveAnnotated.match(/ — 0m 5s<\\/summary>/g) ?? []).length, 1);
  assert.equal((successiveAnnotated.match(/ — 0m 10s<\\/summary>/g) ?? []).length, 1);
  assert.doesNotMatch(successiveAnnotated, /<\\/details>\\n\\nWorked for/);
});
''',
  'successive cumulative assertions')

marker = "test('worked-duration annotation clears timing when a boundary has no rendered timestamp', () => {"
new_test = r'''test('multi-thought summary totals are cumulative from User while interval labels stay boundary-to-boundary', () => {
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

'''
if marker not in tests:
  raise RuntimeError('missing timestamp-boundary test marker')
tests = tests.replace(marker, new_test + marker, 1)
TESTS.write_text(tests, encoding='utf-8')


design = DESIGN.read_text(encoding='utf-8')
design = replace_once(
  design,
  '''The preceding rendered `## User` prompt or `### ChatGPT Commentary` report is
the timing boundary. Only structural headings are eligible: transcript-looking
text inside fenced blocks or rendered `<details>` content remains opaque. The
enclosing `## ChatGPT` response heading is ignored for timing because real
ChatGPT data can make that heading inherit an older in-progress activity
timestamp. A boundary without a rendered timestamp clears the timing state
rather than reusing an earlier boundary.
''',
  '''For each per-interval annotation, the preceding rendered `## User` prompt or
`### ChatGPT Commentary` report is the start boundary and the terminating
Commentary is the end boundary. The reasoning-group summary uses a separate
cumulative origin: the current rendered `## User` timestamp through that same
terminating Commentary. Therefore later reasoning/commentary phases can retain a
short boundary-to-boundary `Worked for ...` line while their `Having ...
thought(s)` summary reports the full elapsed time since the User prompt. Only
structural headings are eligible: transcript-looking text inside fenced blocks or
rendered `<details>` content remains opaque. The enclosing `## ChatGPT` response
heading is ignored for timing because real ChatGPT data can make that heading
inherit an older in-progress activity timestamp. A boundary without a rendered
timestamp clears timing state rather than reusing an earlier boundary.
''',
  'design timing boundaries')
design = replace_once(
  design,
  '''For a qualifying outer `<details><summary>Having ... thought(s)</summary>` group,
the interval annotation is inserted immediately before that group's closing
`</details>`, so timing information never sits outside the reasoning disclosure.
The same whole interval is appended to the summary, for example
`Having 9 thoughts — 1m 45s`. Commentary without an immediately preceding
reasoning group receives no duration annotation, and a reasoning group without a
terminating Commentary boundary receives no total because no rendered end
timestamp is available.
''',
  '''For a qualifying outer `<details><summary>Having ... thought(s)</summary>` group,
the interval annotation is inserted immediately before that group's closing
`</details>`, so timing information never sits outside the reasoning disclosure.
The summary receives the cumulative User-to-output total instead of repeating the
last interval. For example, if one phase ends five seconds after the User prompt
and a second phase ends another five seconds later, both interval lines may say
`Worked for 0m 5s` while the summaries end in `— 0m 5s` and `— 0m 10s`.
Commentary without an immediately preceding reasoning group receives no duration
annotation, and a reasoning group without a terminating Commentary boundary
receives no total because no rendered end timestamp is available.
''',
  'design cumulative summary')
design = replace_once(
  design,
  '''The summary uses the matching compact total (`Duration error ...`, `less than a
sec`, or `Xh Ym Zs`). Negative source anomalies are surfaced rather than silently
clamped or repaired.
''',
  '''The summary uses the matching compact total (`Duration error ...`, `a sec`, or
`Xh Ym Zs`). Negative source anomalies are surfaced rather than silently clamped
or repaired.
''',
  'design sub-second summary wording')
DESIGN.write_text(design, encoding='utf-8')
