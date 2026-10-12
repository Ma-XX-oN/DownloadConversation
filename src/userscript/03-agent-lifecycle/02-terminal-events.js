   * Retains one terminal sound-event identity in a bounded insertion-ordered set.
   *
   * @param {string} key - Stable terminal sound-event key.
   * @returns {void} No value is returned.
   */
  function agentSoundRememberTerminalKey(key) {
    if (!key || agentSoundTerminalKeys.has(key)) return;
    while (agentSoundTerminalKeys.size >= AGENT_SOUND_TERMINAL_KEY_LIMIT) {
      const oldest = agentSoundTerminalKeys.values().next().value;
      if (oldest === undefined) break;
      agentSoundTerminalKeys.delete(oldest);
    }
    agentSoundTerminalKeys.add(key);
  }

  /** Unresolved page-lifetime captures eligible for conversation-only provider completion correlation. */
  const agentTerminalLifecycleCaptures = [];

  /**
   * Registers one generation/resume capture for shared terminal-lifecycle correlation.
   *
   * Resolved captures are discarded when the next capture is registered. More than one unresolved
   * same-conversation capture is retained deliberately so the conversation-only provider completion
   * observer can detect ambiguity and fail closed instead of terminating a newer exchange.
   *
   * @param {Object} capture - Mutable generation or resume capture.
   * @returns {boolean} True when the capture is registered or was already registered.
   */
  function agentTerminalRegisterLifecycleCapture(capture) {
    if (!capture || typeof capture !== 'object') return false;
    if (agentTerminalLifecycleCaptures.includes(capture)) return true;
    for (let index = agentTerminalLifecycleCaptures.length - 1; index >= 0; index -= 1) {
      const existing = agentTerminalLifecycleCaptures[index];
      if (existing?.agent_terminal_success_observed === true ||
          existing?.agent_terminal_error_observed === true) {
        agentTerminalLifecycleCaptures.splice(index, 1);
      }
    }
    if (agentTerminalLifecycleCaptures.length >= 16) {
      logDiagnostic('warnings', 'agent-terminal-lifecycle-capture-overflow', {
        unresolved_capture_count: agentTerminalLifecycleCaptures.length,
        conversation_id: capture?.conversation_id ?? null
      });
      return false;
    }
    agentTerminalLifecycleCaptures.push(capture);
    return true;
  }

  /**
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
   * Returns the newest structured Assistant record that the provider marked finished successfully.
   *
   * This is not terminal by itself. It is only corroborating success evidence when the provider
   * separately emits the exact `conversation-turn-complete` lifecycle notification.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @returns {Object|null} Finished Assistant record, or null when none has been observed.
   */
  function agentTerminalHasFinishedAssistant(capture) {
    return [...(capture?.stream_messages ?? [])].reverse().find(message =>
      message?.author?.role === 'assistant' &&
      message?.status === 'finished_successfully'
    ) ?? null;
  }

  /**
   * Tests the normalized provider completion event against one lifecycle capture.
   *
   * @param {Object} capture - Candidate shared Agent lifecycle capture.
   * @param {Object|null} event - Normalized provider lifecycle event.
   * @returns {boolean} True only for corroborated successful provider turn completion.
   */
  function agentTerminalIsConversationTurnComplete(capture, event) {
    return event?.type === 'provider_conversation_turn_complete' &&
      typeof event?.conversation_id === 'string' &&
      event.conversation_id === capture?.conversation_id &&
      (Boolean(agentTerminalHasFinishedAssistant(capture)) || event.stream_status === 'COMPLETE');
  }

  /**
   * Routes one exact global ChatGPT `conversation-turn-complete` WebSocket frame into the shared
   * Agent terminal watcher only when conversation identity selects one unambiguous unresolved capture.
   *
   * The observed provider frame carries no exchange id. If two unresolved exchanges for the same
   * conversation are present, correlation is information-theoretically ambiguous and therefore no
   * terminal is inferred. This prevents a delayed older completion from terminating a newer exchange.
   *
   * @param {Object} frame - Parsed page WebSocket frame.
   * @returns {boolean} True when an exact unambiguous provider completion was dispatched.
   */
  function agentTerminalObserveConversationTurnCompleteFrame(frame) {
    if (frame?.type !== 'message' || frame?.topic_id !== 'conversations' ||
        frame?.payload?.type !== 'conversation-turn-complete') return false;
    const conversationId = frame?.payload?.payload?.conversation_id;
    if (typeof conversationId !== 'string' || !conversationId) return false;
    const unresolved = agentTerminalLifecycleCaptures.filter(capture =>
      capture?.conversation_id === conversationId &&
      capture?.agent_terminal_success_observed !== true &&
      capture?.agent_terminal_error_observed !== true
    );
    if (unresolved.length !== 1) {
      logDiagnostic('debug', 'agent-terminal-conversation-turn-complete-ignored', {
        conversation_id: conversationId,
        unresolved_capture_count: unresolved.length,
        reason: unresolved.length === 0
          ? 'no-unresolved-lifecycle-capture'
          : 'ambiguous-unresolved-lifecycle-captures'
      });
      return false;
    }
    const capture = unresolved[0];
    const finishedAssistant = agentTerminalHasFinishedAssistant(capture);
    if (!finishedAssistant) {
      // A resumed/recovered turn can complete without its final Assistant record
      // ever reaching this capture. Require both the exact provider completion
      // notification and a fresh, authoritative COMPLETE stream status.
      if (capture.agent_terminal_completion_check_pending === true) return false;
      capture.agent_terminal_completion_check_pending = true;
      void agentStopwatchFetchStreamStatus(conversationId).then(streamStatus => {
        if (streamStatus?.status !== 'COMPLETE' ||
            capture.agent_terminal_success_observed === true ||
            capture.agent_terminal_error_observed === true) {
          logDiagnostic('debug', 'agent-terminal-conversation-turn-complete-ignored', {
            conversation_id: conversationId,
            reason: 'no-finished-assistant-evidence',
            stream_status: streamStatus?.status ?? null
          });
          return;
        }
        // Do not complete an older turn if another unresolved capture appeared
        // while the asynchronous provider status check was in flight.
        const unresolvedNow = agentTerminalLifecycleCaptures.filter(candidate =>
          candidate?.conversation_id === conversationId &&
          candidate?.agent_terminal_success_observed !== true &&
          candidate?.agent_terminal_error_observed !== true
        );
        if (unresolvedNow.length !== 1 || unresolvedNow[0] !== capture) return;
        logDiagnostic('debug', 'agent-terminal-conversation-turn-complete-verified', {
          conversation_id: conversationId,
          evidence: 'provider-websocket-and-stream-status'
        });
        agentTerminalObserve(capture, {
          type: 'provider_conversation_turn_complete',
          conversation_id: conversationId,
          stream_status: 'COMPLETE'
        });
      }).catch(error => {
        logDiagnostic('warnings', 'agent-terminal-completion-status-check-failed', {
          conversation_id: conversationId,
          message: boundedDiagnosticText(errorMessage(error), 1000)
        });
      }).finally(() => {
        capture.agent_terminal_completion_check_pending = false;
      });
      return false;
    }
    logDiagnostic('debug', 'agent-terminal-conversation-turn-complete-observed', {
      conversation_id: conversationId,
      assistant_message_id: finishedAssistant.id ?? null,
      assistant_channel: finishedAssistant.channel ?? null,
      assistant_end_turn: finishedAssistant.end_turn === true
    });
    agentTerminalObserve(capture, {
      type: 'provider_conversation_turn_complete',
      conversation_id: conversationId
    });
    return true;
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