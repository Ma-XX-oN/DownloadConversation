from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'chatgpt-conversation-markdown-export.user.js'
DESIGN = ROOT / 'DESIGN.md'
TAIL_TEST = ROOT / 'tests' / 'tail-consistency.test.mjs'


def replace_once(path: Path, old: str, new: str) -> None:
  text = path.read_text(encoding='utf-8')
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{path}: expected one replacement anchor, found {count}')
  path.write_text(text.replace(old, new, 1), encoding='utf-8')


def regex_once(path: Path, pattern: str, replacement: str) -> None:
  text = path.read_text(encoding='utf-8')
  changed, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
  if count != 1:
    raise RuntimeError(f'{path}: expected one regex replacement, found {count}')
  path.write_text(changed, encoding='utf-8')


replace_once(
  SOURCE,
  "  /** Last observed conversation-scroll position used only to detect upward historical navigation. */\n"
  "  let liveTailLastScrollTop = null;\n",
  "  /** Last observed conversation-scroll position used only to detect upward historical navigation. */\n"
  "  let liveTailLastScrollTop = null;\n"
  "  /** Thread element currently carrying mounted virtual-window conversation turns. */\n"
  "  let liveTailObservedThread = null;\n"
  "  /** Mutation observer scoped to the current conversation thread. */\n"
  "  let liveTailThreadObserver = null;\n"
  "  /** Lightweight root observer used only to detect host replacement of the conversation thread. */\n"
  "  let liveTailRootObserver = null;\n"
  "  /** Scroll root currently supplying direction evidence for live-tail tracking. */\n"
  "  let liveTailObservedScrollRoot = null;\n"
)

replace_once(
  SOURCE,
  "    const container = section.closest('[data-turn-id-container]');\n"
  "    const normalized = normalizeLiveTailText((message ?? section).textContent || '');\n"
  "    return {\n"
  "      role,\n"
  "      message_id: messageId,\n"
  "      dom_turn_id: domTurnId,\n"
  "      container_id: container?.getAttribute('data-turn-id-container') || null,\n"
  "      comparison_text: normalized.slice(0, LIVE_TAIL_TEXT_LIMIT),\n"
  "      content_length: normalized.length,\n"
  "      content_fingerprint: liveTailFingerprint(normalized),",
  "    const normalized = normalizeLiveTailText((message ?? section).textContent || '');\n"
  "    /** Bounded visible text retained for comparison/fingerprinting; full normalized length remains diagnostic metadata. */\n"
  "    const comparisonText = normalized.slice(0, LIVE_TAIL_TEXT_LIMIT);\n"
  "    return {\n"
  "      role,\n"
  "      message_id: messageId,\n"
  "      dom_turn_id: domTurnId,\n"
  "      container_id: section.getAttribute('data-testid') || null,\n"
  "      comparison_text: comparisonText,\n"
  "      content_length: normalized.length,\n"
  "      content_fingerprint: liveTailFingerprint(comparisonText),"
)

replace_once(
  SOURCE,
  "    if (liveTailMarkerIdentityMatches(newest, marker)) {\n"
  "      liveTailMarkers[liveTailMarkers.length - 1] = { ...newest, ...marker };\n"
  "      return true;\n"
  "    }\n"
  "    if (!allowAdvance) return false;",
  "    if (liveTailMarkerIdentityMatches(newest, marker)) {\n"
  "      liveTailMarkers[liveTailMarkers.length - 1] = { ...newest, ...marker };\n"
  "      return true;\n"
  "    }\n"
  "    if (liveTailMarkers.some(existing => liveTailMarkerIdentityMatches(existing, marker))) return false;\n"
  "    if (!allowAdvance) return false;"
)

helper_and_scan = r'''  /**
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
    applyMountedLiveTailMarkers(mounted, liveTailAtPhysicalBottom(scrollRoot), reason);
  }

  /**
   * Coalesces'''

regex_once(
  SOURCE,
  r"  /\*\*\n   \* Scans the mounted virtual window.*?\n  /\*\*\n   \* Coalesces",
  helper_and_scan
)

replace_once(
  SOURCE,
  "  function handleLiveTailScroll() {\n"
  "    const scrollRoot = conversationScrollRoot();\n",
  "  function handleLiveTailScroll() {\n"
  "    const scrollRoot = liveTailObservedScrollRoot || conversationScrollRoot();\n"
)

