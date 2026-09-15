from pathlib import Path

USERSCRIPT = Path('chatgpt-conversation-markdown-export.user.js')
DESIGN = Path('DESIGN.md')


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


source = USERSCRIPT.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      1.0.1-issue.123.5',
  '// @version      1.0.1-issue.123.6',
  'development version'
)

source = replace_once(
  source,
  "  /** Maximum source records retained from one live streamed conversation turn. */\n"
  "  const STREAM_TAIL_RECORD_LIMIT = 512;\n",
  "  /** Maximum source records retained from one live streamed conversation turn. */\n"
  "  const STREAM_TAIL_RECORD_LIMIT = 512;\n"
  "  /** Maximum message identities retained in one stock-network body summary. */\n"
  "  const STOCK_NETWORK_ID_LIMIT = 64;\n"
  "  /** Maximum response-body bytes inspected for stock-network identity diagnostics. */\n"
  "  const STOCK_NETWORK_JSON_BYTE_LIMIT = 1024 * 1024;\n",
  'stock-network constants'
)

source = replace_once(
  source,
  "  /** Newest passive /f/conversation streamed-turn capture observed in this page lifetime. */\n"
  "  let streamTailCapture = null;\n",
  "  /** Newest passive /f/conversation streamed-turn capture observed in this page lifetime. */\n"
  "  let streamTailCapture = null;\n"
  "  /** Monotonic sequence assigned to stock page fetch/XHR diagnostics in this page lifetime. */\n"
  "  let stockNetworkSequence = 0;\n",
  'stock-network sequence state'
)

