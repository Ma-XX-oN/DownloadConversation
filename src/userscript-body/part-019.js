          }
          if (capturePromise && generationResponse) {
            void capturePromise.then(capture => {
              if (!capture) {
                const cancelPromise = generationResponse.body?.cancel?.();
                if (cancelPromise && typeof cancelPromise.catch === 'function') {
                  void cancelPromise.catch(() => {});
                }
                return;
              }
              void captureGenerationStreamResponse(generationResponse, capture);
            });
          }
          return response;
        }, error => {
          logDiagnostic('debug', 'stock-network-fetch-failed', {
            network_sequence: stockTrace.sequence,
            method: stockTrace.method,
            url: stockTrace.url,
            duration_ms: Math.round(performance.now() - stockTrace.started_at),
            error: boundedDiagnosticText(errorMessage(error), 1000)
          });
          throw error;
        });
      };
    }

    // Retain the page-realm XHR constructor whose prototype is patched for capture.
    const XHR = pageWindow.XMLHttpRequest;
    if (XHR?.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      const originalSetRequestHeader = XHR.prototype.setRequestHeader;
      XHR.prototype.open = function(method, url, ...rest) {
        this.__tmApiRequest = { method: String(method), url: String(url), headers: {} };
        return originalOpen.call(this, method, url, ...rest);
      };
      XHR.prototype.setRequestHeader = function(name, value) {
        if (this.__tmApiRequest) {
          const key = String(name).toLowerCase();
          const prior = this.__tmApiRequest.headers[key];
          this.__tmApiRequest.headers[key] = prior ? `${prior}, ${value}` : String(value);
        }
        return originalSetRequestHeader.call(this, name, value);
      };
      XHR.prototype.send = function(body) {
        const info = this.__tmApiRequest || { method: 'GET', url: '', headers: {} };
        const stockTrace = stockNetworkTraceXhrStart(this, info);
        void communicationLogXhrRequest(info, body, stockTrace)
          .catch(communicationError => communicationLogReportFailure('xhr-request', communicationError));
        this.addEventListener('loadend', () => {
          stockNetworkTraceXhrResponse(this, stockTrace);
          void communicationLogXhrResponse(this, stockTrace)
            .catch(communicationError => communicationLogReportFailure('xhr-response', communicationError));
        }, { once: true });
        rememberApiRequestContext(info.url, info.headers);
        recordClickDiagnosticNetworkRequest(info.url, 'xmlhttprequest');
        return originalSend.call(this, body);
      };
    }

    if (typeof pageWindow.WebSocket === 'function') {
      const NativeWebSocket = pageWindow.WebSocket;
      pageWindow.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
          const socket = Reflect.construct(target, args, target);
          const socketUrl = String(args[0] ?? '');
          const nativeSend = socket.send;
          socket.send = function(data) {
            void communicationLogWebSocketSend(socketUrl, data)
              .catch(communicationError => communicationLogReportFailure('websocket-send', communicationError));
            return nativeSend.call(this, data);
          };
          socket.addEventListener('open', () => {
            void communicationLogRecord('communication_websocket_open', { url: stockNetworkSafeUrl(socketUrl) });
          });
          socket.addEventListener('message', event => {
            captureGenerationWebSocketFrame(event.data);
            void communicationLogWebSocketMessage(socketUrl, event.data)
              .catch(communicationError => communicationLogReportFailure('websocket-message', communicationError));
          });
          socket.addEventListener('close', event => {
            void communicationLogRecord('communication_websocket_close', {
              url: stockNetworkSafeUrl(socketUrl),
              code: event.code,
              was_clean: event.wasClean === true
            });
          });
          socket.addEventListener('error', () => {
            void communicationLogRecord('communication_websocket_error', { url: stockNetworkSafeUrl(socketUrl) });
          });
          return socket;
        }
      });
    }

    if (typeof pageWindow.open === 'function') {
      const originalOpen = pageWindow.open;
      pageWindow.open = function(url, ...rest) {
        recordClickDiagnosticNetworkRequest(url, 'window.open');
        return originalOpen.call(this, url, ...rest);
      };
    }

    captureInstalled = true;
  }

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
