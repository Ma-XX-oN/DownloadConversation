from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text()
assert '// @version      0.6.127' in text
text = text.replace('// @version      0.6.127', '// @version      0.6.128', 1)

old_jump = r'''  async function jumpToResolvedTarget(target) {
    let section = mountedTurnSection(target.message_id, target.role);
    if (!(section instanceof HTMLElement)) {
      const toc = document.querySelector(`button[data-toc-item-index="${target.uap_index}"]`);
      assert(toc instanceof HTMLElement,
        `Turn ${target.message_id} is not mounted and the conversation does not expose a UAP index control for ${target.uap_index}.`);
      toc.click();
      if (target.role === 'assistant') {
        const userMessageId = jumpUserRecords(target.spine)[target.uap_index]?.message_id;
        if (userMessageId) {
          const userSection = await waitForJumpTarget({
            uap_index: target.uap_index,
            role: 'user',
            message_id: userMessageId
          }, 6000);
          userSection?.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
      }
      section = await waitForJumpTarget(target);
    }
    assert(section instanceof HTMLElement, `${target.role === 'assistant' ? 'Assistant' : 'User'} turn ${target.message_id} did not materialize.`);
    section.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return section;
  }
'''
new_jump = r'''  async function jumpToResolvedTarget(target) {
    let section = mountedTurnSection(target.message_id, target.role);
    logDiagnostic('debug', 'conversation-jump-materialization-step', {
      message_id: target.message_id,
      role: target.role,
      uap_index: target.uap_index,
      step: 'initial-mounted-check',
      mounted: section instanceof HTMLElement
    });
    if (!(section instanceof HTMLElement)) {
      const toc = document.querySelector(`button[data-toc-item-index="${target.uap_index}"]`);
      logDiagnostic('debug', 'conversation-jump-materialization-step', {
        message_id: target.message_id,
        role: target.role,
        uap_index: target.uap_index,
        step: 'toc-index-control-lookup',
        available: toc instanceof HTMLElement
      });
      assert(toc instanceof HTMLElement,
        `Turn ${target.message_id} is not mounted and the conversation does not expose a UAP index control for ${target.uap_index}.`);
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
'''
assert old_jump in text
text = text.replace(old_jump, new_jump, 1)

old_run = r'''  async function runJump() {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    const requested = window.prompt('Enter a User or Assistant turn_id, or numeric UAP index (0 = first, -1 = last):');
    if (requested === null) return;
    const identifier = requested.trim();
    if (!identifier) {
      setStatus('No User/Assistant turn ID or UAP index was entered.');
      return;
    }
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    jumpInProgress = true;
    updateUi();
    try {
      setStatus('Resolving Jump target…');
      const fetched = await fetchConversationPages(conversationId);
      const spine = conversationSpineFromPages(fetched.pages);
      const target = resolveJumpIdentifier(spine, identifier);
      target.spine = spine;
      setStatus(`Jumping to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn…`);
      const section = await jumpToResolvedTarget(target);
      if (target.role === 'user') {
        const targetRecord = spine.records.find(item => item?.message_id === target.message_id)?.message;
        if (targetRecord && userImagePointerCount(targetRecord) > 0) {
          logInternalImagePointerEvidence(targetRecord, section, mountedUserConversationImages(section));
        }
      }
      setStatus(`Jumped to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn ${target.message_id}.`);
    } catch (error) {
      setStatus(`Jump failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      jumpInProgress = false;
      updateUi();
    }
  }
'''
new_run = r'''  async function runJump() {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    const requested = window.prompt('Enter a User or Assistant turn_id, or numeric UAP index (0 = first, -1 = last):');
    if (requested === null) return;
    const identifier = requested.trim();
    if (!identifier) {
      setStatus('No User/Assistant turn ID or UAP index was entered.');
      return;
    }
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    logDiagnostic('debug', 'conversation-jump-request', {
      raw_requested_identifier: boundedDiagnosticText(requested, 500),
      identifier,
      conversation_id: conversationId
    });
    jumpInProgress = true;
    updateUi();
    let resolvedTarget = null;
    try {
      setStatus('Resolving Jump target…');
      const fetched = await fetchConversationPages(conversationId);
      const spine = conversationSpineFromPages(fetched.pages);
      const target = resolveJumpIdentifier(spine, identifier);
      resolvedTarget = {
        uap_index: target.uap_index,
        role: target.role,
        message_id: target.message_id
      };
      logDiagnostic('debug', 'conversation-jump-target-resolved', {
        identifier,
        ...resolvedTarget
      });
      target.spine = spine;
      setStatus(`Jumping to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn…`);
      const section = await jumpToResolvedTarget(target);
      if (target.role === 'user') {
        const targetRecord = spine.records.find(item => item?.message_id === target.message_id)?.message;
        if (targetRecord && userImagePointerCount(targetRecord) > 0) {
          logInternalImagePointerEvidence(targetRecord, section, mountedUserConversationImages(section));
        }
      }
      logDiagnostic('debug', 'conversation-jump-success', {
        identifier,
        ...resolvedTarget
      });
      setStatus(`Jumped to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn ${target.message_id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDiagnostic('warnings', 'conversation-jump-failure', {
        raw_requested_identifier: boundedDiagnosticText(requested, 500),
        identifier,
        conversation_id: conversationId,
        resolved_target: resolvedTarget,
        message
      });
      setStatus(`Jump failed: ${message}`);
    } finally {
      jumpInProgress = false;
      updateUi();
    }
  }
'''
assert old_run in text
text = text.replace(old_run, new_run, 1)

path.write_text(text)
