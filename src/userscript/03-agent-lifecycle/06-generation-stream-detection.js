   * @returns {boolean} True only for this origin's exact /backend-api/f/conversation path.
   */
  function isGenerationStreamUrl(url) {
    try {
      const parsed = new URL(url, `${location.origin}/`);
      return parsed.origin === location.origin && parsed.pathname === '/backend-api/f/conversation';
    } catch {
      return false;
    }
  }


  /**
   * Tests whether a URL is the stock conversation-resume stream endpoint used after reload.
   *
   * @param {string} url - Candidate request URL.
   * @returns {boolean} True only for this origin's exact /backend-api/f/conversation/resume path.
   */
  function isConversationResumeUrl(url) {
    try {
      const parsed = new URL(url, `${location.origin}/`);
      return parsed.origin === location.origin &&
        parsed.pathname === '/backend-api/f/conversation/resume';
    } catch {
      return false;
    }
  }

  /**
   * Tests whether a URL is the stock same-turn User steering endpoint.
   *
   * @param {string} url - Candidate request URL.
   * @returns {boolean} True only for this origin's exact /backend-api/f/steer_turn path.
   */
  function isSteerTurnUrl(url) {
    try {
      const parsed = new URL(url, `${location.origin}/`);
      return parsed.origin === location.origin && parsed.pathname === '/backend-api/f/steer_turn';
    } catch {
      return false;
    }
  }

  /**
   * Creates mutable state for one passively observed streamed conversation turn.
   *
   * @param {string|null} conversationId - Conversation identity known at request time, when any.
   * @returns {Object} Mutable capture state for the streamed turn.
   */
  function createStreamTailCapture(conversationId = null) {
    return {
      schema_version: 1,
      conversation_id: typeof conversationId === 'string' && conversationId ? conversationId : null,
      parent_message_id: null,
      request_messages: [],
      stream_messages: [],
      message_index_by_id: new Map(),
      current_envelope: null,
      sse_buffer: '',
      done_received: false,
      handoff_done_received: false,
      message_stream_complete: false,
      handed_off: false,
      handoff_topic_id: null,
      overflow: false,
      complete: false,
      updated_at: Date.now()
    };
  }

  /**
   * Clones one provider record without retaining references into page-owned objects.
   *
   * @param {Object} value - JSON-compatible provider value.
   * @returns {Object} Independent copy of the provider value.
   */
  function streamTailClone(value) {
    return structuredClone(value);
  }

  /**
   * Adds or refreshes one exact streamed provider message by stable message id.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object} message - Provider message object received from the stream.
   * @returns {boolean} True when the capture retained or refreshed the message.
   */
  function streamTailUpsertMessage(capture, message) {
    const id = typeof message?.id === 'string' ? message.id : '';
    if (!id || capture?.overflow) return false;
    const existing = capture.message_index_by_id.get(id);
    const copy = streamTailClone(message);
    if (existing !== undefined) {
      capture.stream_messages[existing] = copy;
      capture.updated_at = Date.now();
      return true;
    }
    if (capture.stream_messages.length >= STREAM_TAIL_RECORD_LIMIT) {
      capture.overflow = true;
      capture.complete = false;
      return false;
    }
    capture.message_index_by_id.set(id, capture.stream_messages.length);
    capture.stream_messages.push(copy);
    capture.updated_at = Date.now();
    return true;
  }

  /**
   * Records the exact User request records and parent identity submitted to /f/conversation.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object} requestBody - Parsed stock /f/conversation request body.
   * @returns {void} No value is returned.
   */
  function streamTailCaptureRequest(capture, requestBody) {
    if (!capture || !requestBody || typeof requestBody !== 'object') return;
    if (typeof requestBody.conversation_id === 'string' && requestBody.conversation_id) {
      capture.conversation_id = requestBody.conversation_id;
    }
    capture.parent_message_id = typeof requestBody.parent_message_id === 'string'
      ? requestBody.parent_message_id
      : null;
    const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
    capture.request_messages = messages
      .filter(message => typeof message?.id === 'string' && message.id)
      .slice(-STREAM_TAIL_RECORD_LIMIT)
      .map(streamTailClone);
    capture.updated_at = Date.now();
  }

  /**
   * Decodes one JSON Pointer path segment.
   *
   * @param {string} segment - Encoded JSON Pointer segment.
   * @returns {string} Decoded property name.
   */
  function streamTailPointerSegment(segment) {
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
  }

  /**
   * Applies one v1 patch operation to the current streamed root envelope.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {string} path - JSON Pointer path within the current root envelope.
   * @param {string} operation - v1 patch operation.
   * @param {Object} value - Patch value.
   * @returns {void} No value is returned.
   */
  function streamTailApplyPathPatch(capture, path, operation, value) {
    if (!capture?.current_envelope || typeof capture.current_envelope !== 'object') return;
    const effectivePath = path || '/message/content/parts/0';
    const segments = effectivePath.split('/').slice(1).map(streamTailPointerSegment);
    if (!segments.length) return;
    let target = capture.current_envelope;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const key = segments[index];
      if (!target || typeof target !== 'object' || !(key in target)) return;
      target = target[key];
    }
    if (!target || typeof target !== 'object') return;
    const key = segments.at(-1);
    const op = String(operation || 'append');
    if (op === 'append' || op === 'a') {
      if (typeof target[key] === 'string' && typeof value === 'string') target[key] += value;
      else if (Array.isArray(target[key])) target[key].push(streamTailClone(value));
      else if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) &&
               value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(target[key], streamTailClone(value));
      } else target[key] = streamTailClone(value);
    } else if (op === 'replace' || op === 'r' || op === 'add') {
      target[key] = streamTailClone(value);
    } else {
      return;
    }
    if (capture.current_envelope.message) {
      streamTailUpsertMessage(capture, capture.current_envelope.message);
    }
  }

  /**
   * Applies one parsed v1 stream event to the captured provider state.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object} event - Parsed SSE event object.
   * @returns {void} No value is returned.
   */
  function streamTailApplyEvent(capture, event) {
    if (!capture || !event || typeof event !== 'object' || Array.isArray(event)) return;
    if (typeof event.conversation_id === 'string' && event.conversation_id) {
      capture.conversation_id = event.conversation_id;
    }
    if (event.type === 'stream_handoff') {
      const options = Array.isArray(event.options) ? event.options : [];
      const option = options.find(item => item?.type === 'subscribe_ws_topic') ??
        options.find(item => item?.type === 'resume_sse_endpoint');
      capture.handed_off = true;
      capture.handoff_topic_id = typeof option?.topic_id === 'string' ? option.topic_id : null;
      capture.complete = false;
      capture.updated_at = Date.now();
      return;
    }
    if (event.type === 'message_stream_complete') {
      capture.message_stream_complete = true;
      if (!capture.overflow) capture.complete = true;
      capture.updated_at = Date.now();
      return;
    }
    if (event.message && typeof event.message === 'object') {
      streamTailUpsertMessage(capture, event.message);
      return;
    }
    if (!('v' in event)) return;
    const rootPath = event.p === undefined || event.p === '';
    if (Array.isArray(event.v) && rootPath) {
      for (const patch of event.v) {
        if (patch && typeof patch === 'object') streamTailApplyEvent(capture, patch);
      }
      return;
    }
    if (event.v && typeof event.v === 'object' && !Array.isArray(event.v) && rootPath) {
      capture.current_envelope = streamTailClone(event.v);
      if (typeof capture.current_envelope.conversation_id === 'string') {
        capture.conversation_id = capture.current_envelope.conversation_id;
      }
      if (capture.current_envelope.message) {
        streamTailUpsertMessage(capture, capture.current_envelope.message);
      }
      return;
    }
    streamTailApplyPathPatch(
      capture,
      typeof event.p === 'string' ? event.p : '',
      typeof event.o === 'string' ? event.o : 'append',
      event.v
    );
  }

  /**
   * Reports whether the capture contains a finished final Assistant record.
   *
   * @param {Object} capture - Mutable or frozen streamed-turn capture.
   * @returns {boolean} True when a final Assistant record is complete.
   */
