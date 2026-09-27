import assert from 'node:assert/strict';
import test from 'node:test';

import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

test('Issue 166 archive roles and timestamp ranges are explicit production contracts', () => {
  for (const name of [
    'communicationLogTimestampRangeFromJsonl',
    'communicationLogArchiveTimestamp',
    'communicationLogRoleArchiveName',
    'communicationLogLogicalSnapshot'
  ]) {
    assert.ok(userscript.includes(`function ${name}(`) ||
      userscript.includes(`async function ${name}(`), `missing ${name}`);
  }
  const seal = productionFunctionSource('communicationLogSealActiveSegment');
  assert.match(seal, /start_timestamp/);
  assert.match(seal, /end_timestamp/);
  assert.match(seal, /\.seg\.7z/);
  const duplicate = productionFunctionSource('communicationLogArchiveDuplicate');
  assert.match(duplicate, /\.comm\.7z/);
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
    'reconstructing',
    'compressing',
    'finalizing'
  ]) assert.match(duplicate, new RegExp(phrase, 'i'));
  assert.match(duplicate, /elapsed/i);
  assert.doesNotMatch(duplicate, /ETA.*(?:size|benchmark|assum)/i);
});

test('Issue 166 diagnostic Save uses timestamped log role and main communication directory when authorized', () => {
  const save = productionFunctionSource('saveDiagnosticLog');
  assert.match(save, /\.log\.7z/);
  assert.match(save, /diagnosticLogTimestampRange/);
  assert.match(save, /communicationLogDirectoryHandle/);
  assert.match(save, /downloadBlob/);
});

test('Issue 166 all-in-memory reconstruction has an explicit measured-size guard', () => {
  assert.match(userscript, /COMMUNICATION_LOG_DUPLICATE_MAX_BYTES/);
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
