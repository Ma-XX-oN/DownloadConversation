from pathlib import Path

ROOT = Path('.')
USERSCRIPT = ROOT / 'chatgpt-conversation-markdown-export.user.js'
DESIGN = ROOT / 'DESIGN.md'
HEADING_TEST = ROOT / 'tests' / 'heading-metadata-controls.test.mjs'
DURATION_TEST = ROOT / 'tests' / 'work-duration-markers.test.mjs'
CI = ROOT / '.github' / 'workflows' / 'ci.yml'

CORE_PIN = '3233cba838bbf2d2cea5a2a6f1900ed6014dcfb0'

source = USERSCRIPT.read_text(encoding='utf-8')
old_pin = f'// @require      https://raw.githubusercontent.com/Ma-XX-oN/AIConversationCore/{CORE_PIN}/dist/aiconversationcore.chatgpt.browser.js'
if old_pin not in source:
  raise SystemExit('expected AIConversationCore pin is not present')
if source.count('// @version      0.6.163') != 1:
  raise SystemExit('expected DownloadConversation version 0.6.163 exactly once')
source = source.replace('// @version      0.6.163', '// @version      0.6.164', 1)

annotation_marker = '\n  /**\n   * Builds shared-core heading metadata'
if annotation_marker not in source:
  raise SystemExit('heading metadata insertion marker not found')
annotation_code = r'''

  // BEGIN DownloadConversation worked-duration annotation
  /**
   * Parses one already-rendered local transcript timestamp into whole epoch seconds.
   *
   * The source representation is the Core-rendered `YYYY-MM-DD HH:MM:SS` heading
   * timestamp. No raw provider timestamp is consulted by this feature.
   *
   * @param {string} timestamp - The rendered local transcript timestamp to parse.
   * @returns {number|null} Whole epoch seconds for the rendered local timestamp, or null when invalid.
   */
  function renderedTranscriptTimestampSeconds(timestamp) {
    const match = String(timestamp ?? '').match(
      /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
    );
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const date = new Date(year, month - 1, day, hour, minute, second, 0);
    if (!Number.isFinite(date.getTime())) return null;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 ||
        date.getDate() !== day || date.getHours() !== hour ||
        date.getMinutes() !== minute || date.getSeconds() !== second) {
      return null;
    }
    return Math.trunc(date.getTime() / 1000);
  }

  /**
   * Formats the elapsed whole-second difference between two rendered transcript boundaries.
   *
   * @param {number} timeDiffSeconds - Signed whole-second difference between rendered boundary timestamps.
   * @returns {string} The synthetic Thought, Worked, or Duration error annotation text.
   */
  function workDurationLabel(timeDiffSeconds) {
    if (timeDiffSeconds < -1) return `Duration error ${timeDiffSeconds}s`;
    if (timeDiffSeconds < 1) return 'Thought for less than a sec';
    const hours = Math.floor(timeDiffSeconds / 3600);
    const minutes = Math.floor((timeDiffSeconds % 3600) / 60);
    const seconds = timeDiffSeconds % 60;
    const hourText = hours > 0 ? `${hours}h ` : '';
    return `Worked for ${hourText}${minutes}m ${seconds}s`;
  }

  /**
   * Adds DownloadConversation-only duration annotations before rendered ChatGPT Commentary reports.
   *
   * The input and timing source are already-rendered Markdown heading timestamps. User prompts
   * and Commentary reports are timing boundaries; the enclosing ChatGPT response heading is
   * deliberately ignored because its rendered timestamp can represent older in-progress activity.
   * A boundary without a rendered timestamp clears timing state so no earlier timestamp is reused.
   *
   * @param {string} markdown - Core-rendered conversation Markdown to annotate.
   * @returns {string} Markdown with synthetic duration annotations, or the original Markdown when timestamps are disabled.
   */
  function annotateRenderedWorkDurations(markdown) {
    if (!showTimestamps) return markdown;
    const boundaryPattern = /^(## User|### ChatGPT Commentary)(?: \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]:)?(?:\s|$)/;
    const lines = String(markdown ?? '').split('\n');
    const output = [];
    let previousBoundarySeconds = null;
    for (const line of lines) {
      const match = line.match(boundaryPattern);
      if (!match) {
        output.push(line);
        continue;
      }
      const timestampSeconds = match[2]
        ? renderedTranscriptTimestampSeconds(match[2])
        : null;
      if (match[1] === '### ChatGPT Commentary' &&
          timestampSeconds != null && previousBoundarySeconds != null) {
        const timeDiffSeconds = timestampSeconds - previousBoundarySeconds;
        if (output.at(-1) !== '') output.push('');
        output.push(workDurationLabel(timeDiffSeconds), '');
      }
      previousBoundarySeconds = timestampSeconds;
      output.push(line);
    }
    return output.join('\n');
  }
  // END DownloadConversation worked-duration annotation
'''
source = source.replace(annotation_marker, annotation_code + annotation_marker, 1)

