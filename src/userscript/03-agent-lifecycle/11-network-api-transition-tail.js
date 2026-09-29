  /**
   * Handles API fetch.
   *
   * @param {string} url - The URL to process.
   * @returns {Promise<Object|boolean|string|number|null>} A promise that resolves to the Object|boolean|string|number|null result produced by `apiFetch`.
   */
  async function apiFetch(url) {
    const conversationId = currentConversationId();
    // Snapshot the captured request context used to authorize this direct API request.
    const context = apiRequestContext;
    if (!context?.headers?.authorization || context.conversation_id !== conversationId) {
      throw new Error('No authenticated Conversation API context is available. Reload this conversation, then try again.');
    }
    // Use the page realm rather than the userscript sandbox when intercepting page networking.
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    // Prefer the pre-interception fetch implementation to avoid recursively capturing ourselves.
    const fetchFn = originalPageFetch || pageWindow.fetch;
    const requestInit = {
      method: 'GET',
      headers: { ...context.headers },
      credentials: 'include'
    };
    const trace = {
      sequence: ++stockNetworkSequence,
      started_at: performance.now(),
      method: 'GET',
      url: stockNetworkSafeUrl(url),
      same_origin: true,
      origin: 'downloadconversation'
    };
    let loggingRequest = null;
    try {
      const PageRequest = pageWindow.Request || Request;
      loggingRequest = new PageRequest(url, requestInit);
    } catch {}
    void communicationLogFetchRequest(loggingRequest, trace)
      .catch(communicationError => communicationLogReportFailure('direct-api-request', communicationError));
    const response = await fetchFn.call(pageWindow, url, requestInit);
    void communicationLogFetchResponse(response, trace)
      .catch(communicationError => communicationLogReportFailure('direct-api-response', communicationError));
    return response;
  }

  /**
   * Handles conversation schema ok.
   *
   * @param {Object} data - The data value required by this function.
   * @returns {boolean} `true` when `conversationSchemaOk` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function conversationSchemaOk(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.messages) &&
      !!data.page_info && typeof data.page_info === 'object';
  }

  /**
   * Handles page URL.
   *
   * @param {string} conversationId - The Conversation API conversation identifier.
   * @param {Object|null} cursor - The pagination cursor, or null for the first page.
   * @returns {string} The string produced by `pageUrl`.
   */
  function pageUrl(conversationId, cursor = null) {
    if (cursor === null) {
      return `${location.origin}/backend-api/conversations/${encodeURIComponent(conversationId)}?include_has_versions=true&num_turns=${PAGE_TURNS}`;
    }
    return `${location.origin}/backend-api/conversations/${encodeURIComponent(conversationId)}/messages?before=${encodeURIComponent(cursor)}&include_has_versions=true&num_turns=${PAGE_TURNS}`;
  }

  /**
   * Handles bounded diagnostic text.
   *
   * @param {string} text - The text to process.
   * @param {number} maxChars - The maximum number of characters to retain.
   * @returns {string} The string produced by `boundedDiagnosticText`.
   */
  function boundedDiagnosticText(text, maxChars = 2000) {
    const value = typeof text === 'string' ? text : String(text ?? '');
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]`;
  }


  /**
   * Handles diagnostic request path.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `diagnosticRequestPath`.
   */
  function diagnosticRequestPath(url) {
    try {
      const parsed = new URL(url, location.href);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return String(url);
    }
  }

  /**
   * Fetches one conversation page.
   *
   * @param {string} url - The URL to process.
   * @param {Object} description - The description value required by this function.
   * @param {Object} requestInfo - The requestInfo value required by this function.
   * @returns {Promise<Object|boolean|string|number|null>} A promise that resolves to the Object|boolean|string|number|null result produced by `fetchOneConversationPage`.
   */
  async function fetchOneConversationPage(url, description, requestInfo = {}) {
    const startedAt = performance.now();
    const requestDetails = {
      page_number: requestInfo.page_number ?? null,
      request_kind: requestInfo.request_kind ?? 'unknown',
      cursor: requestInfo.cursor ?? null,
      request_path: diagnosticRequestPath(url),
      previous_page_info: requestInfo.previous_page_info ?? null
    };

    logDiagnostic('verbose', 'conversation-api-page-request-start', requestDetails);

    let response;
    try {
      response = await apiFetch(url);
    } catch (error) {
      logDiagnostic('errors', 'conversation-api-page-network-failure', {
        ...requestDetails,
        elapsed_ms: Math.round(performance.now() - startedAt),
        message: errorMessage(error)
      });
      throw error;
    }

    const responseDetails = {
      ...requestDetails,
      elapsed_ms: Math.round(performance.now() - startedAt),
      status: response.status,
      status_text: response.statusText,
      content_type: response.headers.get('content-type') || ''
    };

    if (!response.ok) {
