from pathlib import Path

userscript_path = Path('chatgpt-conversation-markdown-export.user.js')
test_path = Path('tests/jump-materialization.test.mjs')

text = userscript_path.read_text(encoding='utf-8')

old_version = '// @version      1.2.0-issue.75.1'
new_version = '// @version      1.2.0-issue.75.2'
if text.count(old_version) != 1:
  raise SystemExit(f'version: expected exactly one {old_version!r}')
text = text.replace(old_version, new_version, 1)

helper_marker = '''  /**
   * Progressively materializes a resolved Jump target or its optional stock TOC control.
'''
if text.count(helper_marker) != 1:
  raise SystemExit('prime helper insertion marker missing or ambiguous')

prime_helper = r'''  /**
   * Starts a directionally safe numeric Jump movement before API target resolution finishes.
   *
   * Zero always points toward the oldest boundary and negative indices always point toward
   * the newest boundary. Positive indices move only when the currently mounted stock TOC
   * range proves which direction contains the requested index.
   *
   * @param {number} requestedIndex - Signed numeric UAP index entered by the user.
   * @returns {void} No value is returned.
   */
  function primeNumericJumpMaterialization(requestedIndex) {
    if (!Number.isSafeInteger(requestedIndex)) return;
    const scrollRoot = conversationScrollRoot();
    let direction = null;

    if (requestedIndex === 0) {
      direction = 'older';
    } else if (requestedIndex < 0) {
      direction = 'newer';
    } else {
      const mountedIndices = [...document.querySelectorAll('button[data-toc-item-index]')]
        .map(button => Number(button.getAttribute('data-toc-item-index')))
        .filter(index => Number.isSafeInteger(index) && index >= 0);
      if (mountedIndices.length > 0) {
        const minimum = Math.min(...mountedIndices);
        const maximum = Math.max(...mountedIndices);
        if (requestedIndex < minimum) direction = 'older';
        else if (requestedIndex > maximum) direction = 'newer';
      }
    }

    if (direction === 'older') {
      scrollRoot.scrollTo({ top: 0, behavior: 'auto' });
    } else if (direction === 'newer') {
      scrollRoot.scrollTo({
        top: Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight),
        behavior: 'auto'
      });
    } else {
      return;
    }

    logDiagnostic('debug', 'conversation-jump-numeric-prime', {
      requested_index: requestedIndex,
      direction,
      scroll_top: scrollRoot.scrollTop,
      scroll_height: scrollRoot.scrollHeight,
      client_height: scrollRoot.clientHeight
    });
  }

'''
text = text.replace(helper_marker, prime_helper + helper_marker, 1)

