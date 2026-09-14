import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

function runExportSource() {
  const start = userscript.indexOf('  async function runExport(');
  const end = userscript.indexOf(
    '\n  /**\n   * Tests API pagination logic.',
    start
  );
  assert.ok(start >= 0 && end > start, 'Production runExport function is missing.');
  return userscript.slice(start, end).trimStart();
}

function exportHarness() {
  const spine = {
    records: [
      { ordinal: 0, message_id: 'user-1', role: 'user', message: { id: 'user-1' } },
      { ordinal: 1, message_id: 'assistant-1', role: 'assistant', message: { id: 'assistant-1' } }
    ]
  };
  const observed = {
    fetchCalls: 0,
    jsonlSpines: [],
    imageSpines: [],
    markdownSpines: [],
    downloads: []
  };
  const context = {
    Blob,
    performance,
    setTimeout,
    exportInProgress: false,
    testInProgress: false,
    jumpInProgress: false,
    exportKind: null,
    streamTailCapture: null,
    scanLiveTailMarkers() {},
    snapshotLiveTailMarkers() { return []; },
    streamTailRestoreCapture() { return null; },
    streamTailCaptureSnapshot(capture) { return capture; },
    mergeStreamTailCaptureIntoSpine(received) {
      return {
        merged: false,
        reason: 'no-capture',
        spine: received,
        appended_count: 0,
        replaced_count: 0
      };
    },
    compareLiveTailMarkersToSpine() {
      return { marker_count: 0, matched_count: 0, missing_count: 0, missing_suffix_count: 0, stale_prefix_count: 0, role_mismatch_count: 0, warning: false };
    },
    compareLiveTailMarkersToJsonl() {
      return { marker_count: 0, matched_count: 0, missing_from_jsonl_count: 0, changed_count: 0, warning: false };
    },
    liveApiTailWarningText() { return ''; },
    jsonlTailWarningText() { return ''; },
    progressState: null,
    currentConversationId() {
      return 'conversation-1';
    },
    assert(condition, message) {
      if (!condition) throw new Error(message);
    },
    startStatusTimer() {},
    updateUi() {},
    async acquireWakeLock() {},
    async fetchConversationPages(_conversationId, onProgress) {
      observed.fetchCalls += 1;
      onProgress({
        page_count: 1,
        raw_record_count: spine.records.length,
        page_number: 1,
        page_started_at: performance.now()
      });
      return { pages: [{ messages: spine.records.map(item => item.message) }] };
    },
    conversationSpineFromPages() {
      return spine;
    },
    sanitizeFileName(value) {
      return value;
    },
    conversationTitle() {
      return 'Conversation';
    },
    apiRecordsJsonl(received) {
      observed.jsonlSpines.push(received);
      return '{"record":"fixture"}\n';
    },
    downloadBlob(_blob, filename) {
      observed.downloads.push(filename);
    },
    setStatus() {},
    async recoverUserImages(received) {
      observed.imageSpines.push(received);
      return new Map();
    },
    refreshStatus() {},
    renderConversationMarkdown(received, onProgress) {
      observed.markdownSpines.push(received);
      onProgress({
        record_number: received.records.length,
        record_count: received.records.length
      });
      return '# fixture\n';
    },
    logDiagnostic() {},
    diagnosticEnabled() {
      return false;
    },
    stopStatusTimer() {},
    async releaseWakeLock() {}
  };
  vm.runInNewContext(
    `${runExportSource()}\nthis.__runExport = runExport;`,
    context
  );
  return { runExport: context.__runExport, spine, observed, context };
}

for (const [name, kinds, expected] of [
  ['JSONL-only', ['jsonl'], { jsonl: 1, images: 0, markdown: 0, downloads: ['Conversation.jsonl'] }],
  ['Markdown-only', ['md'], { jsonl: 0, images: 1, markdown: 1, downloads: ['Conversation.md'] }],
  ['JSONL+Markdown', ['jsonl', 'md'], {
    jsonl: 1,
    images: 1,
    markdown: 1,
    downloads: ['Conversation.jsonl', 'Conversation.md']
  }]
]) {
  test(`${name} performs exactly one Conversation API acquisition`, async () => {
    const { runExport, spine, observed, context } = exportHarness();
    await runExport(kinds);
    assert.equal(observed.fetchCalls, 1);
    assert.equal(observed.jsonlSpines.length, expected.jsonl);
    assert.equal(observed.imageSpines.length, expected.images);
    assert.equal(observed.markdownSpines.length, expected.markdown);
    assert.deepEqual(observed.downloads, expected.downloads);
    assert.equal(context.exportInProgress, false);
    assert.equal(context.progressState, null);
    assert.equal(context.exportKind, null);
    for (const received of [
      ...observed.jsonlSpines,
      ...observed.imageSpines,
      ...observed.markdownSpines
    ]) {
      assert.equal(received, spine, `${name} did not consume the authoritative snapshot object.`);
    }
  });
}

test('UI submits each checkbox combination as one operation, or none when unselected', async () => {
  const start = userscript.indexOf('    const runSelectedExports = async () => {');
  const end = userscript.indexOf(
    "    panel.querySelector('[data-role=\"extract\"]').addEventListener",
    start
  );
  assert.ok(start >= 0 && end > start, 'runSelectedExports production block is missing.');
  const source = userscript.slice(start, end);
  for (const kinds of [[], ['jsonl'], ['md'], ['jsonl', 'md']]) {
    const calls = [];
    const context = {
      panel: {
        querySelector(selector) {
          const kind = selector === '[data-role="format-jsonl"]' ? 'jsonl' : 'md';
          return { checked: kinds.includes(kind) };
        }
      },
      async runExport(selected) { calls.push(Array.from(selected)); }
    };
    vm.runInNewContext(`${source}\nthis.runSelectedExports = runSelectedExports;`, context);
    await context.runSelectedExports();
    assert.deepEqual(calls, kinds.length ? [kinds] : []);
  }
});
