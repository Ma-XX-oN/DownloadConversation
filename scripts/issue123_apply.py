from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'chatgpt-conversation-markdown-export.user.js'
DESIGN = ROOT / 'DESIGN.md'
SNAPSHOT_TEST = ROOT / 'tests' / 'export-single-snapshot.test.mjs'


def replace_once(path: Path, old: str, new: str) -> None:
  text = path.read_text(encoding='utf-8')
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{path}: expected one replacement anchor, found {count}')
  path.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(SOURCE, '// @version      0.6.177', '// @version      0.6.178')

replace_once(
  SOURCE,
  "  const DIAGNOSTIC_PERSIST_DELAY_MS = 1000;\n",
  "  const DIAGNOSTIC_PERSIST_DELAY_MS = 1000;\n"
  "  /** Maximum number of legitimate forward tail markers retained for export consistency checks. */\n"
  "  const LIVE_TAIL_MARKER_LIMIT = 10;\n"
  "  /** Maximum normalized visible characters retained per live tail marker for bounded comparison. */\n"
  "  const LIVE_TAIL_TEXT_LIMIT = 8192;\n"
)

replace_once(
  SOURCE,
  "  /** Element to refocus after the active recorder modal closes. */\n  let lastModalOpener = null;\n",
  "  /** Element to refocus after the active recorder modal closes. */\n"
  "  let lastModalOpener = null;\n"
  "  /** Conversation id whose live high-water tail is currently retained. */\n"
  "  let liveTailConversationId = null;\n"
  "  /** Newest legitimate forward-progression markers retained as a bounded high-water history. */\n"
  "  let liveTailMarkers = [];\n"
  "  /** Whether current materialization is historical navigation and therefore cannot advance the high-water tail. */\n"
  "  let liveTailHistoricalNavigation = false;\n"
  "  /** Whether an explicit prompt submission currently authorizes User then Assistant tail advancement. */\n"
  "  let liveTailPromptAdvancePending = false;\n"
  "  /** Guards live-tail DOM/event tracking so observers are installed only once. */\n"
  "  let liveTailTrackingInstalled = false;\n"
  "  /** Coalesces high-volume DOM mutations into one live-tail scan per task. */\n"
  "  let liveTailScanScheduled = false;\n"
  "  /** Last observed conversation-scroll position used only to detect upward historical navigation. */\n"
  "  let liveTailLastScrollTop = null;\n"
)

