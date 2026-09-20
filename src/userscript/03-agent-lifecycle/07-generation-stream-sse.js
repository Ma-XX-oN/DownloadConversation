  function streamTailHasCompletedAssistant(capture) {
    return (capture?.stream_messages ?? []).some(message =>
      message?.author?.role === 'assistant' &&
      (message?.channel === 'final' || message?.end_turn === true) &&
      (message?.status === 'finished_successfully' || message?.end_turn === true)
    );
  }

  /**
   * Consumes one text chunk from either the bootstrap SSE or its WebSocket handoff leg.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {string} chunk - Raw SSE bytes decoded as text.
   * @param {boolean} finalChunk - Whether no more bytes remain in this leg.
   * @param {boolean} fromHandoff - Whether the chunk came from the subscribed WebSocket topic.
   * @returns {void} No value is returned.
   */
  function consumeStreamTailSseChunk(capture, chunk, finalChunk = false, fromHandoff = false) {
    if (!capture) return;
    capture.sse_buffer += String(chunk ?? '').replace(/\r\n/g, '\n');
    const events = [];
    for (;;) {
      const boundary = capture.sse_buffer.indexOf('\n\n');
      if (boundary < 0) break;
      events.push(capture.sse_buffer.slice(0, boundary));
      capture.sse_buffer = capture.sse_buffer.slice(boundary + 2);
    }
    if (finalChunk && capture.sse_buffer.trim()) {
      events.push(capture.sse_buffer);
      capture.sse_buffer = '';
    }
    for (const rawEvent of events) {
      const data = rawEvent.split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
      if (!data) continue;
      if (data === '[DONE]') {
        if (fromHandoff) capture.handoff_done_received = true;
        else capture.done_received = true;
        if (!capture.overflow &&
            (fromHandoff || !capture.handed_off) &&
            streamTailHasCompletedAssistant(capture)) {
          capture.complete = true;
        }
        capture.updated_at = Date.now();
        agentTerminalObserve(capture, null);
        continue;
      }
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      if (typeof parsed === 'string') continue;
      streamTailApplyEvent(capture, parsed);
      agentStopwatchObserveStreamEvent(capture, parsed);
      agentTerminalObserve(capture, parsed);
    }
    if (capture.complete) streamTailPersistCapture(capture);
  }

  /**
   * Produces a serializable exact snapshot of one streamed-turn capture.
   *
   * @param {Object|null} capture - Mutable capture to freeze.
   * @returns {Object|null} Serializable snapshot, or null when unavailable.
   */
  function streamTailCaptureSnapshot(capture) {
    if (!capture) return null;
    return {
      schema_version: 1,
      conversation_id: capture.conversation_id ?? null,
      parent_message_id: capture.parent_message_id ?? null,
      request_messages: (capture.request_messages ?? []).map(streamTailClone),
      stream_messages: (capture.stream_messages ?? []).map(streamTailClone),
      done_received: Boolean(capture.done_received),
      handoff_done_received: Boolean(capture.handoff_done_received),
      message_stream_complete: Boolean(capture.message_stream_complete),
      handed_off: Boolean(capture.handed_off),
      handoff_topic_id: capture.handoff_topic_id ?? null,
      overflow: Boolean(capture.overflow),
      complete: Boolean(capture.complete),
      updated_at: Number(capture.updated_at) || Date.now()
    };
  }

  /**
   * Persists the exact bounded streamed-turn snapshot across a same-tab hard reload.
   *
   * @param {Object} capture - Capture to persist.
   * @returns {boolean} True when session storage accepted the snapshot.
   */
  function streamTailPersistCapture(capture) {
    try {
      const snapshot = streamTailCaptureSnapshot(capture);
      if (!snapshot) return false;
      sessionStorage.setItem(STREAM_TAIL_STORAGE_KEY, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restores the newest matching streamed-turn snapshot from same-tab session storage.
   *
   * @param {string} conversationId - Current conversation identity.
   * @returns {Object|null} Restored mutable capture, or null when no matching snapshot exists.
   */
  function streamTailRestoreCapture(conversationId) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STREAM_TAIL_STORAGE_KEY) || 'null');
      if (!parsed || parsed.schema_version !== 1 || parsed.conversation_id !== conversationId) return null;
      const capture = createStreamTailCapture(parsed.conversation_id);
      capture.parent_message_id = parsed.parent_message_id ?? null;
      capture.request_messages = Array.isArray(parsed.request_messages)
        ? parsed.request_messages.map(streamTailClone)
        : [];
      capture.stream_messages = Array.isArray(parsed.stream_messages)
        ? parsed.stream_messages.map(streamTailClone)
        : [];
      capture.message_index_by_id = new Map(
        capture.stream_messages.map((message, index) => [message.id, index])
      );
      capture.done_received = Boolean(parsed.done_received);
      capture.handoff_done_received = Boolean(parsed.handoff_done_received);
      capture.message_stream_complete = Boolean(parsed.message_stream_complete);
      capture.handed_off = Boolean(parsed.handed_off);
      capture.handoff_topic_id = parsed.handoff_topic_id ?? null;
      capture.overflow = Boolean(parsed.overflow);
      capture.complete = Boolean(parsed.complete);
      capture.updated_at = Number(parsed.updated_at) || Date.now();
      return capture;
    } catch {
      return null;
    }
  }

  /**
   * Returns one de-duplicated provider-message sequence for the submitted and streamed turn.
   *
   * @param {Object} capture - Frozen streamed-turn snapshot.
   * @returns {Array<Object>} Ordered exact provider messages for the turn.
   */
  function streamTailCapturedSequence(capture) {
    const sequence = [];
    const indexById = new Map();
    for (const message of [
      ...(capture?.request_messages ?? []),
      ...(capture?.stream_messages ?? [])
    ]) {
      const id = typeof message?.id === 'string' ? message.id : '';
      if (!id) continue;
      const existing = indexById.get(id);
      if (existing !== undefined) sequence[existing] = streamTailClone(message);
      else {
        indexById.set(id, sequence.length);
        sequence.push(streamTailClone(message));
      }
    }
    return sequence;
  }

  /**
   * Reconciles one complete streamed turn only when history ends at an exact prefix of that turn.
   *
   * Existing history remains authoritative before the captured parent anchor. Matching captured
   * tail records replace stale same-ID copies in place, and only the remaining contiguous captured
   * suffix is appended. Any identity gap or non-suffix divergence is rejected.
   *
   * @param {Object} spine - History-API conversation spine.
   * @param {Object|null} capture - Frozen complete streamed-turn snapshot.
   * @returns {Object} Merge result containing the authoritative reconciled spine.
   */
  function mergeStreamTailCaptureIntoSpine(spine, capture) {
    if (!capture) return { merged: false, reason: 'no-capture', spine, appended_count: 0, replaced_count: 0 };
    if (!capture.complete || capture.overflow) {
      return { merged: false, reason: capture.overflow ? 'capture-overflow' : 'capture-incomplete', spine, appended_count: 0, replaced_count: 0 };
    }
    const sequence = streamTailCapturedSequence(capture);
    if (!sequence.length) return { merged: false, reason: 'capture-empty', spine, appended_count: 0, replaced_count: 0 };
    const history = (spine?.records ?? []).map(record => record?.message).filter(Boolean);
    const parentId = capture.parent_message_id;
    const parentIndex = typeof parentId === 'string'
      ? history.findIndex(message => message?.id === parentId)
      : -1;
    let sequenceStart = 0;
    let anchorIndex = parentIndex;
    let anchorId = parentIndex >= 0 ? parentId : null;
    if (parentIndex < 0) {
      const firstOverlap = sequence.findIndex(message =>
        history.some(existing => existing?.id === message.id)
      );
      if (firstOverlap < 0) {
        return { merged: false, reason: 'no-overlap-anchor', spine, appended_count: 0, replaced_count: 0 };
      }
      const overlapId = sequence[firstOverlap].id;
      anchorIndex = history.findIndex(message => message?.id === overlapId);
      anchorId = overlapId;
      sequenceStart = firstOverlap + 1;
    }
    const historyTail = history.slice(anchorIndex + 1);
    const expected = sequence.slice(sequenceStart);
    if (historyTail.length > expected.length) {
      return { merged: false, reason: 'non-suffix-gap', spine, appended_count: 0, replaced_count: 0 };
    }
    for (let index = 0; index < historyTail.length; index += 1) {
      if (historyTail[index]?.id !== expected[index]?.id) {
        return { merged: false, reason: 'non-suffix-gap', spine, appended_count: 0, replaced_count: 0 };
      }
    }
    if (historyTail.length) anchorId = historyTail.at(-1)?.id ?? anchorId;
    // Only records actually observed in the completed response stream can supersede same-ID history.
    const streamedMessageIds = new Set(
      (capture.stream_messages ?? [])
        .map(message => typeof message?.id === 'string' ? message.id : '')
        .filter(Boolean)
    );
    const mergedMessages = history.slice(0, anchorIndex + 1);
    let replacedCount = 0;
    for (let index = 0; index < historyTail.length; index += 1) {
      const replacement = expected[index];
      if (streamedMessageIds.has(replacement.id)) {
        if (JSON.stringify(historyTail[index]) !== JSON.stringify(replacement)) replacedCount += 1;
        mergedMessages.push(streamTailClone(replacement));
      } else {
        mergedMessages.push(streamTailClone(historyTail[index]));
      }
    }
    const appended = expected.slice(historyTail.length);
    mergedMessages.push(...appended.map(streamTailClone));
    if (!replacedCount && !appended.length) {
      return { merged: false, reason: 'up-to-date', spine, appended_count: 0, replaced_count: 0, anchor_message_id: anchorId };
    }
    const rebuilt = conversationSpineFromPages([
      { messages: mergedMessages, page_info: { has_previous_page: false, has_next_page: false } }
    ]);
    rebuilt.pages = Array.isArray(spine?.pages) ? [...spine.pages] : rebuilt.pages;
    return {
      merged: true,
      reason: 'streamed-tail-recovered',
      spine: rebuilt,
      appended_count: appended.length,
      replaced_count: replacedCount,
      anchor_message_id: anchorId
    };
  }
