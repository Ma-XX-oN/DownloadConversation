   */
  function cgRenderThoughtBlock(items, fileRefIndex = new Map()) {
    const rendered = [];
    for (const record of items) {
      const body = cgRenderThoughtItem(record, fileRefIndex);
      if (body) rendered.push(body);
    }
    return rendered.length ? `<details>\n<summary>Thoughts</summary>\n\n${rendered.join('\n\n')}\n\n</details>` : '';
  }

  // BEGIN AIConversationCore Phase 5 integration
  /**
   * Returns the loaded AIConversationCore browser API after asserting the required adapter and renderer entry points are available.
   *
   * @returns {boolean} `true` when `canonicalCore` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalCore() {
    const core = globalThis.AIConversationCore;
    assert(core && typeof core === 'object', 'AIConversationCore browser bundle is not loaded.');
    assert(typeof core.getVersion === 'function', 'AIConversationCore version API is unavailable.');
    assert(typeof core.adaptChatGPTRecords === 'function', 'AIConversationCore ChatGPT adapter is unavailable.');
    assert(typeof core.renderCanonicalMarkdown === 'function', 'AIConversationCore Markdown renderer is unavailable.');
    return core;
  }

  /**
   * Converts DownloadConversation recovery Markdown for one image into canonical image-resource state.
   *
   * Source -> canonical transformation: recovered data-image Markdown becomes `status: available` plus `data_url`; missing/unavailable placeholders become the corresponding canonical status and optional source pointer.
   *
   * @param {string} markdown - The Markdown text to process.
   * @returns {Object|null} The value produced by `canonicalRecoveredImageState`, or `null` when no value is available.
   */
  function canonicalRecoveredImageState(markdown) {
    const value = String(markdown ?? '').trim();
    if (!value) return null;
    if (value === '[image missing]') return { status: 'missing' };
    const data = value.match(/^!\[[^\]]*\]\((data:image\/[^)]+)\)$/s);
    if (data) return { status: 'available', data_url: data[1] };
    if (value === '[image not available]') return { status: 'unavailable' };
    const unavailable = value.match(/^\[image not available\]\((.*)\)$/s);
    if (unavailable) return { status: 'unavailable', source_pointer: unavailable[1] };
    return null;
  }

  /**
   * Enriches canonical conversation-image resources with host-recovered image state without changing canonical event order.
   *
   * Source -> canonical transformation: the already-normalized image resource remains the identity-bearing object; recovery Markdown contributes only availability/data/source-pointer fields at the matching source image ordinal.
   *
   * @param {Event|Object} event - The event or event-like object being handled.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {Object} The Object value produced by `canonicalEnrichRecoveredImages`.
   */
  function canonicalEnrichRecoveredImages(event, recoveredImages = []) {
    if (!event || !Array.isArray(recoveredImages) || !recoveredImages.length) return event;
    // Advances only across canonical conversation-image resources to preserve source ordinals.
    let imageIndex = 0;
    /**
     * Handles resources.
     */
    const resources = (event.resources ?? []).map(resource => {
      if (resource?.type !== 'image' || resource?.resource_kind !== 'conversation_image') return resource;
      const recovered = canonicalRecoveredImageState(recoveredImages[imageIndex]);
      imageIndex += 1;
      if (!recovered) return resource;
      const enriched = { ...resource, ...recovered };
      if (recovered.data_url) enriched.data_url = recovered.data_url;
      if (recovered.source_pointer) enriched.source_pointer = recovered.source_pointer;
      return enriched;
    });
    return { ...event, resources };
  }

  /**
   * Handles canonical events by source record.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @param {Map<unknown, unknown>} recoveredImageMap - The recovered-image lookup keyed by source record.
   * @returns {Map<unknown, unknown>} The lookup map produced by `canonicalEventsBySourceRecord`.
   */
  function canonicalEventsBySourceRecord(records, recoveredImageMap = new Map()) {
    const conversationId = typeof currentConversationId === 'function' ? currentConversationId() : null;
    /**
     * Handles has metadata.
     */
    const hasMetadata = records.some(record => record?.record_type === 'chatgpt_conversation_metadata');
    const adapterRecords = conversationId && !hasMetadata
      ? [{
          record_type: 'chatgpt_conversation_metadata',
          schema_version: 1,
          conversation_id: conversationId
        }, ...records]
      : records;
    const events = canonicalCore().adaptChatGPTRecords(adapterRecords);
    assert(Array.isArray(events), 'AIConversationCore ChatGPT adapter did not return canonical events.');
    // Maps stable source record ids back to their adapted canonical events.
    const bySourceRecord = new Map();
    for (const event of events) {
      const sourceIndex = event?.source_index;
      const sourceRecordId = event?.source_record_id;
      if (!Number.isInteger(sourceIndex) || typeof sourceRecordId !== 'string' || !sourceRecordId) continue;
      const original = adapterRecords[sourceIndex];
      if (!original) continue;
      assert(original?.id === sourceRecordId,
        `AIConversationCore source record mismatch at JSONL index ${sourceIndex}.`);
      assert(event?.source?.record_id === sourceRecordId,
        `AIConversationCore did not preserve source record ID ${sourceRecordId}.`);
      assert(event?.source?.record_index === sourceIndex,
        `AIConversationCore did not preserve source record index ${sourceIndex}.`);
      assert(event?.source?.turn_id === sourceRecordId,
        `AIConversationCore source turn identity differs from record ${sourceRecordId}.`);
      assert(event?.source?.create_time === (original?.create_time ?? null),
        `AIConversationCore did not preserve create_time for ${sourceRecordId}.`);
      assert(event?.source?.update_time === (original?.update_time ?? null),
        `AIConversationCore did not preserve update_time for ${sourceRecordId}.`);
      const enrichedEvent = canonicalEnrichRecoveredImages(
        event, recoveredImageMap.get(sourceRecordId) ?? []);
      bySourceRecord.set(sourceRecordId, enrichedEvent);
    }
    return bySourceRecord;
  }

  /**
   * Handles canonical rendered has unresolved inline tokens.
   *
   * @param {Object} rendered - The rendered value required by this function.
   * @returns {boolean} `true` when the canonical rendered has unresolved inline tokens condition is satisfied; otherwise `false`.
   */
  function canonicalRenderedHasUnresolvedInlineTokens(rendered) {
    return String(rendered ?? '').includes(CG_INLINE_TOKEN_START);
  }

  /**
   * Determines whether one source User/Assistant record and its canonical event can be rendered by the shared canonical Markdown renderer.
   *
   * Source/canonical -> routing transformation: returns only an eligibility decision. It never rewrites the source record or canonical event; unsupported shapes remain on the legacy fallback path.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The event or event-like object being handled.
   * @returns {boolean} `true` when the canonical message record eligible condition is satisfied; otherwise `false`.
   */
  function canonicalMessageRecordEligible(record, event) {
    if (!event || cgIsHidden(record) || event?.visibility === 'hidden') return false;
    const role = record?.author?.role;
    if (!['user', 'assistant'].includes(role)) return false;
    if (role === 'user' && event.kind !== 'message') return false;
    if (role === 'assistant' && !['message', 'commentary'].includes(event.kind)) return false;
    if (!['text', 'multimodal_text'].includes(record?.content?.content_type)) return false;
    if (!(event.blocks ?? []).some(block => block?.type === 'text' || block?.type === 'image')) return false;
    const sourceText = Array.isArray(record?.content?.parts)
      ? record.content.parts.filter(part => typeof part === 'string').join('')
      : '';
    if (role === 'user' && /sandbox:\/\/?/i.test(sourceText)) return false;
    const rendered = canonicalCore().renderCanonicalMarkdown([event]);
    return Boolean(rendered.trim()) && !canonicalRenderedHasUnresolvedInlineTokens(rendered);
  }

  /**
   * Returns the current AIConversationCore heading-presentation policy.
   *
   * DownloadConversation selects visibility only. Timestamp values, JSONL record
   * numbers, and source turn IDs are derived by Core from canonical provenance.
   *
   * @returns {Object} AIConversationCore Markdown projection options.
   */
  function canonicalHeadingOptions() {
    return {
      heading: {
        timestamp: showTimestamps,
        recordNumber: showRecordNumbers,
        turnId: showTurnIds,
        debugProvenance: showDebugProvenance
      }
    };
  }

  /**
   * Renders one eligible canonical message event through AIConversationCore.
   *
   * Source/canonical -> output transformation: DownloadConversation supplies only
   * heading visibility policy. Core derives timestamp, JSONL record number, and
   * provider/source turn identity from canonical source provenance.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The canonical event associated with the source record.
   * @returns {string} Canonical Markdown for the source record.
   */
  function canonicalRecordBlock(record, event) {
    assert(canonicalMessageRecordEligible(record, event),
      `AIConversationCore message record ${record?.id ?? 'unknown'} is not eligible for canonical rendering.`);
    return canonicalCore().renderCanonicalMarkdown([event], canonicalHeadingOptions()).trimEnd();
  }

  /**
   * Determines whether one non-message canonical Assistant activity event is supported by the shared canonical Markdown renderer.
   *
   * Canonical -> routing transformation: reasoning summaries, tool calls, and tool results are eligible; the event payload is not modified.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The event or event-like object being handled.
   * @returns {boolean} `true` when `canonicalThoughtRecordEligible` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalThoughtRecordEligible(record, event) {
    if (!event || cgIsHidden(record) || event?.visibility === 'hidden') return false;
    return ['reasoning_summary', 'tool_call', 'tool_result'].includes(event.kind);
  }

  /**
   * Determines whether an ordered Assistant activity segment can be rendered wholly by AIConversationCore without changing its source association.
   *
   * Source/canonical -> routing transformation: validates semantic event combinations and returns a Boolean; it does not regroup, reorder, or rewrite records.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @param {Array<Object>} events - The canonical events associated with the source records.
   * @returns {boolean} `true` when the canonical assistant segment eligible condition is satisfied; otherwise `false`.
   */
  function canonicalAssistantSegmentEligible(records, events) {
    if (!Array.isArray(records) || !records.length || !Array.isArray(events) || events.length !== records.length) {
      return false;
    }
    // Tracks the one ordinary final Assistant message allowed in a canonical response segment.
    let finalMessageIndex = -1;
    let hasAssistantSource = false;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const event = events[index];
      if (record?.author?.role === 'assistant') hasAssistantSource = true;
      if (canonicalMessageRecordEligible(record, event)) {
        if (record?.author?.role !== 'assistant') return false;
        if (event?.kind === 'commentary') continue;
        if (event?.kind !== 'message' || finalMessageIndex >= 0) return false;
        finalMessageIndex = index;
        continue;
      }
      if (!canonicalThoughtRecordEligible(record, event)) return false;
    }
    if (!hasAssistantSource) return false;
    if (finalMessageIndex >= 0 && finalMessageIndex !== records.length - 1) return false;
    const rendered = canonicalCore().renderCanonicalMarkdown(events);
    // Tool payloads are opaque literal data and may legitimately contain ChatGPT
    // inline-token character sequences. Message/commentary records were already
    // checked individually above, so do not reject the whole segment by scanning
    // rendered tool payload text.
    return Boolean(rendered.trim());