block = r'''
  // BEGIN Issue #123 live-tail consistency
  /**
   * Normalizes visible text for bounded live/API tail comparison without changing export content.
   *
   * @param {Object} value - Text-like value to normalize.
   * @returns {string} Whitespace-normalized comparison text.
   */
  function normalizeLiveTailText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Produces a compact deterministic fingerprint for diagnostics-only live-tail evidence.
   *
   * @param {string} text - Normalized text to fingerprint.
   * @returns {string} Eight-character hexadecimal FNV-1a fingerprint.
   */
  function liveTailFingerprint(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * Resets live-tail state when entering a different conversation or starting a fresh tracking lifetime.
   *
   * @param {string|null} conversationId - Conversation identity associated with the new tracking state.
   * @returns {void} No value is returned.
   */
  function resetLiveTailTrackingState(conversationId = null) {
    liveTailConversationId = conversationId;
    liveTailMarkers = [];
    liveTailHistoricalNavigation = false;
    liveTailPromptAdvancePending = false;
    liveTailLastScrollTop = null;
  }

  /**
   * Tests whether two live-tail markers describe the same mounted/source message identity.
   *
   * @param {Object|null} left - First marker.
   * @param {Object|null} right - Second marker.
   * @returns {boolean} True when a stable message or DOM turn identity matches.
   */
  function liveTailMarkerIdentityMatches(left, right) {
    if (!left || !right) return false;
    if (left.message_id && right.message_id && left.message_id === right.message_id) return true;
    return Boolean(left.dom_turn_id && right.dom_turn_id && left.dom_turn_id === right.dom_turn_id);
  }

  /**
   * Captures one mounted User/Assistant section as independent DOM/source identity evidence.
   *
   * @param {Element} section - Mounted `section[data-turn-id]` element.
   * @returns {Object|null} Bounded live-tail marker, or null for unsupported sections.
   */
  function liveTailSectionMarker(section) {
    if (!(section instanceof Element)) return null;
    const role = section.getAttribute('data-turn');
    if (role !== 'user' && role !== 'assistant') return null;
    const messageNodes = [...section.querySelectorAll('[data-message-id]')];
    const message = messageNodes.at(-1) ?? null;
    const domTurnId = section.getAttribute('data-turn-id') || null;
    const messageId = message?.getAttribute('data-message-id') || null;
    if (!domTurnId && !messageId) return null;
    const container = section.closest('[data-turn-id-container]');
    const normalized = normalizeLiveTailText((message ?? section).textContent || '');
    return {
      role,
      message_id: messageId,
      dom_turn_id: domTurnId,
      container_id: container?.getAttribute('data-turn-id-container') || null,
      comparison_text: normalized.slice(0, LIVE_TAIL_TEXT_LIMIT),
      content_length: normalized.length,
      content_fingerprint: liveTailFingerprint(normalized),
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
   * Scans the mounted virtual window and advances the retained tail only when navigation state permits it.
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
    const scrollRoot = conversationScrollRoot();
    const atBottom = liveTailAtPhysicalBottom(scrollRoot);
    const highWater = liveTailMarkers.at(-1) ?? null;
    const highWaterMounted = highWater
      ? mounted.some(marker => liveTailMarkerIdentityMatches(marker, highWater))
      : false;
    if (liveTailHistoricalNavigation && atBottom && highWaterMounted) {
      liveTailHistoricalNavigation = false;
      logDiagnostic('debug', 'conversation-live-tail-high-water-reencountered', {
        reason,
        newest_message_id: highWater?.message_id ?? null,
        newest_dom_turn_id: highWater?.dom_turn_id ?? null
      });
    }
    const newestMounted = mounted.at(-1);
    const allowAdvance = liveTailPromptAdvancePending ||
      (!liveTailHistoricalNavigation && atBottom);
    const before = liveTailMarkers.at(-1) ?? null;
    const changed = recordLiveTailMarker(newestMounted, allowAdvance);
    const after = liveTailMarkers.at(-1) ?? null;
    const advanced = changed && !liveTailMarkerIdentityMatches(before, after);
    if (advanced) {
      logDiagnostic('debug', 'conversation-live-tail-advanced', {
        reason,
        marker_count: liveTailMarkers.length,
        role: after.role,
        message_id: after.message_id,
        dom_turn_id: after.dom_turn_id,
        container_id: after.container_id,
        content_length: after.content_length,
        content_fingerprint: after.content_fingerprint
      });
    }
    if (liveTailPromptAdvancePending && advanced && after?.role === 'assistant') {
      liveTailPromptAdvancePending = false;
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
    const scrollRoot = conversationScrollRoot();
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
   *
   * @param {Event|Object} event - Submit event.
   * @returns {void} No value is returned.
   */
  function handleLiveTailSubmit(event) {
    const form = event.target instanceof Element ? event.target : null;
    if (form?.querySelector?.('#prompt-textarea')) markLiveTailPromptSubmission();
  }

  /**
   * Handles Enter in the ChatGPT prompt editor when it represents a send rather than a newline.
   *
   * @param {KeyboardEvent|Object} event - Keyboard event.
   * @returns {void} No value is returned.
   */
  function handleLiveTailPromptKeydown(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest?.('#prompt-textarea')) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) markLiveTailPromptSubmission();
  }

  /**
   * Installs the passive bounded high-water tracker used only for export consistency evidence.
   *
   * @returns {void} No value is returned.
   */
  function installLiveTailTracking() {
    if (liveTailTrackingInstalled) return;
    liveTailTrackingInstalled = true;
    document.addEventListener('scroll', handleLiveTailScroll, true);
    document.addEventListener('click', handleLiveTailClick, true);
    document.addEventListener('submit', handleLiveTailSubmit, true);
    document.addEventListener('keydown', handleLiveTailPromptKeydown, true);
    const observer = new MutationObserver(() => scheduleLiveTailScan('mutation'));
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scheduleLiveTailScan('install');
  }

  /**
   * Freezes the currently retained live high-water history for one export operation.
   *
   * @returns {Array<Object>} Independent marker copies ordered oldest to newest.
   */
  function snapshotLiveTailMarkers() {
    return liveTailMarkers.map(marker => ({ ...marker }));
  }

  /**
   * Extracts provider text suitable only for detecting a materially older/incomplete representation of the same message.
   *
   * @param {Object} message - Raw Conversation API message.
   * @returns {string} Normalized visible comparison text, or an empty string when the record is not a visible User/final-Assistant candidate.
   */
  function liveTailVisibleApiText(message) {
    if (!message || message?.metadata?.is_visually_hidden_from_conversation === true) return '';
    const role = message?.author?.role;
    if (role !== 'user' && role !== 'assistant') return '';
    const type = message?.content?.content_type;
    if (type !== 'text' && type !== 'multimodal_text') return '';
    if (role === 'assistant' && message?.channel && message.channel !== 'final' && message?.end_turn !== true) return '';
    const texts = [];
    for (const part of Array.isArray(message?.content?.parts) ? message.content.parts : []) {
      if (typeof part === 'string') texts.push(part);
      else if (part && typeof part === 'object') {
        for (const key of ['text', 'content']) {
          if (typeof part[key] === 'string') texts.push(part[key]);
        }
      }
    }
    return normalizeLiveTailText(texts.join(' '));
  }

  /**
   * Finds the source record corresponding to one live marker without assuming DOM turn/container ids equal API ids.
   *
   * @param {Object} marker - Frozen live-tail marker.
   * @param {Object} spine - Authoritative Conversation API spine.
   * @returns {Object|null} Matching source record and match basis, or null when absent.
   */
  function liveTailFindRecordForMarker(marker, spine) {
    const ids = [
      ['message_id', marker?.message_id],
      ['dom_turn_id', marker?.dom_turn_id]
    ].filter(([, value], index, all) => value && all.findIndex(([, other]) => other === value) === index);
    for (const [basis, id] of ids) {
      const record = (spine?.records ?? []).find(item => item?.message_id === id);
      if (record && liveTailVisibleApiText(record.message)) return { record, basis };
    }
    return null;
  }

  /**
   * Compares frozen live high-water markers with the single authoritative Conversation API snapshot.
   *
   * @param {Array<Object>} markers - Frozen live-tail markers.
   * @param {Object} spine - Authoritative Conversation API spine.
   * @returns {Object} Safe diagnostic counts/identities; raw user text is never returned.
   */
  function compareLiveTailMarkersToSpine(markers, spine) {
    const visibleRecords = (spine?.records ?? []).filter(item => Boolean(liveTailVisibleApiText(item?.message)));
    const comparisons = [];
    let stalePrefixCount = 0;
    let roleMismatchCount = 0;
    for (const marker of markers ?? []) {
      const found = liveTailFindRecordForMarker(marker, spine);
      if (!found) {
        comparisons.push({ matched: false, message_id: marker?.message_id ?? null, dom_turn_id: marker?.dom_turn_id ?? null });
        continue;
      }
      const apiText = liveTailVisibleApiText(found.record.message);
      const liveText = normalizeLiveTailText(marker?.comparison_text ?? '');
      const roleMismatch = Boolean(marker?.role && found.record.role && marker.role !== found.record.role);
      if (roleMismatch) roleMismatchCount += 1;
      const stalePrefix = found.basis === 'message_id' && apiText.length >= 8 &&
        liveText.length >= apiText.length + 12 && liveText.startsWith(apiText);
      if (stalePrefix) stalePrefixCount += 1;
      comparisons.push({
        matched: true,
        message_id: marker?.message_id ?? null,
        dom_turn_id: marker?.dom_turn_id ?? null,
        matched_source_id: found.record.message_id,
        match_basis: found.basis,
        role_mismatch: roleMismatch,
        stale_prefix: stalePrefix,
        live_content_length: Number(marker?.content_length) || liveText.length,
        api_content_length: apiText.length,
        api_record_ordinal: found.record.ordinal
      });
    }
    const matchedCount = comparisons.filter(item => item.matched).length;
    let missingSuffixCount = 0;
    for (let index = comparisons.length - 1; index >= 0 && !comparisons[index].matched; index -= 1) missingSuffixCount += 1;
    const newestMarker = markers?.at?.(-1) ?? null;
    const newestComparison = comparisons.at(-1) ?? null;
    const newestApiVisibleId = visibleRecords.at(-1)?.message_id ?? null;
    const newestConsistent = Boolean(newestMarker && newestComparison?.matched &&
      newestComparison.matched_source_id === newestApiVisibleId &&
      !newestComparison.role_mismatch && !newestComparison.stale_prefix);
    const warning = comparisons.length > 0 && (
      matchedCount !== comparisons.length || stalePrefixCount > 0 || roleMismatchCount > 0 || !newestConsistent
    );
    return {
      marker_count: comparisons.length,
      matched_count: matchedCount,
      missing_count: comparisons.length - matchedCount,
      missing_suffix_count: missingSuffixCount,
      stale_prefix_count: stalePrefixCount,
      role_mismatch_count: roleMismatchCount,
      newest_live_message_id: newestMarker?.message_id ?? null,
      newest_live_dom_turn_id: newestMarker?.dom_turn_id ?? null,
      newest_api_visible_id: newestApiVisibleId,
      newest_consistent: newestConsistent,
      warning,
      comparisons
    };
  }

  /**
   * Compares the authoritative API source records against the generated JSONL to detect serialization loss/mutation.
   *
   * @param {Array<Object>} markers - Frozen live-tail markers.
   * @param {Object} spine - Authoritative Conversation API spine.
   * @param {string} jsonl - Generated JSONL text.
   * @returns {Object} Safe serialization-consistency summary.
   */
  function compareLiveTailMarkersToJsonl(markers, spine, jsonl) {
    const parsed = [];
    for (const line of String(jsonl ?? '').split('\n')) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line);
        if (value?.record_type !== 'chatgpt_conversation_metadata') parsed.push(value);
      } catch {
        return { marker_count: markers?.length ?? 0, matched_count: 0, missing_from_jsonl_count: markers?.length ?? 0, changed_count: 0, newest_jsonl_visible_id: null, warning: true, parse_error: true };
      }
    }
    const jsonlById = new Map(parsed.filter(item => typeof item?.id === 'string').map(item => [item.id, item]));
    let matchedCount = 0;
    let missingCount = 0;
    let changedCount = 0;
    for (const marker of markers ?? []) {
      const found = liveTailFindRecordForMarker(marker, spine);
      if (!found) continue;
      const serialized = jsonlById.get(found.record.message_id);
      if (!serialized) {
        missingCount += 1;
        continue;
      }
      matchedCount += 1;
      if (JSON.stringify(serialized) !== JSON.stringify(found.record.message)) changedCount += 1;
    }
    const newestJsonlVisible = parsed.filter(message => Boolean(liveTailVisibleApiText(message))).at(-1)?.id ?? null;
    const newestApiVisible = (spine?.records ?? []).filter(item => Boolean(liveTailVisibleApiText(item?.message))).at(-1)?.message_id ?? null;
    const warning = missingCount > 0 || changedCount > 0 || newestJsonlVisible !== newestApiVisible;
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
    return `live/API matched ${result.matched_count}/${result.marker_count}; missing ${result.missing_count}` +
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
'''

