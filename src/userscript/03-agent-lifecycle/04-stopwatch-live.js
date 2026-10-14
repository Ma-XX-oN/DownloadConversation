    lines.push(`Total: ${agentStopwatchFormatDuration(totalMs)}`);
    const control = ensureAgentStopwatchControl();
    const background = agentStopwatchState.terminal_kind === 'success'
      ? 'darkgreen'
      : agentStopwatchState.terminal_kind === 'error'
        ? 'darkred'
        : 'rgba(32, 32, 32, 0.92)';
    if (control.style.background !== background) {
      control.style.background = background;
      if (typeof agentLifecycleAction === 'function') {
        agentLifecycleAction('stopwatch', 'background-applied', {
          background,
          terminal_kind: agentStopwatchState.terminal_kind ?? null
        });
      }
    }
    control.textContent = lines.join('\n');
    if (typeof agentFaviconRingObserveTime === 'function') agentFaviconRingObserveTime(nowMs);
    if (typeof agentSoundPositionInitializationIndicator === 'function') {
      agentSoundPositionInitializationIndicator();
    }
  }

  /**
   * Starts periodic live rendering for the active agent-turn stopwatch.
   *
   * @returns {void} No value is returned.
   */
  function agentStopwatchStartTimer() {
    if (agentStopwatchTimer !== null) return;
    agentStopwatchTimer = setInterval(
      () => agentStopwatchRender(performance.now()),
      AGENT_STOPWATCH_REFRESH_MS
    );
  }

  /**
   * Stops periodic stopwatch rendering while preserving the completed display.
   *
   * @returns {void} No value is returned.
   */
  function agentStopwatchStopTimer() {
    if (agentStopwatchTimer === null) return;
    clearInterval(agentStopwatchTimer);
    agentStopwatchTimer = null;
  }

  /**
   * Starts a fresh agent-turn stopwatch at one local user-submission boundary.
   *
   * @param {number} submittedAtMs - Monotonic timestamp captured before request transmission.
   * @returns {void} No value is returned.
   */
  function agentStopwatchStartNew(submittedAtMs) {
    assert(Number.isFinite(submittedAtMs), 'Agent stopwatch submission timestamp must be finite.');
    agentStopwatchStopTimer();
    agentStopwatchState = {
      active: true,
      terminal_kind: null,
      started_at_ms: submittedAtMs,
      lap_started_at_ms: submittedAtMs,
      laps_ms: [],
      total_ms: null,
      exchange_id: null,
      pending_submission_at_ms: null,
      pending_message_id: null,
      pending_capture: null,
      bound_capture: null
    };
    agentStopwatchRender(submittedAtMs);
    agentStopwatchStartTimer();
    if (typeof agentLifecycleAction === 'function') {
      agentLifecycleAction('stopwatch', 'started', { submitted_at_ms: submittedAtMs });
    }
  }

  /**
   * Freezes the current lap at an exact local user-submission or final-completion boundary.
   *
   * @param {number} boundaryMs - Monotonic boundary timestamp.
   * @returns {void} No value is returned.
   */
  function agentStopwatchRecordLap(boundaryMs) {
    assert(agentStopwatchState?.active, 'Cannot record a lap without an active agent stopwatch.');
    assert(Number.isFinite(boundaryMs) && boundaryMs >= agentStopwatchState.lap_started_at_ms,
      'Agent stopwatch lap boundary precedes the active lap.');
    agentStopwatchState.laps_ms.push(boundaryMs - agentStopwatchState.lap_started_at_ms);
    agentStopwatchState.lap_started_at_ms = boundaryMs;
  }

  /**
   * Registers one local ChatGPT generation submission before enriched stream metadata arrives.
   *
   * @param {Object} capture - Mutable streamed-turn capture for the submitted request.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveRequest(capture) {
    const submittedAtMs = capture?.stopwatch_submitted_at_ms;
    if (!Number.isFinite(submittedAtMs)) return;
    const userMessage = [...(capture?.request_messages ?? [])]
      .reverse()
      .find(message => message?.author?.role === 'user' && typeof message?.id === 'string');
    if (!agentStopwatchState?.active) agentStopwatchStartNew(submittedAtMs);
    agentStopwatchState.pending_submission_at_ms = submittedAtMs;
    agentStopwatchState.pending_message_id = userMessage?.id ?? null;
    agentStopwatchState.pending_capture = capture;
    agentStopwatchRender(performance.now());
  }

  /**
   * Records a User follow-up submitted through ChatGPT's same-turn steering endpoint.
   *
   * `/backend-api/f/steer_turn` is the submission boundary for a User follow-up while the
   * current working exchange remains active. Record the lap at the pre-transmission local
   * timestamp; later streamed User metadata must not create a second lap for this submission.
   *
   * @param {number} submittedAtMs - Monotonic timestamp captured before request transmission.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveSteerTurn(submittedAtMs) {
    if (!agentStopwatchState?.active || !Number.isFinite(submittedAtMs)) return;
    agentStopwatchRecordLap(submittedAtMs);
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchRender(performance.now());
  }

  /**
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
    const exchangeId = agentStopwatchExchangeId(message);
    if (agentStopwatchBindExchange(capture, exchangeId)) {
      agentStopwatchRender(performance.now());
    }
  }

  /**
   * Binds authoritative provider identity to the originating request capture.
   * The capture association prevents late metadata from an older stream from
   * replacing the currently active run's identity.
   *
   * @param {Object} capture - Capture associated with the provider response.
   * @param {string|null} exchangeId - Authoritative backend exchange identity.
   * @returns {boolean} Whether the identity belongs to the active run.
   */
  function agentStopwatchBindExchange(capture, exchangeId) {
    if (typeof exchangeId !== 'string' || !exchangeId || !agentStopwatchState?.active) return false;
    const state = agentStopwatchState;
    const pending = state.pending_capture === capture &&
      Number.isFinite(state.pending_submission_at_ms);
    if (!pending && state.bound_capture !== capture) return false;
    if (capture.stopwatch_exchange_id && capture.stopwatch_exchange_id !== exchangeId) {
      logDiagnostic('warnings', 'agent-stopwatch-exchange-identity-conflict', {
        previous_exchange_id: capture.stopwatch_exchange_id,
        received_exchange_id: exchangeId
      });
      return false;
    }
    if (state.exchange_id && state.exchange_id !== exchangeId) {
      if (!pending) return false;
      const submittedAtMs = state.pending_submission_at_ms;
      agentStopwatchStartNew(submittedAtMs);
    } else if (pending && state.exchange_id === exchangeId &&
               state.started_at_ms !== state.pending_submission_at_ms) {
      agentStopwatchRecordLap(state.pending_submission_at_ms);
    }
    capture.stopwatch_exchange_id = exchangeId;
    agentStopwatchState.exchange_id = exchangeId;
    agentStopwatchState.bound_capture = capture;
    agentStopwatchState.pending_capture = null;
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    return true;
  }

  /**
   * Extracts the exchange identity from the observed, request-owned resume
   * token. The token is transport metadata, not an authentication credential
   * for this userscript; this only decodes its JSON payload.
   *
   * @param {Object} event - Provider SSE event.
   * @returns {string|null} Exchange identity, when present.
   */
  function agentStopwatchResumeTokenExchange(event) {
    if (event?.type !== 'resume_conversation_token' ||
        typeof event.token !== 'string' || typeof atob !== 'function') return null;
    try {
      const payload = event.token.split('.')[1];
      if (!payload || payload.length > 8192) return null;
      const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      const topic = decoded?.turn_topic_id;
      if (typeof topic !== 'string' || !topic.startsWith('conversation-turn-')) return null;
      return topic.slice('conversation-turn-'.length) || null;
    } catch {
      return null;
    }
  }

  /**
   * Observes backend identity after the request-owned SSE capture was updated.
   *
   * @param {Object} capture - Source response capture.
   * @param {Object} event - Latest parsed backend event.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveProviderIdentity(capture, event) {
    if (!capture || !agentStopwatchState?.active) return;
    if (event?.type === 'resume_conversation_token' &&
        event.conversation_id && capture.conversation_id &&
        event.conversation_id !== capture.conversation_id) return;
    const tokenId = agentStopwatchResumeTokenExchange(event);
    const messageId = [...(capture.stream_messages ?? [])].reverse()
      .map(message => agentStopwatchExchangeId(message))
      .find(Boolean) ?? null;
    agentStopwatchBindExchange(capture, tokenId || messageId);
  }

  /**
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
