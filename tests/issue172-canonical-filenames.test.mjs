import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

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

test('Issue 172 callers own role extensions while compressor suffix is derived', () => {
  const runExport = productionFunctionSource('runExport');
  assert.match(runExport, /\.jsonl/);
  assert.match(runExport, /\.md/);
  assert.match(runExport, /compressorExtension\(\)/);
  assert.match(productionFunctionSource('diagnosticLogArchiveName'), /compressorExtension\(\)/);
  assert.match(productionFunctionSource('communicationLogStreamDuplicateArchive'), /compressorExtension\(\)/);
  assert.match(productionFunctionSource('communicationLogStreamDuplicateArchive'), /\.comm/);
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
  assert.match(source, /value <= 0/);
  assert.doesNotMatch(source, /Number\(record\?\.(?:create_time|update_time)\)/);
});

test('Issue 172 JSONL range cannot turn null or zero into the Unix epoch', () => {
  const context = {};
  vm.runInNewContext(
    `${productionFunctionSource('conversationJsonlTimestampRange')}\nthis.range = conversationJsonlTimestampRange;`,
    context
  );
  const jsonl = [
    JSON.stringify({ record_type: 'chatgpt_conversation_metadata', schema_version: 1 }),
    JSON.stringify({ id: 'missing', create_time: null, update_time: null }),
    JSON.stringify({ id: 'zero', create_time: 0, update_time: 0 }),
    JSON.stringify({ id: 'first', create_time: 1780000000, update_time: null }),
    JSON.stringify({ id: 'last', create_time: 1780000300, update_time: null })
  ].join('\n') + '\n';
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.range(jsonl))),
    {
      start_timestamp: new Date(1780000000 * 1000).toISOString(),
      end_timestamp: new Date(1780000300 * 1000).toISOString()
    }
  );
});
