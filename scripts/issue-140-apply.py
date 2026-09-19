from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
  global text
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'Expected exactly one match, found {count}: {old[:160]!r}')
  text = text.replace(old, new, 1)


replace_once(
  '// @version      1.5.0-issue.140.3',
  '// @version      1.5.0-issue.140.4'
)

# The reload resume endpoint is a distinct stock source of the same conversation SSE protocol.
resume_detector = r'''
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

'''
steer_marker = "  /**\n   * Tests whether a URL is the stock same-turn User steering endpoint."
if text.count(steer_marker) != 1:
  raise SystemExit('Could not locate steering endpoint documentation marker.')
text = text.replace(steer_marker, resume_detector + steer_marker, 1)

# Generalize the cloned-stream reader so normal generation and reload resume share the exact parser.
start_marker = "  /**\n   * Reads a cloned /f/conversation response without consuming or delaying the stock page response."
end_marker = "  /**\n   * Extracts encoded SSE items from one matching ChatGPT WebSocket topic frame."
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end <= start:
  raise SystemExit('Could not locate cloned conversation-stream response reader block.')
replacement = r'''  /**
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

'''
text = text[:start] + replacement + text[end:]

replace_once(
  """        const generationRequest = isGenerationStreamUrl(requestUrl) && requestMethod === 'POST';
        const steerTurnRequest = isSteerTurnUrl(requestUrl) && requestMethod === 'POST';""",
  """        const generationRequest = isGenerationStreamUrl(requestUrl) && requestMethod === 'POST';
        const resumeRequest = isConversationResumeUrl(requestUrl) && requestMethod === 'POST';
        const steerTurnRequest = isSteerTurnUrl(requestUrl) && requestMethod === 'POST';"""
)

replace_once(
  """        const capturePromise = generationRequest && request
          ? captureGenerationStreamRequest(request, generationSubmittedAtMs)
          : null;
        const responsePromise = originalFetch.apply(this, args);""",
  """        const capturePromise = generationRequest && request
          ? captureGenerationStreamRequest(request, generationSubmittedAtMs)
          : null;
        const resumeRequestClone = resumeRequest && request ? cloneSafely(request) : null;
        const responsePromise = originalFetch.apply(this, args);"""
)

replace_once(
  """        return responsePromise.then(response => {
          const generationResponse = capturePromise ? cloneSafely(response) : null;
          const stopwatchConversationResponse = stopwatchConversationRequest""",
  """        return responsePromise.then(response => {
          const generationResponse = capturePromise ? cloneSafely(response) : null;
          const resumeResponse = resumeRequest ? cloneSafely(response) : null;
          const stopwatchConversationResponse = stopwatchConversationRequest"""
)

resume_projection = r'''          if (resumeRequest && !resumeRequestClone) {
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
'''
generation_clone_marker = "          if (capturePromise && !generationResponse) {"
if text.count(generation_clone_marker) != 1:
  raise SystemExit('Could not locate generation clone diagnostic marker.')
text = text.replace(generation_clone_marker, resume_projection + generation_clone_marker, 1)

path.write_text(text, encoding='utf-8')
