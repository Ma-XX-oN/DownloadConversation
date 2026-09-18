from pathlib import Path

USER = Path('chatgpt-conversation-markdown-export.user.js')


def replace_once(path, old, new):
  text = path.read_text(encoding='utf-8')
  count = text.count(old)
  assert count == 1, f'{path}: expected one anchor, found {count}: {old[:80]!r}'
  path.write_text(text.replace(old, new, 1), encoding='utf-8')


def function_bounds(text, name):
  marker = f'  function {name}('
  start = text.find(marker)
  assert start >= 0, f'missing production function {name}'
  brace = text.find('{', start)
  assert brace >= 0, f'missing opening brace for {name}'
  depth = 0
  quote = None
  escape = False
  line_comment = False
  block_comment = False
  i = brace
  while i < len(text):
    ch = text[i]
    nxt = text[i + 1] if i + 1 < len(text) else ''
    if line_comment:
      if ch == '\n':
        line_comment = False
      i += 1
      continue
    if block_comment:
      if ch == '*' and nxt == '/':
        block_comment = False
        i += 2
      else:
        i += 1
      continue
    if quote:
      if escape:
        escape = False
      elif ch == '\\':
        escape = True
      elif ch == quote:
        quote = None
      i += 1
      continue
    if ch in ('\"', "'", '`'):
      quote = ch
      i += 1
      continue
    if ch == '/' and nxt == '/':
      line_comment = True
      i += 2
      continue
    if ch == '/' and nxt == '*':
      block_comment = True
      i += 2
      continue
    if ch == '{':
      depth += 1
    elif ch == '}':
      depth -= 1
      if depth == 0:
        return start, i + 1
    i += 1
  raise AssertionError(f'unclosed production function {name}')


def replace_function(path, name, replacement):
  text = path.read_text(encoding='utf-8')
  start, end = function_bounds(text, name)
  path.write_text(text[:start] + replacement + text[end:], encoding='utf-8')


def insert_after_function(path, name, block):
  text = path.read_text(encoding='utf-8')
  _, end = function_bounds(text, name)
  assert block.strip() not in text, f'{path}: helper block already present'
  path.write_text(text[:end] + '\n\n' + block.rstrip() + text[end:], encoding='utf-8')


replace_once(
  USER,
  '// @version      1.3.0',
  '// @version      1.3.0-issue.139.1'
)

