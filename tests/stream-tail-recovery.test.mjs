import { userscript } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

function sourceBlock() {
  const start = userscript.indexOf('  // BEGIN Issue #123 streamed-tail recovery');
  const endMarker = '  // END Issue #123 streamed-tail recovery';
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'Issue #123 streamed-tail recovery production block is missing.');
  return userscript.slice(start, end + endMarker.length);
}

function harness() {
  const storage = new Map();
  const context = {
    console,
    URL,
    TextDecoder,
    structuredClone,
    location: { origin: 'https://chatgpt.com' },
    STREAM_TAIL_RECORD_LIMIT: 512,
    STREAM_TAIL_STORAGE_KEY: 'stream-tail-test',
    sessionStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    logDiagnostic() {},
    conversationSpineFromPages(pages) {
      const messages = [];
      const seen = new Set();
      for (const page of [...pages].reverse()) {
        for (const message of page.messages ?? []) {
          if (seen.has(message.id)) continue;
          seen.add(message.id);
          messages.push(message);
        }
      }
      return {
        pages: [...pages],
        messages,
        records: messages.map((message, ordinal) => ({
          ordinal,
          message_id: message.id,
          role: message.author?.role ?? null,
          channel: message.channel ?? null,
          content_type: message.content?.content_type ?? null,
          message
        }))
      };
    }
  };
  vm.runInNewContext(`${sourceBlock()}\nthis.__stream={isGenerationStreamUrl,createStreamTailCapture,streamTailCaptureRequest,consumeStreamTailSseChunk,streamTailCaptureSnapshot,streamTailPersistCapture,streamTailRestoreCapture,mergeStreamTailCaptureIntoSpine,captureGenerationWebSocketFrame,setActiveCapture:capture=>{streamTailCapture=capture;}};`, context);
  return { api: context.__stream, storage };
}

function message(id, role, text, overrides = {}) {
  return {
    id,
    author: { role },
    channel: role === 'assistant' ? 'final' : null,
    content: { content_type: 'text', parts: [text] },
    metadata: {},
    status: role === 'assistant' ? 'finished_successfully' : undefined,
    end_turn: role === 'assistant',
    ...overrides
  };
}

function baseSpine(messages) {
  return {
    pages: [{ messages, page_info: { has_previous_page: false, has_next_page: false } }],
    messages,
    records: messages.map((item, ordinal) => ({
      ordinal,
      message_id: item.id,
      role: item.author?.role ?? null,
      channel: item.channel ?? null,
      content_type: item.content?.content_type ?? null,
      message: item
    }))
  };
}

function feed(api, capture, payloads) {
  const body = payloads.map(payload => `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`).join('');
  api.consumeStreamTailSseChunk(capture, body, true);
}

test('recognizes only the stock f/conversation generation endpoint', () => {
  const { api } = harness();
  assert.equal(api.isGenerationStreamUrl('https://chatgpt.com/backend-api/f/conversation'), true);
  assert.equal(api.isGenerationStreamUrl('/backend-api/f/conversation'), true);
  assert.equal(api.isGenerationStreamUrl('/backend-api/f/conversation/prepare'), false);
  assert.equal(api.isGenerationStreamUrl('/backend-api/conversations/c1'), false);
  assert.equal(api.isGenerationStreamUrl('https://example.test/backend-api/f/conversation'), false);
});

test('request capture preserves the submitted User record and parent anchor', () => {
  const { api } = harness();
  const capture = api.createStreamTailCapture('c1');
  const user = message('u2', 'user', 'new prompt');
  api.streamTailCaptureRequest(capture, {
    conversation_id: 'c1',
    parent_message_id: 'a1',
    messages: [user]
  });
  const snapshot = api.streamTailCaptureSnapshot(capture);
  assert.equal(snapshot.conversation_id, 'c1');
  assert.equal(snapshot.parent_message_id, 'a1');
  assert.deepEqual(Array.from(snapshot.request_messages, item => item.id), ['u2']);
  assert.equal(snapshot.request_messages[0].content.parts[0], 'new prompt');
});

