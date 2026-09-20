      let value = null;
      try { value = headers?.get?.(headerName) ?? null; } catch {}
      if (value) result[outputName] = boundedDiagnosticText(value, 1000);
    }
    return result;
  }

  /**
   * Extracts bounded message identity/status metadata from arbitrary JSON data.
   *
   * The traversal intentionally records no message content.
   *
   * @param {Object} payload - Parsed stock response JSON.
   * @returns {Object} Bounded identity-only summary.
   */
  function stockNetworkJsonIdentitySummary(payload) {
    const messageIds = [];
    const tailMessages = [];
    const seenMessageIds = new Set();
    const visited = new WeakSet();
    let visitedNodes = 0;

    /**
     * Retains one message-like object without retaining its content.
     *
     * @param {Object} candidate - Potential provider message object.
     * @returns {void} No value is returned.
     */
    function retainMessage(candidate) {
      if (!candidate || typeof candidate !== 'object') return;
      const id = typeof candidate.id === 'string' ? candidate.id : null;
      const role = typeof candidate?.author?.role === 'string'
        ? candidate.author.role
        : (typeof candidate.role === 'string' ? candidate.role : null);
      if (!id || !role || seenMessageIds.has(id)) return;
      seenMessageIds.add(id);
      messageIds.push(id);
      tailMessages.push({
        id,
        role,
        status: typeof candidate.status === 'string' ? candidate.status : null,
        end_turn: typeof candidate.end_turn === 'boolean' ? candidate.end_turn : null,
        channel: typeof candidate.channel === 'string' ? candidate.channel : null
      });
      if (messageIds.length > STOCK_NETWORK_ID_LIMIT) messageIds.shift();
      if (tailMessages.length > STOCK_NETWORK_ID_LIMIT) tailMessages.shift();
    }

    /**
     * Walks bounded JSON structure looking only for message-like identity objects.
     *
     * @param {Object} value - Current JSON value.
     * @param {number} depth - Current traversal depth.
     * @returns {void} No value is returned.
     */
    function visit(value, depth) {
      if (!value || typeof value !== 'object' || depth > 16 || visitedNodes >= 20000) return;
      if (visited.has(value)) return;
      visited.add(value);
      visitedNodes += 1;
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      retainMessage(value);
      if (value.message && typeof value.message === 'object') retainMessage(value.message);
      for (const nested of Object.values(value)) visit(nested, depth + 1);
    }

    visit(payload, 0);
    const currentNode = typeof payload?.current_node === 'string'
      ? payload.current_node
      : (typeof payload?.conversation?.current_node === 'string' ? payload.conversation.current_node : null);
    const conversationId = typeof payload?.conversation_id === 'string'
      ? payload.conversation_id
      : (typeof payload?.id === 'string' && !seenMessageIds.has(payload.id) ? payload.id : null);
    return {
      current_node: currentNode,
      conversation_id: conversationId,
      message_ids: messageIds,
      tail_messages: tailMessages,
      visited_nodes: visitedNodes
    };
  }

  /**
   * Extracts bounded candidate UUID identities from non-JSON text responses.
   *
   * @param {string} text - Bounded response text.
   * @returns {Object} Identity-only text summary.
   */
  function stockNetworkTextIdentitySummary(text) {
    const candidateIds = [];
    const seen = new Set();
    const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
    for (const match of String(text ?? '').matchAll(uuidPattern)) {
      const id = match[0].toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      candidateIds.push(id);
      if (candidateIds.length > STOCK_NETWORK_ID_LIMIT) candidateIds.shift();
    }
    return {
      candidate_uuid_ids: candidateIds,
      message_terms_present: /(?:current_node|message_id|\"message\"|\"author\"|\"role\")/i.test(String(text ?? ''))
    };
  }

  /**
   * Classifies one bounded stock-network text body into JSON identity or text identity evidence.
   *
   * @param {string} text - Bounded response text.
   * @param {string} contentType - Response content type used as JSON evidence.
   * @returns {Object} Exactly one JSON-identity or text-identity projection.
   */
  function stockNetworkBodyIdentity(text, contentType) {
    const value = String(text ?? '');
    if (/json/i.test(contentType) || /^[\s\r\n]*[\[{]/.test(value)) {
      try {
        return { json_identity: stockNetworkJsonIdentitySummary(JSON.parse(value)) };
      } catch {}
    }
    return { text_identity: stockNetworkTextIdentitySummary(value) };
  }

  /**
   * Projects request headers without retaining authentication or other secret values.
   *
   * @param {Object} headers - Headers-like request headers.
   * @returns {Object} Safe request-header metadata.
   */
  function stockNetworkRequestHeaderSummary(headers) {
    const raw = rawHeadersToObject(headers);
    const headerNames = Object.keys(raw).slice(0, 100);
    const selected = {};
    for (const name of ['cache-control', 'pragma', 'if-none-match', 'if-modified-since', 'x-openai-target-path']) {
      if (!raw[name]) continue;
      selected[name.replace(/-/g, '_')] = boundedDiagnosticText(redactDiagnosticSignedTokens(raw[name]), 1000);
    }
    return { header_names: headerNames, selected };
  }

  /**
   * Starts one stock page fetch diagnostic observation.
   *
   * @param {Request|null} request - Page Request when construction succeeded.
   * @param {string} requestUrl - Effective request URL.
   * @returns {Object} Correlation state for the response.
   */
  function stockNetworkTraceFetchStart(request, requestUrl) {
    const sequence = ++stockNetworkSequence;
    const startedAt = performance.now();
    let sameOrigin = false;
    try { sameOrigin = new URL(requestUrl, location.href).origin === location.origin; } catch {}
    const trace = {
      sequence,
      started_at: startedAt,
      method: String(request?.method ?? 'GET').toUpperCase(),
      url: stockNetworkSafeUrl(requestUrl),
      same_origin: sameOrigin
    };
    logDiagnostic('debug', 'stock-network-fetch-start', {
      network_sequence: sequence,
      method: trace.method,
      url: trace.url,
      cache_mode: request?.cache ?? null,
      request_mode: request?.mode ?? null,
      credentials: request?.credentials ?? null,
      destination: request?.destination ?? null,
      redirect: request?.redirect ?? null,
      headers: stockNetworkRequestHeaderSummary(request?.headers)
    });
    return trace;
  }

  /**
   * Reads at most the configured diagnostic byte limit from a cloned response.
   *
   * @param {Response} response - Cloned page response.
   * @returns {Promise<Object>} Bounded text plus byte/truncation metadata.
   */
  async function stockNetworkReadBoundedText(response) {
    if (!response?.body) return { text: '', byte_count: 0, truncated: false };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let byteCount = 0;
    let truncated = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        const remaining = STOCK_NETWORK_JSON_BYTE_LIMIT - byteCount;
        if (remaining <= 0) {
          truncated = true;
          try { await reader.cancel(); } catch {}
          break;
        }
        const accepted = value.byteLength <= remaining ? value : value.slice(0, remaining);
        text += decoder.decode(accepted, { stream: true });
        byteCount += accepted.byteLength;
        if (accepted.byteLength < value.byteLength) {
          truncated = true;
          try { await reader.cancel(); } catch {}
          break;
        }
      }
      text += decoder.decode();
    } finally {
      releaseReaderLockQuietly(reader);
    }
    return { text, byte_count: byteCount, truncated };
  }

  /**
   * Inspects one cloned stock fetch body without retaining its raw content.
   *
   * @param {Response} response - Cloned page response.
   * @param {Object} trace - Request/response correlation state.
   * @returns {Promise<void>} Resolves after bounded body inspection.
   */
  async function stockNetworkInspectFetchBody(response, trace) {
    try {
      const bounded = await stockNetworkReadBoundedText(response);
      const contentType = response.headers?.get?.('content-type') ?? '';
      const identity = stockNetworkBodyIdentity(bounded.text, contentType);
      logDiagnostic('debug', 'stock-network-fetch-body-summary', {
        network_sequence: trace.sequence,
        url: trace.url,
        content_type: boundedDiagnosticText(contentType, 500),
        byte_count: bounded.byte_count,
        truncated: bounded.truncated,
        json_identity: identity.json_identity ?? null,
        text_identity: identity.text_identity ?? null
      });
    } catch (error) {
      logDiagnostic('debug', 'stock-network-fetch-body-summary-failed', {
        network_sequence: trace.sequence,
        url: trace.url,
        error: boundedDiagnosticText(errorMessage(error), 1000)
      });
    }
  }