helpers = r'''  /**
   * Returns whether one normalized client terminal event is the evidenced polling timeout.
   *
   * @param {Object|null} event - Normalized client terminal event.
   * @returns {boolean} True only for the exact structured polling-timeout state.
   */
  function agentTerminalIsPollingTimeout(event) {
    return event?.type === 'client_terminal_error' &&
      event?.code === 'network_error' &&
      event?.source === 'completion_stream_polling_fallback' &&
      event?.reason === 'polling_timeout';
  }

  /**
   * Normalizes the exact stock ChatGPT stats counter emitted for polling timeout.
   *
   * @param {Object|null} payload - Parsed `/ces/statsc/flush` request payload.
   * @returns {Object|null} Normalized terminal event, or null for unrelated stats.
   */
  function agentTerminalFailureFromStatsPayload(payload) {
    const counters = Array.isArray(payload?.counters) ? payload.counters : [];
    const matched = counters.find(counter =>
      counter?.namespace === 'default' &&
      counter?.metric === 'chatgpt_web_message_delivery_failure_shown' &&
      counter?.tags?.source === 'completion_stream_polling_fallback' &&
      counter?.tags?.error_code === 'network_error' &&
      counter?.tags?.failure_reason === 'polling_timeout' &&
      Number(counter?.value) > 0
    );
    if (!matched) return null;
    return {
      type: 'client_terminal_error',
      code: 'network_error',
      source: 'completion_stream_polling_fallback',
      reason: 'polling_timeout'
    };
  }

  /**
   * Returns whether a URL is the exact same-origin ChatGPT stats-flush endpoint.
   *
   * @param {string} url - Candidate request URL.
   * @returns {boolean} True only for `/ces/statsc/flush` on the current origin.
   */
  function isAgentTerminalStatsUrl(url) {
    try {
      const parsed = new URL(String(url ?? ''), location.href);
      return parsed.origin === location.origin && parsed.pathname === '/ces/statsc/flush';
    } catch {
      return false;
    }
  }

  /**
   * Observes one stock stats-flush request for the exact structured polling-timeout terminal state.
   *
   * @param {Request} request - Original page request; only a clone is consumed.
   * @param {string} requestUrl - Resolved request URL.
   * @param {string} requestMethod - Uppercase HTTP method.
   * @returns {Promise<void>} Resolves after relevant structured terminal evidence is handled.
   */
  async function agentTerminalObserveStatsRequest(request, requestUrl, requestMethod) {
    if (requestMethod !== 'POST' || !isAgentTerminalStatsUrl(requestUrl)) return;
    const cloned = cloneSafely(request);
    if (!cloned) return;
    try {
      const payload = JSON.parse(await cloned.text());
      const event = agentTerminalFailureFromStatsPayload(payload);
      if (!event) return;
      const capture = streamTailCapture;
      if (!capture) {
        logDiagnostic('warnings', 'agent-terminal-polling-timeout-without-capture', {});
        return;
      }
      logDiagnostic('debug', 'agent-terminal-polling-timeout-observed', {
        conversation_id: capture?.conversation_id ?? null,
        terminal_key: agentSoundTerminalKey(capture)
      });
      agentSoundObserveTerminal(capture, event);
      agentStopwatchObserveTerminal(capture, event);
    } catch (error) {
      logDiagnostic('debug', 'agent-terminal-stats-request-parse-failed', {
        error: boundedDiagnosticText(errorMessage(error), 1000)
      });
    }
  }
'''
insert_after_function(USER, 'agentSoundRememberTerminalKey', helpers)

replace_function(USER, 'agentSoundClassifyTerminal', r'''  function agentSoundClassifyTerminal(capture, event) {
    const structured = [];
    if (event && typeof event === 'object' && !Array.isArray(event)) structured.push(event);
    if (event?.v && typeof event.v === 'object' && !Array.isArray(event.v)) structured.push(event.v);
    for (const candidate of structured) {
      if (agentTerminalIsPollingTimeout(candidate)) return 'error';
      const providerCode = candidate.code ?? candidate?.error?.code ?? null;
      if (candidate.type === 'error' && providerCode === 'conversation_too_large') return 'error';
      if (candidate.result === 'error' &&
          candidate?.error?.reason === 'request_failed' &&
          Number(candidate?.error?.status_code) >= 400) {
        return 'error';
      }
    }
    const successfulFinal = [...(capture?.stream_messages ?? [])].reverse().find(message =>
      message?.author?.role === 'assistant' &&
      message?.channel === 'final' &&
      message?.status === 'finished_successfully' &&
      message?.end_turn === true
    );
    return successfulFinal ? 'success' : null;
  }''')

replace_once(
  USER,
  "  /**\n   * Stops the active stopwatch only for a successful final Assistant in the same working exchange.\n   *\n   * @param {Object} capture - Mutable streamed-turn capture.\n   * @returns {void} No value is returned.\n   */\n  function agentStopwatchObserveTerminal(capture)",
  "  /**\n   * Stops the active stopwatch for a successful final Assistant or evidenced polling timeout in the same exchange.\n   *\n   * @param {Object} capture - Mutable streamed-turn capture.\n   * @param {Object|null} event - Structured terminal event when the client reports one.\n   * @returns {void} No value is returned.\n   */\n  function agentStopwatchObserveTerminal(capture)"
)

replace_function(USER, 'agentStopwatchObserveTerminal', r'''  function agentStopwatchObserveTerminal(capture, event = null) {
    if (!agentStopwatchState?.active) return;
    const finalMessage = agentStopwatchSuccessfulFinal(capture);
    const pollingTimeout = agentTerminalIsPollingTimeout(event);
    if (!finalMessage && !pollingTimeout) return;
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
  }''')

