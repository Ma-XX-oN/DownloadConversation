from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
USERSCRIPT = ROOT / 'chatgpt-conversation-markdown-export.user.js'
SEDIMENT_TEST = ROOT / 'tests' / 'sediment-resolver.test.mjs'
DESIGN = ROOT / 'DESIGN.md'
SNAPSHOT_TEST = ROOT / 'tests' / 'export-single-snapshot.test.mjs'


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


text = USERSCRIPT.read_text(encoding='utf-8')
text = replace_once(
  text,
  '// @version      0.6.175',
  '// @version      0.6.176',
  'userscript version'
)

start = text.index('  async function runExport(kind) {')
end = text.index('\n  /**\n   * Tests API pagination logic.', start)
run_export = text[start:end]

run_export = replace_once(
  run_export,
  '''  async function runExport(kind) {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    exportInProgress = true;
    exportKind = kind;
''',
  '''  async function runExport(kinds) {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    assert(Array.isArray(kinds) && kinds.length > 0, 'At least one export format must be selected.');
    /** Deduplicated output formats executed from one authoritative Conversation API snapshot. */
    const requestedKinds = [...new Set(kinds)];
    assert(requestedKinds.every(kind => kind === 'jsonl' || kind === 'md'), 'Unsupported export format selected.');
    /** Format currently being serialized, used by shared status and failure reporting. */
    let activeKind = requestedKinds[0];
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    exportInProgress = true;
    exportKind = activeKind;
''',
  'runExport entry'
)
run_export = replace_once(
  run_export,
  "      if (kind === 'jsonl') {\n",
  "      if (requestedKinds.includes('jsonl')) {\n        activeKind = 'jsonl';\n        exportKind = activeKind;\n",
  'JSONL selection'
)
run_export = replace_once(
  run_export,
  '''        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);
      } else {
        progressState.stage = 'recovering-images';
''',
  '''        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);
      }
      if (requestedKinds.includes('md')) {
        activeKind = 'md';
        exportKind = activeKind;
        progressState.stage = 'recovering-images';
''',
  'Markdown selection'
)
run_export = replace_once(
  run_export,
  '''        kind,
        stage: progressState?.stage ?? null,
''',
  '''        kind: activeKind,
        stage: progressState?.stage ?? null,
''',
  'failure diagnostic kind'
)
run_export = replace_once(
  run_export,
  "        `${kind === 'md' ? 'Markdown' : 'JSONL'} extraction failed: ${message}`\n",
  "        `${activeKind === 'md' ? 'Markdown' : 'JSONL'} extraction failed: ${message}`\n",
  'failure status kind'
)
text = text[:start] + run_export + text[end:]
text = replace_once(
  text,
  '''    const runSelectedExports = async () => {
      const jsonl = panel.querySelector('[data-role="format-jsonl"]');
      const md = panel.querySelector('[data-role="format-md"]');
      if (jsonl?.checked) await runExport('jsonl');
      if (md?.checked) await runExport('md');
    };
''',
  '''    const runSelectedExports = async () => {
      const jsonl = panel.querySelector('[data-role="format-jsonl"]');
      const md = panel.querySelector('[data-role="format-md"]');
      /** Selected output formats generated from the same acquired Conversation API snapshot. */
      const kinds = [];
      if (jsonl?.checked) kinds.push('jsonl');
      if (md?.checked) kinds.push('md');
      if (kinds.length) await runExport(kinds);
    };
''',
  'selected-export orchestration'
)
USERSCRIPT.write_text(text, encoding='utf-8')

sediment = SEDIMENT_TEST.read_text(encoding='utf-8')
sediment = replace_once(
  sediment,
  "test('userscript version advances for sediment resolver completion', () => {\n  assert.match(userscript, /\\/\\/ @version      0\\.6\\.175/);\n});",
  "test('userscript version advances for issue 102 single-snapshot export', () => {\n  assert.match(userscript, /\\/\\/ @version      0\\.6\\.176/);\n});",
  'version regression'
)
SEDIMENT_TEST.write_text(sediment, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
anchor = '## Image recovery and export performance diagnostics\n'
section = '''## Single-snapshot multi-format export

One Extract operation acquires the Conversation API exactly once, regardless of
whether JSONL, Markdown, or both formats are selected. The existing pagination,
deduplication, and oldest-to-newest ordering logic produces one authoritative
in-memory conversation spine. Every selected serializer then consumes that same
spine; selecting both formats does not trigger a second API acquisition.

JSONL serialization and Markdown rendering remain independent after acquisition,
including Markdown image recovery and Core rendering. Sharing the source snapshot
ensures both files from one Extract click describe the same Conversation API state
even if the live conversation changes while output generation is still running.

'''
if section in design:
  raise RuntimeError('single-snapshot design section already exists')
design = replace_once(design, anchor, section + anchor, 'DESIGN insertion')
DESIGN.write_text(design, encoding='utf-8')

SNAPSHOT_TEST.write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

function productionFunctionSource(name) {
  const patterns = [`async function ${name}(`, `function ${name}(`];
  let start = -1;
  for (const pattern of patterns) {
    start = userscript.indexOf(pattern);
    if (start >= 0) break;
  }
  assert.ok(start >= 0, `Production function ${name} is missing.`);
  const brace = userscript.indexOf('{', start);
  assert.ok(brace > start, `Production function ${name} has no body.`);
  let depth = 0;
  for (let index = brace; index < userscript.length; index += 1) {
    if (userscript[index] === '{') depth += 1;
    else if (userscript[index] === '}') {
      depth -= 1;
      if (depth === 0) return userscript.slice(start, index + 1);
    }
  }
  throw new Error(`Production function ${name} has an unterminated body.`);
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
    `${productionFunctionSource('runExport')}\nthis.__runExport = runExport;`,
    context
  );
  return { runExport: context.__runExport, spine, observed };
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
    const { runExport, spine, observed } = exportHarness();
    await runExport(kinds);
    assert.equal(observed.fetchCalls, 1);
    assert.equal(observed.jsonlSpines.length, expected.jsonl);
    assert.equal(observed.imageSpines.length, expected.images);
    assert.equal(observed.markdownSpines.length, expected.markdown);
    assert.deepEqual(observed.downloads, expected.downloads);
    for (const received of [
      ...observed.jsonlSpines,
      ...observed.imageSpines,
      ...observed.markdownSpines
    ]) {
      assert.equal(received, spine, `${name} did not consume the authoritative snapshot object.`);
    }
  });
}

test('dual-format UI invokes one export operation with both selected formats', () => {
  const start = userscript.indexOf('    const runSelectedExports = async () => {');
  const end = userscript.indexOf(
    "    panel.querySelector('[data-role=\"extract\"]').addEventListener",
    start
  );
  assert.ok(start >= 0 && end > start, 'runSelectedExports production block is missing.');
  const source = userscript.slice(start, end);
  assert.match(source, /kinds\.push\('jsonl'\)/);
  assert.match(source, /kinds\.push\('md'\)/);
  assert.match(source, /await runExport\(kinds\)/);
  assert.equal((source.match(/runExport\(/g) ?? []).length, 1,
    'Selected formats must be submitted through one runExport call.');
  assert.doesNotMatch(source, /runExport\('jsonl'\)|runExport\('md'\)/);
});
''', encoding='utf-8')