run_start = source.find('  async function runExport(kind) {')
run_end = source.find('\n  /**\n   * Tests API pagination logic.', run_start)
if run_start < 0 or run_end <= run_start:
  raise SystemExit('runExport scope not found')
run_export = source[run_start:run_end]
if run_export.count('const markdown = renderConversationMarkdown(') != 1:
  raise SystemExit('renderConversationMarkdown call not found exactly once in runExport')
run_export = run_export.replace(
  'const markdown = renderConversationMarkdown(',
  'const markdown = annotateRenderedWorkDurations(renderConversationMarkdown(',
  1
)
if run_export.count('}, recoveredImageMap);') != 1:
  raise SystemExit('renderConversationMarkdown closing call not found exactly once in runExport')
run_export = run_export.replace('}, recoveredImageMap);', '}, recoveredImageMap));', 1)
source = source[:run_start] + run_export + source[run_end:]
if source.count(old_pin) != 1:
  raise SystemExit('AIConversationCore pin changed while patching userscript')
USERSCRIPT.write_text(source, encoding='utf-8')

heading_test = HEADING_TEST.read_text(encoding='utf-8')
if heading_test.count(r'0\.6\.163') != 1:
  raise SystemExit('heading metadata version assertion marker not found')
heading_test = heading_test.replace(r'0\.6\.163', r'0\.6\.164', 1)
HEADING_TEST.write_text(heading_test, encoding='utf-8')

duration_test = r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

assert.match(userscript, /\/\/ @version      0\.6\.164/);
assert.match(
  userscript,
  /AIConversationCore\/3233cba838bbf2d2cea5a2a6f1900ed6014dcfb0\/dist\/aiconversationcore\.chatgpt\.browser\.js/
);

const begin = '  // BEGIN DownloadConversation worked-duration annotation';
const end = '  // END DownloadConversation worked-duration annotation';
const start = userscript.indexOf(begin);
const finish = userscript.indexOf(end, start);
assert.ok(start >= 0 && finish > start, 'Production worked-duration helper block is missing.');
const helperSource = userscript.slice(start + begin.length, finish);
const context = { showTimestamps: false };
vm.runInNewContext(
  `${helperSource}\nthis.__workedDuration = { renderedTranscriptTimestampSeconds, workDurationLabel, annotateRenderedWorkDurations };`,
  context
);
const helpers = context.__workedDuration;

function annotate(markdown, showTimestamps = true) {
  context.showTimestamps = showTimestamps;
  return helpers.annotateRenderedWorkDurations(markdown);
}

