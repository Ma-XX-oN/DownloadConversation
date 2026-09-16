from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
  global text
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  text = text.replace(old, new, 1)


replace_once(
  '// @version      1.2.0-issue.75.2',
  '// @version      1.2.0-issue.75.3',
  'version'
)

replace_once(
  "  /** Byte comparison chunk size used to verify ambiguous append outcomes. */\n"
  "  const COMMUNICATION_LOG_COMPARE_CHUNK_BYTES = 256 * 1024;\n",
  "  /** Byte comparison chunk size used to verify ambiguous append outcomes. */\n"
  "  const COMMUNICATION_LOG_COMPARE_CHUNK_BYTES = 256 * 1024;\n"
  "  /** Delayed observation offsets after one stock historical-page response completes. */\n"
  "  const JUMP_LOADING_POST_RESPONSE_DELAYS_MS = Object.freeze([0, 100, 500, 1500, 3000]);\n",
  'historical-loading delay constant'
)

replace_once(
  "  /** Click observation currently collecting correlated network/resource evidence. */\n"
  "  let activeClickDiagnostic = null;\n",
  "  /** Click observation currently collecting correlated network/resource evidence. */\n"
  "  let activeClickDiagnostic = null;\n"
  "  /** Guards stock historical-loading input/scroll diagnostics against duplicate installation. */\n"
  "  let jumpLoadingDiagnosticsInstalled = false;\n"
  "  /** Most recently observed conversation scroll root used for manual-scroll correlation. */\n"
  "  let jumpLoadingLastScrollRoot = null;\n"
  "  /** Last observed scrollTop on the active conversation scroll root. */\n"
  "  let jumpLoadingLastScrollTop = null;\n"
  "  /** Most recent trusted user input capable of moving the conversation viewport. */\n"
  "  let jumpLoadingLastTrustedInput = null;\n"
  "  /** Most recent trusted conversation scroll retained for historical-request correlation. */\n"
  "  let jumpLoadingLastUserScroll = null;\n"
  "  /** Whether a trusted pointer gesture is currently active on the page. */\n"
  "  let jumpLoadingPointerActive = false;\n"
  "  /** Monotonic local sequence assigned only to stock historical-page requests. */\n"
  "  let jumpLoadingHistoricalSequence = 0;\n",
  'historical-loading diagnostic state'
)