bind_and_install = r'''  /**
   * Binds live-tail mutation and scroll observation to the current stock conversation thread.
   *
   * @returns {void} No value is returned.
   */
  function bindLiveTailThread() {
    const thread = document.querySelector('#thread');
    if (thread === liveTailObservedThread) return;
    liveTailThreadObserver?.disconnect();
    liveTailThreadObserver = null;
    liveTailObservedScrollRoot?.removeEventListener?.('scroll', handleLiveTailScroll);
    liveTailObservedThread = thread;
    liveTailObservedScrollRoot = null;
    liveTailLastScrollTop = null;
    if (!(thread instanceof Element)) return;
    liveTailObservedScrollRoot = conversationScrollRoot();
    liveTailLastScrollTop = Number(liveTailObservedScrollRoot?.scrollTop) || 0;
    liveTailObservedScrollRoot?.addEventListener?.('scroll', handleLiveTailScroll, { passive: true });
    liveTailThreadObserver = new MutationObserver(() => scheduleLiveTailScan('thread-mutation'));
    liveTailThreadObserver.observe(thread, { childList: true, subtree: true, characterData: true });
    scheduleLiveTailScan('thread-bound');
  }

  /**
   * Installs the passive bounded high-water tracker used only for export consistency evidence.
   *
   * @returns {void} No value is returned.
   */
  function installLiveTailTracking() {
    if (liveTailTrackingInstalled) return;
    liveTailTrackingInstalled = true;
    document.addEventListener('click', handleLiveTailClick, true);
    document.addEventListener('submit', handleLiveTailSubmit, true);
    document.addEventListener('keydown', handleLiveTailPromptKeydown, true);
    liveTailRootObserver = new MutationObserver(() => {
      if (document.querySelector('#thread') !== liveTailObservedThread) bindLiveTailThread();
    });
    if (document.documentElement) {
      liveTailRootObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    bindLiveTailThread();
  }'''

regex_once(
  SOURCE,
  r"  /\*\*\n   \* Installs the passive bounded high-water tracker.*?\n  function installLiveTailTracking\(\) \{.*?\n  \}",
  bind_and_install
)

find_record = r'''  /**
   * Finds the API source record corresponding to one live marker by stable nested message identity only.
   *
   * DOM section turn ids and virtual-window ids are retained as independent diagnostics and are never assumed to be provider message ids.
   *
   * @param {Object} marker - Frozen live-tail marker.
   * @param {Object} spine - Authoritative Conversation API spine.
   * @returns {Object|null} Matching source record and match basis, or null when absent.
   */
  function liveTailFindRecordForMarker(marker, spine) {
    const messageId = marker?.message_id;
    if (!messageId) return null;
    const record = (spine?.records ?? []).find(item => item?.message_id === messageId);
    if (!record || !liveTailVisibleApiText(record.message)) return null;
    return { record, basis: 'message_id' };
  }'''

regex_once(
  SOURCE,
  r"  /\*\*\n   \* Finds the source record corresponding to one live marker.*?\n  function liveTailFindRecordForMarker\(marker, spine\) \{.*?\n  \}",
  find_record
)

replace_once(
  SOURCE,
  "      const stalePrefix = found.basis === 'message_id' && apiText.length >= 8 &&\n",
  "      const stalePrefix = found.basis === 'message_id' && apiText.length >= 20 &&\n"
)

replace_once(
  SOURCE,
  "    const warning = comparisons.length > 0 && (\n"
  "      matchedCount !== comparisons.length || stalePrefixCount > 0 || roleMismatchCount > 0 || !newestConsistent\n"
  "    );",
  "    const warning = comparisons.length === 0 ||\n"
  "      matchedCount !== comparisons.length || stalePrefixCount > 0 || roleMismatchCount > 0 || !newestConsistent;"
)

replace_once(
  SOURCE,
  "  function liveApiTailWarningText(result) {\n"
  "    if (!result?.warning) return '';\n"
  "    return `live/API matched ${result.matched_count}/${result.marker_count}; missing ${result.missing_count}` +",
  "  function liveApiTailWarningText(result) {\n"
  "    if (!result?.warning) return '';\n"
  "    if (result.marker_count === 0) return 'live/API freshness could not be verified because no live tail markers were retained';\n"
  "    return `live/API matched ${result.matched_count}/${result.marker_count}; missing ${result.missing_count}` +"
)

