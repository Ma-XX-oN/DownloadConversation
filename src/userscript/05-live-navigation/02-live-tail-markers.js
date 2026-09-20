    if (!(section instanceof Element)) return null;
    const role = section.getAttribute('data-turn');
    if (role !== 'user' && role !== 'assistant') return null;
    const messageNodes = [...section.querySelectorAll('[data-message-id]')];
    const message = messageNodes.at(-1) ?? null;
    const domTurnId = section.getAttribute('data-turn-id') || null;
    const messageId = message?.getAttribute('data-message-id') || null;
    if (!domTurnId && !messageId) return null;
    const normalized = normalizeLiveTailText((message ?? section).textContent || '');
    /** Bounded visible text retained for comparison/fingerprinting; full normalized length remains diagnostic metadata. */
    const comparisonText = normalized.slice(0, LIVE_TAIL_TEXT_LIMIT);
    return {
      role,
      message_id: messageId,
      dom_turn_id: domTurnId,
      container_id: section.getAttribute('data-testid') || null,
      comparison_text: comparisonText,
      content_length: normalized.length,
      content_fingerprint: liveTailFingerprint(comparisonText),
      observed_at: Date.now()
    };
  }

  /**
   * Adds or refreshes one live high-water marker while preserving monotonic history.
   *
   * A remount/stream update of the current newest identity may refresh in place even when advancement is disabled. A different identity is appended only when the caller has established legitimate forward progression.
   *
   * @param {Object|null} marker - Candidate live-tail marker.
   * @param {boolean} allowAdvance - Whether a new identity may advance the high-water history.
   * @returns {boolean} True when retained marker state changed.
   */
  function recordLiveTailMarker(marker, allowAdvance) {
    if (!marker || !['user', 'assistant'].includes(marker.role)) return false;
    if (!marker.message_id && !marker.dom_turn_id) return false;
    const newest = liveTailMarkers.at(-1) ?? null;
    if (liveTailMarkerIdentityMatches(newest, marker)) {
      liveTailMarkers[liveTailMarkers.length - 1] = { ...newest, ...marker };
      return true;
    }
    if (liveTailMarkers.some(existing => liveTailMarkerIdentityMatches(existing, marker))) return false;
    if (!allowAdvance) return false;
    liveTailMarkers.push({ ...marker });
    if (liveTailMarkers.length > LIVE_TAIL_MARKER_LIMIT) {
      liveTailMarkers.splice(0, liveTailMarkers.length - LIVE_TAIL_MARKER_LIMIT);
    }
    return true;
  }

  /**
   * Marks current virtual-window movement as historical navigation so mounted older turns cannot advance the tail.
   *
   * @param {string} reason - Diagnostic reason for entering historical-navigation mode.
   * @returns {void} No value is returned.
   */
  function markLiveTailHistoricalNavigation(reason) {
    liveTailHistoricalNavigation = true;
    logDiagnostic('debug', 'conversation-live-tail-historical-navigation', {
      reason,
      marker_count: liveTailMarkers.length,
      newest_message_id: liveTailMarkers.at(-1)?.message_id ?? null,
      newest_dom_turn_id: liveTailMarkers.at(-1)?.dom_turn_id ?? null
    });
  }

  /**
   * Marks an explicit User prompt submission as legitimate forward conversation progression.
   *
   * @returns {void} No value is returned.
   */
  function markLiveTailPromptSubmission() {
    liveTailHistoricalNavigation = false;
    liveTailPromptAdvancePending = true;
    logDiagnostic('debug', 'conversation-live-tail-prompt-submission', {
      marker_count: liveTailMarkers.length,
      newest_message_id: liveTailMarkers.at(-1)?.message_id ?? null
    });
  }

  /**
   * Reports whether the conversation scroll root is at its current physical bottom boundary.
   *
   * Physical-bottom evidence alone never overrides historical-navigation mode.
   *
   * @param {Element|Object} scrollRoot - Conversation scroll container.
   * @returns {boolean} True when the current viewport is within the bottom tolerance.
   */
  function liveTailAtPhysicalBottom(scrollRoot) {
    const scrollTop = Number(scrollRoot?.scrollTop) || 0;
    const clientHeight = Number(scrollRoot?.clientHeight) || 0;
    const scrollHeight = Number(scrollRoot?.scrollHeight) || 0;
    const tolerance = Math.max(24, Math.floor(clientHeight * 0.04));
    return scrollTop + clientHeight >= scrollHeight - tolerance;
  }

  /**
   * Applies one ordered mounted-window observation to the monotonic live high-water history.
   *
   * Initial bottom observation seeds up to ten mounted markers. Historical navigation cannot advance until the prior high-water marker is re-encountered; once re-encountered, only later mounted markers may advance the history.
   *
   * @param {Array<Object>} mounted - Ordered mounted User/Assistant markers.
   * @param {boolean} atBottom - Whether the observed scroll root is at its current physical bottom.
   * @param {string} reason - Diagnostic reason for the observation.
   * @returns {number} Number of retained marker entries added or refreshed.
   */
  function applyMountedLiveTailMarkers(mounted, atBottom, reason = 'scan') {
    const candidates = Array.isArray(mounted) ? mounted.filter(Boolean) : [];
    if (!candidates.length) return 0;
    let changed = 0;
    let advanced = 0;
    const beforeNewest = liveTailMarkers.at(-1) ?? null;
    if (!liveTailMarkers.length) {
      if (!atBottom && !liveTailPromptAdvancePending) return 0;
      for (const marker of candidates.slice(-LIVE_TAIL_MARKER_LIMIT)) {
        if (recordLiveTailMarker(marker, true)) {
          changed += 1;
          advanced += 1;
        }
      }
    } else if (liveTailHistoricalNavigation) {
      const highWater = liveTailMarkers.at(-1);
      const anchorIndex = candidates.findIndex(marker => liveTailMarkerIdentityMatches(marker, highWater));
      if (anchorIndex < 0) return 0;
      if (recordLiveTailMarker(candidates[anchorIndex], false)) changed += 1;
      liveTailHistoricalNavigation = false;
      logDiagnostic('debug', 'conversation-live-tail-high-water-reencountered', {
        reason,
        newest_message_id: highWater?.message_id ?? null,
        newest_dom_turn_id: highWater?.dom_turn_id ?? null
      });
      for (let index = anchorIndex + 1; index < candidates.length; index += 1) {
        if (recordLiveTailMarker(candidates[index], true)) {
          changed += 1;
          advanced += 1;
        }
      }
    } else {
      const highWater = liveTailMarkers.at(-1);
      const anchorIndex = candidates.findIndex(marker => liveTailMarkerIdentityMatches(marker, highWater));
      if (anchorIndex >= 0) {
        if (recordLiveTailMarker(candidates[anchorIndex], false)) changed += 1;
        for (let index = anchorIndex + 1; index < candidates.length; index += 1) {
          if (recordLiveTailMarker(candidates[index], true)) {
            changed += 1;
            advanced += 1;
          }
        }
      } else if ((atBottom || liveTailPromptAdvancePending) && candidates.length) {
        if (recordLiveTailMarker(candidates.at(-1), true)) {
          changed += 1;
          advanced += 1;
        }
      }
    }
    const afterNewest = liveTailMarkers.at(-1) ?? null;
    if (advanced > 0 && afterNewest?.role === 'assistant' && liveTailPromptAdvancePending) {
      liveTailPromptAdvancePending = false;
    }
    if (advanced > 0 && !liveTailMarkerIdentityMatches(beforeNewest, afterNewest)) {
      logDiagnostic('debug', 'conversation-live-tail-advanced', {
        reason,
        advanced_count: advanced,
        marker_count: liveTailMarkers.length,
        role: afterNewest?.role ?? null,
        message_id: afterNewest?.message_id ?? null,
        dom_turn_id: afterNewest?.dom_turn_id ?? null,
        container_id: afterNewest?.container_id ?? null,
        content_length: afterNewest?.content_length ?? null,
        content_fingerprint: afterNewest?.content_fingerprint ?? null
      });
    }
    return changed;
  }

  /**
   * Scans the mounted virtual window and applies it to the retained monotonic high-water history.
   *
   * @param {string} reason - Diagnostic reason for the scan.
   * @returns {void} No value is returned.
   */
  function scanLiveTailMarkers(reason = 'scan') {
    const conversationId = currentConversationId();
    if (!conversationId) return;
    if (liveTailConversationId !== conversationId) resetLiveTailTrackingState(conversationId);
    const mounted = [...document.querySelectorAll('section[data-turn-id]')]
      .map(liveTailSectionMarker)
      .filter(Boolean);
    if (!mounted.length) return;
    const scrollRoot = liveTailObservedScrollRoot || conversationScrollRoot();
    const atPhysicalBottom = liveTailAtPhysicalBottom(scrollRoot);
    applyMountedLiveTailMarkers(mounted, atPhysicalBottom, reason);
    if (atPhysicalBottom) {
      const newestAssistant = [...mounted].reverse().find(marker => marker.role === 'assistant') ?? null;
      communicationLogAssistantLifecycle(newestAssistant, reason);
    }
  }

  /**
   * Coalesces a requested live-tail scan into one queued microtask.
   *
   * @param {string} reason - Diagnostic reason retained for the queued scan.
   * @returns {void} No value is returned.
   */
  function scheduleLiveTailScan(reason) {
    if (liveTailScanScheduled) return;
    liveTailScanScheduled = true;
    queueMicrotask(() => {
      liveTailScanScheduled = false;
      scanLiveTailMarkers(reason);
    });
  }

  /**
   * Handles conversation scrolling for high-water tracking without treating upward navigation as new content.
   *
   * @returns {void} No value is returned.
   */
  function handleLiveTailScroll() {
    const scrollRoot = liveTailObservedScrollRoot || conversationScrollRoot();
    const current = Number(scrollRoot?.scrollTop) || 0;
    if (liveTailLastScrollTop !== null && current < liveTailLastScrollTop - 4) {
      markLiveTailHistoricalNavigation('scroll-up');
    }
    liveTailLastScrollTop = current;
    scheduleLiveTailScan('scroll');
  }

  /**
   * Handles index-bar/send-button clicks for live-tail navigation/progression state.
   *
   * @param {Event|Object} event - Click event.
   * @returns {void} No value is returned.
   */
  function handleLiveTailClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('button[data-toc-item-index]')) {
      markLiveTailHistoricalNavigation('prompt-index');
      return;
    }
    if (target.closest('button[data-testid="send-button"]')) markLiveTailPromptSubmission();
  }

  /**
   * Handles prompt-form submission as explicit forward conversation progression.