block = r'''
  /**
   * Reports whether one page fetch is a stock ChatGPT request for older conversation history.
   *
   * DownloadConversation's direct Conversation API walk bypasses the page fetch wrapper via
   * `originalPageFetch`, so this classifier describes stock page loading rather than export work.
   *
   * @param {string} url - Candidate page request URL.
   * @returns {boolean} True only for same-origin `/messages?before=...` history requests.
   */
  function isStockHistoricalConversationPageUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin) return false;
      if (!/^\/backend-api\/conversations\/[^/]+\/messages$/.test(parsed.pathname)) return false;
      return parsed.searchParams.has('before');
    } catch {
      return false;
    }
  }

  /**
   * Captures the bounded identity of one currently mounted virtual-window turn.
   *
   * @param {HTMLElement|null} section - Mounted ChatGPT turn section.
   * @returns {Object|null} Bounded turn identity, or null when no section is available.
   */
  function jumpLoadingTurnSnapshot(section) {
    if (!(section instanceof HTMLElement)) return null;
    const message = section.querySelector('[data-message-id]');
    return {
      turn_id: section.getAttribute('data-turn-id') || null,
      role: section.getAttribute('data-turn') || null,
      message_id: message?.getAttribute('data-message-id') || null
    };
  }

  /**
   * Captures the current virtualized conversation window without retaining message content.
   *
   * @returns {Object} Scroll extent, mounted boundary identities, and mounted TOC-index range.
   */
  function jumpLoadingDiagnosticSnapshot() {
    const scrollRoot = conversationScrollRoot();
    const sections = [...document.querySelectorAll('section[data-turn-id]')]
      .filter(section => section instanceof HTMLElement);
    const tocIndices = [...document.querySelectorAll('button[data-toc-item-index]')]
      .map(button => Number.parseInt(button.getAttribute('data-toc-item-index') ?? '', 10))
      .filter(Number.isFinite);
    const scrollTop = Number(scrollRoot?.scrollTop) || 0;
    const scrollHeight = Number(scrollRoot?.scrollHeight) || 0;
    const clientHeight = Number(scrollRoot?.clientHeight) || 0;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    return {
      scroll_top: scrollTop,
      scroll_height: scrollHeight,
      client_height: clientHeight,
      at_top: scrollTop <= 2,
      at_bottom: scrollTop >= maxScrollTop - 2,
      mounted_turn_count: sections.length,
      oldest_mounted_turn: jumpLoadingTurnSnapshot(sections[0] ?? null),
      newest_mounted_turn: jumpLoadingTurnSnapshot(sections.at(-1) ?? null),
      toc_count: tocIndices.length,
      toc_min_index: tocIndices.length ? Math.min(...tocIndices) : null,
      toc_max_index: tocIndices.length ? Math.max(...tocIndices) : null
    };
  }

  /**
   * Installs evidence-only listeners that correlate trusted user scrolling with stock history loads.
   *
   * Programmatic Jump scrolling is intentionally not classified as user scrolling merely because
   * the browser later emits a scroll event; a recent trusted wheel/key/pointer gesture is required.
   *
   * @returns {void} No value is returned.
   */
  function installJumpLoadingDiagnostics() {
    if (jumpLoadingDiagnosticsInstalled) return;
    jumpLoadingDiagnosticsInstalled = true;

    /**
     * Retains one trusted input that can plausibly cause a subsequent conversation scroll.
     *
     * @param {Event} event - Candidate browser input event.
     * @returns {void} No value is returned.
     */
    function rememberTrustedInput(event) {
      if (event.isTrusted !== true) return;
      if (event.type === 'keydown' &&
          !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        return;
      }
      jumpLoadingLastTrustedInput = {
        type: event.type,
        key: event.type === 'keydown' ? event.key : null,
        at: performance.now()
      };
    }

    /**
     * Opens the trusted-pointer correlation window used for scrollbar/touch dragging.
     *
     * @param {PointerEvent} event - Trusted pointer-down event.
     * @returns {void} No value is returned.
     */
    function beginPointerInput(event) {
      if (event.isTrusted !== true) return;
      jumpLoadingPointerActive = true;
      rememberTrustedInput(event);
    }

    /**
     * Closes the trusted-pointer correlation window.
     *
     * @param {PointerEvent} event - Pointer completion/cancellation event.
     * @returns {void} No value is returned.
     */
    function endPointerInput(event) {
      if (event.isTrusted !== true) return;
      jumpLoadingPointerActive = false;
    }

    /**
     * Records one conversation scroll only when recent trusted input explains the movement.
     *
     * @param {Event} event - Captured browser scroll event.
     * @returns {void} No value is returned.
     */
    function recordTrustedScroll(event) {
      const scrollRoot = conversationScrollRoot();
      if (!scrollRoot) return;
      if (jumpLoadingLastScrollRoot !== scrollRoot) {
        jumpLoadingLastScrollRoot = scrollRoot;
        jumpLoadingLastScrollTop = Number(scrollRoot.scrollTop) || 0;
        return;
      }
      const current = Number(scrollRoot.scrollTop) || 0;
      const previous = Number.isFinite(jumpLoadingLastScrollTop)
        ? jumpLoadingLastScrollTop
        : current;
      jumpLoadingLastScrollTop = current;
      const delta = current - previous;
      if (Math.abs(delta) < 0.5) return;
      const input = jumpLoadingLastTrustedInput;
      const inputAge = input ? Math.max(0, performance.now() - input.at) : Number.POSITIVE_INFINITY;
      if (!jumpLoadingPointerActive && inputAge > 1500) return;
      const direction = delta < 0 ? 'older' : 'newer';
      const details = {
        direction,
        distance_px: Math.abs(delta),
        input_type: input?.type ?? (jumpLoadingPointerActive ? 'pointer' : null),
        input_key: input?.key ?? null,
        input_age_ms: Number.isFinite(inputAge) ? Math.round(inputAge) : null,
        state: jumpLoadingDiagnosticSnapshot()
      };
      jumpLoadingLastUserScroll = {
        direction,
        distance_px: Math.abs(delta),
        at: performance.now()
      };
      logDiagnostic('debug', 'conversation-jump-loading-user-scroll', details);
    }

    document.addEventListener('wheel', rememberTrustedInput, { capture: true, passive: true });
    document.addEventListener('keydown', rememberTrustedInput, true);
    document.addEventListener('pointerdown', beginPointerInput, true);
    document.addEventListener('pointerup', endPointerInput, true);
    document.addEventListener('pointercancel', endPointerInput, true);
    document.addEventListener('scroll', recordTrustedScroll, true);
  }

  /**
   * Starts correlation for one stock ChatGPT historical-page request.
   *
   * @param {string} url - Stock fetch URL.
   * @param {number|null} networkSequence - Existing stock-network diagnostic sequence.
   * @returns {Object|null} Correlation trace, or null for non-historical requests.
   */
  function jumpLoadingHistoricalRequestStart(url, networkSequence = null) {
    if (!isStockHistoricalConversationPageUrl(url)) return null;
    const parsed = new URL(url, location.href);
    const now = performance.now();
    const userScrollAge = jumpLoadingLastUserScroll
      ? Math.max(0, now - jumpLoadingLastUserScroll.at)
      : Number.POSITIVE_INFINITY;
    const trace = {
      historical_sequence: ++jumpLoadingHistoricalSequence,
      network_sequence: networkSequence,
      started_at: now,
      request_path: `${parsed.pathname}${parsed.search}`,
      before_cursor: parsed.searchParams.get('before'),
      trigger_scroll: jumpLoadingLastUserScroll && userScrollAge <= 3000 ? {
        direction: jumpLoadingLastUserScroll.direction,
        distance_px: jumpLoadingLastUserScroll.distance_px,
        age_ms: Math.round(userScrollAge)
      } : null,
      start_state: jumpLoadingDiagnosticSnapshot()
    };
    logDiagnostic('debug', 'conversation-jump-loading-historical-request-start', {
      historical_sequence: trace.historical_sequence,
      network_sequence: trace.network_sequence,
      request_path: trace.request_path,
      before_cursor: trace.before_cursor,
      trigger_scroll: trace.trigger_scroll,
      state: trace.start_state
    });
    return trace;
  }

  /**
   * Completes one stock historical-page correlation and schedules delayed virtual-window snapshots.
   *
   * @param {Object|null} trace - Trace returned by `jumpLoadingHistoricalRequestStart`.
   * @param {Response|null} response - Stock response when the request completed normally.
   * @param {unknown} error - Fetch failure when the request rejected.
   * @returns {void} No value is returned.
   */
  function jumpLoadingHistoricalRequestComplete(trace, response = null, error = null) {
    if (!trace) return;
    const completedAt = performance.now();
    const responseState = jumpLoadingDiagnosticSnapshot();
    logDiagnostic(error ? 'warnings' : 'debug', 'conversation-jump-loading-historical-response', {
      historical_sequence: trace.historical_sequence,
      network_sequence: trace.network_sequence,
      request_path: trace.request_path,
      before_cursor: trace.before_cursor,
      duration_ms: Math.round(completedAt - trace.started_at),
      status: response?.status ?? null,
      ok: response?.ok ?? null,
      error: error ? boundedDiagnosticText(errorMessage(error), 1000) : null,
      state: responseState
    });
    for (const delayMs of JUMP_LOADING_POST_RESPONSE_DELAYS_MS) {
      setTimeout(() => {
        const state = jumpLoadingDiagnosticSnapshot();
        logDiagnostic('debug', 'conversation-jump-loading-historical-post-response', {
          historical_sequence: trace.historical_sequence,
          network_sequence: trace.network_sequence,
          delay_ms: delayMs,
          elapsed_ms: Math.round(performance.now() - completedAt),
          scroll_top_delta: state.scroll_top - responseState.scroll_top,
          scroll_height_delta: state.scroll_height - responseState.scroll_height,
          mounted_turn_count_delta: state.mounted_turn_count - responseState.mounted_turn_count,
          toc_count_delta: state.toc_count - responseState.toc_count,
          state
        });
      }, delayMs);
    }
  }

'''

