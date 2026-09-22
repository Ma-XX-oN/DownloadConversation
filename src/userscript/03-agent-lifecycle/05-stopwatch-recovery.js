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
        /^\/backend-api\/conversations\/[^/]+$/.test(parsed.pathname);
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
    agentFaviconObserveStreamStatus(streamStatus);
    if (agentStopwatchState) return;
    agentStopwatchApplyRecovery(
      recovery,
      agentStopwatchStreamIsActive(streamStatus),
      Date.now(),
      performance.now()
    );
  }

  /**
   * Returns the exact structured successful final Assistant message for one capture.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @returns {Object|null} Successful final Assistant message, or null when not terminal-success.
   */
  function agentTerminalSuccessfulFinal(capture) {
    return [...(capture?.stream_messages ?? [])].reverse().find(message =>
      message?.author?.role === 'assistant' &&
      message?.channel === 'final' &&
      message?.status === 'finished_successfully' &&
      message?.end_turn === true
    ) ?? null;
  }

  /**
   * Derives the shared structured exchange identity for one terminal observation.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} finalMessage - Structured successful final Assistant message, when available.
   * @returns {string|null} Turn exchange identity shared by all terminal consumers, or null.
   */
  function agentTerminalExchangeId(capture, finalMessage = null) {
    const finalMetadata = finalMessage?.metadata ?? {};
    const streamedMessage = [...(capture?.stream_messages ?? [])]
      .reverse()
      .find(message => {
        const metadata = message?.metadata ?? {};
        return metadata.turn_exchange_id || metadata.working_turn_id;
      });
    const streamedMetadata = streamedMessage?.metadata ?? {};
    const request = [...(capture?.request_messages ?? [])]
      .reverse()
      .find(message => typeof message?.id === 'string' && message.id);
    const requestMetadata = request?.metadata ?? {};
    return finalMetadata.turn_exchange_id || finalMetadata.working_turn_id ||
      streamedMetadata.turn_exchange_id || streamedMetadata.working_turn_id ||
      capture?.stopwatch_exchange_id || requestMetadata.turn_exchange_id ||
      requestMetadata.working_turn_id || null;
  }

  /**
   * Normalizes one structured terminal observation exactly once before fan-out to consumers.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} event - Most recently parsed structured SSE/v1 event, when any.
   * @returns {Object|null} Shared immutable terminal event, or null when not terminal.
   */
  function agentTerminalNormalize(capture, event = null) {
    const kind = agentTerminalClassifyKind(capture, event);
    if (!kind) return null;
    const finalMessage = agentTerminalSuccessfulFinal(capture);
    const exchangeId = agentTerminalExchangeId(capture, finalMessage);
    return Object.freeze({
      kind,
      conversation_id: capture?.conversation_id ?? null,
      exchange_id: exchangeId,
      terminal_key: agentTerminalKey(capture, exchangeId, finalMessage),
      completed_at_ms: performance.now()
    });
  }

  /**
   * Handles one already-normalized terminal event for the active stopwatch only.
   *
   * @param {Object} terminal - Shared normalized terminal event.
   * @returns {void} No value is returned.
   */
  function agentStopwatchHandleTerminal(terminal) {
    if (!agentStopwatchState?.active) return;
    const exchangeId = terminal?.exchange_id ?? null;
    if (!exchangeId || exchangeId !== agentStopwatchState.exchange_id) return;
    const completedAtMs = terminal.completed_at_ms;
    if (!Number.isFinite(completedAtMs)) return;
    agentStopwatchRecordLap(completedAtMs);
    agentStopwatchState.active = false;
    agentStopwatchState.total_ms = completedAtMs - agentStopwatchState.started_at_ms;
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchStopTimer();
    agentStopwatchRender(completedAtMs);
  }

  /** Ordered consumers of one shared normalized terminal event. */
  const agentTerminalHandlers = Object.freeze([
    agentSoundHandleTerminal,
    agentStopwatchHandleTerminal,
    agentFaviconHandleTerminal
  ]);

  /**
   * Normalizes one structured terminal observation once and fans it out to all terminal consumers.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} event - Most recently parsed structured SSE/v1 event, when any.
   * @returns {void} No value is returned.
   */
  function agentTerminalObserve(capture, event = null) {
    const terminal = agentTerminalNormalize(capture, event);
    if (!terminal) return;
    if (terminal.kind === 'success') capture.agent_terminal_success_observed = true;
    if (terminal.kind === 'error') capture.agent_terminal_error_observed = true;
    logDiagnostic('debug', 'agent-terminal-normalized', {
      kind: terminal.kind,
      conversation_id: terminal.conversation_id,
      exchange_id: terminal.exchange_id,
      terminal_key: terminal.terminal_key
    });
    for (const handler of agentTerminalHandlers) handler(terminal);
  }

  /**
   * Observes structured stream events that affect stopwatch submission/lap state before terminal fan-out.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object} event - Parsed provider stream event.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveStreamEvent(capture, event) {
    if (event && event.type === 'input_message' && event.input_message?.author?.role === 'user') {
      agentStopwatchObserveInputMessage(capture, event.input_message);
    }
  }

  // BEGIN Issue #123 streamed-tail recovery
  /**
   * Tests whether a URL is the stock streaming conversation-generation endpoint.
   *
   * @param {string} url - Candidate request URL.