import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadConversationSource, productionFunctionSource } from './helpers/userscript-source.mjs';

test('Issue 172 canonical filename owns project chat and timestamp range only', () => {
  const source = productionFunctionSource('canonicalFilename');
  assert.match(source, /project/);
  assert.match(source, /chat/);
  assert.match(source, /timestampRange/);
  assert.doesNotMatch(source, /getFileHandle|collision|extension|ext\b/);
});

test('Issue 172 collision helper receives destination prefix and extension separately', () => {
  const source = productionFunctionSource('unusedFilename');
  assert.match(source, /destination/);
  assert.match(source, /filenamePrefix/);
  assert.match(source, /ext/);
  assert.match(source, /getFileHandle/);
  assert.match(source, /\(\$\{collision\}\)/);
});

test('Issue 172 user-facing producers share canonical filename construction', () => {
  for (const name of ['runExport', 'diagnosticLogArchiveName', 'communicationLogStreamDuplicateArchive']) {
    assert.match(productionFunctionSource(name), /canonicalFilename/);
  }
});

test('Issue 172 filesystem archive producers share collision resolution', () => {
  assert.match(productionFunctionSource('saveDiagnosticLog'), /unusedFilename/);
  assert.match(productionFunctionSource('communicationLogStreamDuplicateArchive'), /unusedFilename/);
});

test('Issue 172 callers own simple and compound extensions', () => {
  const runExport = productionFunctionSource('runExport');
  assert.match(runExport, /\.jsonl/);
  assert.match(runExport, /\.md/);
  assert.match(runExport, /\$\{filename\}\.xz|\$\{rawFilename\}\.xz/);
  assert.match(productionFunctionSource('diagnosticLogArchiveName'), /\.log\.xz/);
  assert.match(productionFunctionSource('communicationLogStreamDuplicateArchive'), /\.comm\.xz/);
});


test('Issue 172 export range is derived from exact JSONL database text', () => {
  const source = productionFunctionSource('runExport');
  assert.match(source, /apiRecordsJsonl\(spine, conversationId\)/);
  assert.match(source, /conversationJsonlTimestampRange\(jsonl\)/);
  assert.doesNotMatch(source, /conversationSpineTimestampRange\(spine\)/);
});

test('Issue 172 JSONL timestamp range rejects null and Unix epoch zero fields', () => {
  const source = productionFunctionSource('conversationJsonlTimestampRange');
  assert.match(source, /create_time/);
  assert.match(source, /update_time/);
  assert.match(source, /> 0/);
  assert.doesNotMatch(source, /Number\(record\?\.(?:create_time|update_time)\)/);
});
