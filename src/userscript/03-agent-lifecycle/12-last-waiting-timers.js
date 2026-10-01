  /** Shared listeners for authoritative Agent timing transitions. */
  const agentTimingListeners = new Set();
  /** Monotonic timestamp of the newest Assistant message received from the stream. */
  let agentTimingLastNetworkAtMs = null;
  /** Monotonic timestamp at which the Agent finished and began waiting for the User. */
  let agentTimingWaitingSinceMs = null;

  /**
   * Returns the current authoritative timing state.
   *
   * @param {number} nowMs - Current monotonic timestamp.
   * @returns {Object} Timing timestamps and elapsed durations.
   */
  function agentTimingSnapshot(nowMs = performance.now()) {
    assert(Number.isFinite(nowMs), 'Agent timing snapshot timestamp must be finite.');
    const lastMs = Number.isFinite(agentTimingLastNetworkAtMs)
      ? Math.max(0, nowMs - agentTimingLastNetworkAtMs)
      : null;
    const waitingMs = Number.isFinite(agentTimingWaitingSinceMs)
      ? Math.max(0, nowMs - agentTimingWaitingSinceMs)
      : null;
    return Object.freeze({
      last_network_at_ms: agentTimingLastNetworkAtMs,
      waiting_since_ms: agentTimingWaitingSinceMs,
      last_ms: lastMs,
      waiting_ms: waitingMs
    });
  }

  /**
   * Subscribes one consumer to authoritative Agent timing transitions.
   *
   * @param {Function} listener - Listener receiving one frozen timing event.
   * @returns {Function} Unsubscribe function.
   */
  function agentTimingSubscribe(listener) {
    assert(typeof listener === 'function', 'Agent timing listener must be a function.');
    agentTimingListeners.add(listener);
    return () => agentTimingListeners.delete(listener);
  }

  /**
   * Publishes one authoritative timing transition to all shared consumers.
   *
   * @param {string} type - Timing transition name.
   * @param {number} atMs - Monotonic transition timestamp.
   * @param {Object} details - Additional transition metadata.
   * @returns {void} No value is returned.
   */
  function agentTimingPublish(type, atMs, details = {}) {
    assert(typeof type === 'string' && type, 'Agent timing event type is required.');
    assert(Number.isFinite(atMs), 'Agent timing event timestamp must be finite.');
    const event = Object.freeze({
      type,
      at_ms: atMs,
      ...details,
      ...agentTimingSnapshot(atMs)
    });
    for (const listener of [...agentTimingListeners]) listener(event);
  }

  /**
   * Records an Assistant message at the network stream-processing boundary.
   *
   * @param {Object|null} event - Parsed provider stream event.
   * @param {number} atMs - Monotonic timestamp captured synchronously from the stream.
   * @returns {void} No value is returned.
   */
  function agentTimingObserveNetworkEvent(event, atMs) {
    const message = event?.message;
    if (message?.author?.role !== 'assistant') return;
    assert(Number.isFinite(atMs), 'Agent network-message timestamp must be finite.');
    agentTimingLastNetworkAtMs = atMs;
    agentTimingPublish('last-network-message', atMs, {
      message_id: typeof message.id === 'string' ? message.id : null
    });
    agentStopwatchRender(atMs);
  }

  /**
   * Starts the post-completion waiting interval from the shared terminal hook.
   *
   * @param {Object|null} terminal - Shared normalized terminal event.
   * @param {number} atMs - Monotonic timestamp captured before terminal dispatch.
   * @returns {void} No value is returned.
   */
  function agentTimingObserveTerminal(terminal, atMs) {
    if (terminal?.kind !== 'success' || Number.isFinite(agentTimingWaitingSinceMs)) return;
    assert(Number.isFinite(atMs), 'Agent finished timestamp must be finite.');
    agentTimingWaitingSinceMs = atMs;
    agentTimingPublish('agent-finished', atMs, {
      exchange_id: terminal?.exchange_id ?? null,
      retained: false
    });
    agentStopwatchRender(atMs);
    agentStopwatchStartTimer();
  }

  /**
   * Clears the waiting interval at the next local User submission boundary.
   *
   * @param {number} atMs - Monotonic local submission timestamp.
   * @returns {void} No value is returned.
   */
  function agentTimingObserveSubmission(atMs) {
    if (!Number.isFinite(atMs)) return;
    const wasWaiting = Number.isFinite(agentTimingWaitingSinceMs);
    agentTimingWaitingSinceMs = null;
    if (wasWaiting) agentTimingPublish('user-submitted', atMs);
  }

  /**
   * Restores a completed waiting interval from the persisted final message timestamp.
   *
   * @param {Object} recovery - Stopwatch recovery candidate.
   * @param {number} wallNowMs - Current epoch timestamp in milliseconds.
   * @param {number} monotonicNowMs - Current monotonic timestamp.
   * @returns {void} No value is returned.
   */
  function agentTimingApplyRecovery(recovery, wallNowMs, monotonicNowMs) {
    if (!recovery?.final_message || agentStopwatchState?.active) return;
    const createTimeSeconds = Number(recovery.final_message.create_time);
    if (!Number.isFinite(createTimeSeconds)) return;
    const finalWallMs = createTimeSeconds * 1000;
    if (!Number.isFinite(wallNowMs) || !Number.isFinite(monotonicNowMs) ||
        finalWallMs > wallNowMs) return;
    agentTimingWaitingSinceMs = monotonicNowMs - (wallNowMs - finalWallMs);
    agentTimingPublish('agent-finished', agentTimingWaitingSinceMs, {
      exchange_id: recovery?.exchange_id ?? null,
      retained: true
    });
    agentStopwatchRender(monotonicNowMs);
    agentStopwatchStartTimer();
  }

  /** Existing stopwatch renderer, extended only with Last/Waiting presentation. */
  const agentTimingOriginalStopwatchRender = agentStopwatchRender;
  agentStopwatchRender = function agentTimingStopwatchRender(nowMs = performance.now()) {
    agentTimingOriginalStopwatchRender(nowMs);
    if (!agentStopwatchState) return;
    const control = ensureAgentStopwatchControl();
    const lines = String(control.textContent ?? '')
      .split('\n')
      .filter(line => !/^Last:|^Waiting:/.test(line));
    const totalIndex = lines.findIndex(line => line.startsWith('Total:'));
    if (totalIndex < 0) return;
    let insertAt = totalIndex;
    if (Number.isFinite(agentTimingLastNetworkAtMs)) {
      lines.splice(insertAt, 0,
        `Last: ${agentStopwatchFormatDuration(Math.max(0, nowMs - agentTimingLastNetworkAtMs))}`);
      insertAt += 1;
    }
    const currentTotalIndex = lines.findIndex(line => line.startsWith('Total:'));
    if (Number.isFinite(agentTimingWaitingSinceMs)) {
      lines.splice(currentTotalIndex + 1, 0,
        `Waiting: ${agentStopwatchFormatDuration(Math.max(0, nowMs - agentTimingWaitingSinceMs))}`);
    }
    control.textContent = lines.join('\n');
  };

  /** Existing stream hook, extended at the synchronous network-event boundary. */
  const agentTimingOriginalObserveStreamEvent = agentStopwatchObserveStreamEvent;
  agentStopwatchObserveStreamEvent = function agentTimingObserveStreamEvent(capture, event) {
    const receivedAtMs = performance.now();
    agentTimingObserveNetworkEvent(event, receivedAtMs);
    return agentTimingOriginalObserveStreamEvent(capture, event);
  };

  /** Existing terminal hook, extended without re-inferring state from the DOM. */
  const agentTimingOriginalTerminalObserve = agentTerminalObserve;
  agentTerminalObserve = function agentTimingTerminalObserve(capture, event = null) {
    const finishedAtMs = performance.now();
    const terminal = agentTerminalNormalize(capture, event);
    const result = agentTimingOriginalTerminalObserve(capture, event);
    agentTimingObserveTerminal(terminal, finishedAtMs);
    return result;
  };

  /** Existing generation submission hook, extended to reset Waiting. */
  const agentTimingOriginalObserveRequest = agentStopwatchObserveRequest;
  agentStopwatchObserveRequest = function agentTimingObserveRequest(capture) {
    agentTimingObserveSubmission(capture?.stopwatch_submitted_at_ms);
    return agentTimingOriginalObserveRequest(capture);
  };

  /** Existing same-turn steer submission hook, extended to reset Waiting. */
  const agentTimingOriginalObserveSteerTurn = agentStopwatchObserveSteerTurn;
  agentStopwatchObserveSteerTurn = function agentTimingObserveSteerTurn(submittedAtMs) {
    agentTimingObserveSubmission(submittedAtMs);
    return agentTimingOriginalObserveSteerTurn(submittedAtMs);
  };

  /** Existing reload recovery hook, extended with retained Waiting state. */
  const agentTimingOriginalApplyRecovery = agentStopwatchApplyRecovery;
  agentStopwatchApplyRecovery = function agentTimingStopwatchApplyRecovery(
    recovery,
    isStreaming,
    wallNowMs,
    monotonicNowMs
  ) {
    const result = agentTimingOriginalApplyRecovery(
      recovery,
      isStreaming,
      wallNowMs,
      monotonicNowMs
    );
    agentTimingApplyRecovery(recovery, wallNowMs, monotonicNowMs);
    return result;
  };
