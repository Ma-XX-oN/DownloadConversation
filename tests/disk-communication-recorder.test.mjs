import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

function diskBlock() {
  const start = userscript.indexOf('  // BEGIN Issue #123 disk communication recorder');
  const endMarker = '  // END Issue #123 disk communication recorder';
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start,
    'Issue #123 disk communication recorder production block is missing.');
  return userscript.slice(start, end + endMarker.length);
}

function functionBlock(name) {
  const block = diskBlock();
  const start = block.indexOf(`  function ${name}(`);
  const asyncStart = block.indexOf(`  async function ${name}(`);
  const actualStart = start >= 0 ? start : asyncStart;
  assert.ok(actualStart >= 0, `${name} production function is missing.`);
  const next = block.indexOf('\n  /**', actualStart + 3);
  assert.ok(next > actualStart, `${name} production function boundary is missing.`);
  return block.slice(actualStart, next);
}

function apiFetchBlock() {
  const start = userscript.indexOf('  async function apiFetch(url)');
  const endMarker = '  function conversationSchemaOk(data)';
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'apiFetch production block is missing.');
  return userscript.slice(start, end);
}

function redactionHarness() {
  const context = {};
  vm.runInNewContext(
    `${diskBlock()}\nthis.__redaction = {communicationLogCreateRedactionState, communicationLogRedactStreamFeed};`,
    context
  );
  return context.__redaction;
}

function bodyPolicyHarness() {
  const context = {
    URL,
    location: {
      origin: 'https://chatgpt.com',
      href: 'https://chatgpt.com/c/conversation-1'
    }
  };
  vm.runInNewContext(
    `${diskBlock()}\nthis.__bodyPolicy = {communicationLogShouldCaptureBody};`,
    context
  );
  return context.__bodyPolicy;
}

test('disk communication recorder production block exists', () => {
  assert.ok(diskBlock().length > 0);
});

test('communication log filename is project plus sanitized conversation title', () => {
  const block = diskBlock();
  assert.match(block, /DownloadConversation_/);
  assert.match(block, /sanitizeFileName\(conversationTitle\(\)\)/);
  assert.match(block, /\.jsonl/);
});

