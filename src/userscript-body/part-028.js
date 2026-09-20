  }

  /**
   * Renders one eligible canonical Assistant activity segment through AIConversationCore.
   *
   * Source/canonical -> output transformation: DownloadConversation preserves the
   * ordered canonical segment and supplies only heading visibility policy. Core owns
   * all semantic heading values for the response and Commentary descendants.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @param {Array<Object>} events - The canonical events associated with the source records.
   * @returns {string} Canonical Markdown for the Assistant segment.
   */
  function canonicalAssistantSegmentBlock(records, events) {
    assert(canonicalAssistantSegmentEligible(records, events),
      'AIConversationCore Assistant segment contains an unsupported record.');
    /** Final ordinary Assistant message retained only for compact diagnostics. */
    const messageRecord = [...records].reverse().find((record, indexFromEnd) => {
      const index = records.length - 1 - indexFromEnd;
      return canonicalMessageRecordEligible(record, events[index]);
    }) ?? null;
    const rendered = canonicalCore().renderCanonicalMarkdown(events, canonicalHeadingOptions()).trimEnd();
    if (diagnosticEnabled('debug')) {
      logDiagnostic('debug', 'canonical-assistant-segment-rendered', {
        source_record_ids: records.map(record => record?.id ?? null),
        final_source_record_id: messageRecord?.id ?? null,
        event_kinds: events.map(event => event?.kind ?? null),
        rendered_length: rendered.length
      });
    }
    return rendered;
  }

  // Compatibility helpers retained for the already-established #93/#97 regressions.
  /**
   * Handles canonical plain record eligible.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {boolean} `true` when `canonicalPlainRecordEligible` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalPlainRecordEligible(record) {
    if (cgIsHidden(record)) return false;
    if (!['user', 'assistant'].includes(record?.author?.role)) return false;
    if (record?.content?.content_type !== 'text') return false;
    const parts = record?.content?.parts;
    if (!Array.isArray(parts) || !parts.length || parts.some(part => typeof part !== 'string')) return false;
    if (!parts.some(part => part.trim())) return false;
    const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    if (Array.isArray(metadata.content_references) && metadata.content_references.length) return false;
    if (Array.isArray(metadata.citations) && metadata.citations.length) return false;
    const text = parts.join('');
    if (text.includes(CG_INLINE_TOKEN_START)) return false;
    if (/sandbox:\/\/?/i.test(text)) return false;
    return true;
  }

  /**
   * Handles canonical plain record block.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The canonical event associated with the source record.
   * @returns {string} Canonical Markdown for the plain record.
   */
  function canonicalPlainRecordBlock(record, event) {
    return canonicalRecordBlock(record, event);
  }

  /**
   * Handles canonical plain assistant segment eligible.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @returns {boolean} `true` when `canonicalPlainAssistantSegmentEligible` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalPlainAssistantSegmentEligible(records) {
    if (!Array.isArray(records) || records.length < 2) return false;
    let hasAssistantMessage = false;
    for (const record of records) {
      if (cgIsHidden(record)) return false;
      if (record?.author?.role !== 'assistant') return false;
      const type = record?.content?.content_type;
      if (type === 'thoughts') continue;
      if (type !== 'text' || !canonicalPlainRecordEligible(record)) return false;
      hasAssistantMessage = true;
    }
    return hasAssistantMessage;
  }

  /**
   * Handles canonical plain assistant segment block.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @param {Array<Object>} events - The canonical events associated with the source records.
   * @returns {boolean} `true` when `canonicalPlainAssistantSegmentBlock` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalPlainAssistantSegmentBlock(records, events) {
    assert(canonicalPlainAssistantSegmentEligible(records),
      'AIConversationCore Assistant segment requires only plain visible Assistant records.');
    return canonicalAssistantSegmentBlock(records, events);
  }
  // END AIConversationCore Phase 5 integration

  /**
   * Returns the Core-rendered heading for a fallback-rendered source record.
   *
   * The fallback body remains host-rendered, but heading metadata is serialized by
   * AIConversationCore from the same canonical event and visibility policy used by
   * canonical bodies. If no canonical event exists, the established plain speaker
   * heading is preserved without inventing metadata.
   *
   * @param {Object} record - The provider/source record whose speaker heading is required.
   * @param {Event|Object|null} event - The canonical event supplying source provenance, when available.
   * @returns {string} Core-rendered transcript heading or the existing plain speaker heading.
   */
  function transcriptHeading(record, event = null) {
    if (event) {
      const rendered = canonicalCore().renderCanonicalMarkdown([event], canonicalHeadingOptions()).trimEnd();
      const lines = rendered.split('\n');
      if (record?.author?.role === 'assistant' && record?.channel === 'commentary') {
        const commentary = lines.find(line => /^### ChatGPT Commentary(?: |$)/.test(line));
        if (commentary) return commentary.replace(/^### /, '## ');
      }
      const topLevel = lines.find(line => /^## (?:User|ChatGPT)(?: |$)/.test(line));
      if (topLevel) return topLevel;
    }
    if (record?.author?.role === 'user') return '## User';
    if (record?.author?.role === 'assistant' && record?.channel === 'commentary') return '## ChatGPT Commentary';
    if (record?.author?.role === 'assistant') return '## ChatGPT';
    return '';
  }

  /**
   * Renders conversation markdown.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @param {Object} onProgress - The callback invoked with progress updates.
   * @param {Map<unknown, unknown>} recoveredImageMap - The recovered-image lookup keyed by source record.
   * @returns {string} The string produced by `renderConversationMarkdown`.
   */
  function renderConversationMarkdown(spine, onProgress, recoveredImageMap = new Map()) {
    assert(Array.isArray(spine?.records), 'Conversation API Markdown export requires spine records.');
    /**
     * Handles records.
     */
    const records = spine.records.map(item => item.message).filter(Boolean);
    const output = [];
    // Fallback citation lookup keyed by ChatGPT retrieval turn/file coordinates.
    const fileRefIndex = cgBuildFileReferenceIndex(records);
    // Canonical-event lookup kept in source-record identity space for order-preserving rendering.
    const canonicalEventBySourceRecord = canonicalEventsBySourceRecord(records, recoveredImageMap);
    // Buffers Assistant reasoning/tool activity until its complete output segment can be rendered.
    let pendingThoughts = [];

    /**
     * Handles flush assistant block.
     *
     * @param {string} body - The body content to render.
     * @param {Object|null} record - The provider/source record to process.
     * @returns {void} No value is returned.
     */
    const flushAssistantBlock = (body = '', record = null) => {
      if (!body && !pendingThoughts.length) return;
      const headingRecord = record ?? pendingThoughts[0];
      const parts = [transcriptHeading(headingRecord, canonicalEventBySourceRecord.get(headingRecord?.id) ?? null)];
      const thoughts = cgRenderThoughtBlock(pendingThoughts, fileRefIndex);
      if (thoughts) parts.push(thoughts);
      if (body) parts.push(quoteMarkdown(body));
      output.push(parts.join('\n\n'));
      pendingThoughts = [];
    };

    /**
     * Handles flush pending assistant.
     *
     * @returns {void} No value is returned.
     */
    const flushPendingAssistant = () => {
      if (!pendingThoughts.length) return;
      const events = pendingThoughts
        .map(record => canonicalEventBySourceRecord.get(record.id) ?? null)
        .filter(Boolean);
      if (events.length === pendingThoughts.length &&
          canonicalAssistantSegmentEligible(pendingThoughts, events)) {
        output.push(canonicalAssistantSegmentBlock(pendingThoughts, events));
        pendingThoughts = [];
        return;
      }
      flushAssistantBlock();
    };

    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      onProgress?.({
        stage: 'rendering',
        record_number: i + 1,
        record_count: records.length
      });
      const recoveredImages = recoveredImageMap.get(record.id) ?? [];
      const canonicalEvent = canonicalEventBySourceRecord.get(record.id) ?? null;

      if (canonicalEvent && canonicalMessageRecordEligible(record, canonicalEvent)) {
        if (record?.author?.role === 'user') {
          flushPendingAssistant();
          output.push(canonicalRecordBlock(record, canonicalEvent));
          continue;
        }
        if (record?.author?.role === 'assistant' && canonicalEvent?.kind === 'commentary') {
          pendingThoughts.push(record);
          continue;
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length > 0) {
          const segmentRecords = [...pendingThoughts, record];
          const segmentEvents = segmentRecords
            .map(item => canonicalEventBySourceRecord.get(item.id) ?? null)
            .filter(Boolean);
          const canonicalSegmentComplete = segmentEvents.length === segmentRecords.length;
          const canonicalSegmentEligible = canonicalSegmentComplete &&
            canonicalAssistantSegmentEligible(segmentRecords, segmentEvents);
          if (diagnosticEnabled('debug') && segmentRecords.some(item =>
              item?.content?.content_type === 'code' || item?.author?.role === 'tool')) {
            logDiagnostic('debug', 'canonical-tool-segment-routing', {
              complete: canonicalSegmentComplete,
              eligible: canonicalSegmentEligible,
              rejection_reason: canonicalSegmentEligible
                ? null
                : (!canonicalSegmentComplete ? 'missing-canonical-events' : 'unsupported-canonical-segment'),
              records: segmentRecords.map((item, index) => ({
                source_record_id: item?.id ?? null,
                source_role: item?.author?.role ?? null,
                source_recipient: item?.recipient ?? null,
                source_channel: item?.channel ?? null,
                source_content_type: item?.content?.content_type ?? null,
                source_language: item?.content?.language ?? null,
                event_kind: segmentEvents[index]?.kind ?? null,
                event_role: segmentEvents[index]?.role ?? null,
                event_blocks: Array.isArray(segmentEvents[index]?.blocks)
                  ? segmentEvents[index].blocks.map(block => ({
                    type: block?.type ?? null,
                    name: block?.name ?? null,
                    input_format: block?.input_format ?? null,
                    language: block?.language ?? null,
                    source_language: block?.source_language ?? null
                  }))
                  : []
              }))
            });