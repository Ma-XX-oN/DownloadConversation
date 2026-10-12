import assert from 'node:assert/strict';
import test from 'node:test';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const seal = productionFunctionSource('communicationLogSealActiveSegment');
const compress = productionFunctionSource('communicationLogCompressSealedSegment');
const header = '{"version":{"gen":"1.11.4","comm":"1.11.4"}}\n';
const event = '{"timestamp":"2026-10-12T18:00:00Z","type":"fixture"}\n';
const raw = Buffer.from(header + event);

function bind(source, name, dependencies) {
  const declarations = Object.keys(dependencies).map(
    key => 'const ' + key + ' = dependencies.' + key + ';'
  ).join('\n');
  return new Function('dependencies', declarations + '\n' + source
    + '\nreturn ' + name + ';')(dependencies);
}

function sealHarness(timestampRange = {
  start_timestamp: '2026-10-12T18:00:00Z',
  end_timestamp: '2026-10-12T18:00:00Z'
}) {
  const result = { switches: [], compression: [], opens: 0, headers: 0 };
  const dependencies = {
    communicationLogActiveFileName: 'active-a.jsonl',
    communicationLogSegmentDirectoryHandle: {},
    communicationLogAvailableAlternateActiveFile: async () => 'active-b.jsonl',
    communicationLogCloseActiveWriter: async () => {},
    communicationLogActiveFileSnapshot: async () => ({
      file: { size: raw.length, arrayBuffer: async () => raw }
    }),
    communicationLogTimestampRangeFromJsonl: () => timestampRange,
    communicationLogRoleArchiveName: () => 'archive.seg.zst',
    communicationLogFileExistsInDirectory: async () => false,
    communicationLogSha256: async () => 'source-hash',
    communicationLogSwitchActiveFile: async name => {
      result.switches.push(name);
    },
    communicationLogOpenWriter: async () => { result.opens += 1; },
    communicationLogEnsureFragmentHeader: async () => { result.headers += 1; },
    communicationLogQueueSegmentCompression: segment => {
      result.compression.push(segment);
      return Promise.resolve();
    }
  };
  return { result, run: bind(seal, 'communicationLogSealActiveSegment', dependencies) };
}

test('rotation preserves closed bytes and does not create header-only active fragment', async () => {
  const { result, run } = sealHarness();
  const sealed = await run();
  assert.deepEqual(result.switches, ['active-b.jsonl']);
  assert.equal(result.opens, 0);
  assert.equal(result.headers, 0);
  assert.equal(result.compression.length, 1);
  assert.equal(sealed.raw_bytes, raw.length);
  assert.equal(sealed.raw_name, 'active-a.jsonl');
  assert.equal(sealed.source_sha256, 'source-hash');
});

test('metadata-only fragment cannot be sealed as content', async () => {
  const { result, run } = sealHarness(null);
  await assert.rejects(run(), /no trustworthy content timestamp range/);
  assert.deepEqual(result.switches, []);
  assert.deepEqual(result.compression, []);
});

function compressionHarness(extract) {
  const removed = [];
  const written = new Map();
  const hash = async bytes => Array.from(bytes).join(',');
  const equal = async (a, b) =>
    a.length === b.length && a.every((byte, i) => byte === b[i]);
  const dependencies = {
    communicationLogSegmentDirectoryHandle: {
      getFileHandle: async name => ({
        getFile: async () => ({
          arrayBuffer: async () => name === 'active-a.jsonl'
            ? raw : written.get(name)
        })
      }),
      removeEntry: async name => { removed.push(name); }
    },
    communicationLogSha256: hash,
    communicationLogBytesEqual: equal,
    setStatus: () => {},
    createArchive: async bytes => Buffer.concat([Buffer.from([88]), bytes]),
    communicationLogWriteExactFile: async (_directory, name, bytes) => {
      written.set(name, bytes);
      return { getFile: async () => ({ arrayBuffer: async () => bytes }) };
    },
    extractArchive: extract,
    communicationLogRotationPending: false,
    logDiagnostic: () => {},
    errorMessage: error => String(error),
    boundedDiagnosticText: value => value
  };
  return {
    removed, written, hash,
    run: bind(compress, 'communicationLogCompressSealedSegment', dependencies)
  };
}

test('compressed archive roundtrips exact immutable version metadata and content', async () => {
  const h = compressionHarness(bytes => bytes.slice(1));
  await h.run({
    raw_name: 'active-a.jsonl',
    raw_bytes: raw.length,
    source_sha256: await h.hash(raw),
    archive_name: 'archive.seg.zst'
  });
  assert.deepEqual(h.removed, ['active-a.jsonl']);
  assert.deepEqual(h.written.get('archive.seg.zst').slice(1), raw);
  assert.equal(JSON.parse(raw.toString().split('\n')[0]).version.comm, '1.11.4');
});

test('bad archive extraction never retires the raw source', async () => {
  const h = compressionHarness(async () => Buffer.from('corrupted'));
  await assert.rejects(h.run({
    raw_name: 'active-a.jsonl',
    raw_bytes: raw.length,
    source_sha256: await h.hash(raw),
    archive_name: 'archive.seg.zst'
  }), /round-trip verification failed/);
  assert.deepEqual(h.removed, []);
});

test('changed sealed source refuses archive creation and preserves raw', async () => {
  const h = compressionHarness(bytes => bytes.slice(1));
  await assert.rejects(h.run({
    raw_name: 'active-a.jsonl',
    raw_bytes: raw.length,
    source_sha256: 'stale-hash',
    archive_name: 'archive.seg.zst'
  }), /Closed communication source changed/);
  assert.deepEqual(h.removed, []);
  assert.equal(h.written.size, 0);
});
