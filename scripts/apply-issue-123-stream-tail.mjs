import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = 'chatgpt-conversation-markdown-export.user.js';
const designPath = 'DESIGN.md';
const testPath = 'tests/stream-tail-recovery.test.mjs';

let source = await readFile(sourcePath, 'utf8');
let design = await readFile(designPath, 'utf8');
let tests = await readFile(testPath, 'utf8');

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Ambiguous patch anchor: ${label}`);
  }
  return `${text.slice(0, first)}${after}${text.slice(first + before.length)}`;
}

source = replaceOnce(
  source,
  '// @version      1.0.1-issue.123.3',
  '// @version      1.0.1-issue.123.4',
  'issue version'
);

source = replaceOnce(
  source,
  "  /** Maximum normalized visible characters retained per live tail marker for bounded comparison. */\n  const LIVE_TAIL_TEXT_LIMIT = 8192;",
  `  /** Maximum normalized visible characters retained per live tail marker for bounded comparison. */\n  const LIVE_TAIL_TEXT_LIMIT = 8192;\n  /** Session-storage key for the newest exact streamed conversation-turn capture. */\n  const STREAM_TAIL_STORAGE_KEY = 'tm-conversation-recorder-stream-tail';\n  /** Maximum source records retained from one live streamed conversation turn. */\n  const STREAM_TAIL_RECORD_LIMIT = 512;`,
  'stream tail constants'
);

source = replaceOnce(
  source,
  "  /** Scroll root currently supplying direction evidence for live-tail tracking. */\n  let liveTailObservedScrollRoot = null;",
  `  /** Scroll root currently supplying direction evidence for live-tail tracking. */\n  let liveTailObservedScrollRoot = null;\n  /** Newest passive /f/conversation streamed-turn capture observed in this page lifetime. */\n  let streamTailCapture = null;`,
  'stream tail state'
);

const streamedTailBlock = String.raw`
  // BEGIN Issue #123 streamed-tail recovery
  /**
   * Tests whether a URL is the stock streaming conversation-generation endpoint.
   *
   * @param {string} url - Candidate request URL.
   * @returns {boolean} True only for this origin's exact /backend-api/f/conversation path.
   */
  function isGenerationStreamUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && parsed.pathname === '/backend-api/f/conversation';
    } catch {
      return false;
    }
  }

  /**
   * Creates mutable state for one passively observed streamed conversation turn.
   *
   * @param {string|null} conversationId - Conversation identity known at request time, when any.
   * @returns {Object} Mutable capture state for the streamed turn.
   */
  function createStreamTailCapture(conversationId = null) {
    return {
      schema_version: 1,
      conversation_id: typeof conversationId === 'string' && conversationId ? conversationId : null,
      parent_message_id: null,
      request_messages: [],
      stream_messages: [],
      message_index_by_id: new Map(),
      current_envelope: null,
      sse_buffer: '',
      done_received: false,
      handoff_done_received: false,
      message_stream_complete: false,
      handed_off: false,
      handoff_topic_id: null,
      overflow: false,
      complete: false,
      updated_at: Date.now()
    };
  }

  /**
   * Clones one provider record without retaining references into page-owned objects.
   *
   * @param {Object} value - JSON-compatible provider value.
   * @returns {Object} Independent copy of the provider value.
   */
  function streamTailClone(value) {
    return structuredClone(value);
  }

  /**
   * Adds or refreshes one exact streamed provider message by stable message id.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object} message - Provider message object received from the stream.
   * @returns {boolean} True when the capture retained or refreshed the message.
   */
  function streamTailUpsertMessage(capture, message) {
    const id = typeof message?.id === 'string' ? message.id : '';
    if (!id || capture?.overflow) return false;
    const existing = capture.message_index_by_id.get(id);
    const copy = streamTailClone(message);
    if (existing !== undefined) {
      capture.stream_messages[existing] = copy;
      capture.updated_at = Date.now();
      return true;
    }
    if (capture.stream_messages.length >= STREAM_TAIL_RECORD_LIMIT) {
      capture.overflow = true;
      capture.complete = false;
      return false;
    }
    capture.message_index_by_id.set(id, capture.stream_messages.length);
    capture.stream_messages.push(copy);
    capture.updated_at = Date.now();
    return true;
  }

  /**
   * Records the exact User request records and parent identity submitted to /f/conversation.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object} requestBody - Parsed stock /f/conversation request body.
   * @returns {void} No value is returned.
   */
  function streamTailCaptureRequest(capture, requestBody) {
    if (!capture || !requestBody || typeof requestBody !== 'object') return;
    if (typeof requestBody.conversation_id === 'string' && requestBody.conversation_id) {
      capture.conversation_id = requestBody.conversation_id;
    }
    capture.parent_message_id = typeof requestBody.parent_message_id === 'string'
      ? requestBody.parent_message_id
      : null;
    const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
    capture.request_messages = messages
      .filter(message => typeof message?.id === 'string' && message.id)
      .slice(-STREAM_TAIL_RECORD_LIMIT)
      .map(streamTailClone);
    capture.updated_at = Date.now();
  }

  /**
   * Decodes one JSON Pointer path segment.
   *
   * @param {string} segment - Encoded JSON Pointer segment.
   * @returns {string} Decoded property name.
   */
  function streamTailPointerSegment(segment) {
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
  }

  /**
   * Applies one v1 patch operation to the current streamed root envelope.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {string} path - JSON Pointer path within the current root envelope.
   * @param {string} operation - v1 patch operation.
   * @param {Object} value - Patch value.
   * @returns {void} No value is returned.
   */
  function streamTailApplyPathPatch(capture, path, operation, value) {
    if (!capture?.current_envelope || typeof capture.current_envelope !== 'object') return;
    const effectivePath = path || '/message/content/parts/0';
    const segments = effectivePath.split('/').slice(1).map(streamTailPointerSegment);
    if (!segments.length) return;
    let target = capture.current_envelope;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const key = segments[index];
      if (!target || typeof target !== 'object' || !(key in target)) return;
      target = target[key];
    }
    if (!target || typeof target !== 'object') return;
    const key = segments.at(-1);
    const op = String(operation || 'append');
    if (op === 'append' || op === 'a') {
      if (typeof target[key] === 'string' && typeof value === 'string') target[key] += value;
      else if (Array.isArray(target[key])) target[key].push(streamTailClone(value));
      else target[key] = streamTailClone(value);
    } else if (op === 'replace' || op === 'r' || op === 'add') {
      target[key] = streamTailClone(value);
    } else {
      return;
    }
    if (capture.current_envelope.message) {
      streamTailUpsertMessage(capture, capture.current_envelope.message);
    }
  }

  /**
   * Applies one parsed v1 stream event to the captured provider state.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object} event - Parsed SSE event object.
   * @returns {void} No value is returned.
   */
  function streamTailApplyEvent(capture, event) {
    if (!capture || !event || typeof event !== 'object' || Array.isArray(event)) return;
    if (typeof event.conversation_id === 'string' && event.conversation_id) {
      capture.conversation_id = event.conversation_id;
    }
    if (event.type === 'stream_handoff') {
      const options = Array.isArray(event.options) ? event.options : [];
      const option = options.find(item => item?.type === 'subscribe_ws_topic') ??
        options.find(item => item?.type === 'resume_sse_endpoint');
      capture.handed_off = true;
      capture.handoff_topic_id = typeof option?.topic_id === 'string' ? option.topic_id : null;
      capture.complete = false;
      capture.updated_at = Date.now();
      return;
    }
    if (event.type === 'message_stream_complete') {
      capture.message_stream_complete = true;
      if (!capture.overflow) capture.complete = true;
      capture.updated_at = Date.now();
      return;
    }
    if (event.message && typeof event.message === 'object') {
      streamTailUpsertMessage(capture, event.message);
      return;
    }
    if (!('v' in event)) return;
    const rootPath = event.p === undefined || event.p === '';
    if (Array.isArray(event.v) && rootPath) {
      for (const patch of event.v) {
        if (patch && typeof patch === 'object') streamTailApplyEvent(capture, patch);
      }
      return;
    }
    if (event.v && typeof event.v === 'object' && !Array.isArray(event.v) && rootPath) {
      capture.current_envelope = streamTailClone(event.v);
      if (typeof capture.current_envelope.conversation_id === 'string') {
        capture.conversation_id = capture.current_envelope.conversation_id;
      }
      if (capture.current_envelope.message) {
        streamTailUpsertMessage(capture, capture.current_envelope.message);
      }
      return;
    }
    streamTailApplyPathPatch(
      capture,
      typeof event.p === 'string' ? event.p : '',
      typeof event.o === 'string' ? event.o : 'append',
      event.v
    );
  }

  /**
   * Reports whether the capture contains a finished final Assistant record.
   *
   * @param {Object} capture - Mutable or frozen streamed-turn capture.
   * @returns {boolean} True when a final Assistant record is complete.
   */
  function streamTailHasCompletedAssistant(capture) {
    return (capture?.stream_messages ?? []).some(message =>
      message?.author?.role === 'assistant' &&
      (message?.channel === 'final' || message?.end_turn === true) &&
      (message?.status === 'finished_successfully' || message?.end_turn === true)
    );
  }

  /**
   * Consumes one text chunk from either the bootstrap SSE or its WebSocket handoff leg.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {string} chunk - Raw SSE bytes decoded as text.
   * @param {boolean} finalChunk - Whether no more bytes remain in this leg.
   * @param {boolean} fromHandoff - Whether the chunk came from the subscribed WebSocket topic.
   * @returns {void} No value is returned.
   */
  function consumeStreamTailSseChunk(capture, chunk, finalChunk = false, fromHandoff = false) {
    if (!capture) return;
    capture.sse_buffer += String(chunk ?? '').replace(/\r\n/g, '\n');
    const events = [];
    for (;;) {
      const boundary = capture.sse_buffer.indexOf('\n\n');
      if (boundary < 0) break;
      events.push(capture.sse_buffer.slice(0, boundary));
      capture.sse_buffer = capture.sse_buffer.slice(boundary + 2);
    }
    if (finalChunk && capture.sse_buffer.trim()) {
      events.push(capture.sse_buffer);
      capture.sse_buffer = '';
    }
    for (const rawEvent of events) {
      const data = rawEvent.split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
      if (!data) continue;
      if (data === '[DONE]') {
        if (fromHandoff) capture.handoff_done_received = true;
        else capture.done_received = true;
        if (!capture.overflow &&
            (fromHandoff || !capture.handed_off) &&
            streamTailHasCompletedAssistant(capture)) {
          capture.complete = true;
        }
        capture.updated_at = Date.now();
        continue;
      }
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      if (typeof parsed === 'string') continue;
      streamTailApplyEvent(capture, parsed);
    }
    if (capture.complete) streamTailPersistCapture(capture);
  }

  /**
   * Produces a serializable exact snapshot of one streamed-turn capture.
   *
   * @param {Object|null} capture - Mutable capture to freeze.
   * @returns {Object|null} Serializable snapshot, or null when unavailable.
   */
  function streamTailCaptureSnapshot(capture) {
    if (!capture) return null;
    return {
      schema_version: 1,
      conversation_id: capture.conversation_id ?? null,
      parent_message_id: capture.parent_message_id ?? null,
      request_messages: (capture.request_messages ?? []).map(streamTailClone),
      stream_messages: (capture.stream_messages ?? []).map(streamTailClone),
      done_received: Boolean(capture.done_received),
      handoff_done_received: Boolean(capture.handoff_done_received),
      message_stream_complete: Boolean(capture.message_stream_complete),
      handed_off: Boolean(capture.handed_off),
      handoff_topic_id: capture.handoff_topic_id ?? null,
      overflow: Boolean(capture.overflow),
      complete: Boolean(capture.complete),
      updated_at: Number(capture.updated_at) || Date.now()
    };
  }

  /**
   * Persists the exact bounded streamed-turn snapshot across a same-tab hard reload.
   *
   * @param {Object} capture - Capture to persist.
   * @returns {boolean} True when session storage accepted the snapshot.
   */
  function streamTailPersistCapture(capture) {
    try {
      const snapshot = streamTailCaptureSnapshot(capture);
      if (!snapshot) return false;
      sessionStorage.setItem(STREAM_TAIL_STORAGE_KEY, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restores the newest matching streamed-turn snapshot from same-tab session storage.
   *
   * @param {string} conversationId - Current conversation identity.
   * @returns {Object|null} Restored mutable capture, or null when no matching snapshot exists.
   */
  function streamTailRestoreCapture(conversationId) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STREAM_TAIL_STORAGE_KEY) || 'null');
      if (!parsed || parsed.schema_version !== 1 || parsed.conversation_id !== conversationId) return null;
      const capture = createStreamTailCapture(parsed.conversation_id);
      capture.parent_message_id = parsed.parent_message_id ?? null;
      capture.request_messages = Array.isArray(parsed.request_messages)
        ? parsed.request_messages.map(streamTailClone)
        : [];
      capture.stream_messages = Array.isArray(parsed.stream_messages)
        ? parsed.stream_messages.map(streamTailClone)
        : [];
      capture.message_index_by_id = new Map(
        capture.stream_messages.map((message, index) => [message.id, index])
      );
      capture.done_received = Boolean(parsed.done_received);
      capture.handoff_done_received = Boolean(parsed.handoff_done_received);
      capture.message_stream_complete = Boolean(parsed.message_stream_complete);
      capture.handed_off = Boolean(parsed.handed_off);
      capture.handoff_topic_id = parsed.handoff_topic_id ?? null;
      capture.overflow = Boolean(parsed.overflow);
      capture.complete = Boolean(parsed.complete);
      capture.updated_at = Number(parsed.updated_at) || Date.now();
      return capture;
    } catch {
      return null;
    }
  }

  /**
   * Returns one de-duplicated provider-message sequence for the submitted and streamed turn.
   *
   * @param {Object} capture - Frozen streamed-turn snapshot.
   * @returns {Array<Object>} Ordered exact provider messages for the turn.
   */
  function streamTailCapturedSequence(capture) {
    const sequence = [];
    const indexById = new Map();
    for (const message of [
      ...(capture?.request_messages ?? []),
      ...(capture?.stream_messages ?? [])
    ]) {
      const id = typeof message?.id === 'string' ? message.id : '';
      if (!id) continue;
      const existing = indexById.get(id);
      if (existing !== undefined) sequence[existing] = streamTailClone(message);
      else {
        indexById.set(id, sequence.length);
        sequence.push(streamTailClone(message));
      }
    }
    return sequence;
  }

  /**
   * Reconciles one complete streamed turn only when history ends at an exact prefix of that turn.
   *
   * Existing history remains authoritative before the captured parent anchor. Matching captured
   * tail records replace stale same-ID copies in place, and only the remaining contiguous captured
   * suffix is appended. Any identity gap or non-suffix divergence is rejected.
   *
   * @param {Object} spine - History-API conversation spine.
   * @param {Object|null} capture - Frozen complete streamed-turn snapshot.
   * @returns {Object} Merge result containing the authoritative reconciled spine.
   */
  function mergeStreamTailCaptureIntoSpine(spine, capture) {
    if (!capture) return { merged: false, reason: 'no-capture', spine, appended_count: 0, replaced_count: 0 };
    if (!capture.complete || capture.overflow) {
      return { merged: false, reason: capture.overflow ? 'capture-overflow' : 'capture-incomplete', spine, appended_count: 0, replaced_count: 0 };
    }
    const sequence = streamTailCapturedSequence(capture);
    if (!sequence.length) return { merged: false, reason: 'capture-empty', spine, appended_count: 0, replaced_count: 0 };
    const history = (spine?.records ?? []).map(record => record?.message).filter(Boolean);
    const parentId = capture.parent_message_id;
    const parentIndex = typeof parentId === 'string'
      ? history.findIndex(message => message?.id === parentId)
      : -1;
    let sequenceStart = 0;
    let anchorIndex = parentIndex;
    let anchorId = parentIndex >= 0 ? parentId : null;
    if (parentIndex < 0) {
      const firstOverlap = sequence.findIndex(message =>
        history.some(existing => existing?.id === message.id)
      );
      if (firstOverlap < 0) {
        return { merged: false, reason: 'no-overlap-anchor', spine, appended_count: 0, replaced_count: 0 };
      }
      const overlapId = sequence[firstOverlap].id;
      anchorIndex = history.findIndex(message => message?.id === overlapId);
      anchorId = overlapId;
      sequenceStart = firstOverlap + 1;
    }
    const historyTail = history.slice(anchorIndex + 1);
    const expected = sequence.slice(sequenceStart);
    if (historyTail.length > expected.length) {
      return { merged: false, reason: 'non-suffix-gap', spine, appended_count: 0, replaced_count: 0 };
    }
    for (let index = 0; index < historyTail.length; index += 1) {
      if (historyTail[index]?.id !== expected[index]?.id) {
        return { merged: false, reason: 'non-suffix-gap', spine, appended_count: 0, replaced_count: 0 };
      }
    }
    const mergedMessages = history.slice(0, anchorIndex + 1);
    let replacedCount = 0;
    for (let index = 0; index < historyTail.length; index += 1) {
      const replacement = expected[index];
      if (JSON.stringify(historyTail[index]) !== JSON.stringify(replacement)) replacedCount += 1;
      mergedMessages.push(streamTailClone(replacement));
    }
    const appended = expected.slice(historyTail.length);
    mergedMessages.push(...appended.map(streamTailClone));
    if (!replacedCount && !appended.length) {
      return { merged: false, reason: 'up-to-date', spine, appended_count: 0, replaced_count: 0, anchor_message_id: anchorId };
    }
    const rebuilt = conversationSpineFromPages([
      { messages: mergedMessages, page_info: { has_previous_page: false, has_next_page: false } }
    ]);
    rebuilt.pages = Array.isArray(spine?.pages) ? [...spine.pages] : rebuilt.pages;
    return {
      merged: true,
      reason: 'streamed-tail-recovered',
      spine: rebuilt,
      appended_count: appended.length,
      replaced_count: replacedCount,
      anchor_message_id: anchorId
    };
  }

  /**
   * Parses the stock /f/conversation request clone into a new passive capture.
   *
   * @param {Request} request - Page-owned request cloned before transmission.
   * @returns {Promise<Object|null>} Capture associated with this request, or null when unreadable.
   */
  async function captureGenerationStreamRequest(request) {
    try {
      const body = JSON.parse(await request.clone().text());
      const conversationId = typeof body?.conversation_id === 'string'
        ? body.conversation_id
        : currentConversationId();
      const capture = createStreamTailCapture(conversationId);
      streamTailCaptureRequest(capture, body);
      streamTailCapture = capture;
      streamTailPersistCapture(capture);
      return capture;
    } catch (error) {
      logDiagnostic('warnings', 'conversation-stream-tail-request-capture-failure', {
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
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
      streamTailPersistCapture(capture);
      logDiagnostic('debug', 'conversation-stream-tail-response-captured', {
        conversation_id: capture.conversation_id,
        stream_record_count: capture.stream_messages.length,
        handed_off: capture.handed_off,
        handoff_topic_id: capture.handoff_topic_id,
        complete: capture.complete
      });
    } catch (error) {
      capture.complete = false;
      streamTailPersistCapture(capture);
      logDiagnostic('warnings', 'conversation-stream-tail-response-capture-failure', {
        conversation_id: capture.conversation_id,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      try { reader.releaseLock(); } catch {}
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
   * Passively observes one page WebSocket frame and consumes only the active handoff topic.
   *
   * @param {Object} data - WebSocket message data.
   * @returns {void} No value is returned.
   */
  function captureGenerationWebSocketFrame(data) {
    const capture = streamTailCapture;
    if (!capture?.handed_off || !capture.handoff_topic_id) return;
    if (typeof data !== 'string') return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }
    const frames = Array.isArray(parsed) ? parsed : [parsed];
    for (const frame of frames) {
      if (!frame || typeof frame !== 'object') continue;
      if (frame.type === 'message') {
        streamTailConsumeWebSocketMessage(capture, frame);
      } else if (frame.type === 'reply' && frame.reply?.topic_id === capture.handoff_topic_id) {
        for (const catchup of Array.isArray(frame.reply.catchups) ? frame.reply.catchups : []) {
          streamTailConsumeWebSocketMessage(capture, catchup);
        }
      }
    }
  }
  // END Issue #123 streamed-tail recovery
`;

source = replaceOnce(
  source,
  "\n  /**\n   * Handles install network capture.\n",
  `${streamedTailBlock}\n\n  /**\n   * Handles install network capture.\n`,
  'stream tail production block'
);

const oldFetch = `        const requestUrl = request?.url ?? String(input);\n        rememberApiRequestContext(requestUrl, request?.headers, init.headers);\n        recordClickDiagnosticNetworkRequest(requestUrl, 'fetch');\n        return originalFetch.apply(this, args);`;
const newFetch = `        const requestUrl = request?.url ?? String(input);\n        rememberApiRequestContext(requestUrl, request?.headers, init.headers);\n        recordClickDiagnosticNetworkRequest(requestUrl, 'fetch');\n        const generationRequest = isGenerationStreamUrl(requestUrl) &&\n          String(request?.method ?? init.method ?? 'GET').toUpperCase() === 'POST';\n        const capturePromise = generationRequest && request\n          ? captureGenerationStreamRequest(request)\n          : null;\n        const responsePromise = originalFetch.apply(this, args);\n        if (!capturePromise) return responsePromise;\n        return responsePromise.then(response => {\n          void capturePromise.then(capture => {\n            if (!capture) return;\n            let cloned;\n            try { cloned = response.clone(); } catch { return; }\n            void captureGenerationStreamResponse(cloned, capture);\n          });\n          return response;\n        });`;
source = replaceOnce(source, oldFetch, newFetch, 'fetch stream interception');

source = replaceOnce(
  source,
  "\n    if (typeof pageWindow.open === 'function') {",
  `\n    if (typeof pageWindow.WebSocket === 'function') {\n      const NativeWebSocket = pageWindow.WebSocket;\n      pageWindow.WebSocket = new Proxy(NativeWebSocket, {\n        construct(target, args) {\n          const socket = Reflect.construct(target, args, target);\n          socket.addEventListener('message', event => captureGenerationWebSocketFrame(event.data));\n          return socket;\n        }\n      });\n    }\n\n    if (typeof pageWindow.open === 'function') {`,
  'WebSocket stream interception'
);

const oldSpine = `      const spine = conversationSpineFromPages(fetched.pages);\n      const liveApiTailComparison = compareLiveTailMarkersToSpine(frozenLiveTailMarkers, spine);`;
const newSpine = `      const historySpine = conversationSpineFromPages(fetched.pages);\n      const currentStreamCapture = streamTailCapture?.conversation_id === conversationId\n        ? streamTailCapture\n        : streamTailRestoreCapture(conversationId);\n      const streamMerge = mergeStreamTailCaptureIntoSpine(\n        historySpine, streamTailCaptureSnapshot(currentStreamCapture)\n      );\n      const spine = streamMerge.spine;\n      logDiagnostic(streamMerge.merged ? 'debug' : 'verbose',\n        'conversation-stream-tail-reconciliation', {\n          reason: streamMerge.reason,\n          merged: streamMerge.merged,\n          appended_count: streamMerge.appended_count,\n          replaced_count: streamMerge.replaced_count,\n          anchor_message_id: streamMerge.anchor_message_id ?? null,\n          history_record_count: historySpine.records.length,\n          reconciled_record_count: spine.records.length\n        });\n      const liveApiTailComparison = compareLiveTailMarkersToSpine(frozenLiveTailMarkers, spine);`;
source = replaceOnce(source, oldSpine, newSpine, 'runExport streamed-tail reconciliation');

const designSection = `\n## Issue #123 streamed-tail recovery\n\nThe newest generated turn has a second first-class source in addition to the\nhistory pagination API: the stock page's own \/backend-api\/f\/conversation\ntransport. DownloadConversation observes that request and a cloned response at\ndocument-start without delaying or consuming the page's response. When the\nbootstrap SSE emits a stream_handoff, DownloadConversation also passively\nobserves the page's existing WebSocket connection and consumes only the\nadvertised conversation-turn topic's encoded_item SSE payloads; it does not\nopen a second generation request or a second history acquisition.\n\nThe submitted request messages, parent_message_id, and exact provider message\nobjects reconstructed from the completed stream are retained for only the\nnewest turn and mirrored to session storage so a same-tab hard reload does not\ndiscard a completed streamed response while history is still stale. The capture\nis bounded and an overflowed or incomplete capture is never merged.\n\nReconciliation is identity- and suffix-constrained. History remains authoritative\nthrough the captured parent anchor. The records after that anchor must be an\nexact message-ID prefix of the captured turn. Matching same-ID tail records are\nreplaced by the completed streamed copies, which repairs stale partial history\nrecords; only the remaining contiguous captured suffix is appended. Any gap,\nreordering, missing anchor, incomplete handoff, or conflicting identity rejects\nthe streamed merge rather than inventing chronology. JSONL and Markdown then\nconsume that same reconciled in-memory spine, preserving the single-snapshot\nmulti-format export contract and the AIConversationCore rendering boundary.\n`;
if (!design.includes('## Issue #123 streamed-tail recovery')) design += designSection;

const harnessOld = `vm.runInNewContext(\`${'${sourceBlock()}'}\\nthis.__stream={isGenerationStreamUrl,createStreamTailCapture,streamTailCaptureRequest,consumeStreamTailSseChunk,streamTailCaptureSnapshot,streamTailPersistCapture,streamTailRestoreCapture,mergeStreamTailCaptureIntoSpine};\`, context);`;
const harnessNew = `vm.runInNewContext(\`${'${sourceBlock()}'}\\nthis.__stream={isGenerationStreamUrl,createStreamTailCapture,streamTailCaptureRequest,consumeStreamTailSseChunk,streamTailCaptureSnapshot,streamTailPersistCapture,streamTailRestoreCapture,mergeStreamTailCaptureIntoSpine,captureGenerationWebSocketFrame,setActiveCapture:capture=>{streamTailCapture=capture;}};\`, context);`;
tests = replaceOnce(tests, harnessOld, harnessNew, 'stream test harness WebSocket exposure');

const handoffTest = `test('stream handoff is retained as incomplete and is never treated as a complete direct SSE turn', () => {`;
const wsTest = `test('WebSocket handoff encoded_item completes the same captured turn without a second request', () => {\n  const { api } = harness();\n  const capture = api.createStreamTailCapture('c1');\n  api.streamTailCaptureRequest(capture, {\n    conversation_id: 'c1',\n    parent_message_id: 'a1',\n    messages: [message('u2', 'user', 'prompt')]\n  });\n  feed(api, capture, [{\n    type: 'stream_handoff',\n    conversation_id: 'c1',\n    options: [{ type: 'subscribe_ws_topic', topic_id: 'conversation-turn-x' }]\n  }, '[DONE]']);\n  api.setActiveCapture(capture);\n  const encoded = [\n    'event: delta_encoding\\ndata: "v1"\\n\\n',\n    \`data: \${JSON.stringify({ p: '', o: 'add', v: { conversation_id: 'c1', message: message('a2', 'assistant', '', { status: 'in_progress', end_turn: false }) } })}\\n\\n\`,\n    \`data: \${JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: 'from websocket' })}\\n\\n\`,\n    \`data: \${JSON.stringify({ o: 'patch', v: [\n      { p: '/message/status', o: 'replace', v: 'finished_successfully' },\n      { p: '/message/end_turn', o: 'replace', v: true }\n    ] })}\\n\\n\`,\n    'data: [DONE]\\n\\n'\n  ].join('');\n  api.captureGenerationWebSocketFrame(JSON.stringify([{\n    type: 'message',\n    topic_id: 'conversation-turn-x',\n    payload: { type: 'conversation-turn-stream', payload: { type: 'stream-item', encoded_item: encoded } }\n  }]));\n  const snapshot = api.streamTailCaptureSnapshot(capture);\n  assert.equal(snapshot.complete, true);\n  assert.equal(snapshot.handoff_done_received, true);\n  assert.equal(snapshot.stream_messages.at(-1).content.parts[0], 'from websocket');\n});\n\n`;
tests = replaceOnce(tests, handoffTest, `${wsTest}${handoffTest}`, 'WebSocket regression');

await writeFile(sourcePath, source);
await writeFile(designPath, design);
await writeFile(testPath, tests);
