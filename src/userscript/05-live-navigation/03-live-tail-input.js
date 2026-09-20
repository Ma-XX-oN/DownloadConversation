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
      const verifiable = Boolean(marker?.message_id);
      if (!verifiable) {
        comparisons.push({
          matched: false,
          verifiable: false,
          message_id: null,
          dom_turn_id: marker?.dom_turn_id ?? null
        });
        continue;
      }
      const found = liveTailFindRecordForMarker(marker, spine);
      if (!found) {
        comparisons.push({
          matched: false,
          verifiable: true,
          message_id: marker?.message_id ?? null,
          dom_turn_id: marker?.dom_turn_id ?? null
        });
        continue;
      }
      const apiText = liveTailVisibleApiText(found.record.message);
      const liveText = normalizeLiveTailText(marker?.comparison_text ?? '');
      const roleMismatch = Boolean(marker?.role && found.record.role && marker.role !== found.record.role);
      if (roleMismatch) roleMismatchCount += 1;
      const stalePrefix = marker?.role !== 'user' && found.record.role !== 'user' &&
        found.basis === 'message_id' && apiText.length >= 20 &&
        liveText.length >= apiText.length + 12 && liveText.startsWith(apiText);
      if (stalePrefix) stalePrefixCount += 1;
      comparisons.push({
        matched: true,
        verifiable: true,
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
    const verifiableCount = comparisons.filter(item => item.verifiable).length;
    const unverifiableCount = comparisons.length - verifiableCount;
    const matchedCount = comparisons.filter(item => item.matched).length;
    const missingCount = comparisons.filter(item => item.verifiable && !item.matched).length;
    let missingSuffixCount = 0;
    for (let index = comparisons.length - 1; index >= 0; index -= 1) {
      const comparison = comparisons[index];
      if (!comparison.verifiable || comparison.matched) break;
      missingSuffixCount += 1;
    }
    const newestMarker = markers?.at?.(-1) ?? null;
    const newestComparison = comparisons.at(-1) ?? null;
    const newestApiVisibleId = visibleRecords.at(-1)?.message_id ?? null;
    const newestVerifiable = Boolean(newestMarker?.message_id);
    const newestConsistent = Boolean(newestVerifiable && newestComparison?.matched &&
      newestComparison.matched_source_id === newestApiVisibleId &&
      !newestComparison.role_mismatch && !newestComparison.stale_prefix);
    const warning = comparisons.length === 0 ||
      missingCount > 0 || stalePrefixCount > 0 || roleMismatchCount > 0 || !newestConsistent;
    return {
      marker_count: comparisons.length,
      verifiable_count: verifiableCount,
      unverifiable_count: unverifiableCount,
      matched_count: matchedCount,
      missing_count: missingCount,
      missing_suffix_count: missingSuffixCount,
      stale_prefix_count: stalePrefixCount,
      role_mismatch_count: roleMismatchCount,
      newest_live_message_id: newestMarker?.message_id ?? null,
      newest_live_dom_turn_id: newestMarker?.dom_turn_id ?? null,
      newest_api_visible_id: newestApiVisibleId,
      newest_verifiable: newestVerifiable,
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
