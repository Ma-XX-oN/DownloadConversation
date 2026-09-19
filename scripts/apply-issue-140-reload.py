from pathlib import Path


USER = Path('chatgpt-conversation-markdown-export.user.js')
DESIGN = Path('DESIGN.md')


def replace_once(path, old, new):
  text = path.read_text(encoding='utf-8')
  count = text.count(old)
  assert count == 1, f'{path}: expected one anchor, found {count}: {old[:100]!r}'
  path.write_text(text.replace(old, new, 1), encoding='utf-8')


def function_bounds(text, name):
  starts = [
    text.find(f'  async function {name}('),
    text.find(f'  function {name}(')
  ]
  starts = [start for start in starts if start >= 0]
  assert starts, f'missing production function {name}'
  start = min(starts)
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


def insert_after_function(path, name, block):
  text = path.read_text(encoding='utf-8')
  _, end = function_bounds(text, name)
  assert block.strip() not in text, f'{path}: helper block already present'
  path.write_text(text[:end] + '\n\n' + block.rstrip() + text[end:], encoding='utf-8')


replace_once(
  USER,
  '// @version      1.4.0-issue.140.2',
  '// @version      1.4.0-issue.140.3'
)

helpers = r'''  /**
   * Scans chronological Conversation API messages for the newest User-started
   * working exchange and reports whether its true start boundary is proven.
   *
   * @param {Array<Object>} messages - Chronological de-duplicated API messages.
   * @param {boolean} hasPreviousPage - Whether still-older API history exists.
   * @returns {Object} Recovery candidate and boundary-completeness state.
   */
  function agentStopwatchRecoveryScan(messages, hasPreviousPage) {
    const source = Array.isArray(messages) ? messages : [];
    const latestUser = [...source].reverse().find(message =>
      message?.author?.role === 'user' && agentStopwatchExchangeId(message)
    );
    if (!latestUser) {
      return {
        ready: !hasPreviousPage,
        exchange_id: null,
        user_messages: [],
        final_message: null
      };
    }

    const exchangeId = agentStopwatchExchangeId(latestUser);
    const userMessages = source.filter(message =>
      message?.author?.role === 'user' && agentStopwatchExchangeId(message) === exchangeId
    );
    const firstUser = userMessages[0] ?? null;
    const firstUserIndex = firstUser ? source.indexOf(firstUser) : -1;
    const olderBoundary = firstUserIndex > 0 && source.slice(0, firstUserIndex).some(message => {
      const olderExchangeId = agentStopwatchExchangeId(message);
      return olderExchangeId && olderExchangeId !== exchangeId;
    });
    const ready = olderBoundary || !hasPreviousPage;
    const finalMessage = [...source].reverse().find(message =>
      message?.author?.role === 'assistant' &&
      agentStopwatchExchangeId(message) === exchangeId &&
      message?.channel === 'final' &&
      message?.status === 'finished_successfully' &&
      message?.end_turn === true
    ) ?? null;

    return {
      ready,
      exchange_id: exchangeId,
      user_messages: userMessages,
      final_message: finalMessage
    };
  }

  /**
   * Pages backward only until the newest stopwatch exchange's true starting
   * User prompt has been proven.
   *
   * @param {Object} initialPage - Stock initial Conversation API response.
   * @param {Function} fetchOlderPage - Fetches one older page by start cursor.
   * @param {Function} buildSpine - Builds chronological de-duplicated messages.
   * @returns {Promise<Object>} Proven recovery candidate, or an empty candidate.
   */
  async function agentStopwatchCollectRecovery(initialPage, fetchOlderPage, buildSpine) {
    assert(initialPage && typeof initialPage === 'object',
      'Agent stopwatch recovery requires an initial Conversation API page.');
    assert(typeof fetchOlderPage === 'function',
      'Agent stopwatch recovery requires an older-page fetcher.');
    assert(typeof buildSpine === 'function',
      'Agent stopwatch recovery requires a conversation-spine builder.');

    const pages = [initialPage];
    const seenCursors = new Set();
    while (true) {
      const oldestPage = pages[pages.length - 1];
      const hasPreviousPage = oldestPage?.page_info?.has_previous_page === true;
      const spine = buildSpine(pages);
      const recovery = agentStopwatchRecoveryScan(spine?.messages ?? [], hasPreviousPage);
      if (recovery.ready || !hasPreviousPage) return recovery;

      const cursor = oldestPage?.page_info?.start_cursor ?? null;
      assert(cursor, 'Agent stopwatch recovery page is missing start_cursor.');
      assert(!seenCursors.has(cursor),
        `Agent stopwatch recovery repeated start_cursor ${cursor}.`);
      seenCursors.add(cursor);
      const olderPage = await fetchOlderPage(cursor);
      assert(olderPage && typeof olderPage === 'object',
        'Agent stopwatch recovery older-page fetch returned no page.');
      pages.push(olderPage);
    }
  }

  /**
   * Tests the exact provider stream-status state that means the recovered
   * stopwatch should continue advancing.
   *
   * @param {Object|null} payload - Parsed stream-status response.
   * @returns {boolean} True only for the exact `IS_STREAMING` state.
   */
  function agentStopwatchStreamIsActive(payload) {
    return payload?.status === 'IS_STREAMING';
  }

  /**
   * Restores stopwatch state from persisted provider timestamps and bridges an
   * active exchange into the current page's monotonic performance clock.
   *
   * @param {Object} recovery - Proven recovery candidate.
   * @param {boolean} isStreaming - Whether the provider says work is streaming.
   * @param {number} wallNowMs - Current wall-clock epoch milliseconds.
   * @param {number} monotonicNowMs - Current page monotonic milliseconds.
   * @returns {void} No value is returned.
   */
  function agentStopwatchApplyRecovery(recovery, isStreaming, wallNowMs, monotonicNowMs) {
    if (!recovery?.ready || !recovery?.exchange_id || !recovery?.user_messages?.length) return;
    assert(Number.isFinite(wallNowMs), 'Agent stopwatch recovery wall timestamp must be finite.');
    assert(Number.isFinite(monotonicNowMs),
      'Agent stopwatch recovery monotonic timestamp must be finite.');

    const userTimesMs = recovery.user_messages.map(message => Number(message?.create_time) * 1000);
    assert(userTimesMs.every(Number.isFinite),
      'Agent stopwatch recovery User timestamps must be finite.');
    for (let index = 1; index < userTimesMs.length; index += 1) {
      assert(userTimesMs[index] >= userTimesMs[index - 1],
        'Agent stopwatch recovery User timestamps must be chronological.');
    }

    const completedLaps = [];
    for (let index = 1; index < userTimesMs.length; index += 1) {
      completedLaps.push(userTimesMs[index] - userTimesMs[index - 1]);
    }

    const firstWallMs = userTimesMs[0];
    const currentLapWallMs = userTimesMs[userTimesMs.length - 1];
    agentStopwatchStopTimer();
    if (isStreaming) {
      agentStopwatchState = {
        active: true,
        started_at_ms: monotonicNowMs - Math.max(0, wallNowMs - firstWallMs),
        lap_started_at_ms: monotonicNowMs - Math.max(0, wallNowMs - currentLapWallMs),
        laps_ms: completedLaps,
        total_ms: null,
        exchange_id: recovery.exchange_id,
        pending_submission_at_ms: null,
        pending_message_id: null
      };
      agentStopwatchRender(monotonicNowMs);
      agentStopwatchStartTimer();
      return;
    }

    const finalMessage = recovery.final_message;
    const finalSeconds = Number.isFinite(Number(finalMessage?.update_time))
      ? Number(finalMessage.update_time)
      : Number(finalMessage?.create_time);
    const completedWallMs = finalSeconds * 1000;
    assert(Number.isFinite(completedWallMs) && completedWallMs >= currentLapWallMs,
      'Completed agent stopwatch recovery requires a terminal provider timestamp.');
    completedLaps.push(completedWallMs - currentLapWallMs);
    agentStopwatchState = {
      active: false,
      started_at_ms: monotonicNowMs - Math.max(0, wallNowMs - firstWallMs),
      lap_started_at_ms: null,
      laps_ms: completedLaps,
      total_ms: completedWallMs - firstWallMs,
      exchange_id: recovery.exchange_id,
      pending_submission_at_ms: null,
      pending_message_id: null
    };
    agentStopwatchRender(monotonicNowMs);
  }

  /**
   * Tests whether one request URL is the stock initial Conversation API history
   * endpoint whose response can restore stopwatch state after reload.
   *
   * @param {string} url - Candidate request URL.
   * @returns {boolean} True only for `/backend-api/conversations/<id>`.
   */
  function agentStopwatchIsInitialConversationUrl(url) {
    try {
      const parsed = new URL(String(url ?? ''), location.href);
      return parsed.origin === location.origin &&
        /^\\/backend-api\\/conversations\\/[^/]+$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  /**
   * Fetches the provider stream status for one recovered conversation using the
   * already captured authenticated Conversation API request context.
   *
   * @param {string} conversationId - Stable provider conversation id.
   * @returns {Promise<Object>} Parsed stream-status payload.
   */
  async function agentStopwatchFetchStreamStatus(conversationId) {
    const url = `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationId)}/stream_status`;
    const response = await apiFetch(url);
    if (!response?.ok) {
      throw new Error(`Agent stopwatch stream-status request failed with HTTP ${response?.status ?? 'unknown'}.`);
    }
    return response.json();
  }

  /**
   * Reconstructs the newest stopwatch exchange from one cloned stock reload
   * history response, paging backward only when the true prompt predates it.
   *
   * @param {Response} response - Independently owned stock history response clone.
   * @returns {Promise<void>} Resolves after restoration is applied or skipped.
   */
  async function agentStopwatchObserveConversationResponse(response) {
    if (agentStopwatchState) return;
    if (!response?.ok) return;
    const initialPage = await response.json();
    const conversationId = initialPage?.conversation_id || currentConversationId();
    if (!conversationId) return;

    const recovery = await agentStopwatchCollectRecovery(
      initialPage,
      cursor => fetchOneConversationPage(
        pageUrl(conversationId, cursor),
        'Agent stopwatch recovery pagination request',
        { request_kind: 'stopwatch-recovery', cursor }
      ),
      conversationSpineFromPages
    );
    if (!recovery.ready || agentStopwatchState) return;

    const streamStatus = await agentStopwatchFetchStreamStatus(conversationId);
    if (agentStopwatchState) return;
    agentStopwatchApplyRecovery(
      recovery,
      agentStopwatchStreamIsActive(streamStatus),
      Date.now(),
      performance.now()
    );
  }
'''
insert_after_function(USER, 'agentStopwatchObserveInputMessage', helpers)

