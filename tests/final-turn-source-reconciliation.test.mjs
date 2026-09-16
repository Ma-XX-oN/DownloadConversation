import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

function sourceBlock() {
  const start = userscript.indexOf('  // BEGIN Issue #123 streamed-tail recovery');
  const endMarker = '  // END Issue #123 streamed-tail recovery';
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'Streamed-tail recovery production block is missing.');
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
        records: messages.map((message, ordinal) => ({ ordinal, message }))
      };
    }
  };
  vm.runInNewContext(
    `${sourceBlock()}\nthis.api={createStreamTailCapture,streamTailCaptureRequest,` +
      'consumeStreamTailSseChunk,streamTailCaptureSnapshot,mergeStreamTailCaptureIntoSpine};',
    context
  );
  return context.api;
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

function spine(messages) {
  return {
    pages: [{ messages, page_info: { has_previous_page: false, has_next_page: false } }],
    messages,
    records: messages.map((item, ordinal) => ({ ordinal, message: item }))
  };
}

function feed(api, capture, payloads) {
  const body = payloads
    .map(payload => `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
    .join('');
  api.consumeStreamTailSseChunk(capture, body, true);
}

test('completed tail survives a stream-only visually-hidden system record omitted by History API', () => {
  const api = harness();
  const prior = message('a1', 'assistant', 'prior answer');
  const user = message('u2', 'user', 'go');
  const hidden = message('hidden-system', 'system', '', {
    channel: null,
    status: 'finished_successfully',
    end_turn: null,
    metadata: { is_visually_hidden_from_conversation: true }
  });
  const visiblePrefix = message('a2', 'assistant', 'visible prefix', {
    channel: 'commentary',
    end_turn: false
  });
  const final = message('a3', 'assistant', 'completed final');
  const capture = api.createStreamTailCapture('c1');
  api.streamTailCaptureRequest(capture, {
    conversation_id: 'c1',
    parent_message_id: 'a1',
    messages: [user]
  });
  feed(api, capture, [
    { message: hidden, conversation_id: 'c1' },
    { message: visiblePrefix, conversation_id: 'c1' },
    { message: final, conversation_id: 'c1' },
    '[DONE]'
  ]);

  const result = api.mergeStreamTailCaptureIntoSpine(
    spine([prior, user, visiblePrefix]),
    api.streamTailCaptureSnapshot(capture)
  );

  assert.equal(result.merged, true);
  assert.equal(result.reason, 'streamed-tail-recovered');
  assert.equal(result.appended_count, 1);
  assert.deepEqual(Array.from(result.spine.messages, item => item.id), ['a1', 'u2', 'a2', 'a3']);
  assert.equal(result.spine.messages.at(-1).content.parts[0], 'completed final');
});
