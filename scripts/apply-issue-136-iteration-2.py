from pathlib import Path


def replace_once(path, old, new):
  file_path = Path(path)
  text = file_path.read_text(encoding='utf-8')
  count = text.count(old)
  assert count == 1, f'{path}: expected one anchor, found {count}'
  file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


SOURCE = 'chatgpt-conversation-markdown-export.user.js'
TEST = 'tests/agent-turn-stopwatch.test.mjs'
DESIGN = 'DESIGN.md'

replace_once(
  SOURCE,
  '// @version      1.2.0-issue.136.1',
  '// @version      1.2.0-issue.136.2'
)

old_input = '''  /**
   * Classifies one enriched streamed User input as the initial prompt, a follow-up, or a new exchange.
   *
   * @param {Object} capture - Mutable streamed-turn capture associated with the input.
   * @param {Object} message - Enriched provider User input_message.
   * @param {boolean} isFollowUp - Whether provider metadata explicitly marks `message_type: next`.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveInputMessage(capture, message, isFollowUp) {
    if (message?.author?.role !== 'user' || !agentStopwatchState?.active) return;
    const pendingId = agentStopwatchState.pending_message_id;
    if (pendingId && message?.id && message.id !== pendingId) return;
    const submittedAtMs = agentStopwatchState.pending_submission_at_ms ??
      capture?.stopwatch_submitted_at_ms;
    if (!Number.isFinite(submittedAtMs)) return;
    const exchangeId = agentStopwatchExchangeId(message);
    if (!agentStopwatchState.exchange_id) {
      agentStopwatchState.exchange_id = exchangeId;
    } else if (exchangeId && exchangeId !== agentStopwatchState.exchange_id) {
      agentStopwatchStartNew(submittedAtMs);
      agentStopwatchState.exchange_id = exchangeId;
    } else if (isFollowUp && exchangeId === agentStopwatchState.exchange_id) {
      agentStopwatchRecordLap(submittedAtMs);
    }
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchRender(performance.now());
  }
'''
new_input = '''  /**
   * Classifies one enriched streamed User input as the initial prompt, a same-exchange follow-up,
   * or a new exchange.
   *
   * The live provider `input_message` carries the working exchange identity but does not reliably
   * carry `message_type`. A pending local User submission in the same working exchange is therefore
   * the follow-up boundary; a different working exchange starts a fresh stopwatch session.
   *
   * @param {Object} capture - Mutable streamed-turn capture associated with the input.
   * @param {Object} message - Enriched provider User input_message.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveInputMessage(capture, message) {
    if (message?.author?.role !== 'user' || !agentStopwatchState?.active) return;
    const pendingId = agentStopwatchState.pending_message_id;
    if (pendingId && message?.id && message.id !== pendingId) return;
    const submittedAtMs = agentStopwatchState.pending_submission_at_ms;
    if (!Number.isFinite(submittedAtMs)) return;
    const exchangeId = agentStopwatchExchangeId(message);
    if (!exchangeId) return;
    capture.stopwatch_exchange_id = exchangeId;
    if (!agentStopwatchState.exchange_id) {
      agentStopwatchState.exchange_id = exchangeId;
    } else if (exchangeId !== agentStopwatchState.exchange_id) {
      agentStopwatchStartNew(submittedAtMs);
      agentStopwatchState.exchange_id = exchangeId;
    } else {
      agentStopwatchRecordLap(submittedAtMs);
    }
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchRender(performance.now());
  }
'''
replace_once(SOURCE, old_input, new_input)

old_terminal = '''  function agentStopwatchObserveTerminal(capture) {
    if (!agentStopwatchState?.active) return;
    const finalMessage = agentStopwatchSuccessfulFinal(capture);
    if (!finalMessage) return;
    const exchangeId = agentStopwatchExchangeId(finalMessage);
    if (agentStopwatchState.exchange_id && exchangeId !== agentStopwatchState.exchange_id) return;
    if (!agentStopwatchState.exchange_id) agentStopwatchState.exchange_id = exchangeId;
    const completedAtMs = performance.now();
    agentStopwatchRecordLap(completedAtMs);
    agentStopwatchState.active = false;
    agentStopwatchState.total_ms = completedAtMs - agentStopwatchState.started_at_ms;
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchStopTimer();
    agentStopwatchRender(completedAtMs);
  }
'''
new_terminal = '''  function agentStopwatchObserveTerminal(capture) {
    if (!agentStopwatchState?.active) return;
    const finalMessage = agentStopwatchSuccessfulFinal(capture);
    if (!finalMessage) return;
    const exchangeId = capture?.stopwatch_exchange_id ?? null;
    if (!exchangeId || exchangeId !== agentStopwatchState.exchange_id) return;
    const completedAtMs = performance.now();
    agentStopwatchRecordLap(completedAtMs);
    agentStopwatchState.active = false;
    agentStopwatchState.total_ms = completedAtMs - agentStopwatchState.started_at_ms;
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchStopTimer();
    agentStopwatchRender(completedAtMs);
  }
'''
replace_once(SOURCE, old_terminal, new_terminal)

