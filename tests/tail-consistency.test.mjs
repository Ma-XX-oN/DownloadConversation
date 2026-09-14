import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');
const markerLimit = Number(userscript.match(/const LIVE_TAIL_MARKER_LIMIT = (\d+);/)?.[1]);
const textLimit = Number(userscript.match(/const LIVE_TAIL_TEXT_LIMIT = (\d+);/)?.[1]);
assert.equal(markerLimit, 10, 'Production live-tail marker limit must remain ten.');
assert.equal(textLimit, 8192, 'Production live-tail text bound changed unexpectedly.');

function sourceBlock() {
  const start = userscript.indexOf('  // BEGIN Issue #123 live-tail consistency');
  const endMarker = '  // END Issue #123 live-tail consistency';
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'Issue #123 production tail-consistency block is missing.');
  return userscript.slice(start, end + endMarker.length);
}

function harness() {
  const context = {
    console,
    performance,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    LIVE_TAIL_MARKER_LIMIT: markerLimit,
    LIVE_TAIL_TEXT_LIMIT: textLimit,
    currentConversationId: () => 'conversation-1',
    conversationScrollRoot: () => ({ scrollTop: 1000, clientHeight: 800, scrollHeight: 1800 }),
    logDiagnostic() {},
    document: { querySelectorAll: () => [], addEventListener() {}, documentElement: {} },
    MutationObserver: class { observe() {} disconnect() {} },
    Element: class {},
    HTMLElement: class {},
    HTMLFormElement: class {}
  };
  vm.runInNewContext(`${sourceBlock()}\nthis.__tail={resetLiveTailTrackingState,recordLiveTailMarker,applyMountedLiveTailMarkers,markLiveTailHistoricalNavigation,markLiveTailPromptSubmission,compareLiveTailMarkersToSpine,compareLiveTailMarkersToJsonl,markers:()=>liveTailMarkers.map(x=>({...x})),historical:()=>liveTailHistoricalNavigation,promptPending:()=>liveTailPromptAdvancePending};`, context);
  return context.__tail;
}

function marker(index, overrides = {}) {
  const id = `m${index}`;
  const text = `marker ${index} content that is long enough for comparison`;
  return {
    role: index % 2 ? 'assistant' : 'user',
    message_id: id,
    dom_turn_id: `turn-${id}`,
    container_id: `container-${id}`,
    comparison_text: text,
    content_length: text.length,
    content_fingerprint: `fingerprint-${index}`,
    observed_at: index,
    ...overrides
  };
}

function sourceMessage(id, role, text) {
  return {
    id,
    author: { role },
    channel: role === 'assistant' ? 'final' : null,
    content: { content_type: 'text', parts: [text] },
    metadata: {},
    status: 'finished_successfully',
    end_turn: role === 'assistant'
  };
}

function spine(messages) {
  return { records: messages.map((message, ordinal) => ({ ordinal, message_id: message.id, role: message.author?.role ?? null, channel: message.channel ?? null, content_type: message.content?.content_type ?? null, message })) };
}

test('tail history is monotonic, navigation-safe, and bounded to ten markers', () => {
  const api = harness();
  api.resetLiveTailTrackingState('conversation-1');
  for (let i = 0; i < 12; i += 1) assert.equal(api.recordLiveTailMarker(marker(i), true), true);
  assert.deepEqual(Array.from(api.markers(), x => x.message_id), Array.from({ length: 10 }, (_, i) => `m${i + 2}`));
  api.markLiveTailHistoricalNavigation('scroll-up');
  assert.equal(api.historical(), true);
  assert.equal(api.recordLiveTailMarker(marker(12), false), false);
  assert.equal(api.markers().at(-1).message_id, 'm11');
  assert.equal(api.recordLiveTailMarker(marker(11, { content_fingerprint: 'updated', content_length: 99 }), false), true);
  assert.equal(api.markers().at(-1).content_fingerprint, 'updated');
  assert.equal(api.markers().length, 10);
  api.markLiveTailPromptSubmission();
  assert.equal(api.historical(), false);
  assert.equal(api.promptPending(), true);
});