test('duration labels preserve the specified signed thresholds and complete time fields', () => {
  assert.equal(helpers.workDurationLabel(-2), 'Duration error -2s');
  assert.equal(helpers.workDurationLabel(-1), 'Thought for less than a sec');
  assert.equal(helpers.workDurationLabel(0), 'Thought for less than a sec');
  assert.equal(helpers.workDurationLabel(1), 'Worked for 0m 1s');
  assert.equal(helpers.workDurationLabel(1598), 'Worked for 26m 38s');
  assert.equal(helpers.workDurationLabel(5198), 'Worked for 1h 26m 38s');
  assert.equal(helpers.workDurationLabel(7205), 'Worked for 2h 0m 5s');
});

test('timestamp display off leaves rendered Markdown byte-identical', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:05]:',
    '',
    '> report'
  ].join('\n');
  assert.equal(annotate(markdown, false), markdown);
});

test('User and Commentary headings are boundaries while the enclosing ChatGPT heading is ignored', () => {
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
  const result = annotate(markdown);
  assert.match(result, /Thought for less than a sec\n\n### ChatGPT Commentary \[2026-09-11 20:29:42\]:/);
  assert.doesNotMatch(result, /Duration error -59s/);
});

test('negative rendered boundary differences expose a duration error instead of clamping', () => {
  const markdown = [
    '## User [2026-01-15 00:00:02]:',
    '',
    '> prompt',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:00]:',
    '',
    '> report'
  ].join('\n');
  assert.match(annotate(markdown), /Duration error -2s\n\n### ChatGPT Commentary/);
});

test('successive Commentary reports measure from the previous Commentary report', () => {
  const markdown = [
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
  const result = annotate(markdown);
  assert.equal((result.match(/Worked for 0m 5s/g) ?? []).length, 2);
});

test('a boundary without a rendered timestamp prevents reuse of an older timestamp', () => {
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
  const result = annotate(markdown);
  assert.equal((result.match(/Worked for 0m 5s/g) ?? []).length, 1);
});

test('final ChatGPT responses are not treated as external-report timing boundaries', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '## ChatGPT [2026-01-15 00:00:20]:',
    '',
    '> final answer'
  ].join('\n');
  const result = annotate(markdown);
  assert.doesNotMatch(result, /Worked for|Thought for|Duration error/);
});
'''
DURATION_TEST.write_text(duration_test, encoding='utf-8')

ci = CI.read_text(encoding='utf-8')
ci_marker = '      - name: Built-in test list UI regression\n'
if ci_marker not in ci:
  raise SystemExit('CI insertion marker not found')
ci_step = (
  '      - name: Worked-duration annotation regression\n'
  '        run: node --test tests/work-duration-markers.test.mjs\n'
)
ci = ci.replace(ci_marker, ci_step + ci_marker, 1)
CI.write_text(ci, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
section_title = '## Experimental rendered work-duration annotations'
if section_title in design:
  raise SystemExit('worked-duration design section already exists')
design = design.rstrip() + r'''

## Experimental rendered work-duration annotations

When the **Timestamp** Markdown-heading control is enabled, DownloadConversation
adds a consumer-only elapsed-time annotation before each rendered
`### ChatGPT Commentary` report. This experimental annotation is deliberately
computed from the timestamp text already present in the rendered Markdown; it
does not consult raw provider timestamps and does not change AIConversationCore
or its pinned version. When Timestamp is disabled, no duration annotation is
emitted.

The preceding rendered `## User` prompt or `### ChatGPT Commentary` report is
the timing boundary. The enclosing `## ChatGPT` response heading is ignored for
timing because real ChatGPT data can make that heading inherit an older
in-progress activity timestamp. A boundary without a rendered timestamp clears
the timing state rather than reusing an earlier boundary.

For a signed whole-second difference `time_diff`, DownloadConversation renders:

- `Duration error <time_diff>s` when `time_diff < -1`;
- `Thought for less than a sec` when `-1 <= time_diff < 1`;
- `Worked for Xm Ys` when `time_diff >= 1`, adding `Xh` only when hours are
  non-zero while retaining both minute and second fields.

Negative source anomalies are surfaced rather than silently clamped or repaired.
''' + '\n'
DESIGN.write_text(design, encoding='utf-8')