populate_start = text.index('  /**\n   * Progressively materializes a resolved Jump target')
populate_end = text.index('  /**\n   * Materializes and scrolls to one resolved Jump target.', populate_start)
new_populate = r'''  /**
   * Progressively materializes a resolved Jump target or its optional stock TOC control.
   *
   * UAP 0 is a special oldest-boundary traversal. ChatGPT prepends older material while
   * preserving the visual anchor, which can move scrollTop forward even though Jump just
   * reached the top. Re-pinning the top until the target/control appears prevents that
   * anchoring from being misread as forward traversal toward the newest boundary.
   *
   * @param {Object} target - Resolved Jump target containing UAP index, role, and message id.
   * @param {number} timeoutMs - Maximum traversal time in milliseconds.
   * @returns {Promise<HTMLElement|null>} The matching TOC control, or null when the target materializes directly or no control converges.
   */
  async function populateJumpTocIndex(target, timeoutMs = 60000) {
    const uapIndex = target?.uap_index;
    assert(Number.isInteger(uapIndex) && uapIndex >= 0, 'Jump target has no valid UAP index.');

    let section = target?.message_id ? mountedTurnSection(target.message_id, target.role) : null;
    if (section instanceof HTMLElement) return null;
    let toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return toc;

    const scrollRoot = conversationScrollRoot();
    const originalScrollTop = scrollRoot.scrollTop;
    const deadline = performance.now() + timeoutMs;
    const seeksOldestBoundary = uapIndex === 0;
    const stableBoundaryObservationLimit = seeksOldestBoundary ? 60 : 20;
    let stableBoundaryObservations = 0;
    let steps = 0;

    /**
     * Logs and returns the current materialization outcome at one terminal observation.
     *
     * @param {string} reason - Stable diagnostic reason for ending traversal.
     * @returns {HTMLElement|null} The available TOC control, or null when none is present.
     */
    const complete = reason => {
      section = target?.message_id ? mountedTurnSection(target.message_id, target.role) : null;
      toc = jumpTocIndexControl(uapIndex);
      logDiagnostic('debug', 'conversation-jump-toc-autopopulate-complete', {
        message_id: target?.message_id ?? null,
        role: target?.role ?? null,
        uap_index: uapIndex,
        reason,
        boundary: seeksOldestBoundary ? 'top' : 'bottom',
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
      message_id: target?.message_id ?? null,
      role: target?.role ?? null,
      uap_index: uapIndex,
      original_scroll_top: originalScrollTop,
      scroll_height: scrollRoot.scrollHeight,
      client_height: scrollRoot.clientHeight,
      boundary: seeksOldestBoundary ? 'top' : 'bottom',
      stable_boundary_observation_limit: stableBoundaryObservationLimit
    });

    scrollRoot.scrollTo({ top: 0, behavior: 'auto' });
    await new Promise(resolve => setTimeout(resolve, 100));
    steps += 1;
    section = target?.message_id ? mountedTurnSection(target.message_id, target.role) : null;
    if (section instanceof HTMLElement) return complete('target-mounted-after-top');
    toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return complete('toc-found-after-top');

    while (performance.now() < deadline) {
      section = target?.message_id ? mountedTurnSection(target.message_id, target.role) : null;
      if (section instanceof HTMLElement) return complete('target-mounted-before-step');
      toc = jumpTocIndexControl(uapIndex);
      if (toc instanceof HTMLElement) return complete('toc-found-before-step');

      const beforeScrollTop = scrollRoot.scrollTop;
      const beforeScrollHeight = scrollRoot.scrollHeight;
      const beforeClientHeight = scrollRoot.clientHeight;
      const beforeMaxScrollTop = Math.max(0, beforeScrollHeight - beforeClientHeight);
      const atBoundaryBefore = seeksOldestBoundary
        ? beforeScrollTop <= 2
        : beforeScrollTop >= beforeMaxScrollTop - 2;

      if (seeksOldestBoundary) {
        scrollRoot.scrollTo({ top: 0, behavior: 'auto' });
      } else if (!atBoundaryBefore) {
        scrollRoot.scrollBy({
          top: Math.max(100, Math.floor(scrollRoot.clientHeight * 0.5)),
          behavior: 'auto'
        });
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      steps += 1;

      section = target?.message_id ? mountedTurnSection(target.message_id, target.role) : null;
      if (section instanceof HTMLElement) return complete('target-mounted-after-settle');
      toc = jumpTocIndexControl(uapIndex);
      if (toc instanceof HTMLElement) return complete('toc-found-after-settle');

      const afterScrollTop = scrollRoot.scrollTop;
      const afterScrollHeight = scrollRoot.scrollHeight;
      const afterClientHeight = scrollRoot.clientHeight;
      const afterMaxScrollTop = Math.max(0, afterScrollHeight - afterClientHeight);
      const atBoundaryAfter = seeksOldestBoundary
        ? afterScrollTop <= 2
        : afterScrollTop >= afterMaxScrollTop - 2;
      const stableObservation =
        Math.abs(afterScrollTop - beforeScrollTop) < 1 &&
        Math.abs(afterScrollHeight - beforeScrollHeight) < 1 &&
        Math.abs(afterClientHeight - beforeClientHeight) < 1;

      if (atBoundaryAfter && stableObservation) stableBoundaryObservations += 1;
      else stableBoundaryObservations = 0;

      if (steps % 20 === 0 || stableBoundaryObservations > 0) {
        logDiagnostic('debug', 'conversation-jump-toc-autopopulate-progress', {
          message_id: target?.message_id ?? null,
          role: target?.role ?? null,
          uap_index: uapIndex,
          steps,
          boundary: seeksOldestBoundary ? 'top' : 'bottom',
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

    section = target?.message_id ? mountedTurnSection(target.message_id, target.role) : null;
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

run_old = '''    try {
      setStatus('Resolving Jump target…');
      const fetched = await fetchConversationPages(conversationId);
'''
run_new = '''    try {
      if (/^-?\\d+$/.test(identifier)) {
        const requestedIndex = Number(identifier);
        if (Number.isSafeInteger(requestedIndex)) primeNumericJumpMaterialization(requestedIndex);
      }
      setStatus('Resolving Jump target…');
      const fetched = await fetchConversationPages(conversationId);
'''
if text.count(run_old) != 1:
  raise SystemExit('runJump numeric-prime insertion point missing or ambiguous')
text = text.replace(run_old, run_new, 1)

userscript_path.write_text(text, encoding='utf-8')

test_text = test_path.read_text(encoding='utf-8')
start = test_text.index("test('numeric Jump inputs start navigation without waiting for a Conversation API snapshot'")
new_test = r'''test('numeric Jump primes safe navigation before Conversation API resolution completes', async () => {
  for (const requested of ['0', '174', '-1', '-2']) {
    const order = [];
    let resolveFetch = null;
    const fetchPromise = new Promise(resolve => { resolveFetch = resolve; });
    const context = vm.createContext({
      exportInProgress: false,
      testInProgress: false,
      jumpInProgress: false,
      window: { prompt: () => requested },
      currentConversationId: () => 'conversation-id',
      assert: (condition, message) => {
        if (!condition) throw new Error(message);
      },
      updateUi() {},
      setStatus() {},
      boundedDiagnosticText: value => String(value),
      errorMessage: error => error instanceof Error ? error.message : String(error),
      logDiagnostic() {},
      primeNumericJumpMaterialization: value => { order.push(`prime:${value}`); },
      fetchConversationPages: async () => {
        order.push('fetch-start');
        return fetchPromise;
      },
      conversationSpineFromPages: () => ({ records: [] }),
      resolveJumpIdentifier: () => ({
        uap_index: Number(requested) >= 0 ? Number(requested) : 3,
        role: 'user',
        message_id: 'target-message'
      }),
      jumpToResolvedTarget: async () => { order.push('resolved-jump'); }
    });
    vm.runInContext(productionFunctionSource('runJump'), context);

    const operation = context.runJump();
    await Promise.resolve();

    assert.equal(order[0], `prime:${Number(requested)}`,
      `Numeric Jump ${requested} did not prime navigation before API resolution.`);
    assert.equal(order[1], 'fetch-start',
      `Numeric Jump ${requested} did not start API resolution after priming navigation.`);

    resolveFetch({ pages: [] });
    await operation;
    assert.equal(order.at(-1), 'resolved-jump');
  }
});
'''
test_text = test_text[:start] + new_test

test_path.write_text(test_text, encoding='utf-8')