test('v1 SSE parser survives chunk boundaries and materializes the completed Assistant record', () => {
  const { api } = harness();
  const capture = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(capture, {
    conversation_id: 'c1',
    parent_message_id: 'a1',
    messages: [message('u2', 'user', 'prompt')]
  });
  const events = [
    'event: delta_encoding\ndata: "v1"\n\n',
    `data: ${JSON.stringify({ p: '', o: 'add', v: { conversation_id: 'c1', message: message('a2', 'assistant', '', { status: 'in_progress', end_turn: false }) } })}\n\n`,
    `data: ${JSON.stringify({ p: '/message/content/parts/0', o: 'replace', v: 'Hello' })}\n\n`,
    `data: ${JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: ' world' })}\n\n`,
    `data: ${JSON.stringify({ v: '!' })}\n\n`,
    `data: ${JSON.stringify({ o: 'patch', v: [
      { p: '/message/status', o: 'replace', v: 'finished_successfully' },
      { p: '/message/end_turn', o: 'replace', v: true }
    ] })}\n\n`,
    'data: [DONE]\n\n'
  ].join('');
  const split = Math.floor(events.length / 2) + 7;
  api.consumeStreamTailSseChunk(capture, events.slice(0, split), false);
  api.consumeStreamTailSseChunk(capture, events.slice(split), true);
  const snapshot = api.streamTailCaptureSnapshot(capture);
  assert.equal(snapshot.done_received, true);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.handed_off, false);
  assert.deepEqual(Array.from(snapshot.stream_messages, item => item.id), ['a2']);
  assert.equal(snapshot.stream_messages[0].content.parts[0], 'Hello world!');
  assert.equal(snapshot.stream_messages[0].status, 'finished_successfully');
  assert.equal(snapshot.stream_messages[0].end_turn, true);
});

test('repeated snapshots of one message id refresh in place instead of duplicating the record', () => {
  const { api } = harness();
  const capture = api.createStreamTailCapture('c1');
  const first = message('a2', 'assistant', 'partial', { status: 'in_progress', end_turn: false });
  const final = message('a2', 'assistant', 'complete', { status: 'finished_successfully', end_turn: true });
  feed(api, capture, [
    { message: first, conversation_id: 'c1' },
    { message: final, conversation_id: 'c1' },
    '[DONE]'
  ]);
  const snapshot = api.streamTailCaptureSnapshot(capture);
  assert.equal(snapshot.stream_messages.length, 1);
  assert.equal(snapshot.stream_messages[0].content.parts[0], 'complete');
  assert.equal(snapshot.complete, true);
});

test('WebSocket handoff encoded_item completes the same captured turn without a second request', () => {
  const { api } = harness();
  const capture = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(capture, {
    conversation_id: 'c1',
    parent_message_id: 'a1',
    messages: [message('u2', 'user', 'prompt')]
  });
  feed(api, capture, [{
    type: 'stream_handoff',
    conversation_id: 'c1',
    options: [{ type: 'subscribe_ws_topic', topic_id: 'conversation-turn-x' }]
  }, '[DONE]']);
  api.setActiveCapture(capture);
  const encoded = [
    'event: delta_encoding\ndata: "v1"\n\n',
    `data: ${JSON.stringify({ p: '', o: 'add', v: { conversation_id: 'c1', message: message('a2', 'assistant', '', { status: 'in_progress', end_turn: false }) } })}\n\n`,
    `data: ${JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: 'from websocket' })}\n\n`,
    `data: ${JSON.stringify({ o: 'patch', v: [
      { p: '/message/status', o: 'replace', v: 'finished_successfully' },
      { p: '/message/end_turn', o: 'replace', v: true }
    ] })}\n\n`,
    'data: [DONE]\n\n'
  ].join('');
  api.captureGenerationWebSocketFrame(JSON.stringify([{
    type: 'message',
    topic_id: 'conversation-turn-x',
    payload: { type: 'conversation-turn-stream', payload: { type: 'stream-item', encoded_item: encoded } }
  }]));
  const snapshot = api.streamTailCaptureSnapshot(capture);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.handoff_done_received, true);
  assert.equal(snapshot.stream_messages.at(-1).content.parts[0], 'from websocket');
});

