from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text()
assert '// @version      0.6.129' in text
text = text.replace('// @version      0.6.129', '// @version      0.6.130', 1)

marker = '  async function jumpToResolvedTarget(target) {'
assert marker in text
helper = r'''  function jumpTocIndexControl(uapIndex) {
    return document.querySelector(`button[data-toc-item-index="${uapIndex}"]`);
  }

  async function populateJumpTocIndex(uapIndex, timeoutMs = 60000) {
    let toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return toc;

    const scrollRoot = conversationScrollRoot();
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

'''
text = text.replace(marker, helper + marker, 1)

old = '''      const toc = document.querySelector(`button[data-toc-item-index="${target.uap_index}"]`);
      logDiagnostic('debug', 'conversation-jump-materialization-step', {
        message_id: target.message_id,
        role: target.role,
        uap_index: target.uap_index,
        step: 'toc-index-control-lookup',
        available: toc instanceof HTMLElement
      });
      assert(toc instanceof HTMLElement,
        `Turn ${target.message_id} is not mounted and the conversation does not expose a UAP index control for ${target.uap_index}.`);'''
new = '''      let toc = jumpTocIndexControl(target.uap_index);
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
        `Turn ${target.message_id} is not mounted and the conversation did not expose a UAP index control for ${target.uap_index} after automatic index population.`);'''
assert old in text
text = text.replace(old, new, 1)

path.write_text(text)
