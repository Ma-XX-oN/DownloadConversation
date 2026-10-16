    let chunkCount = 0;
    let streamErrorMessage = null;
    try {
      for (;;) {
        let result;
        try { result = await reader.read(); }
        catch {
          streamErrorMessage = 'body-stream-read-failed';
          break;
        }
        if (result.done) break;
        if (!result.value?.byteLength) continue;
        byteCount += result.value.byteLength;
        rawChunkCount += 1;
        safePending += await communicationMarkerV1BodyFeed(
          redactionState, decoder.decode(result.value, { stream: true }), false
        );
        if (safePending.length > COMMUNICATION_MARKER_MAX_STAGED_CHARS) {
          throw new Error('redaction-body-too-long');
        }
      }
      if (streamErrorMessage !== null) {
        throw new Error('redaction-incomplete-stream');
      }
      safePending += await communicationMarkerV1BodyFeed(redactionState, decoder.decode(), true);
      if (safePending.length > COMMUNICATION_MARKER_MAX_STAGED_CHARS) {
        throw new Error('redaction-body-too-long');
      }
      for (let offset = 0; offset < safePending.length; offset += COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          redaction_format: COMMUNICATION_MARKER_FORMAT,
          redaction_scope: communicationMarkerV1Scope,
          chunk_ordinal: chunkCount,
          data: safePending.slice(offset, offset + COMMUNICATION_LOG_BODY_CHUNK_CHARS)
        });
      }
      return {
        byte_count: byteCount, raw_chunk_count: rawChunkCount,
        chunk_count: chunkCount, redaction_format: COMMUNICATION_MARKER_FORMAT,
        redaction_scope: communicationMarkerV1Scope
      };
    } catch {
      return {
        byte_count: byteCount, raw_chunk_count: rawChunkCount,
        chunk_count: 0, redaction_failed: true,
        redaction_error: 'redaction-fail-closed',
        ...(streamErrorMessage !== null ? {
          body_incomplete: true, error_message: streamErrorMessage
        } : {})
      };
    } finally {
      releaseReaderLockQuietly(reader);
    }
  }

  /**
   * Stage an already-materialized text body until its entire structure validates.
   *
   * @param {string} text - Original XHR or WebSocket textual body.
   * @param {string} recordType - JSONL chunk record type.
   * @param {Object} context - Transport and content-type metadata.
   * @returns {Promise<Object>} Raw sizes and committed redacted chunk count.
   */
  async function communicationLogTextBody(text, recordType, context) {
    const value = String(text ?? '');
    let count = 0;
    try {
      if (value.length > COMMUNICATION_MARKER_MAX_STAGED_CHARS) {
        throw new Error('redaction-body-too-long');
      }
      const state = communicationMarkerV1BodyState(context.content_type, context.transport);
      let safe = '';
      for (let offset = 0; offset < value.length; offset += COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
        safe += await communicationMarkerV1BodyFeed(
          state, value.slice(offset, offset + COMMUNICATION_LOG_BODY_CHUNK_CHARS), false
        );
        if (safe.length > COMMUNICATION_MARKER_MAX_STAGED_CHARS) {
          throw new Error('redaction-body-too-long');
        }
      }
      safe += await communicationMarkerV1BodyFeed(state, '', true);
      if (safe.length > COMMUNICATION_MARKER_MAX_STAGED_CHARS) {
        throw new Error('redaction-body-too-long');
      }
      for (let offset = 0; offset < safe.length; offset += COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
        count += 1;
        await communicationLogRecord(recordType, {
          ...context, redaction_format: COMMUNICATION_MARKER_FORMAT,
          redaction_scope: communicationMarkerV1Scope,
          chunk_ordinal: count, data: safe.slice(offset, offset + COMMUNICATION_LOG_BODY_CHUNK_CHARS)
        });
      }
      return {
        character_count: value.length, chunk_count: count,
        redaction_format: COMMUNICATION_MARKER_FORMAT,
        redaction_scope: communicationMarkerV1Scope
      };
    } catch {
      return {
        character_count: value.length, chunk_count: 0,
        redaction_failed: true, redaction_error: 'redaction-fail-closed'
      };
    }
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
      url: await communicationMarkerV1SafeUrl(request?.url ?? trace?.url ?? ''),
      cache_mode: request?.cache ?? null,
      request_mode: request?.mode ?? null,
      credentials_mode: request?.credentials ?? null,
      destination: request?.destination ?? null,
      redirect_mode: request?.redirect ?? null,
      content_type: contentType,
      redaction_format: COMMUNICATION_MARKER_FORMAT,
      redaction_scope: communicationMarkerV1Scope,
      headers: await communicationLogSafeHeaders(request?.headers)
    });
    if (cloned?.body && communicationLogShouldCaptureBody(request?.url ?? trace?.url ?? '', contentType)) {
      const summary = await communicationLogStreamBody(cloned.body, 'communication_request_chunk', {
        content_type: contentType,
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
      request_url: trace?.url ? await communicationMarkerV1SafeUrl(trace.url) : null,
      response_url: await communicationMarkerV1SafeUrl(responseUrl),
      status: response?.status ?? null,
      ok: response?.ok === true,
      redirected: response?.redirected === true,
      response_type: response?.type ?? null,
      duration_ms: trace?.started_at == null ? null : Math.round(performance.now() - trace.started_at),
      content_type: contentType,
      redaction_format: COMMUNICATION_MARKER_FORMAT,
      redaction_scope: communicationMarkerV1Scope,
      headers: await communicationLogSafeHeaders(response?.headers)
    });
    if (cloned?.body && communicationLogShouldCaptureBody(responseUrl, contentType)) {
      const summary = await communicationLogStreamBody(cloned.body, 'communication_response_chunk', {
        content_type: contentType,
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
          response_url: await communicationMarkerV1SafeUrl(responseUrl),
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
      url: await communicationMarkerV1SafeUrl(info?.url ?? ''),
      content_type: contentType,
      redaction_format: COMMUNICATION_MARKER_FORMAT,
      redaction_scope: communicationMarkerV1Scope,
      headers: await communicationLogSafeHeaders(info?.headers)
    });
    if (typeof body === 'string' || body instanceof URLSearchParams) {
      await communicationLogTextBody(String(body), 'communication_request_chunk', {
        transport: 'xmlhttprequest',
        content_type: contentType,
        network_sequence: trace?.sequence ?? null
      });
    } else if (body != null) {
      await communicationLogRecord('communication_xhr_request_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
    }