replace_function(USER, 'agentStopwatchObserveStreamEvent', r'''  function agentStopwatchObserveStreamEvent(capture, event) {
    if (event && event.type === 'input_message' && event.input_message?.author?.role === 'user') {
      agentStopwatchObserveInputMessage(capture, event.input_message);
    }
    agentStopwatchObserveTerminal(capture, event);
  }''')

replace_once(
  USER,
  "        const requestMethod = String(request?.method ?? init.method ?? 'GET').toUpperCase();\n        const generationRequest = isGenerationStreamUrl(requestUrl) && requestMethod === 'POST';",
  "        const requestMethod = String(request?.method ?? init.method ?? 'GET').toUpperCase();\n        if (request) void agentTerminalObserveStatsRequest(request, requestUrl, requestMethod);\n        const generationRequest = isGenerationStreamUrl(requestUrl) && requestMethod === 'POST';"
)

for path in [
  Path('tests/agent-completion-sounds.test.mjs'),
  Path('tests/agent-turn-stopwatch.test.mjs'),
  Path('tests/agent-turn-stopwatch-stream.test.mjs'),
  Path('tests/agent-terminal-polling-timeout.test.mjs'),
]:
  text = path.read_text(encoding='utf-8')
  if "productionFunctionSource('agentSoundClassifyTerminal')" in text:
    anchor = "    ${productionFunctionSource('agentSoundRememberTerminalKey')}\n    ${productionFunctionSource('agentSoundClassifyTerminal')}"
    if anchor in text:
      text = text.replace(
        anchor,
        "    ${productionFunctionSource('agentSoundRememberTerminalKey')}\n    ${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    ${productionFunctionSource('agentSoundClassifyTerminal')}",
        1
      )
  if "productionFunctionSource('agentStopwatchObserveTerminal')" in text:
    anchor = "    ${productionFunctionSource('agentStopwatchSuccessfulFinal')}\n    ${productionFunctionSource('agentStopwatchObserveTerminal')}"
    if anchor in text:
      text = text.replace(
        anchor,
        "    ${productionFunctionSource('agentStopwatchSuccessfulFinal')}\n    ${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    ${productionFunctionSource('agentStopwatchObserveTerminal')}",
        1
      )
  path.write_text(text, encoding='utf-8')

replace_once(
  Path('tests/agent-turn-stopwatch.test.mjs'),
  r"assert.match(userscript, /@version\s+1\.3\.0/);",
  r"assert.match(userscript, /@version\s+1\.3\.0-issue\.139\.1/);"
)

DESIGN = Path('DESIGN.md')
design_text = DESIGN.read_text(encoding='utf-8')
section = r'''

## Issue #139 structured polling-timeout terminal state

A stock ChatGPT message-delivery polling timeout is terminal evidence only when the
page emits the exact structured `/ces/statsc/flush` counter observed in production:
`chatgpt_web_message_delivery_failure_shown` with source
`completion_stream_polling_fallback`, `error_code=network_error`, and
`failure_reason=polling_timeout`. DownloadConversation observes a clone of that
stock request and normalizes the counter to one internal terminal-error event.

That normalized event is correlated with the current structured generation capture.
When its exchange identity matches the active stopwatch exchange, the stopwatch
freezes its final lap and Total. The same event is passed through the existing
terminal-sound de-duplication path and emits one error cue when volume is nonzero.
Repeated observations cannot stop the stopwatch twice or replay the sound for the
same generation identity.

Rendered error text, DOM lifecycle labels, elapsed-time thresholds, and retry counts
are not terminal-state authorities. The recorder does not infer this state from the
visible `Retry` UI and does not add an alternate/fallback terminal-detection path.
'''
assert '## Issue #139 structured polling-timeout terminal state' not in design_text
DESIGN.write_text(design_text.rstrip() + section.rstrip() + '\n', encoding='utf-8')
