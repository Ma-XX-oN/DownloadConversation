import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

test('picker is exposed through a deliberate user-gesture prompt instead of startup auto-picking', () => {
  const block = diskBlock();
  assert.match(block, /communication-directory-required/);
  assert.match(block, /addEventListener\(['"]click['"]/);
  assert.match(block, /showDirectoryPicker\(/);
});

test('append path reuses fresh-EOF stale-handle-safe semantics from the old recorder', () => {
  const block = diskBlock();
  assert.match(block, /getFileHandle\([^\n]*create:\s*true/);
  assert.match(block, /await\s+[^;]+\.getFile\(\)/);
  assert.match(block, /createWritable\(\{\s*keepExistingData:\s*true\s*\}\)/);
  assert.match(block, /\.seek\([^)]*\.size\)/,
    'Append offset must come from a freshly read file size.');
  assert.match(block, /InvalidStateError/);
  assert.match(block, /abort\(\)/);
  assert.match(block, /close\(\)/);
  assert.match(block, /changed on disk|external modification/i,
    'Unexpected external byte changes must not be silently overwritten.');
});

test('disk appends are serialized and no writable stream is retained between records', () => {
  const block = diskBlock();
  assert.match(block, /communicationLogWriteChain/);
  assert.doesNotMatch(block, /communicationLogWritable\s*=/,
    'Do not retain an open FileSystemWritableFileStream between JSONL appends.');
});

test('fetch request and response bodies are captured through clones without consuming page objects', () => {
  assert.match(userscript, /communicationLogFetchRequest\(/);
  assert.match(userscript, /communicationLogFetchResponse\(/);
  assert.match(userscript, /request\.clone\(\)|input\.clone\(\)/);
  assert.match(userscript, /response\.clone\(\)/);
  assert.match(userscript, /return response;/);
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