network_block = r'''  // BEGIN Issue #123 stock network diagnostics
  /**
   * Produces a bounded URL safe for stock-network diagnostics.
   *
   * Same-origin ChatGPT URLs retain routing query parameters while known secret
   * values are redacted. Cross-origin URLs retain only origin and path.
   *
   * @param {string} value - Request or response URL to sanitize.
   * @returns {string} Sanitized diagnostic URL.
   */
  function stockNetworkSafeUrl(value) {
    try {
      const parsed = new URL(String(value ?? ''), location.href);
      if (parsed.origin !== location.origin) return `${parsed.origin}${parsed.pathname}`;
      const relative = `${parsed.pathname}${parsed.search}`;
      return boundedDiagnosticText(
        redactDiagnosticSignedTokens(relative)
          .replace(/([?&](?:access_token|token|key|secret|auth|session|jwt)=)[^&#\s]*/gi, '$1[redacted]'),
        4000
      );
    } catch {
      return boundedDiagnosticText(String(value ?? ''), 4000);
    }
  }

  /**
   * Extracts only explicitly safe cache/correlation response headers.
   *
   * @param {Object} headers - Headers-like object exposing get(name).
   * @returns {Object} Safe response-header diagnostic projection.
   */
  function stockNetworkSafeResponseHeaders(headers) {
    const result = {};
    const allowed = [
      ['date', 'date'],
      ['age', 'age'],
      ['cache-control', 'cache_control'],
      ['etag', 'etag'],
      ['last-modified', 'last_modified'],
      ['expires', 'expires'],
      ['pragma', 'pragma'],
      ['vary', 'vary'],
      ['cf-cache-status', 'cf_cache_status'],
      ['x-cache', 'x_cache'],
      ['x-cache-hits', 'x_cache_hits'],
      ['x-served-by', 'x_served_by'],
      ['x-timer', 'x_timer'],
      ['server-timing', 'server_timing'],
      ['x-request-id', 'x_request_id'],
      ['x-openai-request-id', 'x_openai_request_id'],
      ['cf-ray', 'cf_ray']
    ];
    for (const [headerName, outputName] of allowed) {
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
      try { reader.releaseLock(); } catch {}
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
      let jsonIdentity = null;
      let textIdentity = null;
      if (/json/i.test(contentType) || /^[\s\r\n]*[\[{]/.test(bounded.text)) {
        try { jsonIdentity = stockNetworkJsonIdentitySummary(JSON.parse(bounded.text)); } catch {}
      }
      if (!jsonIdentity) textIdentity = stockNetworkTextIdentitySummary(bounded.text);
      logDiagnostic('debug', 'stock-network-fetch-body-summary', {
        network_sequence: trace.sequence,
        url: trace.url,
        content_type: boundedDiagnosticText(contentType, 500),
        byte_count: bounded.byte_count,
        truncated: bounded.truncated,
        json_identity: jsonIdentity,
        text_identity: textIdentity
      });
    } catch (error) {
      logDiagnostic('debug', 'stock-network-fetch-body-summary-failed', {
        network_sequence: trace.sequence,
        url: trace.url,
        error: boundedDiagnosticText(error?.message ?? String(error), 1000)
      });
    }
  }

  /**
   * Records stock fetch response metadata and starts bounded identity inspection.
   *
   * @param {Response} response - Original page response, left untouched for ChatGPT.
   * @param {Object} trace - Request/response correlation state.
   * @returns {void} No value is returned.
   */
  function stockNetworkTraceFetchResponse(response, trace) {
    const contentType = response?.headers?.get?.('content-type') ?? '';
    logDiagnostic('debug', 'stock-network-fetch-response', {
      network_sequence: trace.sequence,
      method: trace.method,
      url: trace.url,
      response_url: stockNetworkSafeUrl(response?.url ?? ''),
      status: response?.status ?? null,
      ok: response?.ok === true,
      type: response?.type ?? null,
      redirected: response?.redirected === true,
      duration_ms: Math.round(performance.now() - trace.started_at),
      content_type: boundedDiagnosticText(contentType, 500),
      response_headers: stockNetworkSafeResponseHeaders(response?.headers)
    });
    const inspectable = trace.same_origin && (
      /(?:json|text|event-stream|x-component|javascript)/i.test(contentType) ||
      /\/backend-api\/(?:conversation|conversations|f\/conversation)(?:\/|\?|$)/.test(trace.url)
    );
    if (!inspectable) return;
    let cloned = null;
    try { cloned = response.clone(); } catch {}
    if (cloned) void stockNetworkInspectFetchBody(cloned, trace);
  }

  /**
   * Starts one stock page XHR diagnostic observation.
   *
   * @param {XMLHttpRequest} xhr - Page XHR instance.
   * @param {Object} info - Captured XHR method/URL/header metadata.
   * @returns {Object} Correlation state for loadend.
   */
  function stockNetworkTraceXhrStart(xhr, info) {
    const sequence = ++stockNetworkSequence;
    const trace = {
      sequence,
      started_at: performance.now(),
      method: String(info?.method ?? 'GET').toUpperCase(),
      url: stockNetworkSafeUrl(info?.url ?? '')
    };
    logDiagnostic('debug', 'stock-network-xhr-start', {
      network_sequence: sequence,
      method: trace.method,
      url: trace.url,
      response_type: xhr?.responseType || null,
      headers: stockNetworkRequestHeaderSummary(info?.headers)
    });
    return trace;
  }

  /**
   * Parses XHR raw response headers into a Headers-like safe lookup object.
   *
   * @param {XMLHttpRequest} xhr - Completed page XHR instance.
   * @returns {Object} Headers-like object with get(name).
   */
  function stockNetworkXhrHeaderLookup(xhr) {
    const values = {};
    try {
      for (const line of String(xhr?.getAllResponseHeaders?.() ?? '').split(/\r?\n/)) {
        const split = line.indexOf(':');
        if (split <= 0) continue;
        values[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
      }
    } catch {}
    return { get: name => values[String(name).toLowerCase()] ?? null };
  }

  /**
   * Records completed stock XHR response metadata and bounded identity information.
   *
   * @param {XMLHttpRequest} xhr - Completed page XHR instance.
   * @param {Object} trace - Request/response correlation state.
   * @returns {void} No value is returned.
   */
  function stockNetworkTraceXhrResponse(xhr, trace) {
    const headerLookup = stockNetworkXhrHeaderLookup(xhr);
    const contentType = headerLookup.get('content-type') ?? '';
    let bodyIdentity = null;
    try {
      if (xhr.responseType === 'json' && xhr.response && typeof xhr.response === 'object') {
        bodyIdentity = { json_identity: stockNetworkJsonIdentitySummary(xhr.response) };
      } else if (!xhr.responseType || xhr.responseType === 'text') {
        const rawText = String(xhr.responseText ?? '');
        const boundedText = rawText.slice(0, STOCK_NETWORK_JSON_BYTE_LIMIT);
        let jsonIdentity = null;
        if (/json/i.test(contentType) || /^[\s\r\n]*[\[{]/.test(boundedText)) {
          try { jsonIdentity = stockNetworkJsonIdentitySummary(JSON.parse(boundedText)); } catch {}
        }
        bodyIdentity = jsonIdentity
          ? { json_identity: jsonIdentity, truncated: rawText.length > boundedText.length }
          : {
              text_identity: stockNetworkTextIdentitySummary(boundedText),
              truncated: rawText.length > boundedText.length
            };
      }
    } catch {}
    logDiagnostic('debug', 'stock-network-xhr-response', {
      network_sequence: trace.sequence,
      method: trace.method,
      url: trace.url,
      response_url: stockNetworkSafeUrl(xhr?.responseURL ?? ''),
      status: Number.isFinite(xhr?.status) ? xhr.status : null,
      duration_ms: Math.round(performance.now() - trace.started_at),
      content_type: boundedDiagnosticText(contentType, 500),
      response_headers: stockNetworkSafeResponseHeaders(headerLookup),
      body_identity: bodyIdentity
    });
  }
  // END Issue #123 stock network diagnostics

'''

