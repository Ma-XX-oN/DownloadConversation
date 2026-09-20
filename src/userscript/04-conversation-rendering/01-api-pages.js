      let bodyPreview = '';
      try {
        bodyPreview = boundedDiagnosticText(await response.clone().text());
      } catch (error) {
        bodyPreview = `[response body unavailable: ${errorMessage(error)}]`;
      }
      logDiagnostic('errors', 'conversation-api-page-http-failure', {
        ...responseDetails,
        response_body_preview: bodyPreview
      });
      throw new Error(`${description} returned HTTP ${response.status}.`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      logDiagnostic('errors', 'conversation-api-page-json-failure', {
        ...responseDetails,
        message: errorMessage(error)
      });
      throw error;
    }

    if (!conversationSchemaOk(data)) {
      logDiagnostic('errors', 'conversation-api-page-schema-failure', {
        ...responseDetails,
        top_level_keys: data && typeof data === 'object' ? Object.keys(data) : [],
        messages_is_array: Array.isArray(data?.messages),
        page_info_type: data?.page_info === null ? 'null' : typeof data?.page_info
      });
      throw new Error(`${description} did not contain messages[] and page_info.`);
    }

    logDiagnostic('debug', 'conversation-api-page-success', {
      ...responseDetails,
      record_count: data.messages.length,
      page_info: {
        start_cursor: data.page_info.start_cursor ?? null,
        end_cursor: data.page_info.end_cursor ?? null,
        has_previous_page: data.page_info.has_previous_page ?? null,
        has_next_page: data.page_info.has_next_page ?? null
      }
    });
    return data;
  }

  /**
   * Collects conversation pages.
   *
   * @param {Object} fetchPage - The callback used to fetch one Conversation API page.
   * @param {Object} onProgress - The callback invoked with progress updates.
   * @returns {Promise<Object>} A promise that resolves to the Object result produced by `collectConversationPages`.
   */
  async function collectConversationPages(fetchPage, onProgress) {
    // Pages are accumulated newest-to-oldest as the API previous-page cursor is followed.
    const pages = [];
    // Tracks pagination cursors already consumed so a server loop is detected immediately.
    const seenCursors = new Set();
    // Running count of source records fetched across all Conversation API pages.
    let rawRecordCount = 0;
    // Null requests the newest page; later values request progressively older pages.
    let cursor = null;

    for (;;) {
      if (pages.length >= MAX_PAGES) {
        throw new Error(`Conversation pagination exceeded the ${MAX_PAGES}-page safety limit.`);
      }
      const previousPageInfo = pages.length ? pages[pages.length - 1].page_info : null;
      const pageNumber = pages.length + 1;
      const pageStartedAt = performance.now();
      onProgress?.({
        stage: 'fetching',
        phase: 'request-start',
        page_count: pages.length,
        raw_record_count: rawRecordCount,
        page_number: pageNumber,
        page_started_at: pageStartedAt
      });
      const data = await fetchPage(cursor, pageNumber, previousPageInfo);
      if (!conversationSchemaOk(data)) {
        throw new Error('Conversation API page did not contain messages[] and page_info.');
      }
      if (pages.length === 0 && data.page_info.has_next_page === true) {
        throw new Error('Initial Conversation API page reports has_next_page=true; newest boundary is not established.');
      }

      pages.push(data);
      rawRecordCount += data.messages.length;
      onProgress?.({
        stage: 'fetching',
        phase: 'request-complete',
        page_count: pages.length,
        raw_record_count: rawRecordCount,
        page_number: pageNumber,
        page_started_at: 0
      });

      if (data.page_info.has_previous_page !== true) break;
      cursor = data.page_info.start_cursor;
      if (!cursor) {
        throw new Error('Conversation API reports a previous page but supplied no start_cursor.');
      }
      if (seenCursors.has(cursor)) {
        throw new Error(`Conversation pagination repeated start_cursor ${cursor}.`);
      }
      seenCursors.add(cursor);
    }

    return { pages, raw_record_count: rawRecordCount };
  }

  /**
   * Fetches conversation pages.
   *
   * @param {string} conversationId - The Conversation API conversation identifier.
   * @param {Object} onProgress - The callback invoked with progress updates.
   * @returns {Promise<Array<unknown>>} A promise that resolves to the Array<unknown> result produced by `fetchConversationPages`.
   */
  async function fetchConversationPages(conversationId, onProgress) {
    return collectConversationPages(
      (cursor, pageNumber, previousPageInfo) => fetchOneConversationPage(
        pageUrl(conversationId, cursor),
        cursor === null ? 'Initial Conversation API request' : 'Conversation pagination request',
        {
          page_number: pageNumber,
          request_kind: cursor === null ? 'initial' : 'pagination',
          cursor,
          previous_page_info: previousPageInfo ? {
            start_cursor: previousPageInfo.start_cursor ?? null,
            end_cursor: previousPageInfo.end_cursor ?? null,
            has_previous_page: previousPageInfo.has_previous_page ?? null,
            has_next_page: previousPageInfo.has_next_page ?? null
          } : null
        }
      ),
      onProgress
    );
  }

  /**
   * Handles conversation spine from pages.
   *
   * @param {Object} pages - The ordered Conversation API pages.
   * @returns {Object} The Object value produced by `conversationSpineFromPages`.
   */
  function conversationSpineFromPages(pages) {
    // Maps each stable message id to its slot so duplicate page overlap can be replaced in place.
    const messageIndexById = new Map();
    // De-duplicated Conversation API messages in chronological source order.
    const messages = [];
    // Counts page-overlap records whose stable message id was already present.
    let duplicateMessageIds = 0;
    for (const page of [...pages].reverse()) {
      for (const message of page?.messages ?? []) {
        const id = typeof message?.id === 'string' ? message.id : '';
        if (!id) throw new Error('Conversation API message is missing a stable id.');
        const existingIndex = messageIndexById.get(id);
        if (existingIndex !== undefined) {
          duplicateMessageIds += 1;
          messages[existingIndex] = message;
          continue;
        }
        messageIndexById.set(id, messages.length);
        messages.push(message);
      }
    }

    /**
     * Handles records.
     */
    const records = messages.map((message, ordinal) => {
      const metadata = message?.metadata && typeof message.metadata === 'object'
        ? message.metadata
        : {};
      return {
        ordinal,
        message_id: message.id,
        role: typeof message?.author?.role === 'string' ? message.author.role : null,
        channel: typeof message?.channel === 'string' ? message.channel : null,
        content_type: typeof message?.content?.content_type === 'string'
          ? message.content.content_type
          : null,
        turn_exchange_id: typeof metadata.turn_exchange_id === 'string'
          ? metadata.turn_exchange_id
          : null,
        working_turn_id: typeof metadata.working_turn_id === 'string'
          ? metadata.working_turn_id
          : null,
        message
      };
    });

    // User records become chronological UAP anchors for associating following activity.
    const uapAnchors = [];
    for (const record of records) {
      if (record.role !== 'user') continue;
      uapAnchors.push({
        ordinal: uapAnchors.length,
        user_message_id: record.message_id,
        user_record_ordinal: record.ordinal,
        turn_exchange_id: record.turn_exchange_id,
        working_turn_id: record.working_turn_id
      });
    }

    return {
      pages: [...pages],
      messages,
      records,
      uap_anchors: uapAnchors,
      duplicate_message_ids: duplicateMessageIds
    };
  }

  /**
   * Handles API linkage key is identifier like.
   *
   * @param {string} key - The lookup key to process.
   * @returns {boolean} `true` when the api linkage key is identifier like condition is satisfied; otherwise `false`.
   */
  function apiLinkageKeyIsIdentifierLike(key) {
    return /(?:^id$|_id$|_ids$|call|parent|source|reference|tool|exchange|working|request|response)/i
      .test(String(key ?? ''));
  }

  /**
   * Handles API linkage scalar is safe.
   *
   * @param {string} key - The lookup key to process.
   * @param {string} value - The value to process.
   * @returns {boolean} `true` when `apiLinkageScalarIsSafe` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function apiLinkageScalarIsSafe(key, value) {
    if (value === null || value === undefined) return false;
    if (!['string', 'number'].includes(typeof value)) return false;
    if (/(?:authorization|cookie|token|secret|password)/i.test(String(key ?? ''))) return false;
    if (typeof value === 'string' && value.length > 256) return false;
    return true;
  }

  /**
   * Handles API record identifier scalars.
   *
   * @param {Object} record - The provider/source record to process.