old_observer = '''  function agentStopwatchObserveStreamEvent(capture, event) {
    if (event && event.type === 'input_message' && event.input_message?.author?.role === 'user') {
      const isFollowUp = event.input_message?.metadata?.message_type === 'next';
      agentStopwatchObserveInputMessage(capture, event.input_message, isFollowUp);
    }
    agentStopwatchObserveTerminal(capture);
  }
'''
new_observer = '''  function agentStopwatchObserveStreamEvent(capture, event) {
    if (event && event.type === 'input_message' && event.input_message?.author?.role === 'user') {
      agentStopwatchObserveInputMessage(capture, event.input_message);
    }
    agentStopwatchObserveTerminal(capture);
  }
'''
replace_once(SOURCE, old_observer, new_observer)

replace_once(
  TEST,
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.136\.1/);",
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.136\.2/);"
)

replace_once(
  TEST,
  "  return {\n    conversation_id: 'conversation-1',\n    stream_messages: [{",
  "  return {\n    conversation_id: 'conversation-1',\n    stopwatch_exchange_id: exchangeId,\n    stream_messages: [{"
)

old_nonfollow = '''test('non-follow-up input does not create a lap merely because control returned to the User', () => {
  const harness = stopwatchHarness();
  const initial = requestCapture('user-1', 1000);
  harness.api.request(initial);
  harness.api.event(initial, inputEvent('user-1', 'exchange-A'));

  const ambiguous = requestCapture('user-2', 41000);
  harness.api.request(ambiguous);
  harness.api.event(ambiguous, inputEvent('user-2', 'exchange-A'));
  assert.deepEqual(Array.from(harness.api.state().laps_ms), []);
});
'''
new_nonfollow = '''test('same-exchange User input creates a lap without relying on message_type metadata', () => {
  const harness = stopwatchHarness();
  const initial = requestCapture('user-1', 1000);
  harness.api.request(initial);
  harness.api.event(initial, inputEvent('user-1', 'exchange-A'));

  const followUp = requestCapture('user-2', 41000);
  harness.api.request(followUp);
  harness.api.event(followUp, inputEvent('user-2', 'exchange-A'));
  assert.deepEqual(Array.from(harness.api.state().laps_ms), [40000]);
});
'''
replace_once(TEST, old_nonfollow, new_nonfollow)

replace_once(
  TEST,
  "  assert.match(observer, /event\\.type === 'input_message'/);\n  assert.match(observer, /message_type === 'next'/);\n",
  "  assert.match(observer, /event\\.type === 'input_message'/);\n  assert.doesNotMatch(observer, /message_type/);\n"
)

path = Path(DESIGN)
text = path.read_text(encoding='utf-8')
marker = '## Agent-turn stopwatch live-stream identity'
assert marker not in text, f'{DESIGN}: iteration-2 design note already present'
text += '''\n\n## Agent-turn stopwatch live-stream identity\n\nThe stopwatch classifies User submissions from the production SSE stream by working-exchange identity, not by `message_type`. Captured provider evidence shows that the top-level User `input_message` carries `turn_exchange_id` / `working_turn_id` but may omit `message_type`, while a later hidden system record in the same turn may carry `message_type: next`. The stopwatch therefore treats a pending User submission with the same working exchange as a lap boundary and a different working exchange as a new timing session.\n\nEach streamed generation capture retains the working exchange learned from its User `input_message`. Terminal stopwatch validation uses that capture-level identity together with the completed final Assistant record. This avoids depending on later message-metadata patch representation while keeping exchange matching explicit and single-path.\n'''
path.write_text(text, encoding='utf-8')
