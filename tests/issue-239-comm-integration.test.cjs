'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const root = 'src/userscript/02-network-communication/';
const source = [
  '06-segment-storage.js',
  '06-segment-recovery.js',
  '06-segment-duplicate.js',
  '06-segment-snapshot.js'
].map(name => readFileSync(root + name, 'utf8')).join('\n');
const encoder = new TextEncoder();
const decode = bytes => new TextDecoder().decode(bytes);
const encode = text => encoder.encode(text);
const header = '{"version":{"gen":"v1","comm":"v1"}}\n';
const a = '{"timestamp":"2026-10-11T12:00:00.000Z","message":"A"}\n';
const transition =
  '{"timestamp":"2026-10-11T12:01:00.000Z","version":{"comm":"v2"}}\n';
const b = '{"timestamp":"2026-10-11T12:02:00.000Z","message":"B"}\n';

test('combined modules compile and preserve selected COMM provenance', () => {
  const { filter, range } = new Function(source +
    '\nreturn {filter:communicationLogFilterJsonlBytes, ' +
    'range:communicationLogTimestampRangeFromJsonl};')();
  const bytes = encode(header + a + transition + b);
  const selected = filter(bytes, Date.parse('2026-10-11T12:01:00Z'),
    Date.parse('2026-10-11T12:02:00Z'));
  assert.equal(decode(selected.bytes), header + transition + b);
  assert.equal(selected.start_timestamp, '2026-10-11T12:01:00.000Z');
  assert.equal(selected.end_timestamp, '2026-10-11T12:02:00.000Z');
  assert.deepEqual(range(bytes), {
    start_timestamp: '2026-10-11T12:00:00.000Z',
    end_timestamp: '2026-10-11T12:02:00.000Z'
  });
  assert.equal(range(encode(header)), null);
  assert.equal(filter(encode(header), null, null).bytes.length, 0);
  assert.equal(filter(bytes, Date.parse('2026-10-11T13:00:00Z'), null)
    .bytes.length, 0);
  assert.equal(decode(filter(encode(a + b), null, null).bytes), a + b);
  assert.equal(range(encode(header + a +
    '{"timestamp":"2026-10-11T19:00:00.000Z"}')).end_timestamp,
    '2026-10-11T12:00:00.000Z');
  assert.equal(range(encode(header + '{"timestamp":"invalid"}\n' + a))
    .start_timestamp, '2026-10-11T12:00:00.000Z');
});

test('recovery preserves historical and legacy raw source', async () => {
  for (const legacy of [false, true]) {
    const raw = encode((legacy ? '' : header) + a);
    let queued = null;
    const removed = [];
    const directory = {
      async getFileHandle(name) {
        if (name !== 'active-b.jsonl') {
          const error = new Error('Missing');
          error.name = 'NotFoundError';
          throw error;
        }
        return { getFile: async () => ({
          size: raw.length, arrayBuffer: async () => raw.slice().buffer
        }) };
      },
      async removeEntry(name) { removed.push(name); }
    };
    const api = new Function('directory', 'queue', source + '\n' +
      'communicationLogSegmentDirectoryHandle = directory;\n' +
      'communicationLogActiveFileName = "active-a.jsonl";\n' +
      'communicationLogSha256 = async () => "verified";\n' +
      'communicationLogQueueSegmentCompression = queue;\n' +
      'return communicationLogRecoverSegmentState;')(
      directory, segment => { queued = segment; return Promise.resolve(); }
    );
    await api();
    assert.equal(queued.raw_bytes, raw.length);
    assert.equal(queued.start_timestamp, '2026-10-11T12:00:00.000Z');
    assert.equal(queued.source_sha256, 'verified');
    assert.deepEqual(removed, []);
    assert.equal(decode(raw), (legacy ? '' : header) + a);
  }
});

test('new fragments receive one immutable header and existing fragments none',
  async () => {
    const factory = new Function('VERSION', source + '\n' +
      'return {set: (count, size, writer) => {\n' +
      'communicationLogActiveSegmentBytes = count;\n' +
      'communicationLogActiveFileSnapshot = async () => ({file:{size}});\n' +
      'communicationLogOpenWriter = async () => {};\n' +
      'communicationLogWritable = writer;},\n' +
      'ensure: communicationLogEnsureFragmentHeader};');
    for (const [count, size, expected] of [[0, 0, 1], [40, 40, 0],
      [0, 60, 0]]) {
      const writes = [];
      const api = factory('1.11.4-issue.239.1');
      api.set(count, size, { write: async data => writes.push(data) });
      await api.ensure();
      await api.ensure();
      assert.equal(writes.length, expected);
      if (expected) assert.equal(writes[0],
        '{"version":{"gen":"1.11.4-issue.239.1",' +
        '"comm":"1.11.4-issue.239.1"}}\n');
    }
  });

test('archive round-trip integrity and source failure retention', async () => {
  for (const [corrupt, drift] of [[false, false], [true, false], [false, true]]) {
    const raw = encode(header + a);
    const files = new Map([['closed.jsonl', raw]]);
    const removed = [];
    const directory = {
      async getFileHandle(name) {
        if (!files.has(name)) {
          const error = new Error('Missing');
          error.name = 'NotFoundError';
          throw error;
        }
        return { getFile: async () => ({
          arrayBuffer: async () => files.get(name).slice().buffer
        }) };
      },
      async removeEntry(name) { removed.push(name); files.delete(name); }
    };
    const hash = async bytes => String(bytes.length) + ':' +
      [...bytes].reduce((sum, b) => sum + b, 0);
    const writer = async (dir, name, bytes) => {
      files.set(name, bytes);
      return dir.getFileHandle(name);
    };
    const api = new Function('directory', 'hash', 'writer', 'archive',
      'extract', source + '\n' +
      'communicationLogSegmentDirectoryHandle = directory;\n' +
      'communicationLogSha256 = hash;\n' +
      'communicationLogWriteExactFile = writer;\n' +
      'createArchive = archive;\n' +
      'extractArchive = extract;\n' +
      'setStatus = () => {}; logDiagnostic = () => {};\n' +
      'boundedDiagnosticText = String; errorMessage = String;\n' +
      'return communicationLogCompressSealedSegment;')(
      directory, hash, writer, async bytes => bytes.slice(),
      async bytes => corrupt ? bytes.slice(1) : bytes.slice()
    );
    const segment = {
      raw_name: 'closed.jsonl', archive_name: 'closed.seg.zst',
      raw_bytes: raw.length, source_sha256: drift ? 'stale' : await hash(raw)
    };
    if (corrupt || drift) {
      await assert.rejects(api(segment));
      assert.equal(files.has('closed.jsonl'), true);
      assert.deepEqual(removed, []);
    } else {
      await api(segment);
      assert.equal(files.has('closed.jsonl'), false);
      assert.deepEqual(removed, ['closed.jsonl']);
    }
  }
});