replace_once(
  SOURCE,
  "\n  /**\n   * Waits for for jump target.",
  block + "\n  /**\n   * Waits for for jump target."
)

replace_once(
  SOURCE,
  "    assert(conversationId, 'Current page is not a ChatGPT conversation.');\n    logDiagnostic('debug', 'conversation-jump-request', {",
  "    assert(conversationId, 'Current page is not a ChatGPT conversation.');\n"
  "    markLiveTailHistoricalNavigation('downloadconversation-jump');\n"
  "    logDiagnostic('debug', 'conversation-jump-request', {"
)

replace_once(
  SOURCE,
  "    let activeKind = requestedKinds[0];\n    const conversationId = currentConversationId();\n    assert(conversationId, 'Current page is not a ChatGPT conversation.');\n    exportInProgress = true;",
  "    let activeKind = requestedKinds[0];\n"
  "    const conversationId = currentConversationId();\n"
  "    assert(conversationId, 'Current page is not a ChatGPT conversation.');\n"
  "    scanLiveTailMarkers('export-freeze');\n"
  "    /** Frozen high-water evidence for this export; later UI activity cannot change its oracle. */\n"
  "    const frozenLiveTailMarkers = snapshotLiveTailMarkers();\n"
  "    /** Tail-consistency warnings accumulated without changing the authoritative export source. */\n"
  "    const tailConsistencyWarnings = [];\n"
  "    exportInProgress = true;"
)

