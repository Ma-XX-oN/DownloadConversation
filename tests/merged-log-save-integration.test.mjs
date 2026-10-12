import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const definitions = [
  'mergedLogValidateSelection', 'mergedLogRangeFilter',
  'mergedLogValidPosition', 'mergedLogComparePosition',
  'mergedLogInterleave', 'mergedLogGroupEntries',
  'mergedLogJsonl', 'mergedLogJsonlWithVersions',
  'mergedLogBoundaryVersionRecord', 'resolveGenVersionAtBoundary', 'saveMergedLogs'
].map(productionFunctionSource).join('\n\n');

function fixture(entries, { directory = true } = {}) {
  const writes = [];
  const downloads = [];
  let commReads = 0;
  const state = {
    TextEncoder, TextDecoder, Uint8Array, Blob, Date, JSON, Number, Set,
    diagnosticLog: entries,
    diagnosticLogBaselineVersion: null,
    recordingGroupState: () => ({ enabled: false, ready: false, uuid: null }),
    mergedLogReadCommunication: async () => {
      commReads += 1;
      return { records: [], fragments: [] };
    },
    communicationLogResolveCommVersionAtBoundary: () => null,
    createArchive: async bytes => bytes,
    extractArchive: async bytes => bytes,
    diagnosticLogBytesEqual: (left, right) =>
      Buffer.from(left).equals(Buffer.from(right)),
    canonicalFilename: () => 'recording',
    conversationProjectName: () => null,
    conversationTitle: () => 'recording',
    compressorExtension: () => '.zst',
    compressorMimeType: () => 'application/zstd',
    communicationLogReady: directory,
    communicationLogDirectoryHandle: {},
    unusedFilename: async (handle, prefix, suffix) => prefix + suffix,
    diagnosticLogWriteArchive: async (handle, name, blob) => {
      writes.push({ name, blob });
    },
    downloadBlob: (blob, name) => downloads.push({ blob, name }),
    setStatus: () => {}
  };
  vm.createContext(state);
  vm.runInContext(definitions + '\nthis.save = saveMergedLogs;', state);
  return {
    save: selection => state.save(selection),
    writes, downloads,
    communicationReads: () => commReads
  };
}

const start = '2026-10-11T10:00:00.000Z';
const end = '2026-10-11T10:59:59.999Z';
const choice = { start_timestamp: start, end_timestamp: end,
  general: true, communication: false };
const entry = (level, ordinal, minute) => ({
  timestamp: '2026-10-11T10:' + String(minute).padStart(2, '0')
    + ':00.000Z',
  level, message: 'event-' + ordinal,
  capture_order: { epoch: 1, ordinal, document: 'page-1' },
  recording_group_uuid: 'group-1'
});

test('disk save uses mlog zstd extension and groups selected levels once', async () => {
  const original = [entry('debug', 1, 8), entry('debug', 2, 4),
    entry('warnings', 3, 5)];
  const before = JSON.stringify(original);
  const harness = fixture(original);
  const filename = await harness.save(choice);
  assert.equal(filename, 'recording.mlog.zst');
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.downloads.length, 0);
  assert.equal(harness.communicationReads(), 0);
  const rows = new TextDecoder().decode(harness.writes[0].blob)
    .trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(rows[0], { version: { gen: null, comm: null } });
  assert.equal(rows[1].schema, 2);
  assert.deepEqual(rows.slice(2).map(group => group.level),
    ['debug', 'warnings']);
  assert.deepEqual(rows.slice(2).map(group =>
    group.records.map(record => record.message)),
    [['event-1', 'event-2'], ['event-3']]);
  assert.equal(JSON.stringify(original), before,
    'export must not mutate retained general-log objects');
});

test('ungranted disk destination downloads exact grouped source only', async () => {
  const harness = fixture([entry('debug', 1, 5)], { directory: false });
  assert.equal(await harness.save(choice), 'recording.mlog.zst');
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.downloads.length, 1);
});

test('empty selected range cannot publish an archive', async () => {
  const harness = fixture([entry('debug', 1, 2)]);
  await assert.rejects(harness.save({
    ...choice,
    start_timestamp: '2026-10-11T11:00:00.000Z',
    end_timestamp: '2026-10-11T11:01:00.000Z'
  }), /No recorded events/);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.downloads.length, 0);
});
