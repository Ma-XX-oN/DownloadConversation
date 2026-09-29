import assert from 'node:assert/strict';
import { downloadConversationSource, userscript } from './helpers/userscript-source.mjs';
import vm from 'node:vm';
import test from 'node:test';

function runExportSource() {
  const start = downloadConversationSource.indexOf('  async function runExport(');
  const end = downloadConversationSource.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start, 'Production runExport function is missing.');
  let depth = 0;
  let opened = false;
  for (let index = start; index < downloadConversationSource.length; index += 1) {
    if (downloadConversationSource[index] === '{') {
      depth += 1;
      opened = true;
    } else if (downloadConversationSource[index] === '}') {
      depth -= 1;
      if (opened && depth === 0) return downloadConversationSource.slice(start, index + 1);
    }
  }
  throw new Error('Production runExport function is unterminated.');
}

function harness() {
  const spine = {
    records: [
      { ordinal: 0, message_id: 'user-1', role: 'user', message: { id: 'user-1' } }
    ]
  };
  const downloads = [];
  const archiveInputs = [];
  const context = {
    Blob,
    TextEncoder,
    performance,
    setTimeout,
    exportInProgress: false,
    testInProgress: false,
    jumpInProgress: false,
    exportKind: null,
    progressState: null,
    streamTailCapture: null,
    scanLiveTailMarkers() {},
    snapshotLiveTailMarkers() { return []; },
    streamTailRestoreCapture() { return null; },
    streamTailCaptureSnapshot(value) { return value; },
    mergeStreamTailCaptureIntoSpine(value) {
      return { merged: false, reason: 'fixture', spine: value, appended_count: 0, replaced_count: 0 };
    },
    compareLiveTailMarkersToSpine() { return { warning: false }; },
    compareLiveTailMarkersToJsonl() { return { warning: false }; },
    liveApiTailWarningText() { return ''; },
    jsonlTailWarningText() { return ''; },
    currentConversationId() { return 'conversation-1'; },
    assert(condition, message) { if (!condition) throw new Error(message); },
    startStatusTimer() {},
    updateUi() {},
    async acquireWakeLock() {},
    async fetchConversationPages() { return { pages: [{}] }; },
    conversationSpineFromPages() { return spine; },
    conversationFileBaseName() { return 'Conversation'; },
    apiRecordsJsonl() { return '{"record":"fixture"}\n'; },
    async createArchive(bytes) {
      archiveInputs.push(new Uint8Array(bytes));
      return new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, ...bytes]);
    },
    downloadBlob(blob, filename) { downloads.push({ blob, filename }); },
    setStatus() {},
    async recoverUserImages() { return new Map(); },
    refreshStatus() {},
    renderConversationMarkdown() { return '# fixture\n'; },
    logDiagnostic() {},
    diagnosticEnabled() { return false; },
    stopStatusTimer() {},
    async releaseWakeLock() {}
  };
  vm.runInNewContext(`${runExportSource()}\nthis.runExport = runExport;`, context);
  return { context, downloads, archiveInputs };
}

test('Issue 173 panel places an explicit raw/compressed toggle after MD', () => {
  assert.match(userscript, /format-md[^\n]+data-role="export-compression"/);
  assert.match(userscript, /data-role="export-compression"[^>]+role="switch"/);
  assert.match(userscript, /aria-label="Raw export output"/);
});

test('Issue 173 toggle exposes large-circle raw and small-circle compressed semantics with tooltips', () => {
  assert.match(userscript, /exportCompressionIconMarkup/);
  assert.match(userscript, /Raw JSONL\/MD files/);
  assert.match(userscript, /Compress JSONL\/MD files/);
  assert.match(userscript, /aria-checked/);
});

for (const [name, compressed, expectedNames, expectedArchiveCalls] of [
  ['raw', false, ['Conversation.jsonl', 'Conversation.md'], 0],
  ['compressed', true, ['Conversation.jsonl.xz', 'Conversation.md.xz'], 2]
]) {
  test(`Issue 173 ${name} mode projects both selected formats through the requested output boundary`, async () => {
    const { context, downloads, archiveInputs } = harness();
    await context.runExport(['jsonl', 'md'], { compressed });
    assert.deepEqual(downloads.map(item => item.filename), expectedNames);
    assert.equal(archiveInputs.length, expectedArchiveCalls);
    if (compressed) {
      const expected = [
        Array.from(new TextEncoder().encode('{"record":"fixture"}\n')),
        Array.from(new TextEncoder().encode('# fixture\n'))
      ];
      assert.deepEqual(archiveInputs.map(bytes => Array.from(bytes)), expected);
      for (const { blob } of downloads) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        assert.deepEqual(Array.from(bytes.subarray(0, 6)), [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
      }
    }
  });
}

test('Issue 173 repeated mode changes do not retain stale output projection', async () => {
  const { context, downloads, archiveInputs } = harness();
  await context.runExport(['jsonl'], { compressed: false });
  await context.runExport(['jsonl'], { compressed: true });
  await context.runExport(['jsonl'], { compressed: false });
  assert.deepEqual(downloads.map(item => item.filename), [
    'Conversation.jsonl',
    'Conversation.jsonl.xz',
    'Conversation.jsonl'
  ]);
  assert.equal(archiveInputs.length, 1);
});