marker = "  /**\n   * Handles install network capture.\n"
count = text.count(marker)
if count != 1:
  raise SystemExit(f'network-capture marker: expected exactly one match, found {count}')
text = text.replace(marker, block + marker, 1)

replace_once(
  "  function installNetworkCapture() {\n"
  "    if (captureInstalled) return;\n"
  "    // Use the page realm rather than the userscript sandbox when intercepting page networking.\n",
  "  function installNetworkCapture() {\n"
  "    if (captureInstalled) return;\n"
  "    installJumpLoadingDiagnostics();\n"
  "    // Use the page realm rather than the userscript sandbox when intercepting page networking.\n",
  'install diagnostics'
)

replace_once(
  "        const requestUrl = request?.url ?? String(input);\n"
  "        const stockTrace = stockNetworkTraceFetchStart(request, requestUrl);\n",
  "        const requestUrl = request?.url ?? String(input);\n"
  "        const stockTrace = stockNetworkTraceFetchStart(request, requestUrl);\n"
  "        const historicalLoadingTrace = jumpLoadingHistoricalRequestStart(requestUrl, stockTrace.sequence);\n",
  'historical request start'
)

replace_once(
  "        return responsePromise.then(response => {\n"
  "          stockNetworkTraceFetchResponse(response, stockTrace);\n",
  "        return responsePromise.then(response => {\n"
  "          stockNetworkTraceFetchResponse(response, stockTrace);\n"
  "          jumpLoadingHistoricalRequestComplete(historicalLoadingTrace, response);\n",
  'historical response complete'
)

replace_once(
  "        }, error => {\n"
  "          logDiagnostic('debug', 'stock-network-fetch-failed', {\n",
  "        }, error => {\n"
  "          jumpLoadingHistoricalRequestComplete(historicalLoadingTrace, null, error);\n"
  "          logDiagnostic('debug', 'stock-network-fetch-failed', {\n",
  'historical request failure'
)

path.write_text(text, encoding='utf-8')
