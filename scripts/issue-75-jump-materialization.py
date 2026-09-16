from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')

old_version = '// @version      1.2.0-issue.135.1'
new_version = '// @version      1.2.0-issue.75.1'
if text.count(old_version) != 1:
  raise SystemExit(f'version: expected exactly one {old_version!r}')
text = text.replace(old_version, new_version, 1)

populate_start = text.index('  /**\n   * Handles populate jump TOC index.')
populate_end = text.index('  /**\n   * Handles conversation jump to resolved target.', populate_start)
new_populate = r'''  /**
   * Progressively materializes a resolved Jump target or its optional stock TOC control.
   *
   * A current scroll boundary is not considered whole-conversation convergence until the
   * viewport and virtualized extent remain unchanged across repeated settle observations.
   * The requested message itself is checked before the TOC after every navigation settle.
   *
   * @param {Object} target - Resolved Jump target containing UAP index, role, and message id.
   * @param {number} timeoutMs - Maximum traversal time in milliseconds.
   * @returns {Promise<HTMLElement|null>} The matching TOC control, or null when the target materializes directly or no control converges.
   */
  async function populateJumpTocIndex(target, timeoutMs = 60000) {
    const uapIndex = target?.uap_index;
    assert(Number.isInteger(uapIndex) && uapIndex >= 0, 'Jump target has no valid UAP index.');

    let section = mountedTurnSection(target.message_id, target.role);
    if (section instanceof HTMLElement) return null;
    let toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return toc;

    const scrollRoot = conversationScrollRoot();
    const originalScrollTop = scrollRoot.scrollTop;
    const deadline = performance.now() + timeoutMs;
    const stableBoundaryObservationLimit = 20;
    let stableBoundaryObservations = 0;
    let steps = 0;

    const complete = reason => {
      section = mountedTurnSection(target.message_id, target.role);
      toc = jumpTocIndexControl(uapIndex);
      logDiagnostic('debug', 'conversation-jump-toc-autopopulate-complete', {
        message_id: target.message_id,
        role: target.role,
        uap_index: uapIndex,
        reason,
        target_mounted: section instanceof HTMLElement,
        found: toc instanceof HTMLElement,
        steps,
        stable_boundary_observations: stableBoundaryObservations,
        scroll_top: scrollRoot.scrollTop,
        scroll_height: scrollRoot.scrollHeight,
        client_height: scrollRoot.clientHeight
      });
      return toc instanceof HTMLElement ? toc : null;
    };

    logDiagnostic('debug', 'conversation-jump-toc-autopopulate-start', {
      message_id: target.message_id,
      role: target.role,
      uap_index: uapIndex,
      original_scroll_top: originalScrollTop,
      scroll_height: scrollRoot.scrollHeight,
      client_height: scrollRoot.clientHeight,
      stable_boundary_observation_limit: stableBoundaryObservationLimit
    });

    scrollRoot.scrollTo({ top: 0, behavior: 'auto' });
    await new Promise(resolve => setTimeout(resolve, 100));
    steps += 1;
    section = mountedTurnSection(target.message_id, target.role);
    if (section instanceof HTMLElement) return complete('target-mounted-after-top');
    toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return complete('toc-found-after-top');

    while (performance.now() < deadline) {
      section = mountedTurnSection(target.message_id, target.role);
      if (section instanceof HTMLElement) return complete('target-mounted-before-step');
      toc = jumpTocIndexControl(uapIndex);
      if (toc instanceof HTMLElement) return complete('toc-found-before-step');

      const beforeScrollTop = scrollRoot.scrollTop;
      const beforeScrollHeight = scrollRoot.scrollHeight;
      const beforeClientHeight = scrollRoot.clientHeight;
      const beforeMaxScrollTop = Math.max(0, beforeScrollHeight - beforeClientHeight);
      const atBoundaryBefore = beforeScrollTop >= beforeMaxScrollTop - 2;

      if (!atBoundaryBefore) {
        scrollRoot.scrollBy({
          top: Math.max(100, Math.floor(scrollRoot.clientHeight * 0.5)),
          behavior: 'auto'
        });
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      steps += 1;

      section = mountedTurnSection(target.message_id, target.role);
      if (section instanceof HTMLElement) return complete('target-mounted-after-settle');
      toc = jumpTocIndexControl(uapIndex);
      if (toc instanceof HTMLElement) return complete('toc-found-after-settle');

      const afterScrollTop = scrollRoot.scrollTop;
      const afterScrollHeight = scrollRoot.scrollHeight;
      const afterClientHeight = scrollRoot.clientHeight;
      const afterMaxScrollTop = Math.max(0, afterScrollHeight - afterClientHeight);
      const atBoundaryAfter = afterScrollTop >= afterMaxScrollTop - 2;
      const stableObservation =
        Math.abs(afterScrollTop - beforeScrollTop) < 1 &&
        Math.abs(afterScrollHeight - beforeScrollHeight) < 1 &&
        Math.abs(afterClientHeight - beforeClientHeight) < 1;

      if (atBoundaryAfter && stableObservation) stableBoundaryObservations += 1;
      else stableBoundaryObservations = 0;

      if (steps % 20 === 0 || stableBoundaryObservations > 0) {
        logDiagnostic('debug', 'conversation-jump-toc-autopopulate-progress', {
          message_id: target.message_id,
          role: target.role,
          uap_index: uapIndex,
          steps,
          scroll_top: afterScrollTop,
          scroll_height: afterScrollHeight,
          client_height: afterClientHeight,
          at_boundary: atBoundaryAfter,
          stable_boundary_observations: stableBoundaryObservations,
          target_mounted: false,
          target_available: false
        });
      }

      if (stableBoundaryObservations >= stableBoundaryObservationLimit) break;
    }

    section = mountedTurnSection(target.message_id, target.role);
    if (section instanceof HTMLElement) return complete('target-mounted-final-check');
    toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return complete('toc-found-final-check');

    scrollRoot.scrollTo({ top: originalScrollTop, behavior: 'auto' });
    return complete(
      performance.now() >= deadline ? 'timeout-without-target-or-toc' : 'stable-boundary-convergence-without-target-or-toc'
    );
  }

'''
text = text[:populate_start] + new_populate + text[populate_end:]

