from pathlib import Path

SOURCE = Path('chatgpt-conversation-markdown-export.user.js')
TEST = Path('tests/jump-materialization.test.mjs')
DESIGN = Path('DESIGN.md')


def replace_region(text, start_marker, end_marker, replacement):
  start = text.index(start_marker)
  end = text.index(end_marker, start)
  return text[:start] + replacement + text[end:]


source = SOURCE.read_text(encoding='utf-8')
old_version = '// @version      1.2.0-issue.75.3'
new_version = '// @version      1.2.0-issue.75.4'
assert source.count(old_version) == 1, 'Expected exactly one .75.3 userscript version.'
source = source.replace(old_version, new_version, 1)

new_function = r'''  /**
   * Progressively materializes a resolved Jump target or its optional stock TOC control.
   *
   * UAP 0 follows ChatGPT's observed stock historical-loading cycle.  Entering the near-top
   * region provokes one older-page request; prepending that page preserves the visual anchor
   * and moves scrollTop forward.  Jump then traverses upward through the near-top region again
   * instead of pinning scrollTop at zero while the stock loader is still re-arming.
   *
   * The timeout is a stall timeout.  Any observed scroll/geometry progress refreshes it so a
   * long conversation is not rejected merely because successful stock pagination needs many
   * historical batches.
   *
   * @param {Object} target - Resolved Jump target containing UAP index, role, and message id.
   * @param {number} timeoutMs - Maximum time without materialization progress, in milliseconds.
   * @returns {Promise<HTMLElement|null>} The matching TOC control, or null when the target materializes directly or traversal stalls.
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
    const seeksOldestBoundary = uapIndex === 0;
    const stableBoundaryObservationLimit = 20;
    let stallDeadline = performance.now() + timeoutMs;
    let stableBoundaryObservations = 0;
    let oldestAnchorCycles = 0;
    let steps = 0;
    let observedScrollTop = Number(scrollRoot.scrollTop) || 0;
    let observedScrollHeight = Number(scrollRoot.scrollHeight) || 0;
    let observedClientHeight = Number(scrollRoot.clientHeight) || 0;

    /**
     * Refreshes the stall deadline when the stock viewport or virtualized extent changed.
     *
     * @param {number} scrollTop - Current conversation scroll offset.
     * @param {number} scrollHeight - Current conversation scroll extent.
     * @param {number} clientHeight - Current conversation viewport height.
     * @returns {boolean} True when observable materialization/traversal progress occurred.
     */
    const recordProgress = (scrollTop, scrollHeight, clientHeight) => {
      const changed =
        Math.abs(scrollTop - observedScrollTop) >= 1 ||
        Math.abs(scrollHeight - observedScrollHeight) >= 1 ||
        Math.abs(clientHeight - observedClientHeight) >= 1;
      if (seeksOldestBoundary &&
          scrollHeight > observedScrollHeight + 1 &&
          scrollTop > observedScrollTop + 1) {
        oldestAnchorCycles += 1;
        logDiagnostic('debug', 'conversation-jump-oldest-prepend-anchor', {
          message_id: target?.message_id ?? null,
          uap_index: uapIndex,
          anchor_cycle: oldestAnchorCycles,
          scroll_top_delta: scrollTop - observedScrollTop,
          scroll_height_delta: scrollHeight - observedScrollHeight,
          scroll_top: scrollTop,
          scroll_height: scrollHeight,
          client_height: clientHeight
        });
      }
      observedScrollTop = scrollTop;
      observedScrollHeight = scrollHeight;
      observedClientHeight = clientHeight;
      if (changed) stallDeadline = performance.now() + timeoutMs;
      return changed;
    };

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
        oldest_anchor_cycles: oldestAnchorCycles,
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
      stall_timeout_ms: timeoutMs,
      stable_boundary_observation_limit: seeksOldestBoundary ? null : stableBoundaryObservationLimit
    });

    if (!seeksOldestBoundary) {
      scrollRoot.scrollTo({ top: 0, behavior: 'auto' });
      await new Promise(resolve => setTimeout(resolve, 100));
      steps += 1;
      recordProgress(scrollRoot.scrollTop, scrollRoot.scrollHeight, scrollRoot.clientHeight);
      section = target?.message_id ? mountedTurnSection(target.message_id, target.role) : null;
      if (section instanceof HTMLElement) return complete('target-mounted-after-top');
      toc = jumpTocIndexControl(uapIndex);
      if (toc instanceof HTMLElement) return complete('toc-found-after-top');
    }

    while (performance.now() < stallDeadline) {
      section = target?.message_id ? mountedTurnSection(target.message_id, target.role) : null;
      if (section instanceof HTMLElement) return complete('target-mounted-before-step');
      toc = jumpTocIndexControl(uapIndex);
      if (toc instanceof HTMLElement) return complete('toc-found-before-step');

      const beforeScrollTop = scrollRoot.scrollTop;
      const beforeScrollHeight = scrollRoot.scrollHeight;
      const beforeClientHeight = scrollRoot.clientHeight;
      recordProgress(beforeScrollTop, beforeScrollHeight, beforeClientHeight);
      const beforeMaxScrollTop = Math.max(0, beforeScrollHeight - beforeClientHeight);
      const atBoundaryBefore = seeksOldestBoundary
        ? beforeScrollTop <= 2
        : beforeScrollTop >= beforeMaxScrollTop - 2;

      if (seeksOldestBoundary) {
        if (!atBoundaryBefore) {
          scrollRoot.scrollBy({
            top: -Math.max(100, Math.floor(scrollRoot.clientHeight * 0.5)),
            behavior: 'auto'
          });
        }
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
      recordProgress(afterScrollTop, afterScrollHeight, afterClientHeight);
      const afterMaxScrollTop = Math.max(0, afterScrollHeight - afterClientHeight);
      const atBoundaryAfter = seeksOldestBoundary
        ? afterScrollTop <= 2
        : afterScrollTop >= afterMaxScrollTop - 2;
      const stableObservation =
        Math.abs(afterScrollTop - beforeScrollTop) < 1 &&
        Math.abs(afterScrollHeight - beforeScrollHeight) < 1 &&
        Math.abs(afterClientHeight - beforeClientHeight) < 1;

      if (!seeksOldestBoundary && atBoundaryAfter && stableObservation) {
        stableBoundaryObservations += 1;
      } else {
        stableBoundaryObservations = 0;
      }

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
          oldest_anchor_cycles: oldestAnchorCycles,
          target_mounted: false,
          target_available: false
        });
      }

      if (!seeksOldestBoundary &&
          stableBoundaryObservations >= stableBoundaryObservationLimit) break;
    }

    section = target?.message_id ? mountedTurnSection(target.message_id, target.role) : null;
    if (section instanceof HTMLElement) return complete('target-mounted-final-check');
    toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return complete('toc-found-final-check');

    scrollRoot.scrollTo({ top: originalScrollTop, behavior: 'auto' });
    return complete(
      performance.now() >= stallDeadline
        ? 'stall-timeout-without-target-or-toc'
        : 'stable-boundary-convergence-without-target-or-toc'
    );
  }

'''
source = replace_region(
  source,
  '  /**\n   * Progressively materializes a resolved Jump target or its optional stock TOC control.',
  '  /**\n   * Materializes and scrolls to one resolved Jump target.',
  new_function
)
SOURCE.write_text(source, encoding='utf-8')