test('directory handle is persisted in IndexedDB and reused when permission remains granted', () => {
  const block = diskBlock();
  assert.match(block, /indexedDB\.open\(/);
  assert.match(block, /put\([^\n]*communication/i);
  assert.match(block, /queryPermission\(\{\s*mode:\s*['"]readwrite['"]\s*\}\)/);
  assert.match(block, /showDirectoryPicker\(/,
    'Missing/unusable persisted directory must have a picker path.');
});

test('picker is exposed through a deliberate page-realm user gesture', () => {
  const block = diskBlock();
  assert.match(block, /communication-directory-required/);
  assert.match(block, /addEventListener\(['"]click['"]/);
  assert.match(block, /const pickerWindow = typeof unsafeWindow !== ['"]undefined['"] \? unsafeWindow : window;/);
  assert.match(block, /pickerWindow\.showDirectoryPicker\(/);
});

test('recovery retains the verified stale-handle one-shot append invariant', () => {
  const block = diskBlock();
  assert.match(block, /getFileHandle\([^\n]*create:\s*true/);
  assert.match(block, /await\s+[^;]+\.getFile\(\)/);
  assert.match(block, /createWritable\(\{\s*keepExistingData:\s*true\s*\}\)/);
  assert.match(block, /InvalidStateError/);
  assert.match(block, /changed on disk|external modification/i,
    'Unexpected external byte changes must not be silently overwritten.');
});

test('normal recording keeps one writable open instead of committing every JSONL record', () => {
  const block = diskBlock();
  assert.match(block, /let communicationLogWritable = null/);
  assert.match(block, /communicationLogOpenWriter/);
  assert.match(block, /communicationLogWritable\.write\(/);
  const appendLine = functionBlock('communicationLogAppendLine');
  assert.doesNotMatch(appendLine, /\.close\(/,
    'Per-record append must not close/commit the long-lived writable.');
  assert.match(block, /communicationLogWriteChain/,
    'Independent network observers must still serialize writer access.');
});

test('long-lived writer checkpoints every 30 seconds and reopens lazily', () => {
  const block = diskBlock();
  assert.match(block, /COMMUNICATION_LOG_CHECKPOINT_MS\s*=\s*30\s*\*\s*1000/);
  assert.match(block, /setInterval\([^\n]*communicationLogCheckpoint/);
  const checkpoint = functionBlock('communicationLogCheckpoint');
  assert.match(checkpoint, /communicationLogWritable\.close\(\)/);
  assert.match(checkpoint, /communicationLogWritable\s*=\s*null/);
  assert.doesNotMatch(checkpoint, /createWritable\(/,
    'Checkpoint should commit and leave reopening to the next append.');
  assert.match(checkpoint, /communicationLogWriterDirty/,
    'Clean writers should not churn swap files merely because the timer fired.');
});

test('page lifecycle and completed generation-stream response trigger checkpoints', () => {
  const block = diskBlock();
  assert.match(block, /visibilityState\s*===\s*['"]hidden['"][\s\S]{0,400}communicationLogCheckpoint/);
  assert.match(block, /pagehide[\s\S]{0,400}communicationLogCheckpoint/);
  const fetchResponse = functionBlock('communicationLogFetchResponse');
  assert.match(fetchResponse, /\/backend-api\/f\/conversation/);
  assert.match(fetchResponse, /communicationLogCheckpoint\(['"]generation-response-complete['"]\)/);
});

test('startup recovers compatible Chromium crswap candidates before normal recording', () => {
  const block = diskBlock();
  assert.match(block, /communicationLogRecoverSwapFiles/);
  assert.match(block, /\.crswap/);
  assert.match(block, /\.\d+\\\.crswap|\\d\+.*crswap/,
    'Numbered Chromium swap variants must be recognized.');
  assert.match(block, /for await\s*\([^)]*\.entries\(\)/,
    'Recovery must enumerate sibling directory entries.');
  assert.match(block, /lastModified/,
    'Compatible candidates of equal recoverable length need deterministic newest selection.');
  const activate = functionBlock('communicationLogActivateDirectory');
  assert.match(activate, /await communicationLogRecoverSwapFiles\(/);
});

test('swap recovery trims only an incomplete final JSONL line and appends only the compatible suffix', () => {
  const recover = functionBlock('communicationLogRecoverSwapFiles');
  assert.match(recover, /lastIndexOf\(['"]\\n['"]\)|lastIndexOf\(.*10/,
    'Recovery needs a last-complete-line boundary.');
  assert.match(recover, /communicationLogBlobsEqual|communicationLogBlobPrefix/,
    'Real committed bytes must be verified as a prefix of a recovery candidate.');
  assert.match(recover, /slice\([^,]+\.size/,
    'Recovery must append only bytes after the committed real-file size.');
  assert.doesNotMatch(recover, /new Blob\(\[\s*[^\]]*real[^\]]*swap|\+\s*swap/i,
    'Recovery must never blindly concatenate real and swap files.');
});

test('compatible recovered/stale swap files are removed but incompatible swaps are retained', () => {
  const recover = functionBlock('communicationLogRecoverSwapFiles');
  assert.match(recover, /removeEntry\(/);
  assert.match(recover, /communication-log-swap-incompatible/);
  assert.match(recover, /continue|return/,
    'Incompatible swap path must leave the candidate untouched.');
});

test('fetch request and response bodies are captured through clones without consuming page objects', () => {
  assert.match(userscript, /communicationLogFetchRequest\(/);
  assert.match(userscript, /communicationLogFetchResponse\(/);
  assert.match(userscript, /request\.clone\(\)|input\.clone\(\)/);
  assert.match(userscript, /response\.clone\(\)/);
  assert.match(userscript, /return response;/);
});

test('DownloadConversation direct apiFetch traffic is included in the disk trace', () => {
  const block = apiFetchBlock();
  assert.match(block, /communicationLogFetchRequest\(/,
    'Direct authenticated export requests bypass the page fetch wrapper and need explicit disk tracing.');
  assert.match(block, /communicationLogFetchResponse\(/);
  assert.match(block, /origin:\s*['"]downloadconversation['"]/);
  assert.match(diskBlock(), /origin:\s*trace\?\.origin\s*\?\?\s*['"]stock-chatgpt['"]/,
    'Disk records must distinguish stock ChatGPT traffic from DownloadConversation traffic.');
});

test('SSE bodies are streamed to JSONL incrementally rather than buffered wholesale', () => {
  const block = diskBlock();
  assert.match(block, /getReader\(\)/);
  assert.match(block, /communication_response_chunk/);
  assert.match(block, /TextDecoder/);
});

test('XHR and WebSocket communication are represented in the disk recorder', () => {
  assert.match(userscript, /communicationLogXhrRequest\(/);
  assert.match(userscript, /communicationLogXhrResponse\(/);
  assert.match(userscript, /communicationLogWebSocketSend\(/);
  assert.match(userscript, /communicationLogWebSocketMessage\(/);
});

test('credentials and signed-secret values are excluded from disk records', () => {
  const block = diskBlock();
  assert.match(block, /authorization/i);
  assert.match(block, /cookie/i);
  assert.match(block, /set-cookie/i);
  assert.match(block, /redactDiagnosticSignedTokens|signature|access_token/i);
  assert.match(block, /\[redacted\]/i);
});

test('streaming redaction cannot leak secrets split across body chunk boundaries', () => {
  const api = redactionHarness();
  const cases = [
    ['query token', ['https://chatgpt.com/x?access_tok', 'en=SUPER', 'SECRET&ok=1']],
    ['signed URL', ['https://chatgpt.com/x?signa', 'ture=SIG', 'SECRET#frag']],
    ['Bearer header-like text', ['Authorization: Bea', 'rer BEARER', 'SECRET\nnext']],
    ['JSON field', ['{"refresh_tok', 'en":"JSON', 'SECRET","ok":true}']]
  ];

  for (const [name, chunks] of cases) {
    const state = api.communicationLogCreateRedactionState();
    let output = '';
    for (const chunk of chunks) output += api.communicationLogRedactStreamFeed(state, chunk, false);
    output += api.communicationLogRedactStreamFeed(state, '', true);
    assert.doesNotMatch(output, /SUPERSECRET|SIGSECRET|BEARERSECRET|JSONSECRET/, name);
    assert.match(output, /\[redacted\]/i, name);
  }

  const longState = api.communicationLogCreateRedactionState();
  let longOutput = api.communicationLogRedactStreamFeed(longState, '?token=', false);
  for (let index = 0; index < 20; index += 1) {
    longOutput += api.communicationLogRedactStreamFeed(longState, 'A'.repeat(65536), false);
  }
  longOutput += api.communicationLogRedactStreamFeed(longState, '&ok=1', true);
  assert.doesNotMatch(longOutput, /A{32}/,
    'An arbitrarily long credential must stay suppressed until its delimiter arrives.');
  assert.match(longOutput, /\?token=\[redacted\]&ok=1/);
});

test('known binary backend responses are metadata-only, not decoded as API text', () => {
  const api = bodyPolicyHarness();
  assert.equal(api.communicationLogShouldCaptureBody(
    'https://chatgpt.com/backend-api/files/download/file-1',
    'application/octet-stream'
  ), false);
  assert.equal(api.communicationLogShouldCaptureBody(
    'https://chatgpt.com/backend-api/files/download/file-1',
    'image/png'
  ), false);
  assert.equal(api.communicationLogShouldCaptureBody(
    'https://chatgpt.com/backend-api/conversation/conversation-1',
    'application/json'
  ), true);
  assert.equal(api.communicationLogShouldCaptureBody(
    'https://chatgpt.com/backend-api/f/conversation',
    'text/event-stream'
  ), true);
  assert.equal(api.communicationLogShouldCaptureBody(
    'https://chatgpt.com/backend-api/conversations/conversation-1',
    ''
  ), true,
  'Unknown-content-type backend API responses may still be textual and should remain observable.');
});

test('binary bodies are metadata-only while API JSON text SSE payloads can be persisted', () => {
  const block = diskBlock();
  assert.match(block, /application\/json|text\/event-stream|text\//);
  assert.match(block, /binary_body_omitted|body_omitted.*binary/i);
  assert.doesNotMatch(block, /FileReader.*readAsDataURL|btoa\(/,
    'The communication recorder must not Base64 binary assets into JSONL.');
});

test('session and assistant lifecycle evidence are written to the same disk log', () => {
  assert.match(userscript, /communication_session_start/);
  assert.match(userscript, /communicationLogAssistantLifecycle\(/);
  assert.match(userscript, /placeholder|hydrated|retry|thinking|timeout/i);
});

test('disk logger failures are isolated from ChatGPT networking', () => {
  assert.match(userscript, /communication-log-write-failure/);
  assert.match(userscript, /\.catch\([^)]*communication/i);
});
