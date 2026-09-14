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
const fixturePath = path.join(root, 'tests', 'fixtures', 'phase7-adversarial.jsonl');
const fixtureText = await readFile(fixturePath, 'utf8');
const records = fixtureText.trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line));

function mismatch(label, actual, expected) {
  if (actual === expected) return;
  const common = Math.min(actual.length, expected.length);
  let offset = 0;
  while (offset < common && actual[offset] === expected[offset]) offset += 1;
  assert.fail(
    `${label} differs at offset ${offset}; actual_len=${actual.length}, expected_len=${expected.length}; ` +
    `actual=${JSON.stringify(actual.slice(Math.max(0, offset - 100), offset + 220))}; ` +
    `expected=${JSON.stringify(expected.slice(Math.max(0, offset - 100), offset + 220))}`
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
  const bundle = await readFile(path.join(coreRoot, 'dist', 'aiconversationcore.chatgpt.browser.js'), 'utf8');
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
      return 'phase7-adversarial';
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
      if (!record?.metadata?.is_visually_hidden_from_conversation && record?.author?.role === 'assistant' &&
          ['text', 'multimodal_text'].includes(record?.content?.content_type)) {
        throw new Error(`Unexpected Assistant fallback for ${record?.id ?? 'unknown'}.`);
      }
      return '';
    },
    cgRenderThoughtItem(record) {
      if (record?.metadata?.is_visually_hidden_from_conversation) return '';
      const role = record?.author?.role;
      const type = record?.content?.content_type;
      if ((role === 'assistant' && ['thoughts', 'code', 'execution_output'].includes(type)) || role === 'tool') {
        throw new Error(`Unexpected thought/tool fallback for ${record?.id ?? 'unknown'}.`);
      }
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
const python = aiTranscriptMarkdown();
mismatch('AI-transcript.py adversarial final Markdown', python, direct);

const download = await downloadConversationMarkdown();
const expectedDownload = projectedDownloadConversationGolden(direct);
mismatch('DownloadConversation adversarial final exported Markdown', download, expectedDownload);

// Supplemental semantic guards. Whole-output equality above remains the primary gate.
assert.match(direct, /<summary>Having a thought<\/summary>/);
assert.match(direct, /^### ChatGPT Commentary$/m);
assert.match(direct, /```python\nprint\('hello from flattened python'\)/);
assert.doesNotMatch(direct, /```unknown/);
assert.match(direct, /```json\n\{"path":"tests\/example\.md","line":17\}/);
assert.match(direct, /## ChatGPT\nThis is literal tool payload\./);
assert.match(direct, /Tool result stayed opaque\./);
assert.match(direct, /message_id=adv-final/);
assert.match(direct, /conversation\/phase7-adversarial\/interpreter\/download/);
assert.match(direct, /sandbox_path=%2Fmnt%2Fdata%2Freport%20\(final\)\.txt/);

const literalPayloadStart = direct.indexOf('retrieved transcript snippet');
assert.ok(literalPayloadStart >= 0, 'Opaque tool payload is missing.');
const beforePayload = direct.slice(0, literalPayloadStart);
const openingFenceMatch = beforePayload.match(/(`{3,})[^`]*$/s);
assert.ok(openingFenceMatch, 'Could not locate enclosing adaptive tool fence.');
assert.ok(openingFenceMatch[1].length > 5,
  `Adaptive enclosing fence must exceed the fixture's five-backtick run; found ${openingFenceMatch[1].length}.`);

console.log('PASS: adversarial full-render parity across all three consumers');
