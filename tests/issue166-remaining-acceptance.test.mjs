import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadConversationSource, productionFunctionSource } from './helpers/userscript-source.mjs';

test('Issue 166 archive roles and timestamp ranges are explicit production contracts', () => {
  for (const name of [
    'communicationLogTimestampRangeFromJsonl',
    'communicationLogArchiveTimestamp',
    'communicationLogRoleArchiveName',
    'communicationLogLogicalSnapshot'
  ]) {
    assert.ok(downloadConversationSource.includes(`function ${name}(`) ||
      downloadConversationSource.includes(`async function ${name}(`), `missing ${name}`);
  }
  const seal = productionFunctionSource('communicationLogSealActiveSegment');
  assert.match(seal, /start_timestamp/);
  assert.match(seal, /end_timestamp/);
  assert.match(seal, /'seg'/);
  const duplicate = productionFunctionSource('communicationLogArchiveDuplicate');
  assert.match(duplicate, /'comm'/);
  assert.match(duplicate, /communicationLogLogicalSnapshot/);
});

test('Issue 166 user-facing archive naming adds collision suffix only before role suffix', () => {
  const naming = productionFunctionSource('communicationLogRoleArchiveName');
  assert.match(naming, /role/);
  assert.match(naming, /collision/);
  assert.match(naming, /\(\$\{collision\}\)/);
});

test('Issue 166 duplicate reports every required phase and keeps indeterminate elapsed activity', () => {
  const duplicate = productionFunctionSource('communicationLogArchiveDuplicate');
  for (const phrase of [
    'snapshot boundary',
    'historical segments',
    'compressing',
    'finalizing'
  ]) assert.match(duplicate, new RegExp(phrase, 'i'));
  assert.match(
    productionFunctionSource('communicationLogLogicalSnapshot'),
    /reconstructing/i
  );
  assert.match(duplicate, /elapsed/i);
  assert.doesNotMatch(duplicate, /ETA.*(?:size|benchmark|assum)/i);
});

test('Issue 166 diagnostic Save uses main communication folder when authorized and browser download otherwise', () => {
  const save = productionFunctionSource('saveDiagnosticLog');
  assert.match(save, /'log'/);
  assert.match(save, /diagnosticLogTimestampRange/);
  assert.match(save, /communicationLogDirectoryHandle/);
  assert.match(save, /communicationLogWriteExactFile/);
  assert.match(save, /downloadBlob/);
});

test('Issue 166 all-in-memory reconstruction has an explicit measured-size guard', () => {
  assert.match(downloadConversationSource, /COMMUNICATION_LOG_DUPLICATE_MAX_BYTES/);
  const snapshot = productionFunctionSource('communicationLogLogicalSnapshot');
  assert.match(snapshot, /COMMUNICATION_LOG_DUPLICATE_MAX_BYTES/);
  assert.match(snapshot, /memory/i);
});


test('Issue 166 timestamp range and role naming execute against fixed independent fixtures', async () => {
  const rangeSource = productionFunctionSource('communicationLogTimestampRangeFromJsonl');
  const timestampSource = productionFunctionSource('communicationLogArchiveTimestamp');
  const roleSource = productionFunctionSource('communicationLogRoleArchiveName');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction(`
    ${rangeSource}
    ${timestampSource}
    ${roleSource}
    const bytes = new TextEncoder().encode(
      '{"timestamp":"2026-09-27T01:02:03.004Z","sequence":1}\\n' +
      '{"timestamp":"2026-09-27T01:02:05.006Z","sequence":2}\\n'
    );
    const range = communicationLogTimestampRangeFromJsonl(bytes);
    return {
      range,
      normal: communicationLogRoleArchiveName('DownloadConversation_fixture', range, 'comm', 0),
      collision: communicationLogRoleArchiveName('DownloadConversation_fixture', range, 'comm', 2)
    };
  `);
  const result = await run();
  assert.deepEqual(result.range, {
    start_timestamp: '2026-09-27T01:02:03.004Z',
    end_timestamp: '2026-09-27T01:02:05.006Z'
  });
  assert.equal(
    result.normal,
    'DownloadConversation_fixture_20260927T010203004Z_20260927T010205006Z.comm.7z'
  );
  assert.equal(
    result.collision,
    'DownloadConversation_fixture_20260927T010203004Z_20260927T010205006Z(2).comm.7z'
  );
});

test('Issue 166 no-trustworthy-timestamp fixture is rejected instead of inventing save time', async () => {
  const rangeSource = productionFunctionSource('communicationLogTimestampRangeFromJsonl');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction(`
    ${rangeSource}
    return communicationLogTimestampRangeFromJsonl(
      new TextEncoder().encode('{"sequence":1}\\n')
    );
  `);
  assert.equal(await run(), null);
});


test('Issue 166 duplicate naming is collision-safe and never overwrites an existing archive', () => {
  const duplicate = productionFunctionSource('communicationLogArchiveDuplicate');
  assert.match(duplicate, /communicationLogUnusedRoleArchiveName/);
  assert.match(duplicate, /'comm'/);
});

test('Issue 166 selected segment default and in-memory guard are documented with browser measurements', () => {
  assert.match(downloadConversationSource, /COMMUNICATION_LOG_SEGMENT_TARGET_BYTES = 10 \* 1024 \* 1024/);
  assert.match(downloadConversationSource, /COMMUNICATION_LOG_DUPLICATE_MAX_BYTES = 128 \* 1024 \* 1024/);
});


test('Issue 166 diagnostic Save does not cross into communication segment helper scope', () => {
  const save = productionFunctionSource('saveDiagnosticLog');
  assert.doesNotMatch(save, /communicationLogRoleArchiveName/);
  assert.doesNotMatch(save, /communicationLogUnusedRoleArchiveName/);
  assert.doesNotMatch(save, /communicationLogAsciiArchiveMemberName/);
  assert.doesNotMatch(save, /communicationLogWriteExactFile/);
  assert.doesNotMatch(save, /communicationLogBytesEqual/);
  assert.match(save, /diagnosticLogArchiveApi/);
  assert.match(save, /diagnosticLogArchiveName/);
  assert.match(save, /diagnosticLogWriteArchive/);
  assert.match(save, /diagnosticLogBytesEqual/);
});

test('Issue 166 diagnostic archive API rejects an actually unavailable runtime primitive', () => {
  const api = productionFunctionSource('diagnosticLogArchiveApi');
  assert.match(api, /typeof create7zArchive !== 'function'/);
  assert.match(api, /typeof extract7zArchive !== 'function'/);
  assert.match(api, /ReferenceError/);
});

test('Issue 166 diagnostic Save reports the original phase and error without rethrowing', () => {
  const save = productionFunctionSource('saveDiagnosticLog');
  assert.match(save, /phase = 'archive-create'/);
  assert.match(save, /phase = 'archive-verify'/);
  assert.match(save, /phase = 'destination'/);
  assert.match(save, /diagnostic-log-save-failed/);
  assert.match(save, /error_name/);
  assert.match(save, /message/);
  assert.doesNotMatch(save, /throw error/);
});