replace_once(
  USER,
  "        if (request) void agentTerminalObserveStatsRequest(request, requestUrl, requestMethod);\n        const generationRequest = isGenerationStreamUrl(requestUrl) && requestMethod === 'POST';",
  "        if (request) void agentTerminalObserveStatsRequest(request, requestUrl, requestMethod);\n        const stopwatchConversationRequest =\n          requestMethod === 'GET' && agentStopwatchIsInitialConversationUrl(requestUrl);\n        const generationRequest = isGenerationStreamUrl(requestUrl) && requestMethod === 'POST';"
)

replace_once(
  USER,
  "        return responsePromise.then(response => {\n          const generationResponse = capturePromise ? cloneSafely(response) : null;\n          stockNetworkTraceFetchResponse(response, stockTrace);",
  "        return responsePromise.then(response => {\n          const generationResponse = capturePromise ? cloneSafely(response) : null;\n          const stopwatchConversationResponse = stopwatchConversationRequest\n            ? cloneSafely(response)\n            : null;\n          stockNetworkTraceFetchResponse(response, stockTrace);"
)

replace_once(
  USER,
  "          void communicationLogFetchResponse(response, stockTrace)\n            .catch(communicationError => communicationLogReportFailure('fetch-response', communicationError));\n          if (capturePromise && !generationResponse) {",
  "          void communicationLogFetchResponse(response, stockTrace)\n            .catch(communicationError => communicationLogReportFailure('fetch-response', communicationError));\n          if (stopwatchConversationRequest && !stopwatchConversationResponse) {\n            logDiagnostic('warnings', 'agent-stopwatch-recovery-response-clone-failure', {\n              url: boundedDiagnosticText(response?.url ?? requestUrl, 320)\n            });\n          }\n          if (stopwatchConversationResponse) {\n            void agentStopwatchObserveConversationResponse(stopwatchConversationResponse)\n              .catch(error => logDiagnostic('warnings', 'agent-stopwatch-recovery-failed', {\n                message: boundedDiagnosticText(errorMessage(error), 1000)\n              }));\n          }\n          if (capturePromise && !generationResponse) {"
)

