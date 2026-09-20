  }

  /**
   * Captures one completed XHR response without changing its responseType or page-visible data.
   *
   * @param {XMLHttpRequest} xhr - Completed page XHR instance.
   * @param {Object} trace - Stock-network correlation state.
   * @returns {Promise<void>} Resolves after response data is persisted.
   */
  async function communicationLogXhrResponse(xhr, trace) {
    if (!(await communicationLogAwaitReadyOrDrop())) return;
    const responseHeaders = {};
    try {
      for (const line of String(xhr?.getAllResponseHeaders?.() ?? '').split(/\r?\n/)) {
        const split = line.indexOf(':');
        if (split <= 0) continue;
        responseHeaders[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
      }
    } catch {}
    const contentType = responseHeaders['content-type'] ?? '';
    const responseUrl = xhr?.responseURL ?? trace?.url ?? '';
    await communicationLogRecord('communication_xhr_response', {
      network_sequence: trace?.sequence ?? null,
      method: trace?.method ?? null,
      request_url: trace?.url ?? null,
      response_url: stockNetworkSafeUrl(responseUrl),
      status: Number.isFinite(xhr?.status) ? xhr.status : null,
      response_type: xhr?.responseType || 'text',
      duration_ms: trace?.started_at == null ? null : Math.round(performance.now() - trace.started_at),
      content_type: contentType,
      headers: communicationLogSafeHeaders(responseHeaders)
    });
    if (!communicationLogShouldCaptureBody(responseUrl, contentType)) {
      await communicationLogRecord('communication_xhr_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
      return;
    }
    let text = null;
    try {
      if (!xhr.responseType || xhr.responseType === 'text') text = xhr.responseText;
      else if (xhr.responseType === 'json') text = JSON.stringify(xhr.response);
    } catch {}
    if (typeof text === 'string') {
      const summary = await communicationLogTextBody(text, 'communication_response_chunk', {
        transport: 'xmlhttprequest',
        network_sequence: trace?.sequence ?? null
      });
      await communicationLogRecord('communication_xhr_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        ...summary
      });
    } else {
      await communicationLogRecord('communication_xhr_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
    }
  }

  /**
   * Persists one outgoing WebSocket frame while leaving socket.send behavior unchanged.
   *
   * @param {string} url - WebSocket URL.
   * @param {Object} data - Frame data supplied to send().
   * @returns {Promise<void>} Resolves after frame metadata/content is persisted.
   */
  async function communicationLogWebSocketSend(url, data) {
    if (!(await communicationLogAwaitReadyOrDrop())) return;
    await communicationLogRecord('communication_websocket_send', {
      url: stockNetworkSafeUrl(url),
      data_type: typeof data === 'string' ? 'text' : Object.prototype.toString.call(data)
    });
    if (typeof data === 'string') {
      await communicationLogTextBody(data, 'communication_request_chunk', { transport: 'websocket' });
    } else {
      await communicationLogRecord('communication_websocket_send_body_end', {
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
    }
  }

  /**
   * Persists one incoming WebSocket frame while the existing streamed-tail consumer sees the original data.
   *
   * @param {string} url - WebSocket URL.
   * @param {Object} data - Incoming MessageEvent data.
   * @returns {Promise<void>} Resolves after frame metadata/content is persisted.
   */
  async function communicationLogWebSocketMessage(url, data) {
    if (!(await communicationLogAwaitReadyOrDrop())) return;
    await communicationLogRecord('communication_websocket_message', {
      url: stockNetworkSafeUrl(url),
      data_type: typeof data === 'string' ? 'text' : Object.prototype.toString.call(data)
    });
    if (typeof data === 'string') {
      await communicationLogTextBody(data, 'communication_response_chunk', { transport: 'websocket' });
    } else {
      await communicationLogRecord('communication_websocket_message_body_end', {
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
    }
  }

  /**
   * Persists transitions of the newest visible Assistant placeholder/error/thinking/hydrated state.
   *
   * @param {Object|null} marker - Newest mounted Assistant live-tail marker.
   * @param {string} reason - Live-tail scan reason.
   * @returns {void} No value is returned.
   */
  function communicationLogAssistantLifecycle(marker, reason) {
    if (!marker || marker.role !== 'assistant') return;
    const text = String(marker.comparison_text ?? '').trim();
    let state = marker.message_id ? 'hydrated' : 'placeholder';
    if (/message delivery timed out|timed out\. please try again/i.test(text)) state = 'timeout';
    else if (text.length <= 300 && /something went wrong|please try again|\bretry\b|connection interrupted/i.test(text)) state = 'retry';
    else if (!marker.message_id && text.length <= 100 && /^thinking(?:…|\.\.\.|\s*)$/i.test(text)) state = 'thinking';
    const lifecycleKey = [state, marker.message_id ?? '', marker.dom_turn_id ?? '', marker.content_fingerprint ?? ''].join('|');
    if (lifecycleKey === communicationLogLastAssistantLifecycleKey) return;
    communicationLogLastAssistantLifecycleKey = lifecycleKey;
    void communicationLogRecord('communication_assistant_lifecycle', {
      state,
      reason,
      conversation_id: currentConversationId(),
      message_id: marker.message_id ?? null,
      dom_turn_id: marker.dom_turn_id ?? null,
      container_id: marker.container_id ?? null,
      content_length: marker.content_length ?? null,
      content_fingerprint: marker.content_fingerprint ?? null
    }).catch(communicationError => communicationLogReportFailure('assistant-lifecycle', communicationError));
  }
  // END Issue #123 disk communication recorder

  /**
   * Handles remember API request context.
   *
   * @param {string} url - The URL to process.
   * @param {Array<Object>} headerCandidates - The HTTP header values to inspect.
   * @returns {void} No value is returned.
   */
  function rememberApiRequestContext(url, ...headerCandidates) {
    if (!isConversationApiUrl(url)) return;
    try {
      const parsed = new URL(url, location.href);
      const match = parsed.pathname.match(/^\/backend-api\/conversations\/([^/]+)/);
      if (!match) return;
      const headers = {};
      for (const candidate of headerCandidates) {
        for (const [key, value] of Object.entries(rawHeadersToObject(candidate))) {
          if (!(key in headers)) headers[key] = value;
        }
      }
      if (!headers.authorization) return;
      apiRequestContext = {
        conversation_id: match[1],
        headers,
        captured_at: new Date().toISOString()
      };
    } catch {}
  }

  /**
   * Handles click diagnostic element snapshot.
   *
   * @param {Element} element - The DOM element to inspect or update.
   * @returns {Object|null} The value produced by `clickDiagnosticElementSnapshot`, or `null` when unavailable.
   */
  function clickDiagnosticElementSnapshot(element) {
    if (!(element instanceof Element)) return null;
    const attributes = {};
    for (const attribute of [...element.attributes].slice(0, 40)) {
      if (attribute.name.startsWith('data-') ||
          ['href', 'src', 'aria-label', 'title', 'alt', 'download', 'target', 'role'].includes(attribute.name)) {
        attributes[attribute.name] = boundedDiagnosticText(attribute.value, 1000);
      }
    }
    return {
      tag: element.tagName.toLowerCase(),
      attributes,
      href_property: element instanceof HTMLAnchorElement ? element.href || null : null,
      src_property: element instanceof HTMLImageElement ? element.src || null : null,
      current_src: element instanceof HTMLImageElement ? element.currentSrc || null : null,
      text: boundedDiagnosticText(element.textContent?.trim() || '', 500) || null
    };
  }

  /**
   * Handles click diagnostic turn context.
   *
   * @param {EventTarget|null} target - The target element or resolved jump target.
   * @returns {Object|null} The value produced by `clickDiagnosticTurnContext`, or `null` when no value is available.
   */
  function clickDiagnosticTurnContext(target) {
    const section = target instanceof Element ? target.closest('section[data-turn-id]') : null;
    if (!(section instanceof HTMLElement)) return null;
    const message = section.querySelector('[data-message-id]');
    const clickedImage = target.closest('img');
    // One-based image ordinal used to correlate a click with the matching source image.
    let imageOrdinal = null;
    if (clickedImage instanceof HTMLImageElement) {
      const images = [...section.querySelectorAll(
        'button[aria-label^="Open image:"] img, [class~="group/message-image"] img'
      )];
      const index = images.indexOf(clickedImage);
      if (index >= 0) imageOrdinal = index + 1;
    }
    return {
      turn_id: section.getAttribute('data-turn-id') || null,
      message_id: message?.getAttribute('data-message-id') || null,
      role: section.getAttribute('data-turn') || null,
      image_ordinal: imageOrdinal
    };
  }

  /**
   * Handles record click diagnostic network request.
   *
   * @param {string} url - The URL to process.
   * @param {Object} initiatorType - The initiatorType value required by this function.
   * @returns {void} No value is returned.
   */
  function recordClickDiagnosticNetworkRequest(url, initiatorType) {
    // Snapshot the observation so this request is attributed to one click consistently.
    const active = activeClickDiagnostic;
    if (!active || performance.now() > active.deadline) return;
    const value = typeof url === 'string' ? url : String(url ?? '');
    if (!value) return;
    const item = {
      url: boundedDiagnosticText(value, 2000),
      initiator_type: initiatorType,
      elapsed_ms: Math.round(performance.now() - active.started_at)
    };
    active.network_requests.push(item);
    if (active.network_requests.length > 50) active.network_requests.shift();
    logDiagnostic('debug', 'conversation-click-network-request', {
      click_sequence: active.sequence,
      ...item
    });
  }
