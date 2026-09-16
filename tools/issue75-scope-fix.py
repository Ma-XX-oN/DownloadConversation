from pathlib import Path

SOURCE = Path('chatgpt-conversation-markdown-export.user.js')
TEST = Path('tests/jump-materialization.test.mjs')

source = SOURCE.read_text(encoding='utf-8')
old_timeout_text = (
  '   * The timeout is a stall timeout.  Any observed scroll/geometry progress refreshes it so a\n'
  '   * long conversation is not rejected merely because successful stock pagination needs many\n'
  '   * historical batches.'
)
new_timeout_text = (
  '   * For UAP 0, the timeout is a stall timeout.  Any observed scroll/geometry progress refreshes\n'
  '   * it so a long conversation is not rejected merely because successful stock pagination needs\n'
  '   * many historical batches.  Other targets retain the existing total traversal timeout.'
)
old_param = '   * @param {number} timeoutMs - Maximum time without materialization progress, in milliseconds.'
new_param = '   * @param {number} timeoutMs - Total traversal timeout, or UAP 0 stall timeout, in milliseconds.'
old_refresh = '      if (changed) stallDeadline = performance.now() + timeoutMs;'
new_refresh = '      if (changed && seeksOldestBoundary) stallDeadline = performance.now() + timeoutMs;'
assert source.count(old_timeout_text) == 1, 'Expected one global stall-timeout description.'
assert source.count(old_param) == 1, 'Expected one global stall-timeout parameter description.'
assert source.count(old_refresh) == 1, 'Expected one unrestricted stall-deadline refresh.'
source = source.replace(old_timeout_text, new_timeout_text, 1)
source = source.replace(old_param, new_param, 1)
source = source.replace(old_refresh, new_refresh, 1)
SOURCE.write_text(source, encoding='utf-8')

tests = TEST.read_text(encoding='utf-8')
old_signature = 'function makeHarness({ onScroll = null, onSettle = null, tocForSelector = null } = {}) {'
new_signature = 'function makeHarness({ onScroll = null, onSettle = null, tocForSelector = null, timeStepMs = 100 } = {}) {'
old_state = '    diagnostics: [],\n    settleCount: 0'
new_state = '    diagnostics: [],\n    settleCount: 0,\n    now: 0'
old_performance = '    performance,\n'
new_performance = '    performance: { now: () => state.now },\n'
old_set_timeout = (
  '    setTimeout(callback) {\n'
  '      state.settleCount += 1;\n'
  '      onSettle?.({ root: scrollRoot, state });'
)
new_set_timeout = (
  '    setTimeout(callback) {\n'
  '      state.settleCount += 1;\n'
  '      state.now += timeStepMs;\n'
  '      onSettle?.({ root: scrollRoot, state });'
)
assert tests.count(old_signature) == 1, 'Expected one Jump harness signature.'
assert tests.count(old_state) == 1, 'Expected one Jump harness state block.'
assert tests.count(old_performance) == 1, 'Expected one Jump harness performance binding.'
assert tests.count(old_set_timeout) == 1, 'Expected one Jump harness timer implementation.'
tests = tests.replace(old_signature, new_signature, 1)
tests = tests.replace(old_state, new_state, 1)
tests = tests.replace(old_performance, new_performance, 1)
tests = tests.replace(old_set_timeout, new_set_timeout, 1)
marker = "test('numeric Jump primes safe navigation before Conversation API resolution completes', async () => {"
assert tests.count(marker) == 1, 'Expected numeric-prime regression insertion point.'
regression = """test('non-oldest Jump keeps its total traversal timeout while geometry changes', async () => {
  const harness = makeHarness({
    timeStepMs: 100,
    onSettle({ root, state }) {
      if (state.settleCount <= 20) root.scrollHeight += 200;
    }
  });
  const target = {
    uap_index: 10,
    role: 'user',
    message_id: 'never-mounted',
    spine: { records: [] }
  };

  const toc = await harness.context.populateJumpTocIndex(target, 500);
  assert.equal(toc, null);
  assert.ok(harness.state.settleCount <= 6,
    'Non-oldest geometry changes must not refresh the existing total traversal timeout.');
});

"""
tests = tests.replace(marker, regression + marker, 1)
TEST.write_text(tests, encoding='utf-8')
