import { userscript } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const runtimeSource = await readFile(
  new URL('../src/userscript/01-runtime/02-shared-network-transition.js', import.meta.url),
  'utf8'
);
const projectIdentitySource = await readFile(
  new URL('../src/userscript/01-runtime/03-conversation-identity.js', import.meta.url),
  'utf8'
);
const identitySource = `${runtimeSource}\n${projectIdentitySource}`;
const lifecycleSource = await readFile(
  new URL('../src/userscript/02-network-communication/03-communication-lifecycle.js', import.meta.url),
  'utf8'
);
const manifestSource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-manifest.js', import.meta.url),
  'utf8'
);
const imageRecoverySource = await readFile(
  new URL('../src/userscript/06-image-export-tests/02-image-recovery.js', import.meta.url),
  'utf8'
);
const diagnosticSource = await readFile(
  new URL('../src/userscript/07-panel-launcher/02-diagnostic-archive.js', import.meta.url),
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

function functionSource(source, name) {
  const marker = `function ${name}`;
  const functionStart = source.indexOf(marker);
  assert.ok(functionStart >= 0, `missing ${name}`);
  let depth = 0;
  let seenBrace = false;
  for (let index = functionStart; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
      seenBrace = true;
    } else if (source[index] === '}') {
      depth -= 1;
      if (seenBrace && depth === 0) return source.slice(functionStart, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function identityHarness({ pathname, heading, title, links }) {
  const conversationTitle = functionSource(identitySource, 'conversationTitle');
  const sanitizeFileName = functionSource(identitySource, 'sanitizeFileName');
  const projectName = functionSource(identitySource, 'conversationProjectName');
  const fileBase = functionSource(identitySource, 'conversationFileBaseName');
  const location = {
    origin: 'https://chatgpt.com',
    href: `https://chatgpt.com${pathname}`,
    pathname
  };
  const document = {
    title,
    querySelector: selector => selector === 'h1' ? { textContent: heading } : null,
    querySelectorAll: selector => selector === 'a[href]' ? links : []
  };
  return new Function('document', 'location', 'URL', `
    ${conversationTitle}
    ${sanitizeFileName}
    ${projectName}
    ${fileBase}
    return {
      projectName: conversationProjectName(),
      fileBase: conversationFileBaseName()
    };
  `)(document, location, URL);
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
    TextEncoder,
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
    conversationFileBaseName() {
      return 'Conversation';
    },
    apiRecordsJsonl(received) {
      observed.jsonlSpines.push(received);
      return '{"record":"fixture"}\n';
    },
    async createArchive(bytes) {
      return new Uint8Array(bytes);
    },
    downloadBlob(_blob, filename) {
      observed.downloads.push(filename);
    },
    errorMessage(error) {
      return error instanceof Error ? error.message : String(error);
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
      exportCompressionEnabled: false,
      async runExport(selected) { calls.push(Array.from(selected)); }
    };
    vm.runInNewContext(`${source}\nthis.runSelectedExports = runSelectedExports;`, context);
    await context.runSelectedExports();
    assert.deepEqual(calls, kinds.length ? [kinds] : []);
  }
});

test('Issue 172 project chat resolves project name and canonical project-conversation base', () => {
  const projectSegment = 'g-p-1234567890-download-conversation';
  const result = identityHarness({
    pathname: `/g/${projectSegment}/c/conversation-1`,
    heading: 'Browser XZ Comparison',
    title: 'Browser XZ Comparison - ChatGPT',
    links: [{
      href: `/g/${projectSegment}/project`,
      textContent: 'Download Conversation'
    }]
  });
  assert.deepEqual(result, {
    projectName: 'Download Conversation',
    fileBase: 'Download Conversation - Browser XZ Comparison'
  });
});

test('Issue 172 standalone chat keeps conversation-only filename base', () => {
  const result = identityHarness({
    pathname: '/c/conversation-1',
    heading: 'Browser XZ Comparison',
    title: 'Browser XZ Comparison - ChatGPT',
    links: []
  });
  assert.deepEqual(result, {
    projectName: null,
    fileBase: 'Browser XZ Comparison'
  });
});

test('Issue 172 manifest persists project identity separately from conversation identity', () => {
  assert.match(manifestSource, /project_name:/);
  assert.match(manifestSource, /conversationProjectName\(\)/);
  assert.match(manifestSource, /conversation_name:/);
});

test('Issue 172 all user-facing filename paths use the canonical filename base', () => {
  assert.match(lifecycleSource,
    /DownloadConversation_\$\{conversationFileBaseName\(\)\}\.jsonl/);
  assert.match(imageRecoverySource,
    /\$\{conversationFileBaseName\(\)\}\.jsonl/);
  assert.match(imageRecoverySource,
    /\$\{conversationFileBaseName\(\)\}\.md/);
  assert.match(diagnosticSource,
    /DownloadConversation_\$\{conversationFileBaseName\(\)\}/);
  assert.doesNotMatch(imageRecoverySource,
    /sanitizeFileName\(conversationTitle\(\)\)\.(?:jsonl|md)/);
});
