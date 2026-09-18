from pathlib import Path
import re


def replace_once(path, old, new):
  file_path = Path(path)
  text = file_path.read_text(encoding='utf-8')
  count = text.count(old)
  assert count == 1, f'{path}: expected one anchor, found {count}'
  file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


SOURCE = 'chatgpt-conversation-markdown-export.user.js'
UNIT = 'tests/agent-turn-stopwatch.test.mjs'
DESIGN = 'DESIGN.md'

replace_once(
  SOURCE,
  '// @version      1.2.0-issue.136.3',
  '// @version      1.2.0-issue.136.4'
)

source_path = Path(SOURCE)
source_text = source_path.read_text(encoding='utf-8')
pattern = re.compile(
  r"  function agentStopwatchRender\(nowMs = performance\.now\(\)\) \{\n"
  r".*?"
  r"\n  \}\n\n  /\*\*",
  re.DOTALL
)
replacement = '''  function agentStopwatchRender(nowMs = performance.now()) {
    if (!agentStopwatchState) return;
    assert(Number.isFinite(nowMs), 'Agent stopwatch render timestamp must be finite.');
    const lines = agentStopwatchState.laps_ms.map((duration, index) =>
      `Lap ${index + 1}: ${agentStopwatchFormatDuration(duration)}`
    );
    let totalMs;
    if (agentStopwatchState.active) {
      assert(Number.isFinite(agentStopwatchState.lap_started_at_ms),
        'Active agent stopwatch must have a lap start timestamp.');
      assert(Number.isFinite(agentStopwatchState.started_at_ms),
        'Active agent stopwatch must have an overall start timestamp.');
      const current = Math.max(0, nowMs - agentStopwatchState.lap_started_at_ms);
      lines.push(`Lap ${agentStopwatchState.laps_ms.length + 1}: ${agentStopwatchFormatDuration(current)}`);
      totalMs = Math.max(0, nowMs - agentStopwatchState.started_at_ms);
    } else {
      assert(Number.isFinite(agentStopwatchState.total_ms),
        'Completed agent stopwatch must have a total duration.');
      totalMs = agentStopwatchState.total_ms;
    }
    lines.push(`Total: ${agentStopwatchFormatDuration(totalMs)}`);
    ensureAgentStopwatchControl().textContent = lines.join('\\n');
  }

  /**'''
source_text, count = pattern.subn(replacement, source_text, count=1)
assert count == 1, f'{SOURCE}: expected one agentStopwatchRender function, found {count}'
source_path.write_text(source_text, encoding='utf-8')

replace_once(
  UNIT,
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.136\.3/);",
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.136\.4/);"
)
replace_once(
  UNIT,
  "assert.equal(harness.api.text(), 'Lap 1: 1 m 5 s');",
  "assert.equal(harness.api.text(), 'Lap 1: 1 m 5 s\\nTotal: 1 m 5 s');"
)
replace_once(
  UNIT,
  "assert.equal(harness.api.text(), 'Lap 1: 1 m 10 s\\nLap 2: 0 m 5 s');",
  "assert.equal(harness.api.text(), 'Lap 1: 1 m 10 s\\nLap 2: 0 m 5 s\\nTotal: 1 m 15 s');"
)
replace_once(
  UNIT,
  "assert.equal(harness.api.text(), 'Lap 1: 0 m 5 s');",
  "assert.equal(harness.api.text(), 'Lap 1: 0 m 5 s\\nTotal: 0 m 5 s');"
)

design_path = Path(DESIGN)
design_text = design_path.read_text(encoding='utf-8')
marker = '## Agent-turn stopwatch live total'
assert marker not in design_text, f'{DESIGN}: live-total design note already present'
design_text += '''\n\n## Agent-turn stopwatch live total\n\nThe floating stopwatch always renders a `Total` line. While the stopwatch is active, Total is the live monotonic elapsed duration from the initial prompt submission (`now - started_at_ms`) and refreshes on the same interval as the current lap. On successful terminal completion, the same line switches to the frozen `total_ms` value. Follow-up lap boundaries do not reset Total.\n'''
design_path.write_text(design_text, encoding='utf-8')
