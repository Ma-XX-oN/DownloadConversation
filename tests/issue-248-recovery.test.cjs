'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,
  '../src/userscript/02-network-communication/06-segment-recovery.js'), 'utf8');

async function recover(input) {
  const files = new Map(Object.entries(input).map(([name, value]) =>
    [name, { ...value }]));
  let selected = null;
  const directory = {
    async getFileHandle(name, { create }) {
      if (!files.has(name)) {
        if (!create) {
          const error = new Error('Missing file');
          error.name = 'NotFoundError';
          throw error;
        }
        files.set(name, { text: '', modified: 0 });
      }
      return {
        async getFile() {
          const file = files.get(name);
          return {
            size: Buffer.byteLength(file.text),
            lastModified: file.modified,
            async text() { return file.text; }
          };
        }
      };
    }
  };
  const context = {
    COMMUNICATION_LOG_ACTIVE_FILE_NAMES: ['active-a.jsonl', 'active-b.jsonl'],
    communicationLogSegmentDirectoryHandle: directory
  };
  vm.runInNewContext(source + '\n'
    + 'globalThis.__recover = async () => { '
    + 'await communicationLogRecoverAlternatingActiveFiles(); '
    + 'return communicationLogActiveFileName; };', context);
  selected = await context.__recover();
  return { selected, files };
}

const historical = '{"timestamp":"2026-10-12T12:00:00Z"}\n';
const header = '{"version":{"gen":"1.0","comm":"1.0"}}\n';
const nullHeader = '{"version":{"gen":null,"comm":null}}\n';
const file = (text, modified) => ({ text, modified });

test('resumes header-only active without rewriting immutable provenance', async () => {
  const result = await recover({
    'active-a.jsonl': file(header, 1),
    'active-b.jsonl': file(historical, 2)
  });
  assert.equal(result.selected, 'active-a.jsonl');
  assert.equal(result.files.get('active-a.jsonl').text, header);
  assert.equal(result.files.get('active-b.jsonl').text, historical);
});

test('preserves null legacy provenance in a header-only fragment', async () => {
  const result = await recover({
    'active-a.jsonl': file(nullHeader, 1),
    'active-b.jsonl': file(historical, 2)
  });
  assert.equal(result.selected, 'active-a.jsonl');
  assert.equal(result.files.get('active-a.jsonl').text, nullHeader);
});

test('preserves standard selection for two timestamped fragments', async () => {
  const result = await recover({
    'active-a.jsonl': file(historical, 1),
    'active-b.jsonl': file(historical, 2)
  });
  assert.equal(result.selected, 'active-b.jsonl');
});

test('prefers an empty append target over a sealed source', async () => {
  const result = await recover({
    'active-a.jsonl': file(historical, 2),
    'active-b.jsonl': file('', 1)
  });
  assert.equal(result.selected, 'active-b.jsonl');
});

test('malformed metadata is not mistaken for a provenance header', async () => {
  const result = await recover({
    'active-a.jsonl': file('{bad}\n', 1),
    'active-b.jsonl': file(historical, 2)
  });
  assert.equal(result.selected, 'active-b.jsonl');
});

test('creates a new active file when no previous fragment exists', async () => {
  const result = await recover({});
  assert.equal(result.selected, 'active-a.jsonl');
  assert.equal(result.files.get('active-a.jsonl').text, '');
});

test('seals interrupted legacy source without generating version metadata', async () => {
  const legacy = '{"timestamp":"2026-10-11T12:00:00Z"}\n';
  const rawBytes = Uint8Array.from(Buffer.from(legacy));
  let queued = null;
  let removed = null;
  const directory = {
    async getFileHandle(name) {
      if (name !== 'active-b.jsonl') {
        const error = new Error('Missing archive');
        error.name = 'NotFoundError';
        throw error;
      }
      return {
        async getFile() {
          return {
            size: rawBytes.byteLength,
            async arrayBuffer() { return rawBytes.slice().buffer; }
          };
        }
      };
    },
    async removeEntry(name) { removed = name; }
  };
  const context = {
    COMMUNICATION_LOG_ACTIVE_FILE_NAMES: ['active-a.jsonl', 'active-b.jsonl'],
    communicationLogActiveFileName: 'active-a.jsonl',
    communicationLogSegmentDirectoryHandle: directory,
    communicationLogTimestampRangeFromJsonl(bytes) {
      assert.equal(Buffer.from(bytes).toString(), legacy);
      return { start_timestamp: '2026-10-11T12:00:00Z',
        end_timestamp: '2026-10-11T12:00:00Z' };
    },
    communicationLogArchiveTimestamp() { return '2026-10-11'; },
    communicationLogRoleArchiveName() { return 'segment.seg.zst'; },
    async communicationLogSha256() { return 'verified-source-hash'; },
    communicationLogQueueSegmentCompression(segment) {
      queued = segment;
      return Promise.resolve();
    }
  };
  vm.runInNewContext(source + '\n'
    + 'globalThis.__recoverSegment = communicationLogRecoverSegmentState;', context);
  await context.__recoverSegment();
  assert.equal(queued.raw_name, 'active-b.jsonl');
  assert.equal(queued.raw_bytes, rawBytes.byteLength);
  assert.equal(queued.source_sha256, 'verified-source-hash');
  assert.equal(removed, null);
  assert.equal(Buffer.from(rawBytes).toString(), legacy);
});

test('preserves immutable header when scheduling recovery compression', async () => {
  const fragment = header + historical;
  const rawBytes = Uint8Array.from(Buffer.from(fragment));
  let compressed = null;
  const directory = {
    async getFileHandle(name) {
      if (name !== 'active-b.jsonl') {
        const error = new Error('No archive yet');
        error.name = 'NotFoundError';
        throw error;
      }
      return { async getFile() {
        return { size: rawBytes.byteLength,
          async arrayBuffer() { return rawBytes.slice().buffer; } };
      } };
    },
    async removeEntry() { throw new Error('Raw source must be preserved'); }
  };
  const context = {
    COMMUNICATION_LOG_ACTIVE_FILE_NAMES: ['active-a.jsonl', 'active-b.jsonl'],
    communicationLogActiveFileName: 'active-a.jsonl',
    communicationLogSegmentDirectoryHandle: directory,
    communicationLogTimestampRangeFromJsonl(bytes) {
      assert.equal(Buffer.from(bytes).toString(), fragment);
      return { start_timestamp: '2026-10-12T12:00:00Z',
        end_timestamp: '2026-10-12T12:00:00Z' };
    },
    communicationLogArchiveTimestamp() { return '2026-10-12'; },
    communicationLogRoleArchiveName() { return 'segment.seg.zst'; },
    async communicationLogSha256() { return 'immutable-hash'; },
    communicationLogQueueSegmentCompression(segment) {
      compressed = segment;
      return Promise.resolve();
    }
  };
  vm.runInNewContext(source + '\n'
    + 'globalThis.__recoverSegment = communicationLogRecoverSegmentState;', context);
  await context.__recoverSegment();
  assert.equal(compressed.raw_bytes, rawBytes.byteLength);
  assert.equal(compressed.source_sha256, 'immutable-hash');
  assert.equal(Buffer.from(rawBytes).toString(), fragment);
});
