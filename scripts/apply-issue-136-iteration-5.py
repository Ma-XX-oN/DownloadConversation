from pathlib import Path


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
  '// @version      1.2.0-issue.136.4',
  '// @version      1.2.0-issue.136.5'
)

old_render = r'''  function agentStopwatchRender(nowMs = performance.now()) {
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
    ensureAgentStopwatchControl().textContent = lines.join('\n');
  }
'''

new_render = r'''  function agentStopwatchRender(nowMs = performance.now()) {
    if (!agentStopwatchState) return;
    assert(Number.isFinite(nowMs), 'Agent stopwatch render timestamp must be finite.');
    const representedLapCount = agentStopwatchState.laps_ms.length +
      (agentStopwatchState.active ? 1 : 0);
    const showLapLines = representedLapCount > 1;
    const lines = showLapLines
      ? agentStopwatchState.laps_ms.map((duration, index) =>
        `Lap ${index + 1}: ${agentStopwatchFormatDuration(duration)}`
      )
      : [];
    let totalMs;
    if (agentStopwatchState.active) {
      assert(Number.isFinite(agentStopwatchState.lap_started_at_ms),
        'Active agent stopwatch must have a lap start timestamp.');
      assert(Number.isFinite(agentStopwatchState.started_at_ms),
        'Active agent stopwatch must have an overall start timestamp.');
      const current = Math.max(0, nowMs - agentStopwatchState.lap_started_at_ms);
      if (showLapLines) {
        lines.push(`Lap ${agentStopwatchState.laps_ms.length + 1}: ${agentStopwatchFormatDuration(current)}`);
      }
      totalMs = Math.max(0, nowMs - agentStopwatchState.started_at_ms);
    } else {
      assert(Number.isFinite(agentStopwatchState.total_ms),
        'Completed agent stopwatch must have a total duration.');
      totalMs = agentStopwatchState.total_ms;
    }
    lines.push(`Total: ${agentStopwatchFormatDuration(totalMs)}`);
    ensureAgentStopwatchControl().textContent = lines.join('\n');
  }
'''
replace_once(SOURCE, old_render, new_render)

replace_once(
  UNIT,
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.136\.4/);",
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.136\.5/);"
)
replace_once(
  UNIT,
  "assert.equal(harness.api.text(), 'Lap 1: 1 m 5 s\\nTotal: 1 m 5 s');",
  "assert.equal(harness.api.text(), 'Total: 1 m 5 s');"
)
replace_once(
  UNIT,
  "assert.equal(harness.api.text(), 'Lap 1: 0 m 5 s\\nTotal: 0 m 5 s');",
  "assert.equal(harness.api.text(), 'Total: 0 m 5 s');"
)

design_path = Path(DESIGN)
design_text = design_path.read_text(encoding='utf-8')
marker = '## Agent-turn stopwatch single-lap display'
assert marker not in design_text, f'{DESIGN}: single-lap design note already present'
design_text += '''\n\n## Agent-turn stopwatch single-lap display\n\nThe floating stopwatch always renders `Total`. When the current stopwatch session contains only one represented lap, the redundant `Lap 1` line is suppressed and only `Total` is shown. Once a follow-up creates a second lap, all lap lines are shown together with the continuously running Total. The same rule applies after completion: a one-lap completed session shows only the frozen Total, while multi-lap sessions preserve their individual lap lines plus Total.\n'''
design_path.write_text(design_text, encoding='utf-8')