tests = TEST.read_text(encoding='utf-8')
new_test = r'''test('Jump 0 waits for delayed prepend anchoring and then traverses upward through the loading zone again', async () => {
  let prepended = false;
  let postPrependOlderScrolls = 0;
  const harness = makeHarness({
    onScroll({ kind, root, state }) {
      if (!prepended || kind !== 'by') return;
      postPrependOlderScrolls += 1;
      if (root.scrollTop <= 150) state.mounted = true;
    },
    onSettle({ root, state }) {
      if (prepended || state.settleCount !== 80) return;
      root.scrollHeight += 4000;
      root.scrollTop += 4000;
      prepended = true;
    }
  });
  harness.scrollRoot.scrollTop = 0;

  const target = {
    uap_index: 0,
    role: 'user',
    message_id: 'fb3c34bb-46be-475a-bd68-bcb2722a1262',
    spine: { records: [] }
  };

  const section = await harness.context.jumpToResolvedTarget(target);
  assert.equal(section, harness.targetSection);
  assert.equal(prepended, true,
    'The regression must delay prepend materialization beyond the former 60 stable-top observations.');
  assert.ok(harness.state.settleCount >= 80,
    'Oldest traversal must wait at the top instead of declaring fixed-count stable convergence.');
  assert.ok(postPrependOlderScrolls > 0,
    'After prepend anchoring, oldest traversal must produce a fresh older-direction scroll sequence.');
});

'''
tests = replace_region(
  tests,
  "test('Jump 0 re-pins the top after prepend pagination scroll anchoring moves the viewport', async () => {",
  "test('Jump traversal does not treat the first current scroll extent as whole-conversation convergence', async () => {",
  new_test
)
TEST.write_text(tests, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
section_heading = '### Jump historical materialization\n'
assert section_heading not in design, 'Jump historical materialization design section already exists.'
anchor = '### Single-snapshot outputs\n'
assert design.count(anchor) == 1, 'Expected one Single-snapshot outputs design heading.'
new_design = '''### Jump historical materialization

Jump resolves requested User/Assistant identity from the Conversation API, but uses the
stock virtualized DOM only to materialize that already-resolved target.  For the oldest
boundary, stock ChatGPT historical loading is driven by repeated upward traversal into
the near-top loading zone.  When an older page is prepended, scroll anchoring moves the
viewport forward by the inserted extent; Jump waits for that observable geometry change
and then traverses upward through the loading zone again.  It does not continuously pin
`scrollTop` to zero while a page is materializing, because that suppresses the stock
re-arm transition observed during manual loading.

The oldest-boundary traversal uses a stall deadline rather than a fixed total-history
deadline.  Observable scroll or virtualized-extent progress refreshes the deadline so a
long conversation can load multiple stock history batches; absence of progress remains
an explicit failure.  This navigation behavior does not make DOM chronology or text an
export source.

'''
design = design.replace(anchor, new_design + anchor, 1)
DESIGN.write_text(design, encoding='utf-8')
