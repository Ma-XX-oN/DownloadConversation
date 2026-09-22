
  /**
   * Parses the stock /f/conversation request clone into a new passive capture.
   *
   * @param {Request} request - Page-owned request cloned before transmission.
   * @param {number} submittedAtMs - Monotonic timestamp captured before request transmission.
   * @returns {Promise<Object|null>} Capture associated with this request, or null when unreadable.
   */
  async function captureGenerationStreamRequest(request, submittedAtMs) {
    try {
      const body = JSON.parse(await request.clone().text());
      const conversationId = typeof body?.conversation_id === 'string'
        ? body.conversation_id
        : currentConversationId();
      const capture = createStreamTailCapture(conversationId);
      agentTerminalRegisterLifecycleCapture(capture);
      streamTailCaptureRequest(capture, body);
      capture.stopwatch_submitted_at_ms = submittedAtMs;
      agentStopwatchObserveRequest(capture);
      streamTailCapture = capture;
      streamTailPersistCapture(capture);
      return capture;
    } catch (error) {
      logDiagnostic('warnings', 'conversation-stream-tail-request-capture-failure', {
        message: errorMessage(error)
      });
      return null;
    }
  }

  /**
   * Consumes one independently owned ChatGPT conversation SSE response through the canonical
   * stream parser and terminal dispatcher.
   *
   * @param {Response} response - Independently owned stock response clone.
   * @param {Object} capture - Mutable parser state for this observed stream.
   * @param {Object} options2 - Stream-consumption options.
   * @param {boolean} options2.persistCapture - Whether this stream is authoritative tail-recovery state.
   * @param {string} options2.source - Diagnostic source label.
   * @returns {Promise<void>} Resolves after the cloned response stream ends.
   */
  async function consumeObservedConversationStreamResponse(
    response,
    capture,
    { persistCapture, source }
  ) {
    if (!capture || !response?.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        consumeStreamTailSseChunk(capture, decoder.decode(value, { stream: true }), false, false);
      }
      consumeStreamTailSseChunk(capture, decoder.decode(), true, false);
      if (persistCapture) streamTailPersistCapture(capture);
      logDiagnostic('debug', 'conversation-stream-response-observed', {
        source,
        conversation_id: capture.conversation_id,
        stream_record_count: capture.stream_messages.length,
        handed_off: capture.handed_off,
        handoff_topic_id: capture.handoff_topic_id,
        complete: capture.complete
      });
    } catch (error) {
      capture.complete = false;
      if (persistCapture) streamTailPersistCapture(capture);
      logDiagnostic('warnings', 'conversation-stream-response-observation-failure', {
        source,
        conversation_id: capture.conversation_id,
        message: errorMessage(error)
      });
    } finally {
      releaseReaderLockQuietly(reader);
    }
  }

  /**
   * Reads a cloned /f/conversation response without consuming or delaying the stock page response.
   *
   * @param {Response} response - Cloned stock response.
   * @param {Object} capture - Capture associated with the request.
   * @returns {Promise<void>} Resolves after the cloned response stream ends.
   */
  async function captureGenerationStreamResponse(response, capture) {
    await consumeObservedConversationStreamResponse(response, capture, {
      persistCapture: true,
      source: 'generation'
    });
  }

  /**
   * Observes a cloned /f/conversation/resume response through the same canonical stream parser.
   *
   * The resume stream is lifecycle evidence only here; it must not replace the authoritative
   * tail-recovery snapshot captured from the original generation request.
   *
   * @param {Response} response - Independently owned resume response clone.
   * @param {Request} request - Independently owned resume request clone.
   * @returns {Promise<void>} Resolves after the cloned resume stream ends.
   */
  async function captureConversationResumeStreamResponse(response, request) {
    if (!response?.body || !request) return;
    try {
      const body = JSON.parse(await request.text());
      const conversationId = typeof body?.conversation_id === 'string' && body.conversation_id
        ? body.conversation_id
        : null;
      if (!conversationId) {
        throw new Error('Conversation resume request did not contain conversation_id.');
      }
      const capture = createStreamTailCapture(conversationId);
      agentTerminalRegisterLifecycleCapture(capture);
      await consumeObservedConversationStreamResponse(response, capture, {
        persistCapture: false,
        source: 'resume'
      });
    } catch (error) {
      logDiagnostic('warnings', 'conversation-resume-stream-observation-failure', {
        message: errorMessage(error)
      });
    }
  }

  /**
   * Extracts encoded SSE items from one matching ChatGPT WebSocket topic frame.
   *
   * @param {Object} capture - Active streamed-turn capture.
   * @param {Object} message - Parsed WebSocket message/catchup frame.
   * @returns {void} No value is returned.
   */
  function streamTailConsumeWebSocketMessage(capture, message) {
    if (!capture?.handoff_topic_id || !message || typeof message !== 'object') return;
    if (message.topic_id !== capture.handoff_topic_id) return;
    const encoded = message?.payload?.payload?.encoded_item;
    if (typeof encoded !== 'string' || !encoded) return;
    consumeStreamTailSseChunk(capture, encoded, false, true);
    if (capture.complete) streamTailPersistCapture(capture);
  }

  /**
   * Passively observes page WebSocket frames for both the active streamed-tail handoff topic and
   * the exact global provider turn-completion lifecycle notification.
   *
   * @param {Object} data - WebSocket message data.
   * @returns {void} No value is returned.
   */
  function captureGenerationWebSocketFrame(data) {
    if (typeof data !== 'string') return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }
    const frames = Array.isArray(parsed) ? parsed : [parsed];
    const capture = streamTailCapture;
    for (const frame of frames) {
      if (!frame || typeof frame !== 'object') continue;
      if (frame.type === 'message') {
        if (frame.topic_id === 'conversations' &&
            frame?.payload?.type === 'conversation-turn-complete') {
          agentTerminalObserveConversationTurnCompleteFrame(frame);
        }
        if (capture?.handed_off && capture.handoff_topic_id) {
          streamTailConsumeWebSocketMessage(capture, frame);
        }
      } else if (capture?.handed_off && capture.handoff_topic_id &&
                 frame.type === 'reply' && frame.reply?.topic_id === capture.handoff_topic_id) {
        for (const catchup of Array.isArray(frame.reply.catchups) ? frame.reply.catchups : []) {
          streamTailConsumeWebSocketMessage(capture, catchup);
        }
      }
    }
  }
  // END Issue #123 streamed-tail recovery


  /**
   * Handles install network capture.
   *
   * @returns {void} No value is returned.
   */
  function installNetworkCapture() {
    if (captureInstalled) return;
    // Use the page realm rather than the userscript sandbox when intercepting page networking.
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    if (typeof pageWindow.fetch === 'function') {
      const originalFetch = pageWindow.fetch;
      originalPageFetch = originalFetch;
      pageWindow.fetch = function(...args) {
        const input = args[0];
        const init = args[1] || {};
        let request = null;
        try {
          const PageRequest = pageWindow.Request || Request;
          request = input instanceof PageRequest ? input : new PageRequest(input, init);
        } catch {}
        const requestUrl = request?.url ?? String(input);
        const stockTrace = stockNetworkTraceFetchStart(request, requestUrl);
        void communicationLogFetchRequest(request, stockTrace)
          .catch(communicationError => communicationLogReportFailure('fetch-request', communicationError));
        rememberApiRequestContext(requestUrl, request?.headers, init.headers);
        recordClickDiagnosticNetworkRequest(requestUrl, 'fetch');
        const requestMethod = String(request?.method ?? init.method ?? 'GET').toUpperCase();
        if (request) void agentTerminalObserveStatsRequest(request, requestUrl, requestMethod);
        const stopwatchConversationRequest =
          requestMethod === 'GET' && agentStopwatchIsInitialConversationUrl(requestUrl);
        const generationRequest = isGenerationStreamUrl(requestUrl) && requestMethod === 'POST';
        const resumeRequest = isConversationResumeUrl(requestUrl) && requestMethod === 'POST';
        const steerTurnRequest = isSteerTurnUrl(requestUrl) && requestMethod === 'POST';
        const generationSubmittedAtMs = generationRequest ? performance.now() : null;
        if (generationRequest) agentFaviconObserveProcessing();
        if (steerTurnRequest) agentStopwatchObserveSteerTurn(performance.now());
        const capturePromise = generationRequest && request
          ? captureGenerationStreamRequest(request, generationSubmittedAtMs)
          : null;
        const resumeRequestClone = resumeRequest && request ? cloneSafely(request) : null;
        const responsePromise = originalFetch.apply(this, args);
        return responsePromise.then(response => {
          const generationResponse = capturePromise ? cloneSafely(response) : null;
          const resumeResponse = resumeRequest ? cloneSafely(response) : null;
          const stopwatchConversationResponse = stopwatchConversationRequest
            ? cloneSafely(response)
            : null;
          stockNetworkTraceFetchResponse(response, stockTrace);
          void communicationLogFetchResponse(response, stockTrace)
            .catch(communicationError => communicationLogReportFailure('fetch-response', communicationError));
          if (stopwatchConversationRequest && !stopwatchConversationResponse) {
            logDiagnostic('warnings', 'agent-stopwatch-recovery-response-clone-failure', {
              url: boundedDiagnosticText(response?.url ?? requestUrl, 320)
            });
          }
          if (stopwatchConversationResponse) {
            void agentStopwatchObserveConversationResponse(stopwatchConversationResponse)
              .catch(error => logDiagnostic('warnings', 'agent-stopwatch-recovery-failed', {
                message: boundedDiagnosticText(errorMessage(error), 1000)
              }));
          }
          if (resumeRequest && !resumeRequestClone) {
            logDiagnostic('warnings', 'conversation-resume-request-clone-failure', {
              url: boundedDiagnosticText(requestUrl, 320)
            });
          }
          if (resumeRequest && !resumeResponse) {
            logDiagnostic('warnings', 'conversation-resume-response-clone-failure', {
              url: boundedDiagnosticText(response?.url ?? requestUrl, 320)
            });
          }
          if (resumeRequestClone && resumeResponse) {
            void captureConversationResumeStreamResponse(resumeResponse, resumeRequestClone);
          }
          if (capturePromise && !generationResponse) {
            logDiagnostic('warnings', 'conversation-stream-tail-response-clone-failure', {
              url: boundedDiagnosticText(response?.url ?? requestUrl, 320)
            });