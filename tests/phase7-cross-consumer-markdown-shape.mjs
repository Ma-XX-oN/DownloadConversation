import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const coreRoot = path.resolve(process.env.PHASE7_CORE_ROOT ?? path.join(root, '.phase7-core'));
const aigmRoot = path.resolve(process.env.PHASE7_AIGM_ROOT ?? path.join(root, '.phase7-aigm'));
const sourcePath = path.join(coreRoot, 'tests', 'fixtures', 'chatgpt', 'H1 Heading.jsonl');
const sourceText = await readFile(sourcePath, 'utf8');
const sourceRecords = sourceText.trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line));

// Keep the real fixture's metadata, hidden system context, User records, and completed
// final text records. Older noncanonical reasoning/model-context records are covered by
// adapter tests separately; this gate isolates final Markdown structure across consumers.
const records = sourceRecords.filter(record =>
  record?.record_type === 'chatgpt_conversation_metadata' ||
  record?.author?.role === 'system' ||
  record?.author?.role === 'user' ||
  (record?.author?.role === 'assistant' &&
    record?.content?.content_type === 'text' &&
    record?.channel === 'final' &&
    record?.end_turn === true)
);

function mismatch(label, actual, expected) {
  if (actual === expected) return;
  const common = Math.min(actual.length, expected.length);
  let offset = 0;
  while (offset < common && actual[offset] === expected[offset]) offset += 1;
  assert.fail(
    `${label} differs at offset ${offset}; actual_len=${actual.length}, expected_len=${expected.length}; ` +
    `actual=${JSON.stringify(actual.slice(Math.max(0, offset - 100), offset + 180))}; ` +
    `expected=${JSON.stringify(expected.slice(Math.max(0, offset - 100), offset + 180))}`
  );
}

function projectedDownloadConversationGolden(canonical) {
  let rendered = canonical;
  if (rendered.endsWith('\n\n')) rendered = rendered.slice(0, -1);
  return rendered;
}

async function directCoreMarkdown() {
  const core = await import(pathToFileURL(path.join(coreRoot, 'src', 'index.js')).href);
  return core.renderCanonicalMarkdown(core.adaptChatGPTRecords(records));
}

async function aiTranscriptMarkdown() {
  const fixturePath = path.join(root, '.phase7-h1-filtered.jsonl');
  await writeFile(fixturePath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  const script = path.join(aigmRoot, 'scripts', 'AI-transcript.py');
  const result = spawnSync(
    process.env.PYTHON ?? 'python',
    [script, '--file', fixturePath, '--color', 'never'],
    {
      cwd: aigmRoot,
      env: { ...process.env, AI_CONVERSATION_CORE: coreRoot },
      encoding: 'utf8'
    }
  );
  assert.equal(result.status, 0, `AI-transcript.py failed: ${result.stderr}`);
  const start = result.stdout.indexOf('## ');
  assert.ok(start >= 0, 'AI-transcript.py output contains no transcript heading.');
  return result.stdout.slice(start);
}

async function downloadConversationMarkdown() {
  const userscript = await readFile(path.join(root, 'chatgpt-conversation-markdown-export.user.js'), 'utf8');
  const bundle = await readFile(path.join(coreRoot, 'dist', 'aiconversationcore.chatgpt.browser.js'), 'utf8');
  const context = { URL };
  context.globalThis = context;
  vm.runInNewContext(bundle, context, { filename: 'aiconversationcore.chatgpt.browser.js' });

  Object.assign(context, {
    showTimestamps: false,
    showRecordNumbers: false,
    showTurnIds: false,
    assert(condition, message) {
      if (!condition) throw new Error(message);
    },
    cgIsHidden(record) {
      return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
    },
    currentConversationId() {
      return records.find(record => record?.record_type === 'chatgpt_conversation_metadata')?.conversation_id ?? null;
    },
    diagnosticEnabled() {
      return false;
    },
    logDiagnostic() {},
    diagnosticTextHash() {
      return '';
    },
    diagnosticMarkdownTurnInventory() {
      return { count: 0, tail: [] };
    },
    boundedDiagnosticText(value, maxChars = 2000) {
      const text = String(value ?? '');
      return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
    },
    CG_INLINE_TOKEN_START: '\ue200',
    cgBuildFileReferenceIndex() {
      return new Map();
    },
    cgVisibleUserText(record) {
      if (!record?.metadata?.is_visually_hidden_from_conversation && record?.author?.role === 'user') {
        throw new Error(`Unexpected User fallback for ${record?.id ?? 'unknown'}.`);
      }
      return '';
    },
    cgVisibleAssistantMarkdown(record) {
      if (!record?.metadata?.is_visually_hidden_from_conversation && record?.author?.role === 'assistant') {
        throw new Error(`Unexpected Assistant fallback for ${record?.id ?? 'unknown'}.`);
      }
      return '';
    },
    cgRenderThoughtItem() {
      return '';
    },
    cgRenderThoughtBlock() {
      throw new Error('Unexpected thought-block fallback.');
    },
    quoteMarkdown() {
      throw new Error('Unexpected quote fallback.');
    }
  });

  const integrationBegin = '  // BEGIN AIConversationCore Phase 5 integration';
  const integrationEnd = '  // END AIConversationCore Phase 5 integration';
  const integrationStart = userscript.indexOf(integrationBegin);
  const integrationFinish = userscript.indexOf(integrationEnd, integrationStart);
  assert.ok(integrationStart >= 0 && integrationFinish > integrationStart,
    'DownloadConversation canonical integration block is missing.');
  const integrationSource = userscript.slice(
    integrationStart + integrationBegin.length,
    integrationFinish
  );
  const headingStart = userscript.indexOf('  function transcriptHeading(');
  const renderEnd = userscript.indexOf('\n  function conversationMetadataJsonlRecord', headingStart);
  assert.ok(headingStart >= 0 && renderEnd > headingStart,
    'DownloadConversation final Markdown renderer is missing.');
  const renderSource = userscript.slice(headingStart, renderEnd);
  vm.runInNewContext(
    `${integrationSource}\n${renderSource}\nthis.__phase7Render = renderConversationMarkdown;`,
    context
  );

  const spine = {
    records: records.map((message, ordinal) => ({
      ordinal,
      role: message?.author?.role ?? null,
      message_id: message?.id ?? null,
      message
    }))
  };
  return context.__phase7Render(spine, null, new Map());
}

const direct = await directCoreMarkdown();
const python = await aiTranscriptMarkdown();
mismatch('AI-transcript.py H1 final Markdown', python, direct);

const download = await downloadConversationMarkdown();
const expectedDownload = projectedDownloadConversationGolden(direct);
mismatch('DownloadConversation H1 final exported Markdown', download, expectedDownload);

assert.match(direct, /# H1 Heading/);
assert.match(direct, /```python/);
assert.match(direct, /\| Left \| Center \| Right \|/);
assert.match(direct, /A sentence with a footnote\.\[\^1\]/);
console.log('PASS: H1/multi-exchange final-render parity across all three consumers');