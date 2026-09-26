  // BEGIN Issue #163 WorkStack continuation UI/transaction
  /** Root observer that remounts/refreshes the WorkStack control across ChatGPT SPA reconciliation. */
  let workStackRootObserver = null;
  /** Resize observer keeping the WorkStack control immediately below the independent stopwatch UI. */
  let workStackStopwatchResizeObserver = null;
  /** Stopwatch element currently observed for WorkStack positioning. */
  let workStackObservedStopwatch = null;

  /**
   * Captures frozen mounted Assistant DOM candidates with the same identities used by live-tail tracking.
   *
   * Duplicate/remounted physical copies of one exact logical identity collapse to the copy
   * with the greatest visible content length.
   *
   * @returns {Array<Object>} Candidate descriptors in mounted conversation order with cloned source sections.
   */
  function workStackMountedAssistantCandidates() {
    const orderedKeys = [];
    const byKey = new Map();
    for (const section of [...document.querySelectorAll('section[data-turn-id]')]) {
      const marker = liveTailSectionMarker(section);
      if (!marker || marker.role !== 'assistant') continue;
      const key = marker.message_id ? `message:${marker.message_id}` :
        (marker.dom_turn_id ? `turn:${marker.dom_turn_id}` : `container:${marker.container_id ?? ''}`);
      if (!byKey.has(key)) orderedKeys.push(key);
      const existing = byKey.get(key) ?? null;
      if (!existing || Number(marker.content_length) >= Number(existing.content_length)) {
        byKey.set(key, { ...marker, section: section.cloneNode(true) });
      }
    }
    return orderedKeys.map(key => byKey.get(key)).filter(Boolean);
  }

  /**
   * Waits briefly for an active Agent turn to settle while continuing to refresh tail evidence.
   *
   * @returns {Promise<void>} Resolves once the stopwatch is inactive; throws after the bounded wait.
   */
  async function workStackAwaitTailSettled() {
    const startedAt = performance.now();
    while (agentStopwatchState?.active && performance.now() - startedAt < WORKSTACK_SETTLE_WAIT_MS) {
      scanLiveTailMarkers('workstack-await-settle');
      await new Promise(resolve => setTimeout(resolve, AGENT_STOPWATCH_REFRESH_MS));
    }
    if (agentStopwatchState?.active) {
      throw new Error('The current Assistant turn is still active; wait for it to finish and retry CONTINUE.');
    }
    scanLiveTailMarkers('workstack-continue-freeze');
  }

  /**
   * Ensures stopwatch geometry changes can reposition the independent WorkStack control.
   *
   * @param {HTMLElement} control - Mounted WorkStack control to reposition.
   * @returns {void} No value is returned.
   */
  function workStackObserveStopwatch(control) {
    if (typeof ResizeObserver !== 'function') return;
    const stopwatch = document.getElementById(AGENT_STOPWATCH_ID);
    if (stopwatch === workStackObservedStopwatch) return;
    workStackStopwatchResizeObserver?.disconnect();
    workStackObservedStopwatch = stopwatch instanceof HTMLElement ? stopwatch : null;
    if (!workStackObservedStopwatch) return;
    workStackStopwatchResizeObserver = new ResizeObserver(() => workStackPositionControl(control));
    workStackStopwatchResizeObserver.observe(workStackObservedStopwatch);
  }

  /**
   * Positions the WorkStack control immediately below the stopwatch without coupling their lifecycle state.
   *
   * @param {HTMLElement} control - WorkStack control element to position.
   * @returns {void} No value is returned.
   */
  function workStackPositionControl(control) {
    const stopwatch = document.getElementById(AGENT_STOPWATCH_ID);
    const rect = stopwatch?.getBoundingClientRect?.() ?? null;
    control.style.top = `${Math.round(rect?.bottom ?? 108) + 8}px`;
    control.style.right = '16px';
  }

  /**
   * Creates the compact WorkStack lane/control UI once and returns the mounted element.
   *
   * @returns {HTMLElement|null} Mounted WorkStack control, or null before BODY exists.
   */
  function ensureWorkStackControl() {
    if (!document.body) return null;
    const existing = document.getElementById(WORKSTACK_CONTROL_ID);
    if (existing instanceof HTMLElement) {
      workStackObserveStopwatch(existing);
      workStackPositionControl(existing);
      return existing;
    }
    const control = document.createElement('div');
    control.id = WORKSTACK_CONTROL_ID;
    control.style.position = 'fixed';
    control.style.zIndex = '2147483646';
    control.style.display = 'flex';
    control.style.alignItems = 'center';
    control.style.gap = '8px';
    control.style.padding = '6px 8px';
    control.style.border = '1px solid rgba(255,255,255,.28)';
    control.style.borderRadius = '9px';
    control.style.background = 'rgba(24,24,24,.96)';
    control.style.color = '#fff';
    control.style.font = '12px/1.25 system-ui, sans-serif';
    control.style.boxShadow = '0 2px 8px rgba(0,0,0,.35)';
    control.style.pointerEvents = 'auto';
    control.dataset.state = workStackState.status;
    control.setAttribute('aria-label', 'WorkStack continuation');

    const label = document.createElement('span');
    label.dataset.role = 'workstack-lane';
    label.textContent = workStackState.status === 'unbound'
      ? 'WS: UNBOUND'
      : (workStackState.status === 'bound' ? `WS: ${workStackState.lane}` : 'WS: FETCHING...');
    control.append(label);

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.role = 'workstack-continue';
    button.textContent = 'CONTINUE';
    button.disabled = workStackState.status !== 'bound' || workStackState.handoff_in_progress;
    button.style.padding = '4px 7px';
    button.style.borderRadius = '6px';
    button.style.border = '1px solid rgba(255,255,255,.35)';
    button.style.background = 'transparent';
    button.style.color = 'inherit';
    button.style.cursor = 'pointer';
    button.addEventListener('click', () => void handleWorkStackContinue());
    control.append(button);

    const detail = document.createElement('span');
    detail.dataset.role = 'workstack-detail';
    detail.style.display = 'none';
    control.append(detail);

    document.body.append(control);
    workStackObserveStopwatch(control);
    workStackPositionControl(control);
    return control;
  }

  /**
   * Renders current authoritative WorkStack lane/handoff state without changing stopwatch state.
   *
   * @returns {void} No value is returned.
   */
  function workStackRender() {
    const control = ensureWorkStackControl();
    if (!control) return;
    control.style.display = workStackState.conversation_id ? 'flex' : 'none';
    control.dataset.state = workStackState.status;
    const label = control.querySelector('[data-role="workstack-lane"]');
    const button = control.querySelector('[data-role="workstack-continue"]');
    const detail = control.querySelector('[data-role="workstack-detail"]');
    const nextLabel = workStackState.status === 'bound'
      ? `WS: ${workStackState.lane}`
      : (workStackState.status === 'unbound' ? 'WS: UNBOUND' : 'WS: FETCHING...');
    if (label && label.textContent !== nextLabel) label.textContent = nextLabel;
    if (button) button.disabled = workStackState.status !== 'bound' || workStackState.handoff_in_progress;
    if (detail) {
      const nextDetail = workStackState.handoff_in_progress ? 'working…' : workStackState.detail;
      if (detail.textContent !== nextDetail) detail.textContent = nextDetail;
      detail.style.display = nextDetail ? 'inline' : 'none';
    }
    workStackObserveStopwatch(control);
    workStackPositionControl(control);
  }

  /**
   * Installs the SPA-safe WorkStack control and lane recovery observer exactly once.
   *
   * @returns {void} No value is returned.
   */
  function installWorkStackContinuation() {
    if (workStackRootObserver) return;
    workStackObserveConversation(currentConversationId());
    workStackRender();
    void recoverWorkStackLane();
    workStackRootObserver = new MutationObserver(() => {
      const conversationId = currentConversationId();
      workStackObserveConversation(conversationId);
      workStackRender();
      if (conversationId && workStackState.status === 'fetching') void recoverWorkStackLane();
    });
    workStackRootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  /**
   * Performs one atomic WorkStack continuation handoff from the already-bound lane state.
   *
   * @returns {Promise<void>} Resolves after clipboard/export preparation and reserved-window navigation complete.
   */
  async function handleWorkStackContinue() {
    if (workStackState.status !== 'bound' || !workStackState.lane || workStackState.handoff_in_progress) return;
    const lane = workStackState.lane;
    const projectUrl = workStackProjectNewChatUrl(location.href);
    if (!projectUrl) {
      workStackState.detail = 'Current chat is not in a recognized ChatGPT Project.';
      workStackRender();
      return;
    }
    if (exportInProgress || testInProgress || jumpInProgress) {
      workStackState.detail = 'DownloadConversation is busy; retry CONTINUE after the current operation finishes.';
      workStackRender();
      return;
    }

    const githubWindow = window.open('about:blank', '_blank');
    const projectWindow = window.open('about:blank', '_blank');
    if (!githubWindow || !projectWindow) {
      try { githubWindow?.close(); } catch {}
      try { projectWindow?.close(); } catch {}
      workStackState.detail = 'Popup blocked; allow popups and retry CONTINUE.';
      workStackRender();
      return;
    }

    workStackState.handoff_in_progress = true;
    workStackState.detail = '';
    workStackRender();
    try {
      await workStackAwaitTailSettled();
      const conversationId = currentConversationId();
      if (!conversationId || workStackState.conversation_id !== conversationId) {
        throw new Error('Conversation changed during WorkStack handoff.');
      }

      const frozenMarkers = snapshotLiveTailMarkers().slice(-LIVE_TAIL_MARKER_LIMIT);
      const frozenCandidates = workStackMountedAssistantCandidates();
      const fetched = await fetchConversationPages(conversationId);
      const historySpine = conversationSpineFromPages(fetched.pages);
      const currentStreamCapture = streamTailCapture?.conversation_id === conversationId
        ? streamTailCapture
        : streamTailRestoreCapture(conversationId);
      const reconciled = mergeStreamTailCaptureIntoSpine(
        historySpine, streamTailCaptureSnapshot(currentStreamCapture)
      ).spine;
      const recoveryMarkers = workStackRecoveryAssistantMarkers(frozenMarkers, reconciled);
      if (!recoveryMarkers.length) {
        throw new Error('No usable recent Assistant DOM turn is available for continuation.');
      }
      const correlated = workStackCorrelateTailCandidates(recoveryMarkers, frozenCandidates);
      const recovered = correlated.map(candidate => extractTurn(candidate.section));
      const packet = workStackContinuationPacket(lane, recovered);
      await navigator.clipboard.writeText(packet);

      if (exportInProgress || testInProgress || jumpInProgress) {
        throw new Error('DownloadConversation became busy before the required Markdown export could start.');
      }
      const previousShowTimestamps = showTimestamps;
      const exportOptions = { forceTimestamps: true };
      showTimestamps = exportOptions.forceTimestamps || previousShowTimestamps;
      try {
        await runExport(['md']);
        if (/^Markdown extraction failed:/i.test(String(statusText ?? ''))) {
          throw new Error(statusText);
        }
      } finally {
        showTimestamps = previousShowTimestamps;
        updateUi();
      }

      githubWindow.location.href = workStackLaneContinueUrl(lane);
      projectWindow.location.href = projectUrl;
      workStackState.detail = 'Continuation prepared.';
      logDiagnostic('debug', 'workstack-continuation-complete', {
        lane,
        recovered_turn_count: recovered.length,
        frozen_marker_count: frozenMarkers.length,
        recovery_mode: workStackMissingAssistantMarkers(frozenMarkers, reconciled).length
          ? 'failed-or-missing-tail'
          : 'latest-complete-assistant'
      });
    } catch (error) {
      try { githubWindow.close(); } catch {}
      try { projectWindow.close(); } catch {}
      workStackState.detail = `CONTINUE failed: ${errorMessage(error)}`;
      logDiagnostic('errors', 'workstack-continuation-failure', {
        lane,
        message: errorMessage(error)
      });
    } finally {
      workStackState.handoff_in_progress = false;
      workStackRender();
    }
  }

  installWorkStackContinuation();
  // END Issue #163 WorkStack continuation UI/transaction
