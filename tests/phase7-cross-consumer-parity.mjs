import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const coreRoot = path.resolve(process.env.PHASE7_CORE_ROOT ?? path.join(root, '.phase7-core'));
const aigmRoot = path.resolve(process.env.PHASE7_AIGM_ROOT ?? path.join(root, '.phase7-aigm'));
const aigmCoreRoot = path.resolve(process.env.PHASE7_AIGM_CORE_ROOT ?? path.join(root, '.phase7-aigm-core'));
const fixturePath = path.join(coreRoot, 'tests', 'fixtures', 'chatgpt', 'chatgpt-direct.jsonl');
const goldenPath = path.join(coreRoot, 'tests', 'golden', 'chatgpt', 'chatgpt-direct.canonical.md');

const fixtureText = await readFile(fixturePath, 'utf8');
const records = fixtureText.trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line));
const canonicalGolden = await readFile(goldenPath, 'utf8');

function mismatch(label, actual, expected) {
  if (actual === expected) return;
  const common = Math.min(actual.length, expected.length);
  let offset = 0;
  while (offset < common && actual[offset] === expected[offset]) offset += 1;
  assert.fail(
    `${label} differs at offset ${offset}; actual_len=${actual.length}, expected_len=${expected.length}; ` +
    `actual=${JSON.stringify(actual.slice(Math.max(0, offset - 80), offset + 160))}; ` +
    `expected=${JSON.stringify(expected.slice(Math.max(0, offset - 80), offset + 160))}`
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

function aiTranscriptMarkdown() {
  const script = path.join(aigmRoot, 'scripts', 'AI-transcript.py');
  const result = spawnSync(
    process.env.PYTHON ?? 'python',
    [script, '--file', fixturePath, '--color', 'never'],
    {
      cwd: aigmRoot,
      env: { ...process.env, AI_CONVERSATION_CORE: aigmCoreRoot },
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
  const bundle = await readFile(
    path.join(coreRoot, 'dist', 'aiconversationcore.chatgpt.browser.js'),
    'utf8'
  );
  // Mirror browser globals the canonical bundle actually relies on. Node vm contexts
  // do not provide the Web URL constructor automatically, while production browsers do.
  const context = { URL };
  context.globalThis = context;
  vm.runInNewContext(bundle, context, { filename: 'aiconversationcore.chatgpt.browser.js' });

  Object.assign(context, {
    showTimestamps: false,
    showRecordNumbers: false,
    showTurnIds: false,
    showDebugProvenance: false,
    assert(condition, message) {
      if (!condition) throw new Error(message);
    },
    cgIsHidden(record) {
      return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
    },
    currentConversationId() {
      return 'phase7-conversation';
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
      const visibleUser = !record?.metadata?.is_visually_hidden_from_conversation &&
        record?.author?.role === 'user' &&
        ['text', 'multimodal_text'].includes(record?.content?.content_type);
      if (visibleUser) {
        throw new Error(`Phase 7 fixture unexpectedly entered DownloadConversation User fallback rendering for ${record?.id ?? 'unknown'}.`);
      }
      return '';
    },
    cgVisibleAssistantMarkdown(record) {
      const visibleAssistant = !record?.metadata?.is_visually_hidden_from_conversation &&
        record?.author?.role === 'assistant' &&
        ['text', 'multimodal_text'].includes(record?.content?.content_type);
      if (visibleAssistant) {
        throw new Error(`Phase 7 fixture unexpectedly entered DownloadConversation Assistant fallback rendering for ${record?.id ?? 'unknown'}.`);
      }
      return '';
    },
    cgRenderThoughtItem(record) {
      if (record?.metadata?.is_visually_hidden_from_conversation) return '';
      const role = record?.author?.role;
      const type = record?.content?.content_type;
      if ((role === 'assistant' && ['thoughts', 'code', 'execution_output'].includes(type)) || role === 'tool') {
        throw new Error(`Phase 7 fixture unexpectedly entered DownloadConversation thought/tool fallback rendering for ${record?.id ?? 'unknown'}.`);
      }
      return '';
    },
    cgRenderThoughtBlock() {
      throw new Error('Phase 7 fixture unexpectedly entered DownloadConversation thought-block fallback rendering.');
    },
    quoteMarkdown() {
      throw new Error('Phase 7 fixture unexpectedly entered DownloadConversation quote fallback rendering.');
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
    `${integrationSource}\n${renderSource}\nthis.__phase7 = { renderConversationMarkdown, canonicalEventsBySourceRecord, canonicalMessageRecordEligible };`,
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
  const recoveredImageMap = new Map([[
    'user-1',
    ['[image not available](sediment://fixture-image-1)', '[image missing]']
  ]]);
  const events = context.__phase7.canonicalEventsBySourceRecord(records, recoveredImageMap);
  const user = records.find(record => record.id === 'user-1');
  const userEvent = events.get('user-1');
  assert.ok(userEvent, 'DownloadConversation produced no canonical event for user-1.');
  assert.equal(
    context.__phase7.canonicalMessageRecordEligible(user, userEvent),
    true,
    `DownloadConversation rejected canonical user-1: ${JSON.stringify({
      kind: userEvent.kind,
      role: userEvent.role,
      visibility: userEvent.visibility,
      blocks: userEvent.blocks,
      resources: userEvent.resources
    })}`
  );
  return context.__phase7.renderConversationMarkdown(spine, null, recoveredImageMap);
}

const direct = await directCoreMarkdown();
mismatch('direct AIConversationCore final Markdown', direct, canonicalGolden);

const python = aiTranscriptMarkdown();
mismatch('AI-transcript.py final Markdown', python, canonicalGolden);

const downloadConversation = await downloadConversationMarkdown();
const downloadExpected = projectedDownloadConversationGolden(canonicalGolden);
mismatch('DownloadConversation final exported Markdown', downloadConversation, downloadExpected);

console.log('PASS: full final-render parity across AIConversationCore, AI-transcript.py, and DownloadConversation');
