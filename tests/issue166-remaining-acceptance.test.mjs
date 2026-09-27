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
