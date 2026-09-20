    let chunkCount = 0;
    // Terminal cloned-body read error; null means the reader reached clean EOF.
    let streamErrorMessage = null;
    try {
      for (;;) {
        let result = null;
        try {
          result = await reader.read();
        } catch (error) {
          streamErrorMessage = errorMessage(error);
          break;
        }
        if (result.done) break;
        if (!result.value?.byteLength) continue;
        byteCount += result.value.byteLength;
        safePending += communicationLogRedactStreamFeed(
          redactionState,
          decoder.decode(result.value, { stream: true }),
          false
        );
        while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
          const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          chunkCount += 1;
          await communicationLogRecord(recordType, {
            ...context,
            chunk_ordinal: chunkCount,
            data: chunk
          });
        }
      }
      safePending += communicationLogRedactStreamFeed(redactionState, decoder.decode(), true);
      while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
        const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: chunk
        });
      }
      if (safePending) {
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: safePending
        });
      }
      const summary = { byte_count: byteCount, chunk_count: chunkCount };
      if (streamErrorMessage !== null) {
        summary.body_incomplete = true;
        summary.error_message = streamErrorMessage;
      }
      return summary;
    } finally {
      releaseReaderLockQuietly(reader);
    }
  }

  /**
   * Persists one already-materialized textual body in bounded chunks.
   *
   * @param {string} text - Raw body text already held by XHR/WebSocket/page code.
   * @param {string} recordType - JSONL chunk record type.
   * @param {Object} context - Correlation metadata repeated on each chunk.
   * @returns {Promise<Object>} Persisted character/chunk counts.
   */
  async function communicationLogTextBody(text, recordType, context) {
    const value = String(text ?? '');
    const redactionState = communicationLogCreateRedactionState();
    let safePending = '';
    let chunkCount = 0;
    for (let offset = 0; offset < value.length; offset += COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
      safePending += communicationLogRedactStreamFeed(
        redactionState,
        value.slice(offset, offset + COMMUNICATION_LOG_BODY_CHUNK_CHARS),
        false
      );
      while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
        const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: chunk
        });
      }
    }
    safePending += communicationLogRedactStreamFeed(redactionState, '', true);
    while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
      const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
      safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
      chunkCount += 1;
      await communicationLogRecord(recordType, {
        ...context,
        chunk_ordinal: chunkCount,
        data: chunk
      });
    }
    if (safePending) {
      chunkCount += 1;
      await communicationLogRecord(recordType, {
        ...context,
        chunk_ordinal: chunkCount,
        data: safePending
      });
    }
    return { character_count: value.length, chunk_count: chunkCount };
  }

  /**
   * Captures one stock fetch Request clone and its textual body without consuming the page Request.
   *
   * @param {Request|null} request - Page Request object.
   * @param {Object} trace - Stock-network correlation state.
   * @returns {Promise<void>} Resolves after request data is persisted or deliberately omitted.
   */
  async function communicationLogFetchRequest(request, trace) {
    const cloned = cloneSafely(request);
    if (!(await communicationLogAwaitReadyOrDrop(cloned?.body ?? null))) return;
    const contentType = request?.headers?.get?.('content-type') ?? '';
    await communicationLogRecord('communication_fetch_request', {
      origin: trace?.origin ?? 'stock-chatgpt',
      network_sequence: trace?.sequence ?? null,
      method: String(request?.method ?? trace?.method ?? 'GET').toUpperCase(),
      url: stockNetworkSafeUrl(request?.url ?? trace?.url ?? ''),
      cache_mode: request?.cache ?? null,
      request_mode: request?.mode ?? null,
      credentials_mode: request?.credentials ?? null,
      destination: request?.destination ?? null,
      redirect_mode: request?.redirect ?? null,
      content_type: contentType,
      headers: communicationLogSafeHeaders(request?.headers)
    });
    if (cloned?.body && communicationLogShouldCaptureBody(request?.url ?? trace?.url ?? '', contentType)) {
      const summary = await communicationLogStreamBody(cloned.body, 'communication_request_chunk', {
        transport: 'fetch',
        network_sequence: trace?.sequence ?? null
      });
      await communicationLogRecord('communication_fetch_request_body_end', {
        network_sequence: trace?.sequence ?? null,
        ...summary
      });
    } else if (cloned?.body) {
      await communicationLogRecord('communication_fetch_request_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
      await cancelReadableBodyQuietly(cloned.body);
    }
  }

  /**
   * Captures one stock fetch Response clone, including full textual API/SSE content in bounded chunks.
   *
   * @param {Response} response - Original page response; only a clone is read.
   * @param {Object} trace - Stock-network correlation state.
   * @returns {Promise<void>} Resolves after response data is persisted or deliberately omitted.
   */
  async function communicationLogFetchResponse(response, trace) {
    const cloned = cloneSafely(response);
    if (!(await communicationLogAwaitReadyOrDrop(cloned?.body ?? null))) return;
    const contentType = response?.headers?.get?.('content-type') ?? '';
    const responseUrl = response?.url ?? trace?.url ?? '';
    await communicationLogRecord('communication_fetch_response', {
      origin: trace?.origin ?? 'stock-chatgpt',
      network_sequence: trace?.sequence ?? null,
      method: trace?.method ?? null,
      request_url: trace?.url ?? null,
      response_url: stockNetworkSafeUrl(responseUrl),
      status: response?.status ?? null,
      ok: response?.ok === true,
      redirected: response?.redirected === true,
      response_type: response?.type ?? null,
      duration_ms: trace?.started_at == null ? null : Math.round(performance.now() - trace.started_at),
      content_type: contentType,
      headers: communicationLogSafeHeaders(response?.headers)
    });
    if (cloned?.body && communicationLogShouldCaptureBody(responseUrl, contentType)) {
      const summary = await communicationLogStreamBody(cloned.body, 'communication_response_chunk', {
        transport: 'fetch',
        network_sequence: trace?.sequence ?? null
      });
      await communicationLogRecord('communication_fetch_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        ...summary
      });
      if (summary.body_incomplete) {
        logDiagnostic('warnings', 'communication-log-response-body-incomplete', {
          network_sequence: trace?.sequence ?? null,
          response_url: stockNetworkSafeUrl(responseUrl),
          byte_count: summary.byte_count,
          chunk_count: summary.chunk_count,
          message: summary.error_message
        });
      }
    } else if (cloned?.body) {
      await communicationLogRecord('communication_fetch_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
      await cancelReadableBodyQuietly(cloned.body);
    }
    try {
      if (new URL(responseUrl, location.href).pathname === '/backend-api/f/conversation') {
        await communicationLogCheckpoint('generation-response-complete');
      }
    } catch {}
  }

  /**
   * Captures one XHR request and any directly available textual request body.
   *
   * @param {Object} info - Captured XHR method/URL/header metadata.
   * @param {Object|null} body - XHR send() body.
   * @param {Object} trace - Stock-network correlation state.
   * @returns {Promise<void>} Resolves after request data is persisted.
   */
  async function communicationLogXhrRequest(info, body, trace) {
    if (!(await communicationLogAwaitReadyOrDrop())) return;
    const contentType = info?.headers?.['content-type'] ?? '';
    await communicationLogRecord('communication_xhr_request', {
      network_sequence: trace?.sequence ?? null,
      method: String(info?.method ?? 'GET').toUpperCase(),
      url: stockNetworkSafeUrl(info?.url ?? ''),
      content_type: contentType,
      headers: communicationLogSafeHeaders(info?.headers)
    });
    if (typeof body === 'string' || body instanceof URLSearchParams) {
      await communicationLogTextBody(String(body), 'communication_request_chunk', {
        transport: 'xmlhttprequest',
        network_sequence: trace?.sequence ?? null
      });
    } else if (body != null) {
      await communicationLogRecord('communication_xhr_request_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
    }