test('stream handoff is retained as incomplete and is never treated as a complete direct SSE turn', () => {
  const { api } = harness();
  const capture = api.createStreamTailCapture('c1');
  feed(api, capture, [
    { type: 'stream_handoff', conversation_id: 'c1', options: [
      { type: 'subscribe_ws_topic', topic_id: 'conversation-turn-x' },
      { type: 'resume_sse_endpoint', topic_id: 'conversation-turn-x' }
    ] },
    '[DONE]'
  ]);
  const snapshot = api.streamTailCaptureSnapshot(capture);
  assert.equal(snapshot.handed_off, true);
  assert.equal(snapshot.handoff_topic_id, 'conversation-turn-x');
  assert.equal(snapshot.done_received, true);
  assert.equal(snapshot.complete, false);
});

test('completed capture persists exact message records across a hard reload in the same session', () => {
  const { api } = harness();
  const capture = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(capture, {
    conversation_id: 'c1',
    parent_message_id: 'a1',
    messages: [message('u2', 'user', 'prompt')]
  });
  feed(api, capture, [
    { message: message('a2', 'assistant', 'answer'), conversation_id: 'c1' },
    '[DONE]'
  ]);
  assert.equal(api.streamTailPersistCapture(capture), true);
  const restored = api.streamTailRestoreCapture('c1');
  assert.equal(restored.complete, true);
  assert.equal(restored.parent_message_id, 'a1');
  assert.deepEqual(Array.from(restored.request_messages, item => item.id), ['u2']);
  assert.deepEqual(Array.from(restored.stream_messages, item => item.id), ['a2']);
  assert.equal(restored.stream_messages[0].content.parts[0], 'answer');
});

test('merge appends only the exact missing captured suffix after a shared request message', () => {
  const { api } = harness();
  const a1 = message('a1', 'assistant', 'old answer');
  const u2 = message('u2', 'user', 'new prompt');
  const a2 = message('a2', 'assistant', 'new answer');
  const capture = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(capture, { conversation_id: 'c1', parent_message_id: 'a1', messages: [u2] });
  feed(api, capture, [{ message: a2, conversation_id: 'c1' }, '[DONE]']);
  const result = api.mergeStreamTailCaptureIntoSpine(baseSpine([a1, u2]), api.streamTailCaptureSnapshot(capture));
  assert.equal(result.merged, true);
  assert.equal(result.appended_count, 1);
  assert.equal(result.anchor_message_id, 'u2');
  assert.deepEqual(Array.from(result.spine.messages, item => item.id), ['a1', 'u2', 'a2']);
});

test('merge can recover both submitted User and Assistant when only the parent anchor reached history', () => {
  const { api } = harness();
  const a1 = message('a1', 'assistant', 'old answer');
  const u2 = message('u2', 'user', 'new prompt');
  const a2 = message('a2', 'assistant', 'new answer');
  const capture = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(capture, { conversation_id: 'c1', parent_message_id: 'a1', messages: [u2] });
  feed(api, capture, [{ message: a2, conversation_id: 'c1' }, '[DONE]']);
  const result = api.mergeStreamTailCaptureIntoSpine(baseSpine([a1]), api.streamTailCaptureSnapshot(capture));
  assert.equal(result.merged, true);
  assert.equal(result.appended_count, 2);
  assert.equal(result.anchor_message_id, 'a1');
  assert.deepEqual(Array.from(result.spine.messages, item => item.id), ['a1', 'u2', 'a2']);
});

test('existing request-only User history stays authoritative while a missing streamed Assistant is appended', () => {
  const { api } = harness();
  const a1 = message('a1', 'assistant', 'old answer');
  const requestUser = message('u2', 'user', 'new prompt');
  const historyUser = message('u2', 'user', 'new prompt', {
    create_time: 12345,
    metadata: { server_enriched: true }
  });
  const a2 = message('a2', 'assistant', 'new answer');
  const capture = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(capture, {
    conversation_id: 'c1',
    parent_message_id: 'a1',
    messages: [requestUser]
  });
  feed(api, capture, [{ message: a2, conversation_id: 'c1' }, '[DONE]']);
  const result = api.mergeStreamTailCaptureIntoSpine(
    baseSpine([a1, historyUser]),
    api.streamTailCaptureSnapshot(capture)
  );
  assert.equal(result.merged, true);
  assert.equal(result.appended_count, 1);
  assert.equal(result.replaced_count, 0);
  assert.equal(result.spine.messages[1].create_time, 12345);
  assert.equal(result.spine.messages[1].metadata.server_enriched, true);
  assert.equal(result.spine.messages[2].id, 'a2');
});