jump_start = text.index('  /**\n   * Handles conversation jump to resolved target.')
jump_end = text.index('  /**\n   * Handles run jump.', jump_start)
new_jump = r'''  /**
   * Materializes and scrolls to one resolved Jump target.
   *
   * @param {Object} target - Resolved Jump target with UAP index, role, message id, and source spine.
   * @returns {Promise<HTMLElement>} The mounted target section.
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
        toc = await populateJumpTocIndex(target);
        section = mountedTurnSection(target.message_id, target.role);
        logDiagnostic('debug', 'conversation-jump-materialization-step', {
          message_id: target.message_id,
          role: target.role,
          uap_index: target.uap_index,
          step: 'target-after-autopopulate',
          mounted: section instanceof HTMLElement
        });
        logDiagnostic('debug', 'conversation-jump-materialization-step', {
          message_id: target.message_id,
          role: target.role,
          uap_index: target.uap_index,
          step: 'toc-index-control-after-autopopulate',
          available: toc instanceof HTMLElement
        });
      }

      if (!(section instanceof HTMLElement)) {
        assert(toc instanceof HTMLElement,
          `Turn ${target.message_id} is not mounted and the conversation did not expose a UAP index control for ${target.uap_index} after automatic materialization convergence.`);
        logDiagnostic('debug', 'conversation-jump-materialization-step', {
          message_id: target.message_id,
          role: target.role,
          uap_index: target.uap_index,
          step: 'toc-index-control-click'
        });
        toc.click();
        section = mountedTurnSection(target.message_id, target.role);

        if (!(section instanceof HTMLElement) && target.role === 'assistant') {
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

        if (!(section instanceof HTMLElement)) section = await waitForJumpTarget(target);
        logDiagnostic('debug', 'conversation-jump-materialization-step', {
          message_id: target.message_id,
          role: target.role,
          uap_index: target.uap_index,
          step: 'target-wait-complete',
          mounted: section instanceof HTMLElement
        });
      }
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

'''
text = text[:jump_start] + new_jump + text[jump_end:]

path.write_text(text, encoding='utf-8')
