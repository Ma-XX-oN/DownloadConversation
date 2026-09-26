  // BEGIN Issue #163 WorkStack handoff transaction
  /**
   * Captures frozen mounted Assistant DOM candidates using live-tail identity.
   *
   * Duplicate mounted copies collapse to the copy with the most content.
   *
   * @returns {Array<Object>} Mounted candidates in conversation order.
   */
  function workStackMountedAssistantCandidates() {
    const orderedKeys = [];
    const byKey = new Map();
    const selector = 'section[data-turn-id]';
    for (const section of [...document.querySelectorAll(selector)]) {
      const marker = liveTailSectionMarker(section);
      if (!marker || marker.role !== 'assistant') continue;
      const key = marker.message_id
        ? `message:${marker.message_id}`
        : (marker.dom_turn_id
            ? `turn:${marker.dom_turn_id}`
            : `container:${marker.container_id ?? ''}`);
      if (!byKey.has(key)) orderedKeys.push(key);
      const existing = byKey.get(key) ?? null;
      const nextLength = Number(marker.content_length);
      const oldLength = Number(existing?.content_length);
      if (!existing || nextLength >= oldLength) {
        byKey.set(key, {
          ...marker,
          section: section.cloneNode(true)
        });
      }
    }
    return orderedKeys.map(key => byKey.get(key)).filter(Boolean);
  }

  /**
   * Waits briefly for an active Agent turn to settle and refreshes tail data.
   *
   * @returns {Promise<void>} Resolves when inactive; rejects after the limit.
   */
  async function workStackAwaitTailSettled() {
    const startedAt = performance.now();
    while (
      agentStopwatchState?.active &&
      performance.now() - startedAt < WORKSTACK_SETTLE_WAIT_MS
    ) {
      scanLiveTailMarkers('workstack-await-settle');
      await new Promise(resolve => {
        setTimeout(resolve, AGENT_STOPWATCH_REFRESH_MS);
      });
    }
    if (agentStopwatchState?.active) {
      throw new Error(
        'The current Assistant turn is still active; wait for it to finish ' +
        'and retry CONTINUE.'
      );
    }
    scanLiveTailMarkers('workstack-continue-freeze');
  }

  /**
   * Performs one atomic WorkStack continuation handoff from a bound lane.
   *
   * @returns {Promise<void>} Resolves after preparation and navigation.
   */
  async function handleWorkStackContinue() {
    if (
      workStackState.status !== 'bound' ||
      !workStackState.lane ||
      workStackState.handoff_in_progress
    ) {
      return;
    }
    const lane = workStackState.lane;
    const projectUrl = workStackProjectNewChatUrl(location.href);
    if (!projectUrl) {
      workStackState.detail =
        'Current chat is not in a recognized ChatGPT Project.';
      workStackRender();
      return;
    }
    if (exportInProgress || testInProgress || jumpInProgress) {
      workStackState.detail =
        'DownloadConversation is busy; retry CONTINUE after the current ' +
        'operation finishes.';
      workStackRender();
      return;
    }

    const githubWindow = window.open('about:blank', '_blank');
    const projectWindow = window.open('about:blank', '_blank');
    if (!githubWindow || !projectWindow) {
      try { githubWindow?.close(); } catch {}
      try { projectWindow?.close(); } catch {}
      workStackState.detail =
        'Popup blocked; allow popups and retry CONTINUE.';
      workStackRender();
      return;
    }

    workStackState.handoff_in_progress = true;
    workStackState.detail = '';
    workStackRender();
    try {
      await workStackAwaitTailSettled();
      const conversationId = currentConversationId();
      if (
        !conversationId ||
        workStackState.conversation_id !== conversationId
      ) {
        throw new Error('Conversation changed during WorkStack handoff.');
      }

      const frozenMarkers = snapshotLiveTailMarkers()
        .slice(-LIVE_TAIL_MARKER_LIMIT);
      const frozenCandidates = workStackMountedAssistantCandidates();
      const fetched = await fetchConversationPages(conversationId);
      const historySpine = conversationSpineFromPages(fetched.pages);
      const currentStreamCapture =
        streamTailCapture?.conversation_id === conversationId
          ? streamTailCapture
          : streamTailRestoreCapture(conversationId);
      const reconciled = mergeStreamTailCaptureIntoSpine(
        historySpine,
        streamTailCaptureSnapshot(currentStreamCapture)
      ).spine;
      const recoveryMarkers = workStackRecoveryAssistantMarkers(
        frozenMarkers,
        reconciled
      );
      if (!recoveryMarkers.length) {
        throw new Error(
          'No usable recent Assistant DOM turn is available for ' +
          'continuation.'
        );
      }
      const correlated = workStackCorrelateTailCandidates(
        recoveryMarkers,
        frozenCandidates
      );
      const recovered = correlated.map(candidate => {
        return extractTurn(candidate.section);
      });
      const packet = workStackContinuationPacket(lane, recovered);
      await navigator.clipboard.writeText(packet);

      if (exportInProgress || testInProgress || jumpInProgress) {
        throw new Error(
          'DownloadConversation became busy before the required Markdown ' +
          'export could start.'
        );
      }
      const previousShowTimestamps = showTimestamps;
      const exportOptions = { forceTimestamps: true };
      showTimestamps = exportOptions.forceTimestamps ||
        previousShowTimestamps;
      try {
        await runExport(['md']);
        if (
          /^Markdown extraction failed:/i.test(String(statusText ?? ''))
        ) {
          throw new Error(statusText);
        }
      } finally {
        showTimestamps = previousShowTimestamps;
        updateUi();
      }

      githubWindow.location.href = workStackLaneContinueUrl(lane);
      projectWindow.location.href = projectUrl;
      workStackState.detail = 'Continuation prepared.';
      const missingCount = workStackMissingAssistantMarkers(
        frozenMarkers,
        reconciled
      ).length;
      logDiagnostic('debug', 'workstack-continuation-complete', {
        lane,
        recovered_turn_count: recovered.length,
        frozen_marker_count: frozenMarkers.length,
        recovery_mode: missingCount
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
  // END Issue #163 WorkStack handoff transaction