replace_once(
  SOURCE,
  "      const spine = conversationSpineFromPages(fetched.pages);\n      if (requestedKinds.includes('jsonl')) {",
  "      const spine = conversationSpineFromPages(fetched.pages);\n"
  "      const liveApiTailComparison = compareLiveTailMarkersToSpine(frozenLiveTailMarkers, spine);\n"
  "      logDiagnostic(liveApiTailComparison.warning ? 'warnings' : 'debug',\n"
  "        'conversation-tail-live-api-consistency', liveApiTailComparison);\n"
  "      const liveApiWarning = liveApiTailWarningText(liveApiTailComparison);\n"
  "      if (liveApiWarning) tailConsistencyWarnings.push(liveApiWarning);\n"
  "      if (requestedKinds.includes('jsonl')) {"
)

replace_once(
  SOURCE,
  "        const filename = `${sanitizeFileName(conversationTitle())}.jsonl`;\n        downloadBlob(\n          new Blob([apiRecordsJsonl(spine)], { type: 'application/x-ndjson;charset=utf-8' }),\n          filename\n        );\n        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);",
  "        const filename = `${sanitizeFileName(conversationTitle())}.jsonl`;\n"
  "        const jsonl = apiRecordsJsonl(spine, conversationId);\n"
  "        const jsonlTailComparison = compareLiveTailMarkersToJsonl(frozenLiveTailMarkers, spine, jsonl);\n"
  "        logDiagnostic(jsonlTailComparison.warning ? 'warnings' : 'debug',\n"
  "          'conversation-tail-api-jsonl-consistency', jsonlTailComparison);\n"
  "        const jsonlWarning = jsonlTailWarningText(jsonlTailComparison);\n"
  "        if (jsonlWarning) tailConsistencyWarnings.push(jsonlWarning);\n"
  "        downloadBlob(\n"
  "          new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' }),\n"
  "          filename\n"
  "        );\n"
  "        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);"
)

