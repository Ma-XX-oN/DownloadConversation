
  /** Current authoritative Agent lifecycle state, distinct from timing state. */
  let agentLifecycleState = 'unknown';
  /** Sequence allocated only when authoritative Agent state changes. */
  let agentLifecycleTransitionSequence = 0;
  /** Correlation identifier for the latest authoritative Agent transition. */
  let agentLifecycleTransitionId = null;

  /**
   * Records one authoritative Agent state transition, suppressing unchanged states.
   *
   * @param {string} nextState - Newly observed authoritative state.
   * @param {Object} details - Conversation and exchange correlation details.
   * @returns {number|null} Transition identifier, or null before first change.
   */
  function agentLifecycleTransition(nextState, details = {}) {
    if (agentLifecycleState === nextState) return agentLifecycleTransitionId;
    const previousState = agentLifecycleState;
    agentLifecycleState = nextState;
    agentLifecycleTransitionId = ++agentLifecycleTransitionSequence;
    logDiagnostic('lifecycle', 'agent-lifecycle-state-changed', {
      transition_id: agentLifecycleTransitionId,
      previous_state: previousState,
      state: nextState,
      ...details
    });
    return agentLifecycleTransitionId;
  }

  /**
   * Records one actual consumer action for its initiating transition.
   *
   * @param {string} component - Consumer name.
   * @param {string} action - Attempt or completed action outcome.
   * @param {Object} details - Associated action metadata.
   * @param {number|null} transitionId - Initiating transition identifier.
   * @returns {void} No value is returned.
   */
  function agentLifecycleAction(component, action, details = {}, transitionId = agentLifecycleTransitionId) {
    logDiagnostic('lifecycle', 'agent-lifecycle-action', {
      transition_id: transitionId,
      component,
      action,
      ...details
    });
  }

  /** Shared listeners for authoritative Agent timing transitions. */
  const agentTimingListeners = new Set();
  /** The sole accepted activity datum is a public AICC V1 retained snapshot. */
  let agentTimingActivityState = null;
  /** Registry and instance owning the current AICC observer subscription. */
  let agentTimingActivityRegistry = null;
  /** Registered Core agent instance whose retained activity is observed. */
  let agentTimingActivityAgent = null;
  /** Independent idempotent unsubscribe from the current AICC subscription. */
  let agentTimingActivityUnsubscribe = null;
  /** Generation invalidates callbacks queued before replacement or teardown. */
  let agentTimingActivityGeneration = 0;
  /** Injectable epoch millisecond display clock; never used to stamp ingress. */
  let agentTimingEpochNow = Date.now;
  /** Monotonic timestamp at which the Agent finished and began waiting for the User. */
  let agentTimingWaitingSinceMs = null;

  /**
   * Projects the Core-retained timestamp into an elapsed display duration.
   * A null snapshot or null timestamp is unknown, not an age of zero.
   *
   * @param {number} epochNowMs - Injected Unix epoch millisecond display time.
   * @returns {number|null} Nonnegative Last age, or null while unknown.
   */
  function agentTimingLastAge(epochNowMs) {
    const stamp = agentTimingActivityState?.latestIncomingAtMs;
    return Number.isSafeInteger(stamp)
      ? Math.max(0, epochNowMs - stamp)
      : null;
  }

  /**
   * Returns view-only timing durations; Total/Waiting retain monotonic time.
   *
   * @param {number} nowMs - Current monotonic stopwatch timestamp.
   * @returns {Object} Frozen, non-transport timing projection.
   */
  function agentTimingSnapshot(nowMs = performance.now()) {
    assert(Number.isFinite(nowMs), 'Agent timing snapshot timestamp must be finite.');
    const waitingMs = Number.isFinite(agentTimingWaitingSinceMs)
      ? Math.max(0, nowMs - agentTimingWaitingSinceMs)
      : null;
    return Object.freeze({
      latest_incoming_at_ms: agentTimingActivityState?.latestIncomingAtMs ?? null,
      waiting_since_ms: agentTimingWaitingSinceMs,
      last_ms: agentTimingLastAge(agentTimingEpochNow()),
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
   * Checks the versioned public Core snapshot, never a provider transport.
   *
   * @param {Object} snapshot - Frozen AICC V1 activity snapshot.
   * @returns {void} Throws on an incompatible public contract.
   */
  function agentTimingValidateActivitySnapshot(snapshot) {
    assert(snapshot && Object.isFrozen(snapshot),
      'AICC V1 activity snapshot must be a frozen object.');
    assert(snapshot.apiVersion === 1 && snapshot.clockDomain === 'unix-epoch-ms',
      'AICC activity observer contract version/domain mismatch.');
    const value = snapshot.latestIncomingAtMs;
    assert(value === null || (Number.isSafeInteger(value) && value >= 0),
      'AICC retained activity timestamp must be null or nonnegative epoch milliseconds.');
  }

  /**
   * Accepts only a newer retained AICC snapshot for this exact binding.
   *
   * @param {Object} snapshot - Public AICC V1 snapshot, not network data.
   * @param {number} generation - Generation active when subscribed.
   * @returns {boolean} Whether display state advanced.
   */
  function agentTimingObserveActivitySnapshot(snapshot, generation) {
    if (generation !== agentTimingActivityGeneration) return false;
    agentTimingValidateActivitySnapshot(snapshot);
    const current = agentTimingActivityState?.latestIncomingAtMs ?? null;
    const next = snapshot.latestIncomingAtMs;
    if (current !== null && (next === null || next <= current)) return false;
    if (current === null && next === null && agentTimingActivityState) return false;
    agentTimingActivityState = snapshot;
    const atMs = performance.now();
    agentTimingPublish('last-activity-snapshot', atMs);
    agentStopwatchRender(atMs);
    if (next !== null) agentStopwatchStartTimer();
    return true;
  }

  /**
   * Disposes the old subscription, invalidating even queued stale callbacks.
   *
   * @returns {void} Unbound Last becomes explicitly unknown.
   */
  function agentTimingUnbindActivityObserver() {
    const previouslyBound = agentTimingActivityRegistry !== null;
    agentTimingActivityGeneration += 1;
    const unsubscribe = agentTimingActivityUnsubscribe;
    agentTimingActivityRegistry = null;
    agentTimingActivityAgent = null;
    agentTimingActivityUnsubscribe = null;
    agentTimingActivityState = null;
    agentTimingEpochNow = Date.now;
    if (typeof unsubscribe === 'function') unsubscribe();
    if (previouslyBound) {
      const atMs = performance.now();
      agentTimingPublish('last-activity-unbound', atMs);
      agentStopwatchRender(atMs);
      if (!agentStopwatchState?.active && !Number.isFinite(agentTimingWaitingSinceMs)) {
        agentTimingOriginalStopwatchStopTimer();
      }
    }
  }

  /**
   * Binds an interchangeable Core registry/agent observer to pure Last view.
   * No network, JSON, PI lifecycle observer or Core publication is accessed.
   *
   * @param {Object} registry - Public AICC activityState/observeActivity owner.
   * @param {Object} agent - Registered agent instance belonging to registry.
   * @param {Object} [options={}] - Injectable display-only clock.
   * @param {Function} [options.now=Date.now] - Epoch millisecond clock.
   * @returns {boolean} True if a live observer binding was installed.
   */
  function agentTimingBindActivityObserver(registry, agent, { now = Date.now } = {}) {
    assert(registry && typeof registry.activityState === 'function' &&
      typeof registry.observeActivity === 'function',
      'AICC activity registry V1 methods are required.');
    assert(agent && typeof agent === 'object', 'AICC agent instance is required.');
    assert(typeof now === 'function', 'Last display clock must be a function.');
    if (registry === agentTimingActivityRegistry && agent === agentTimingActivityAgent) {
      return false;
    }
    const initial = registry.activityState(agent);
    if (initial !== null) agentTimingValidateActivitySnapshot(initial);
    agentTimingUnbindActivityObserver();
    if (initial === null) return false;
    agentTimingActivityRegistry = registry;
    agentTimingActivityAgent = agent;
    agentTimingEpochNow = now;
    const generation = agentTimingActivityGeneration;
    try {
      const unsubscribe = registry.observeActivity(agent, snapshot => {
        agentTimingObserveActivitySnapshot(snapshot, generation);
      });
      assert(typeof unsubscribe === 'function',
        'AICC observeActivity must return an unsubscribe function.');
      agentTimingActivityUnsubscribe = unsubscribe;
      return true;
    } catch (error) {
      agentTimingUnbindActivityObserver();
      throw error;
    }
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
    const lastMs = agentTimingLastAge(agentTimingEpochNow());
    lines.splice(totalIndex, 0, lastMs === null
      ? 'Last: —'
      : 'Last: ' + agentStopwatchFormatDuration(lastMs));
    const currentTotalIndex = lines.findIndex(line => line.startsWith('Total:'));
    if (Number.isFinite(agentTimingWaitingSinceMs)) {
      lines.splice(currentTotalIndex + 1, 0,
        `Waiting: ${agentStopwatchFormatDuration(Math.max(0, nowMs - agentTimingWaitingSinceMs))}`);
    }
    control.textContent = lines.join('\n');
  };

  /** Original stopwatch stop operation; Last reuses, never duplicates, its timer. */
  const agentTimingOriginalStopwatchStopTimer = agentStopwatchStopTimer;
  /**
   * Keeps the existing stopwatch repaint cadence alive for known Last data.
   *
   * @returns {void} Total retains its frozen completion semantics.
   */
  agentStopwatchStopTimer = function agentTimingStopTimer() {
    agentTimingOriginalStopwatchStopTimer();
    if (agentTimingActivityRegistry !== null &&
        agentTimingActivityState?.latestIncomingAtMs !== null) {
      agentStopwatchStartTimer();
    }
  };

  /** Existing terminal hook, extended without re-inferring state from the DOM. */
  const agentTimingOriginalTerminalObserve = agentTerminalObserve;
  agentTerminalObserve = function agentTimingTerminalObserve(capture, event = null) {
    const terminal = agentTimingOriginalTerminalObserve(capture, event);
    if (terminal?.kind === 'success') {
      agentTimingObserveTerminal(terminal, terminal.completed_at_ms);
    }
    return terminal;
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