remember_anchor = "  /**\n   * Handles remember API request context.\n"
source = replace_once(
  source,
  remember_anchor,
  network_block + remember_anchor,
  'stock-network helper insertion'
)

old_fetch = """        const requestUrl = request?.url ?? String(input);
        rememberApiRequestContext(requestUrl, request?.headers, init.headers);
        recordClickDiagnosticNetworkRequest(requestUrl, 'fetch');
        const generationRequest = isGenerationStreamUrl(requestUrl) &&
          String(request?.method ?? init.method ?? 'GET').toUpperCase() === 'POST';
        const capturePromise = generationRequest && request
          ? captureGenerationStreamRequest(request)
          : null;
        const responsePromise = originalFetch.apply(this, args);
        if (!capturePromise) return responsePromise;
        return responsePromise.then(response => {
          void capturePromise.then(capture => {
            if (!capture) return;
            let cloned;
            try { cloned = response.clone(); } catch { return; }
            void captureGenerationStreamResponse(cloned, capture);
          });
          return response;
        });
"""
new_fetch = """        const requestUrl = request?.url ?? String(input);
        const stockTrace = stockNetworkTraceFetchStart(request, requestUrl);
        rememberApiRequestContext(requestUrl, request?.headers, init.headers);
        recordClickDiagnosticNetworkRequest(requestUrl, 'fetch');
        const generationRequest = isGenerationStreamUrl(requestUrl) &&
          String(request?.method ?? init.method ?? 'GET').toUpperCase() === 'POST';
        const capturePromise = generationRequest && request
          ? captureGenerationStreamRequest(request)
          : null;
        const responsePromise = originalFetch.apply(this, args);
        return responsePromise.then(response => {
          stockNetworkTraceFetchResponse(response, stockTrace);
          if (capturePromise) {
            void capturePromise.then(capture => {
              if (!capture) return;
              let cloned;
              try { cloned = response.clone(); } catch { return; }
              void captureGenerationStreamResponse(cloned, capture);
            });
          }
          return response;
        }, error => {
          logDiagnostic('debug', 'stock-network-fetch-failed', {
            network_sequence: stockTrace.sequence,
            method: stockTrace.method,
            url: stockTrace.url,
            duration_ms: Math.round(performance.now() - stockTrace.started_at),
            error: boundedDiagnosticText(error?.message ?? String(error), 1000)
          });
          throw error;
        });
"""
source = replace_once(source, old_fetch, new_fetch, 'page fetch tracing')

old_xhr_send = """      XHR.prototype.send = function(body) {
        const info = this.__tmApiRequest || { url: '', headers: {} };
        rememberApiRequestContext(info.url, info.headers);
        recordClickDiagnosticNetworkRequest(info.url, 'xmlhttprequest');
        return originalSend.call(this, body);
      };
"""
new_xhr_send = """      XHR.prototype.send = function(body) {
        const info = this.__tmApiRequest || { method: 'GET', url: '', headers: {} };
        const stockTrace = stockNetworkTraceXhrStart(this, info);
        this.addEventListener('loadend', () => stockNetworkTraceXhrResponse(this, stockTrace), { once: true });
        rememberApiRequestContext(info.url, info.headers);
        recordClickDiagnosticNetworkRequest(info.url, 'xmlhttprequest');
        return originalSend.call(this, body);
      };
"""
source = replace_once(source, old_xhr_send, new_xhr_send, 'XHR tracing')