test('mounted bottom observation seeds the newest ten and historical navigation resumes only after high-water re-encounter', () => {
  const api = harness();
  api.resetLiveTailTrackingState('conversation-1');
  api.applyMountedLiveTailMarkers(Array.from({ length: 12 }, (_, i) => marker(i)), true, 'initial-bottom');
  assert.deepEqual(Array.from(api.markers(), x => x.message_id), Array.from({ length: 10 }, (_, i) => `m${i + 2}`));
  api.markLiveTailHistoricalNavigation('prompt-index');
  api.applyMountedLiveTailMarkers([marker(4), marker(5), marker(6)], true, 'historical-remount');
  assert.equal(api.markers().at(-1).message_id, 'm11');
  assert.equal(api.historical(), true);
  api.applyMountedLiveTailMarkers([marker(10), marker(11), marker(12), marker(13)], false, 'scroll-down-reencounter');
  assert.equal(api.historical(), false);
  assert.deepEqual(Array.from(api.markers(), x => x.message_id).slice(-3), ['m11', 'm12', 'm13']);
});

test('DOM turn id is diagnostic only and cannot substitute for a missing API message id', () => {
  const api = harness();
  const live = marker(1, { message_id: 'not-in-api', dom_turn_id: 'm1' });
  const result = api.compareLiveTailMarkersToSpine([live], spine([sourceMessage('m1', 'assistant', live.comparison_text)]));
  assert.equal(result.matched_count, 0);
  assert.equal(result.missing_count, 1);
  assert.equal(result.warning, true);
});

test('absence of retained live markers is an explicit freshness warning', () => {
  const api = harness();
  const result = api.compareLiveTailMarkersToSpine([], spine([sourceMessage('m1', 'assistant', 'complete') ]));
  assert.equal(result.marker_count, 0);
  assert.equal(result.warning, true);
});

test('API comparison quantifies missing newest suffix and ignores trailing internal records', () => {
  const api = harness();
  const markers = Array.from({ length: 10 }, (_, i) => marker(i));
  const messages = markers.slice(0, 7).map(x => sourceMessage(x.message_id, x.role, x.comparison_text));
  messages.push({ id: 'tool-after-tail', author: { role: 'tool' }, content: { content_type: 'text', parts: ['internal'] }, metadata: {} });
  const result = api.compareLiveTailMarkersToSpine(markers, spine(messages));
  assert.equal(result.marker_count, 10);
  assert.equal(result.matched_count, 7);
  assert.equal(result.missing_count, 3);
  assert.equal(result.missing_suffix_count, 3);
  assert.equal(result.newest_api_visible_id, 'm6');
  assert.equal(result.warning, true);
});

test('same-ID shorter API prefix is classified as stale/incomplete content evidence', () => {
  const api = harness();
  const live = marker(1, { role: 'assistant', comparison_text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda' });
  const result = api.compareLiveTailMarkersToSpine([live], spine([sourceMessage('m1', 'assistant', 'alpha beta gamma delta epsilon')]));
  assert.equal(result.matched_count, 1);
  assert.equal(result.stale_prefix_count, 1);
  assert.equal(result.warning, true);
});

test('JSONL comparison separates serialization loss or mutation from acquisition', () => {
  const api = harness();
  const markers = [marker(0), marker(1), marker(2)];
  const messages = markers.map(x => sourceMessage(x.message_id, x.role, x.comparison_text));
  const snapshot = spine(messages);
  const metadata = JSON.stringify({ record_type: 'chatgpt_conversation_metadata', schema_version: 1, conversation_id: 'conversation-1' });
  const completeJsonl = `${metadata}\n${messages.map(x => JSON.stringify(x)).join('\n')}\n`;
  const complete = api.compareLiveTailMarkersToJsonl(markers, snapshot, completeJsonl);
  assert.equal(complete.warning, false);
  assert.equal(complete.matched_count, 3);
  const missingJsonl = `${metadata}\n${messages.slice(0, 2).map(x => JSON.stringify(x)).join('\n')}\n`;
  assert.equal(api.compareLiveTailMarkersToJsonl(markers, snapshot, missingJsonl).missing_from_jsonl_count, 1);
  const changed = messages.map(x => structuredClone(x));
  changed[1].content.parts = ['mutated during serialization'];
  const changedJsonl = `${metadata}\n${changed.map(x => JSON.stringify(x)).join('\n')}\n`;
  const changedResult = api.compareLiveTailMarkersToJsonl(markers, snapshot, changedJsonl);
  assert.equal(changedResult.changed_count, 1);
  assert.equal(changedResult.warning, true);
});