replace_once(
  DESIGN,
  "The retained high-water history distinguishes the nested message identity, mounted `section[data-turn-id]` identity, and persistent container identity rather than assuming those values are interchangeable.",
  "The retained high-water history distinguishes the nested `data-message-id` API-correlation identity, mounted `section[data-turn-id]` identity, and section `data-testid` virtual-window identity rather than assuming those values are interchangeable."
)

replace_once(
  TAIL_TEST,
  "  assert.deepEqual(api.markers().map(x => x.message_id), Array.from({ length: 10 }, (_, i) => `m${i + 2}`));",
  "  assert.deepEqual(Array.from(api.markers(), x => x.message_id), Array.from({ length: 10 }, (_, i) => `m${i + 2}`));"
)

replace_once(
  TAIL_TEST,
  "this.__tail={resetLiveTailTrackingState,recordLiveTailMarker,markLiveTailHistoricalNavigation,markLiveTailPromptSubmission,compareLiveTailMarkersToSpine,compareLiveTailMarkersToJsonl,markers:()=>liveTailMarkers.map(x=>({...x})),historical:()=>liveTailHistoricalNavigation,promptPending:()=>liveTailPromptAdvancePending};",
  "this.__tail={resetLiveTailTrackingState,recordLiveTailMarker,applyMountedLiveTailMarkers,markLiveTailHistoricalNavigation,markLiveTailPromptSubmission,compareLiveTailMarkersToSpine,compareLiveTailMarkersToJsonl,markers:()=>liveTailMarkers.map(x=>({...x})),historical:()=>liveTailHistoricalNavigation,promptPending:()=>liveTailPromptAdvancePending};"
)

new_tests = r'''

test('mounted bottom observation seeds the newest ten and historical navigation resumes only after high-water re-encounter', () => {
  const api = harness();
  api.resetLiveTailTrackingState('conversation-1');
  api.applyMountedLiveTailMarkers(Array.from({ length: 12 }, (_, i) => marker(i)), true, 'initial-bottom');
  assert.deepEqual(Array.from(api.markers(), x => x.message_id), Array.from({ length: 10 }, (_, i) => `m${i + 2}`));
  api.markLiveTailHistoricalNavigation('prompt-index');
  api.applyMountedLiveTailMarkers([marker(4), marker(5), marker(6)], true, 'historical-remount');
  assert.equal(api.markers().at(-1).message_id, 'm11');
  assert.equal(api.historical(), true);
  api.applyMountedLiveTailMarkers([marker(10), marker(11), marker(12), marker(13)], false, 'scroll-down-reencounter');
  assert.equal(api.historical(), false);
  assert.deepEqual(Array.from(api.markers(), x => x.message_id).slice(-3), ['m11', 'm12', 'm13']);
});

test('DOM turn id is diagnostic only and cannot substitute for a missing API message id', () => {
  const api = harness();
  const live = marker(1, { message_id: 'not-in-api', dom_turn_id: 'm1' });
  const result = api.compareLiveTailMarkersToSpine([live], spine([sourceMessage('m1', 'assistant', live.comparison_text)]));
  assert.equal(result.matched_count, 0);
  assert.equal(result.missing_count, 1);
  assert.equal(result.warning, true);
});

test('absence of retained live markers is an explicit freshness warning', () => {
  const api = harness();
  const result = api.compareLiveTailMarkersToSpine([], spine([sourceMessage('m1', 'assistant', 'complete') ]));
  assert.equal(result.marker_count, 0);
  assert.equal(result.warning, true);
});
'''

text = TAIL_TEST.read_text(encoding='utf-8')
anchor = "\ntest('API comparison quantifies missing newest suffix and ignores trailing internal records', () => {"
if text.count(anchor) != 1:
  raise RuntimeError('tail test insertion anchor missing or duplicated')
TAIL_TEST.write_text(text.replace(anchor, new_tests + anchor, 1), encoding='utf-8')

source_text = SOURCE.read_text(encoding='utf-8')
if "container_id: section.getAttribute('data-testid') || null" not in source_text:
  raise RuntimeError('virtual-window data-testid identity correction was not applied')
if "data-turn-id-container" in source_text[source_text.index('// BEGIN Issue #123 live-tail consistency'):source_text.index('// END Issue #123 live-tail consistency')]:
  raise RuntimeError('guessed data-turn-id-container identity remains in Issue #123 production block')