replace_once(
  SOURCE,
  "        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);\n      }\n    } catch (error) {",
  "        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);\n"
  "      }\n"
  "      if (tailConsistencyWarnings.length) {\n"
  "        setStatus(`⚠ Export completed with tail consistency warning: ${tailConsistencyWarnings.join(' | ')}`);\n"
  "      }\n"
  "    } catch (error) {"
)

replace_once(
  SOURCE,
  "  installNetworkCapture();\n  bootstrapUi();",
  "  installLiveTailTracking();\n  installNetworkCapture();\n  bootstrapUi();"
)

replace_once(
  SNAPSHOT_TEST,
  "    jumpInProgress: false,\n    exportKind: null,",
  "    jumpInProgress: false,\n"
  "    exportKind: null,\n"
  "    scanLiveTailMarkers() {},\n"
  "    snapshotLiveTailMarkers() { return []; },\n"
  "    compareLiveTailMarkersToSpine() {\n"
  "      return { marker_count: 0, matched_count: 0, missing_count: 0, missing_suffix_count: 0, stale_prefix_count: 0, role_mismatch_count: 0, warning: false };\n"
  "    },\n"
  "    compareLiveTailMarkersToJsonl() {\n"
  "      return { marker_count: 0, matched_count: 0, missing_from_jsonl_count: 0, changed_count: 0, warning: false };\n"
  "    },\n"
  "    liveApiTailWarningText() { return ''; },\n"
  "    jsonlTailWarningText() { return ''; },"
)

section = r'''

## Live/API/JSONL tail consistency

DownloadConversation retains a bounded monotonic history of the ten newest User/Assistant turns that the stock ChatGPT UI has legitimately exposed through forward conversation progression. The retained high-water history distinguishes the nested message identity, mounted `section[data-turn-id]` identity, and persistent container identity rather than assuming those values are interchangeable.

Historical navigation is not forward evidence. Scrolling upward, using ChatGPT's prompt index, invoking DownloadConversation Jump, or virtualized remounting must not advance the retained newest turn. After historical navigation, ordinary DOM discovery becomes eligible to advance the high-water mark only after the previous high-water turn is re-encountered at the current bottom boundary. An explicit new User prompt independently authorizes the following User/Assistant progression.

At the start of Extract, the current ten-marker history is frozen for that operation. The existing single-snapshot invariant remains unchanged: DownloadConversation acquires the Conversation API once and all selected formats consume that same authoritative spine. The frozen live markers are compared with that spine, and generated JSONL is then compared with the exact source records from the same spine. Missing newest suffixes, same-ID materially shorter API content, identity/role disagreement, or JSONL loss/mutation are reported as consistency warnings with bounded identity/count evidence.

These checks are observational. A mismatch does not reload ChatGPT, merge DOM content into the export, issue a second acquisition, or select a fallback source. Source-selection changes require separate evidence and approval. The consistency classifications are intended both to expose stale API snapshots and to help localize final-response loss such as issue #116 to live UI → API acquisition versus API → serialization.
'''

design = DESIGN.read_text(encoding='utf-8')
if '## Live/API/JSONL tail consistency' in design:
  raise RuntimeError('DESIGN.md already contains Issue #123 section')
DESIGN.write_text(design.rstrip() + section + '\n', encoding='utf-8')
