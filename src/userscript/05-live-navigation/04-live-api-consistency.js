    return {
      marker_count: markers?.length ?? 0,
      matched_count: matchedCount,
      missing_from_jsonl_count: missingCount,
      changed_count: changedCount,
      newest_jsonl_visible_id: newestJsonlVisible,
      newest_api_visible_id: newestApiVisible,
      warning,
      parse_error: false
    };
  }

  /**
   * Formats a compact live/API consistency warning for the recorder status display.
   *
   * @param {Object} result - Live/API comparison result.
   * @returns {string} Warning summary, or an empty string when consistent/unverified.
   */
  function liveApiTailWarningText(result) {
    if (!result?.warning) return '';
    if (result.marker_count === 0) {
      return 'live/API freshness could not be verified because no live tail markers were retained';
    }
    if (result.newest_verifiable === false) {
      return 'live/API freshness could not be verified because the newest live marker has no API message identity' +
        `${result.unverifiable_count > 1 ? `; unverifiable markers ${result.unverifiable_count}` : ''}`;
    }
    return `live/API matched ${result.matched_count}/${result.verifiable_count}; missing ${result.missing_count}` +
      `${result.unverifiable_count ? `; unverifiable ${result.unverifiable_count}` : ''}` +
      `${result.missing_suffix_count ? ` (newest suffix ${result.missing_suffix_count})` : ''}` +
      `${result.stale_prefix_count ? `; stale-content ${result.stale_prefix_count}` : ''}` +
      `${result.role_mismatch_count ? `; role-mismatch ${result.role_mismatch_count}` : ''}`;
  }

  /**
   * Formats a compact API/JSONL consistency warning for the recorder status display.
   *
   * @param {Object} result - API/JSONL comparison result.
   * @returns {string} Warning summary, or an empty string when consistent.
   */
  function jsonlTailWarningText(result) {
    if (!result?.warning) return '';
    return `API/JSONL missing ${result.missing_from_jsonl_count}; changed ${result.changed_count}` +
      `${result.parse_error ? '; JSONL parse error' : ''}`;
  }
  // END Issue #123 live-tail consistency

  /**
   * Waits for for jump target.
   *
   * @param {EventTarget|null} target - The target element or resolved jump target.
   * @param {number} timeoutMs - The timeout duration in milliseconds.
   * @returns {Promise<null>} A promise that resolves to the null result produced by `waitForJumpTarget`.
   */
  async function waitForJumpTarget(target, timeoutMs = 12000) {
    const deadline = performance.now() + timeoutMs;
    const scrollRoot = conversationScrollRoot();
    while (performance.now() < deadline) {
      const section = mountedTurnSection(target.message_id, target.role);
      if (section instanceof HTMLElement) return section;
      if (target.role === 'assistant') {
        scrollRoot.scrollBy({ top: Math.max(140, Math.floor(scrollRoot.clientHeight * 0.45)), behavior: 'auto' });
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }

  /**
   * Handles conversation jump TOC index control.
   *
   * @param {number} uapIndex - The zero-based uap index.
   * @returns {Element|null} The value produced by `jumpTocIndexControl`, or `null` when no value is available.
   */
  function jumpTocIndexControl(uapIndex) {
    return document.querySelector(`button[data-toc-item-index="${uapIndex}"]`);
  }

  /**
   * Handles populate jump TOC index.
   *
   * @param {number} uapIndex - The zero-based uap index.
   * @param {number} timeoutMs - The timeout duration in milliseconds.
   * @returns {Promise<null>} A promise resolving to the value produced by `populateJumpTocIndex`.
   */
  async function populateJumpTocIndex(uapIndex, timeoutMs = 60000) {
    let toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return toc;

    const scrollRoot = conversationScrollRoot();
    // Preserve the caller scroll position so image recovery can restore the page exactly.
    const originalScrollTop = scrollRoot.scrollTop;
    const deadline = performance.now() + timeoutMs;
    let steps = 0;
    let stagnantSteps = 0;
    logDiagnostic('debug', 'conversation-jump-toc-autopopulate-start', {
      uap_index: uapIndex,
      original_scroll_top: originalScrollTop,
      scroll_height: scrollRoot.scrollHeight,
      client_height: scrollRoot.clientHeight
    });

    scrollRoot.scrollTo({ top: 0, behavior: 'auto' });
    await new Promise(resolve => setTimeout(resolve, 100));

    while (performance.now() < deadline) {
      toc = jumpTocIndexControl(uapIndex);
      if (toc instanceof HTMLElement) {
        logDiagnostic('debug', 'conversation-jump-toc-autopopulate-complete', {
          uap_index: uapIndex,
          found: true,
          steps,
          scroll_top: scrollRoot.scrollTop
        });
        return toc;
      }

      const maxScrollTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
      if (scrollRoot.scrollTop >= maxScrollTop - 2) break;
      const before = scrollRoot.scrollTop;
      scrollRoot.scrollBy({
        top: Math.max(100, Math.floor(scrollRoot.clientHeight * 0.5)),
        behavior: 'auto'
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      steps += 1;
      if (Math.abs(scrollRoot.scrollTop - before) < 1) stagnantSteps += 1;
      else stagnantSteps = 0;
      if (steps % 20 === 0) {
        logDiagnostic('debug', 'conversation-jump-toc-autopopulate-progress', {
          uap_index: uapIndex,
          steps,
          scroll_top: scrollRoot.scrollTop,
          scroll_height: scrollRoot.scrollHeight,
          target_available: jumpTocIndexControl(uapIndex) instanceof HTMLElement
        });
      }
      if (stagnantSteps >= 5) break;
    }

    toc = jumpTocIndexControl(uapIndex);
    if (!(toc instanceof HTMLElement)) scrollRoot.scrollTo({ top: originalScrollTop, behavior: 'auto' });
    logDiagnostic('debug', 'conversation-jump-toc-autopopulate-complete', {
      uap_index: uapIndex,
      found: toc instanceof HTMLElement,
      steps,
      scroll_top: scrollRoot.scrollTop
    });
    return toc instanceof HTMLElement ? toc : null;
  }

  /**
   * Handles conversation jump to resolved target.
   *
   * @param {EventTarget|null} target - The target element or resolved jump target.
   * @returns {Promise<Object|boolean|string|number|null>} A promise that resolves to the Object|boolean|string|number|null result produced by `jumpToResolvedTarget`.
   */
  async function jumpToResolvedTarget(target) {
    let section = mountedTurnSection(target.message_id, target.role);
    logDiagnostic('debug', 'conversation-jump-materialization-step', {
      message_id: target.message_id,
      role: target.role,
      uap_index: target.uap_index,
      step: 'initial-mounted-check',
      mounted: section instanceof HTMLElement
    });
    if (!(section instanceof HTMLElement)) {
      let toc = jumpTocIndexControl(target.uap_index);
      logDiagnostic('debug', 'conversation-jump-materialization-step', {
        message_id: target.message_id,
        role: target.role,
        uap_index: target.uap_index,
        step: 'toc-index-control-lookup',
        available: toc instanceof HTMLElement
      });
      if (!(toc instanceof HTMLElement)) {
        toc = await populateJumpTocIndex(target.uap_index);
        logDiagnostic('debug', 'conversation-jump-materialization-step', {
          message_id: target.message_id,
          role: target.role,
          uap_index: target.uap_index,
          step: 'toc-index-control-after-autopopulate',
          available: toc instanceof HTMLElement
        });
      }
      assert(toc instanceof HTMLElement,
        `Turn ${target.message_id} is not mounted and the conversation did not expose a UAP index control for ${target.uap_index} after automatic index population.`);
      logDiagnostic('debug', 'conversation-jump-materialization-step', {
        message_id: target.message_id,
        role: target.role,
        uap_index: target.uap_index,
        step: 'toc-index-control-click'
      });
      toc.click();
      if (target.role === 'assistant') {
        const userMessageId = jumpUserRecords(target.spine)[target.uap_index]?.message_id;
        if (userMessageId) {
          const userSection = await waitForJumpTarget({
            uap_index: target.uap_index,
            role: 'user',
            message_id: userMessageId
          }, 6000);
          logDiagnostic('debug', 'conversation-jump-materialization-step', {
            message_id: target.message_id,
            role: target.role,
            uap_index: target.uap_index,
            step: 'assistant-user-anchor-wait',
            user_message_id: userMessageId,
            mounted: userSection instanceof HTMLElement
          });
          userSection?.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
      }
      section = await waitForJumpTarget(target);
      logDiagnostic('debug', 'conversation-jump-materialization-step', {
        message_id: target.message_id,
        role: target.role,
        uap_index: target.uap_index,
        step: 'target-wait-complete',
        mounted: section instanceof HTMLElement
      });
    }
    assert(section instanceof HTMLElement, `${target.role === 'assistant' ? 'Assistant' : 'User'} turn ${target.message_id} did not materialize.`);
    section.scrollIntoView({ block: 'center', behavior: 'smooth' });
    logDiagnostic('debug', 'conversation-jump-materialization-complete', {
      message_id: target.message_id,
      role: target.role,
      uap_index: target.uap_index,
      turn_id: section.getAttribute('data-turn-id') || null,
      data_turn: section.getAttribute('data-turn') || null
    });
    return section;
  }

  /**
   * Handles run jump.
   *
   * @returns {void} No value is returned.
   */
  async function runJump() {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    const requested = window.prompt('Enter a User or Assistant turn_id, or numeric UAP index (0 = first, -1 = last):');
    if (requested === null) return;
    const identifier = requested.trim();
    if (!identifier) {
