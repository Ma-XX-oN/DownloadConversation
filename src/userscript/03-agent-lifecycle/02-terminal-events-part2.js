

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
        conversation_id: capture?.conversation_id ?? null
      });
      agentTerminalObserve(capture, event);
    } catch (error) {
      logDiagnostic('debug', 'agent-terminal-stats-request-parse-failed', {
        error: boundedDiagnosticText(errorMessage(error), 1000)
      });
    }
  }

  /**
   * Classifies one structured agent terminal observation without deriving consumer-specific state.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} event - Most recently parsed structured SSE/v1 event, when any.
   * @returns {string|null} `success`, `error`, or null when the turn is not terminal.
   */
  function agentTerminalClassifyKind(capture, event) {
    const structured = [];
    if (event && typeof event === 'object' && !Array.isArray(event)) structured.push(event);
    if (event?.v && typeof event.v === 'object' && !Array.isArray(event.v)) structured.push(event.v);
    for (const candidate of structured) {
      if (agentTerminalIsPollingTimeout(candidate)) return 'error';
      const providerCode = candidate.error_code ?? candidate.code ?? candidate?.error?.code ?? null;
      if (providerCode === 'conversation_too_large' &&
          (candidate.type === 'error' || candidate.error_code === 'conversation_too_large')) return 'error';
      if (candidate.result === 'error' &&
          candidate?.error?.reason === 'request_failed' &&
          Number(candidate?.error?.status_code) >= 400) {
        return 'error';
      }
      if (agentTerminalIsConversationTurnComplete(capture, candidate)) return 'success';
    }
    return agentTerminalSuccessfulFinal(capture) ? 'success' : null;
  }