design_section = r'''## Agent-turn stopwatch reload restoration

A full page reload clears the stopwatch's page-lifetime monotonic state, but the
stock Conversation API history retains provider `create_time` values and working
exchange identities. DownloadConversation restores the floating stopwatch from
that structured history rather than establishing a new local start time.

The synchronously cloned stock `GET /backend-api/conversations/<id>` response is
the restoration trigger. The newest User-started working exchange is identified
from the de-duplicated chronological API spine. If the initial history window
starts inside that exchange, DownloadConversation follows `start_cursor` backward
until an older different exchange proves the true starting User prompt or the
beginning of conversation is reached. Every same-exchange User `create_time`
becomes a historical lap boundary.

The provider `/backend-api/conversation/<id>/stream_status` response controls only
whether the recovered stopwatch continues to advance. `IS_STREAMING` bridges the
persisted wall-clock boundaries into the new page's `performance.now()` domain;
completed lap durations remain fixed while the current lap and Total advance.
When the stream is not active, the recovered successful final Assistant timestamp
freezes the final lap and Total. In both states the recovered stopwatch remains
visible. Repeated streamed copies of recovered User messages do not create laps
because restoration leaves no pending local submission boundary.

Reload restoration does not add a second terminal classifier. Subsequent live
terminal state continues through the existing shared structured terminal dispatcher.
No rendered-text or DOM transcript fallback is introduced.

'''
replace_once(
  DESIGN,
  '## Shared agent terminal dispatch\n',
  design_section + '## Shared agent terminal dispatch\n'
)
