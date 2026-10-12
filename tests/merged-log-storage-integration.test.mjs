import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const names = [
  'mergedLogParseJsonl', 'mergedLogValidPosition',
  'mergedLogComparePosition', 'mergedLogPreviousConversationBlocks',
  'mergedLogReadCommunication'
];
const source = names.map(productionFunctionSource).join('\n\n');
const ts = minute => '2026-10-11T15:' +
  String(minute).padStart(2, '0') + ':00.000Z';
const record = (ordinal, minute, group = 'group-1') => ({
  timestamp: ts(minute),
  recording_group_uuid: group,
  capture_order: { epoch: 1, ordinal, document: 'doc-1' }
});
const raw = records => new TextEncoder().encode(
  records.map(row => JSON.stringify(row)).join('\n') + '\n'
);
const file = bytes => ({
  size: bytes.byteLength,
  arrayBuffer: async () => bytes.buffer.slice(0),
  slice: (start, end) => ({
    arrayBuffer: async () => bytes.slice(start, end).buffer
  })
});
const handle = bytes => ({ kind: 'file', getFile: async () => file(bytes) });

async function collect(previous, current, missing = false) {
  const oldFiles = new Map([
    ['active-a.jsonl', handle(raw(previous))]
  ]);
  const oldDir = {
    async *entries() { yield* oldFiles; }
  };
  const active = handle(raw(current));
  const context = {
    TextDecoder, Uint8Array, JSON, Date, Number, Set,
    communicationLogReady: true,
    communicationLogSegmentDirectoryHandle: {
      name: 'current-folder',
      async getFileHandle(name) {
        assert.equal(name, 'active-a.jsonl');
        return active;
      }
    },
    communicationLogDirectoryHandle: {
      async getDirectoryHandle(name) {
        assert.equal(name, 'prior-folder');
        if (missing) throw Object.assign(new Error('missing'),
          { name: 'NotFoundError' });
        return oldDir;
      }
    },
    recordingGroupDirectoryNames: () => [
      'prior-folder', 'current-folder'
    ],
    recordingGroupState: () => ({ ready: true, uuid: 'group-1' }),
    communicationLogParseSegmentArchiveName: () => null,
    COMMUNICATION_LOG_ACTIVE_FILE_NAMES: ['active-a.jsonl', 'active-b.jsonl'],
    communicationLogEnqueue: (label, callback) => ({
      operation: callback()
    }),
    communicationLogCaptureSnapshotPlan: async () => ({
      segments: [], active_name: 'active-a.jsonl',
      active_eof: raw(current).byteLength
    })
  };
  vm.createContext(context);
  return vm.runInContext(source +
    '\nmergedLogReadCommunication()', context);
}

test('tab grouping reads prior and current physical folders and excludes other tabs', async () => {
  const events = await collect([
    record(2, 18), record(40, 19, 'different-tab')
  ], [record(3, 10), record(1, 20)]);
  assert.deepEqual(Array.from(events, row => row.capture_order.ordinal),
    [2, 3, 1]);
  assert.ok(events.every(row => row.recording_group_uuid === 'group-1'));
});

test('missing previously recorded directory fails rather than silently losing events', async () => {
  await assert.rejects(() => collect([record(1, 1)],
    [record(2, 2)], true), /Recorded communication directory is missing/);
});