test('same-ID records observed in the completed response stream replace stale history copies', () => {
  const { api } = harness();
  const a1 = message('a1', 'assistant', 'old answer');
  const u2 = message('u2', 'user', 'new prompt', { create_time: 12345 });
  const staleA2 = message('a2', 'assistant', 'partial', {
    status: 'in_progress',
    end_turn: false
  });
  const finalA2 = message('a2', 'assistant', 'complete', {
    status: 'finished_successfully',
    end_turn: true
  });
  const capture = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(capture, {
    conversation_id: 'c1',
    parent_message_id: 'a1',
    messages: [message('u2', 'user', 'new prompt')]
  });
  feed(api, capture, [{ message: finalA2, conversation_id: 'c1' }, '[DONE]']);
  const result = api.mergeStreamTailCaptureIntoSpine(
    baseSpine([a1, u2, staleA2]),
    api.streamTailCaptureSnapshot(capture)
  );
  assert.equal(result.merged, true);
  assert.equal(result.appended_count, 0);
  assert.equal(result.replaced_count, 1);
  assert.equal(result.spine.messages[1].create_time, 12345);
  assert.equal(result.spine.messages[2].content.parts[0], 'complete');
  assert.equal(result.spine.messages[2].status, 'finished_successfully');
});

test('merge rejects incomplete streams, missing overlap, and non-suffix gaps', () => {
  const { api } = harness();
  const a1 = message('a1', 'assistant', 'old answer');
  const u2 = message('u2', 'user', 'new prompt');
  const a2 = message('a2', 'assistant', 'new answer');

  const incomplete = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(incomplete, { conversation_id: 'c1', parent_message_id: 'a1', messages: [u2] });
  assert.equal(api.mergeStreamTailCaptureIntoSpine(baseSpine([a1]), api.streamTailCaptureSnapshot(incomplete)).reason, 'capture-incomplete');

  const noOverlap = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(noOverlap, { conversation_id: 'c1', parent_message_id: 'unknown', messages: [u2] });
  feed(api, noOverlap, [{ message: a2, conversation_id: 'c1' }, '[DONE]']);
  assert.equal(api.mergeStreamTailCaptureIntoSpine(baseSpine([a1]), api.streamTailCaptureSnapshot(noOverlap)).reason, 'no-overlap-anchor');

  const gap = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(gap, { conversation_id: 'c1', parent_message_id: 'a1', messages: [u2] });
  feed(api, gap, [{ message: a2, conversation_id: 'c1' }, '[DONE]']);
  const gapResult = api.mergeStreamTailCaptureIntoSpine(baseSpine([a1, a2]), api.streamTailCaptureSnapshot(gap));
  assert.equal(gapResult.merged, false);
  assert.equal(gapResult.reason, 'non-suffix-gap');
});

test('fetch interception clones the stock generation response and returns the original response to ChatGPT', () => {
  assert.match(userscript, /isGenerationStreamUrl\(requestUrl\)/,
    'Generation fetch must be recognized inside the stock fetch interceptor.');
  assert.match(userscript, /response\.clone\(\)/,
    'Generation response must be cloned before DownloadConversation reads its stream.');
  assert.match(userscript, /captureGenerationStreamResponse/,
    'Cloned generation response is not routed to streamed-tail capture.');
  assert.match(userscript, /return response;/,
    'Stock fetch wrapper must return the original Response object to ChatGPT.');
});

test('one history acquisition still feeds both export formats after streamed-tail reconciliation', () => {
  const start = userscript.indexOf('  async function runExport(kinds)');
  const end = userscript.indexOf('\n  /**', start + 10);
  assert.ok(start >= 0 && end > start, 'runExport source block is unavailable.');
  const block = userscript.slice(start, end);
  assert.equal((block.match(/fetchConversationPages\(/g) ?? []).length, 1,
    'runExport must keep exactly one history acquisition.');
  assert.match(block, /mergeStreamTailCaptureIntoSpine/,
    'runExport does not reconcile the captured streamed suffix.');
  assert.match(block, /apiRecordsJsonl\([^)]*spine/,
    'JSONL export does not consume the reconciled spine.');
  assert.match(block, /renderConversationMarkdown\([^)]*spine/,
    'Markdown export does not consume the reconciled spine.');
});