source = replace_once(
  source,
  "      deadline: startedAt + 2500,\n      turn,\n",
  "      deadline: startedAt + 2500,\n"
  "      is_trusted: event.isTrusted === true,\n"
  "      pointer_type: typeof event.pointerType === 'string' && event.pointerType ? event.pointerType : null,\n"
  "      button: Number.isInteger(event.button) ? event.button : null,\n"
  "      turn,\n",
  'click trust metadata'
)

source = replace_once(
  source,
  "      click_sequence: observation.sequence,\n      turn: observation.turn,\n      clicked: observation.clicked,\n",
  "      click_sequence: observation.sequence,\n"
  "      is_trusted: observation.is_trusted,\n"
  "      pointer_type: observation.pointer_type,\n"
  "      button: observation.button,\n"
  "      turn: observation.turn,\n"
  "      clicked: observation.clicked,\n",
  'click start log trust metadata'
)

source = replace_once(
  source,
  "      observation_ms: Math.round(endedAt - observation.started_at),\n      turn: observation.turn,\n      clicked: observation.clicked,\n",
  "      observation_ms: Math.round(endedAt - observation.started_at),\n"
  "      is_trusted: observation.is_trusted,\n"
  "      pointer_type: observation.pointer_type,\n"
  "      button: observation.button,\n"
  "      turn: observation.turn,\n"
  "      clicked: observation.clicked,\n",
  'click result log trust metadata'
)

source = replace_once(
  source,
  "      const stalePrefix = found.basis === 'message_id' && apiText.length >= 20 &&\n"
  "        liveText.length >= apiText.length + 12 && liveText.startsWith(apiText);\n",
  "      const stalePrefix = marker?.role !== 'user' && found.record.role !== 'user' &&\n"
  "        found.basis === 'message_id' && apiText.length >= 20 &&\n"
  "        liveText.length >= apiText.length + 12 && liveText.startsWith(apiText);\n",
  'User chrome stale-prefix correction'
)

USERSCRIPT.write_text(source, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
section = r'''

## Issue #123 stock network hydration diagnostics

Live evidence showed that a newest Assistant turn can disappear after a hard reload,
remain absent from the flattened Conversation API snapshot, and then materialize in
the stock ChatGPT UI later.  The supplying request could not be identified from the
older diagnostics because page networking was observed only for narrow correlation
purposes.  Issue #123 therefore adds passive stock-network observability without
changing acquisition or rendering semantics.

From `document-start`, the userscript observes page-realm `fetch` and XHR traffic.
It leaves the page's original response object untouched and inspects only a cloned,
bounded response stream where the content type/path is useful for identity tracing.
Diagnostics retain method, sanitized URL, request cache mode when exposed, safe
request header names/selected routing-cache values, HTTP status, elapsed time,
explicitly whitelisted cache/correlation response headers, and bounded message-ID /
status summaries.  Raw response bodies, authorization values, cookies, tokens and
other secret header values are not retained.  Non-JSON text is represented only by
bounded candidate UUIDs and structural message-term presence.

The stock-network trace is evidence gathering only.  It does not add another export
acquisition, alter the single-snapshot invariant, change API/DOM source precedence,
or introduce a fallback.  Existing `/f/conversation` streamed-tail capture remains
the production tail-recovery mechanism while these diagnostics identify which stock
request hydrates delayed/reloaded turns.

Click-correlation diagnostics also record `Event.isTrusted`, pointer type and button
metadata.  A captured/synthetic click event must not be described as deliberate user
input without trusted-event evidence.

Finally, same-ID stale-prefix comparison is not inferred from User DOM text because
ChatGPT may append Retry/error/control chrome inside the mounted User-turn section.
Stable message identity still participates in presence/role checks; this change only
removes an unreliable User-content freshness signal.
'''
if '## Issue #123 stock network hydration diagnostics' not in design:
  design += section
DESIGN.write_text(design, encoding='utf-8')
