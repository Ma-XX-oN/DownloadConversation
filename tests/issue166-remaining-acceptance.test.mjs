import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadConversationSource, productionFunctionSource } from './helpers/userscript-source.mjs';

test('Issue 166 archive roles and timestamp ranges are explicit production contracts', () => {
  for (const name of [
    'communicationLogTimestampRangeFromJsonl',
    'communicationLogArchiveTimestamp',
    'communicationLogRoleArchiveName',
    'communicationLogStreamDuplicateArchive'
  ]) {
    assert.ok(downloadConversationSource.includes(`function ${name}(`) ||
      downloadConversationSource.includes(`async function ${name}(`), `missing ${name}`);
  }
  const seal = productionFunctionSource('communicationLogSealActiveSegment');
  assert.match(seal, /start_timestamp/);
  assert.match(seal, /end_timestamp/);
  assert.match(seal, /'seg'/);
  const duplicate = productionFunctionSource('communicationLogArchiveDuplicate');
  assert.match(duplicate, /communicationLogStreamDuplicateArchive/);
  assert.match(productionFunctionSource('communicationLogStreamDuplicateArchive'), /'comm'/);
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
    'streaming',
    'finalizing'
  ]) assert.match(duplicate, new RegExp(phrase, 'i'));
  assert.match(
    productionFunctionSource('communicationLogStreamDuplicateArchive'),
    /streamingArchiveWriterBegin|streamingArchiveWriterAppendArchive/
  );
  assert.match(duplicate, /elapsed/i);
  assert.doesNotMatch(duplicate, /ETA.*(?:size|benchmark|assum)/i);
});

test('Issue 166 diagnostic Save uses main communication folder when authorized and browser download otherwise', () => {
  const save = productionFunctionSource('saveDiagnosticLog');
  assert.match(productionFunctionSource('diagnosticLogArchiveName'), /\.log\.xz/);
  assert.match(save, /diagnosticLogTimestampRange/);
  assert.match(save, /communicationLogDirectoryHandle/);
  assert.match(save, /diagnosticLogWriteArchive/);
  assert.match(save, /downloadBlob/);
});

test('Issue 166 Duplicate no longer reconstructs the complete logical log in memory', () => {
  const duplicate = productionFunctionSource('communicationLogArchiveDuplicate');
  const stream = productionFunctionSource('communicationLogStreamDuplicateArchive');
  assert.doesNotMatch(duplicate, /communicationLogLogicalSnapshot/);
  assert.doesNotMatch(duplicate, /logicalSnapshot\.bytes/);
  assert.match(stream, /streamingArchiveWriterBegin/);
  assert.match(stream, /streamingArchiveWriterAppendArchive/);
  assert.match(stream, /streamingArchiveWriterAppendBytes/);
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
  const pad = value => String(value).padStart(2, '0');
  const local = timestamp => {
    const date = new Date(timestamp);
    return `${date.getFullYear()},${pad(date.getMonth() + 1)},${pad(date.getDate())};`
      + `${pad(date.getHours())},${pad(date.getMinutes())},${pad(date.getSeconds())}`;
  };
  const start = local(result.range.start_timestamp);
  const end = local(result.range.end_timestamp);
  assert.equal(
    result.normal,
    `DownloadConversation_fixture_${start}-${end}.comm.xz`
  );
  assert.equal(
    result.collision,
    `DownloadConversation_fixture_${start}-${end}(2).comm.xz`
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
  const stream = productionFunctionSource('communicationLogStreamDuplicateArchive');
  assert.match(stream, /communicationLogUnusedRoleArchiveName/);
  assert.match(stream, /'comm'/);
});

test('Issue 166 selected segment default remains the repository-owned 10 MiB threshold', () => {
  assert.match(downloadConversationSource, /COMMUNICATION_LOG_SEGMENT_TARGET_BYTES = 10 \* 1024 \* 1024/);
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
  assert.match(api, /typeof createArchive !== 'function'/);
  assert.match(api, /typeof extractArchive !== 'function'/);
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


test('Issue 166 diagnostic member naming preserves printable ASCII exactly', () => {
  const member = productionFunctionSource('diagnosticLogArchiveMemberName');
  assert.match(member, /\\[\\^\\\\x20-\\\\x7e\\]/);
  const fn = new Function('archiveName', member + '; return diagnosticLogArchiveMemberName(archiveName);');
  assert.equal(
    fn('DownloadConversation_Bind conversation lane_2026,09,27;12,59,34-2026,09,27;14,26,37.log.xz'),
    'DownloadConversation_Bind conversation lane_2026,09,27;12,59,34-2026,09,27;14,26,37.jsonl'
  );
});


test('Issue 166 diagnostic archive timestamps use browser-local calendar/time fields', () => {
  const timestamp = productionFunctionSource('diagnosticLogArchiveTimestamp');
  assert.match(timestamp, /getFullYear/);
  assert.match(timestamp, /getMonth/);
  assert.match(timestamp, /getDate/);
  assert.match(timestamp, /getHours/);
  assert.match(timestamp, /getMinutes/);
  assert.match(timestamp, /getSeconds/);
  assert.doesNotMatch(timestamp, /getMilliseconds/);
  assert.match(timestamp, /,/);
  assert.match(timestamp, /;/);
  assert.doesNotMatch(timestamp, /toISOString/);
  assert.doesNotMatch(timestamp, /Z['"\x60]/);
});


test('Issue 166 diagnostic archive name uses requested local range punctuation', () => {
  const name = productionFunctionSource('diagnosticLogArchiveName');
  assert.match(name, /start_timestamp/);
  assert.match(name, /end_timestamp/);
  assert.match(name, /-.*end_timestamp/s);
  assert.match(name, /\.log\.xz/);
});


test('Issue 166 ordinary recording keeps one long-lived active writable transaction', () => {
  const lifecycle = productionFunctionSource('communicationLogInstallLifecycleObservers');
  const response = productionFunctionSource('communicationLogFetchResponse');
  assert.doesNotMatch(lifecycle, /checkpoint:periodic|communicationLogCheckpoint\('periodic'\)/);
  assert.doesNotMatch(lifecycle, /communicationLogCheckpoint\('visibility-hidden'\)/);
  assert.doesNotMatch(response, /communicationLogCheckpoint\('generation-response-complete'\)/);

  const open = productionFunctionSource('communicationLogOpenWriter');
  assert.match(open, /if \(communicationLogWritable\) return communicationLogWritable/);
  assert.match(open, /createWritable\(\{ keepExistingData: true \}\)/);
});

test('Issue 166 Duplicate commits once, freezes EOF, then immediately reopens recording', () => {
  const snapshot = productionFunctionSource('communicationLogCaptureSnapshotPlan');
  const closeAt = snapshot.indexOf('communicationLogCloseActiveWriter');
  const eofAt = snapshot.indexOf('active.file.size');
  assert.ok(closeAt >= 0 && eofAt > closeAt, 'Duplicate must commit before freezing EOF');

  const duplicate = productionFunctionSource('communicationLogArchiveDuplicate');
  const captureAt = duplicate.indexOf('communicationLogCaptureSnapshotPlan');
  const reopenAt = duplicate.indexOf('communicationLogOpenWriter', captureAt);
  assert.ok(captureAt >= 0 && reopenAt > captureAt,
    'Duplicate must reopen the active writer immediately after its frozen snapshot');
});