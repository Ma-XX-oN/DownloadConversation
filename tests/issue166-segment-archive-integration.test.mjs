import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  downloadConversationSource,
  productionFunctionSource,
  userscript
} from './helpers/userscript-source.mjs';

test('Issue 166 generated artifact keeps archive bridge and diagnostic Save in one runtime IIFE', () => {
  const iifeStart = userscript.indexOf('\n(() => {');
  const iifeEnd = userscript.lastIndexOf('})();');
  const create = userscript.indexOf('async function create7zArchive(', iifeStart);
  const save = userscript.indexOf('async function saveDiagnosticLog(', iifeStart);
  assert.ok(iifeStart >= 0 && iifeEnd > iifeStart);
  assert.ok(create > iifeStart && create < iifeEnd,
    'generated artifact must contain create7zArchive inside the DC runtime IIFE');
  assert.ok(save > create && save < iifeEnd,
    'generated artifact diagnostic Save must share the archive bridge lexical scope');
});


test('Issue 166 production initialization creates the segment directory and reports every phase', async () => {
  const initialize = productionFunctionSource('communicationLogInitializeSegmentStorage');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction(`
    const diagnostics = [];
    const logDiagnostic = (level, event, data) => diagnostics.push({ level, event, data });
    const boundedDiagnosticText = value => String(value);
    const errorMessage = error => error?.message || String(error);
    const communicationLogSegmentDirectoryName = () => '.DownloadConversation-fixture-segments';
    let communicationLogSegmentDirectoryHandle = null;
    let communicationLogSegmentManifest = null;
    let communicationLogActiveSegmentBytes = 0;
    const childDirectory = { kind: 'directory' };
    const directoryCalls = [];
    const communicationLogDirectoryHandle = {
      async getDirectoryHandle(name, options) {
        directoryCalls.push({ name, options });
        return childDirectory;
      }
    };
    const communicationLogReadSegmentManifest = async () => ({
      schema: 1,
      logical_log_id: 'fixture',
      next_ordinal: 4,
      segments: [{}, {}, {}]
    });
    const communicationLogRetireLegacyTopLevelActive = async () => {};
    const communicationLogRecoverDuplicateRequest = async () => {};
    const communicationLogRecoverAlternatingActiveFiles = async () => {};
    const communicationLogRecoverSegmentState = async () => {};
    const communicationLogRefreshedFileSnapshot = async () => ({
      file: { size: 321 }
    });
    ${initialize}
    await communicationLogInitializeSegmentStorage();
    return {
      directoryCalls,
      childSelected: communicationLogSegmentDirectoryHandle === childDirectory,
      activeBytes: communicationLogActiveSegmentBytes,
      events: diagnostics.map(entry => entry.event)
    };
  `);
  const result = await run();
  assert.deepEqual(result.directoryCalls, [{
    name: '.DownloadConversation-fixture-segments',
    options: { create: true }
  }], 'production initialization must create/open the per-log segment directory');
  assert.equal(result.childSelected, true);
  assert.equal(result.activeBytes, 321);
  assert.deepEqual(result.events, [
    'communication-log-segment-initialize-entered',
    'communication-log-segment-directory-name-resolved',
    'communication-log-segment-initialize-started',
    'communication-log-segment-directory-ready',
    'communication-log-segment-manifest-ready',
    'communication-log-segment-recovery-started',
    'communication-log-segment-recovery-completed',
    'communication-log-segment-initialize-completed'
  ], 'successful initialization must leave a complete causal diagnostic trace');
});

test('Issue 166 directory-name failure is diagnosed after literal initializer entry', async () => {
  const initialize = productionFunctionSource('communicationLogInitializeSegmentStorage');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction(`
    const diagnostics = [];
    const logDiagnostic = (level, event, data) => diagnostics.push({ level, event, data });
    const boundedDiagnosticText = value => String(value);
    const errorMessage = error => error?.message || String(error);
    const communicationLogSegmentDirectoryName = () => {
      throw new TypeError('directory-name fixture failure');
    };
    let communicationLogSegmentDirectoryHandle = null;
    let communicationLogSegmentManifest = null;
    let communicationLogActiveSegmentBytes = 0;
    const communicationLogDirectoryHandle = {};
    const communicationLogReadSegmentManifest = async () => ({ segments: [] });
    const communicationLogRetireLegacyTopLevelActive = async () => {};
    const communicationLogRecoverDuplicateRequest = async () => {};
    const communicationLogRecoverAlternatingActiveFiles = async () => {};
    const communicationLogRecoverSegmentState = async () => {};
    const communicationLogRefreshedFileSnapshot = async () => ({ file: { size: 0 } });
    ${initialize}
    try {
      await communicationLogInitializeSegmentStorage();
    } catch {}
    return diagnostics;
  `);
  const diagnostics = await run();
  assert.equal(diagnostics[0].event, 'communication-log-segment-initialize-entered');
  const failure = diagnostics.find(entry =>
    entry.event === 'communication-log-segment-initialize-failed');
  assert.ok(failure, 'directory-name failure must be explicitly diagnosed');
  assert.equal(failure.data.phase, 'directory-name');
  assert.equal(failure.data.segment_directory, null);
  assert.match(failure.data.message, /directory-name fixture failure/);
});

test('Issue 166 production initialization reports the exact failing phase', async () => {
  const initialize = productionFunctionSource('communicationLogInitializeSegmentStorage');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction(`
    const diagnostics = [];
    const logDiagnostic = (level, event, data) => diagnostics.push({ level, event, data });
    const boundedDiagnosticText = value => String(value);
    const errorMessage = error => error?.message || String(error);
    const communicationLogSegmentDirectoryName = () => '.DownloadConversation-fixture-segments';
    let communicationLogSegmentDirectoryHandle = null;
    let communicationLogSegmentManifest = null;
    let communicationLogActiveSegmentBytes = 0;
    const communicationLogDirectoryHandle = {
      async getDirectoryHandle() { return {}; }
    };
    const communicationLogReadSegmentManifest = async () => ({
      schema: 1,
      logical_log_id: 'fixture',
      next_ordinal: 1,
      segments: []
    });
    const communicationLogRecoverSegmentState = async () => {
      throw new Error('recovery fixture failure');
    };
    const communicationLogRefreshedFileSnapshot = async () => ({
      file: { size: 0 }
    });
    ${initialize}
    try {
      await communicationLogInitializeSegmentStorage();
    } catch {}
    return diagnostics;
  `);
  const diagnostics = await run();
  const failure = diagnostics.find(entry =>
    entry.event === 'communication-log-segment-initialize-failed');
  assert.ok(failure, 'initialization failure must be explicitly diagnosed');
  assert.equal(failure.level, 'warnings');
  assert.equal(failure.data.phase, 'recovery');
  assert.equal(failure.data.segment_directory, '.DownloadConversation-fixture-segments');
  assert.match(failure.data.message, /recovery fixture failure/);
});

test('Issue 166 recorder startup diagnostics cover restore through ready state', () => {
  const startup = productionFunctionSource('initializeCommunicationDiskRecorder');
  const activate = productionFunctionSource('communicationLogActivateDirectory');
  for (const event of [
    'communication-log-startup-entered',
    'communication-log-directory-restore-completed',
    'communication-log-directory-permission-checked',
    'communication-log-startup-caught'
  ]) {
    assert.match(startup, new RegExp(event));
  }
  for (const event of [
    'communication-log-activation-entered',
    'communication-log-conversation-name-resolved',
    'communication-log-swap-recovery-started',
    'communication-log-swap-recovery-completed',
    'communication-log-segment-initialize-call-started',
    'communication-log-recorder-ready'
  ]) {
    assert.match(activate, new RegExp(event));
  }
});

test('Issue 166 storage append crosses the target only after a complete record and seals the active segment', () => {
  const append = productionFunctionSource('communicationLogStorageAppendRecord');
  assert.match(append, /JSON\.stringify\(record\).*\\n/s,
    'one complete JSONL record must be formed before threshold evaluation');
  assert.match(append, /COMMUNICATION_LOG_SEGMENT_TARGET_BYTES/,
    'append must evaluate the repository-owned segment target');
  assert.match(append, /communicationLogSealActiveSegment/,
    'threshold crossing must seal the active segment');
});

test('Issue 166 sealing swaps to a new active segment before compression', () => {
  const seal = productionFunctionSource('communicationLogSealActiveSegment');
  const swap = seal.search(/communicationLogFileName\s*=|communicationLogOpenWriter|active/i);
  const compress = seal.indexOf('communicationLogQueueSegmentCompression');
  assert.ok(swap >= 0 && compress > swap,
    'the next active segment must be established before background compression is queued');
});

test('Issue 166 verified compression deletes raw sealed bytes only after exact verification', () => {
  const compress = productionFunctionSource('communicationLogCompressSealedSegment');
  const archive = compress.indexOf('create7zArchive');
  const verify = compress.indexOf('extract7zArchive', archive);
  const remove = compress.indexOf('removeEntry');
  assert.ok(archive >= 0, 'sealed bytes must be archived');
  assert.match(compress,
    /create7zArchive\(\s*rawBytes,\s*segment\.member_name,\s*communicationLogArchiveMTime\(segment\)\s*\)/s,
    'sealed segment member must carry its content end time');
  assert.ok(verify > archive, 'archive/member bytes must be independently verified');
  assert.ok(remove > verify, 'raw sealed bytes may be deleted only after verification');
});

test('Issue 166 compression failure retains the sealed raw source', () => {
  const compress = productionFunctionSource('communicationLogCompressSealedSegment');
  assert.match(compress, /catch\s*\(/);
  assert.match(compress, /failed|failure|retain|retry/i);
  const catchStart = compress.search(/catch\s*\(/);
  assert.doesNotMatch(compress.slice(catchStart), /removeEntry\(/,
    'failure path must not delete the only sealed raw copy');
});


test('Issue 166 production rotation switches active files before compression', async () => {
  const names = [
    'communicationLogTimestampRangeFromJsonl',
    'communicationLogArchiveTimestamp',
    'communicationLogArchiveMTime',
    'communicationLogRoleArchiveName',
    'communicationLogUnusedRoleArchiveName',
    'communicationLogBytesEqual',
    'communicationLogSha256',
    'communicationLogWriteExactFile',
    'communicationLogWriteSegmentManifest',
    'communicationLogActiveFileSnapshot',
    'communicationLogAvailableAlternateActiveFile',
    'communicationLogSwitchActiveFile',
    'communicationLogCompressSealedSegment',
    'communicationLogQueueSegmentCompression',
    'communicationLogSealActiveSegment',
    'communicationLogStorageAppendRecord'
  ];
  const production = names.map(productionFunctionSource).join('\n\n');

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('webcrypto', `
    const encoder = new TextEncoder();
    const cloneBytes = value => typeof value === 'string'
      ? encoder.encode(value)
      : new Uint8Array(value);
    class MemoryFile {
      constructor(bytes) { this.bytes = bytes; this.lastModified = Date.now(); }
      get size() { return this.bytes.byteLength; }
      async arrayBuffer() { return this.bytes.slice().buffer; }
    }
    class MemoryHandle {
      constructor(name) { this.name = name; this.kind = 'file'; this.bytes = new Uint8Array(); }
      async getFile() { return new MemoryFile(this.bytes.slice()); }
      async createWritable(options = {}) {
        const handle = this;
        let working = options.keepExistingData ? handle.bytes.slice() : new Uint8Array();
        let position = working.byteLength;
        return {
          async seek(offset) { position = offset; },
          async write(value) {
            const bytes = cloneBytes(value);
            const required = position + bytes.byteLength;
            if (required > working.byteLength) {
              const grown = new Uint8Array(required);
              grown.set(working);
              working = grown;
            }
            working.set(bytes, position);
            position += bytes.byteLength;
          },
          async close() { handle.bytes = working.slice(); },
          async abort() {}
        };
      }
    }
    class MemoryDirectory {
      constructor() { this.files = new Map(); }
      async getFileHandle(name, options = {}) {
        if (!this.files.has(name)) {
          if (!options.create) {
            const error = new Error('missing');
            error.name = 'NotFoundError';
            throw error;
          }
          this.files.set(name, new MemoryHandle(name));
        }
        return this.files.get(name);
      }
      async removeEntry(name) {
        if (!this.files.delete(name)) {
          const error = new Error('missing');
          error.name = 'NotFoundError';
          throw error;
        }
      }
    }

    const crypto = webcrypto;
    const communicationLogSegmentDirectoryHandle = new MemoryDirectory();
    const communicationLogFileName = 'DownloadConversation_fixture.jsonl';
    const COMMUNICATION_LOG_ACTIVE_FILE_NAMES = Object.freeze([
      'active-a.jsonl', 'active-b.jsonl'
    ]);
    let communicationLogActiveFileName = 'active-a.jsonl';
    let communicationLogRotationPending = false;
    let communicationLogWritable = null;
    let communicationLogWriterDirty = false;
    let communicationLogActiveSegmentBytes = 0;
    let communicationLogCompressionChain = Promise.resolve();
    const COMMUNICATION_LOG_SEGMENT_TARGET_BYTES = 1;
    const communicationLogSegmentManifest = {
      schema: 1, logical_log_id: 'fixture', next_ordinal: 1, segments: []
    };
    const events = [];
    const setStatus = () => {};
    const abortWritableQuietly = async writable => { try { await writable?.abort?.(); } catch {} };
    const boundedDiagnosticText = value => String(value);
    const errorMessage = error => error?.message || String(error);
    const logDiagnostic = () => {};
    const communicationLogReportFailure = () => {};
    const communicationLogCloseActiveWriter = async () => {
      if (!communicationLogWritable) return;
      await communicationLogWritable.close();
      communicationLogWritable = null;
      communicationLogWriterDirty = false;
    };
    const communicationLogOpenWriter = async () => {
      if (communicationLogWritable) return communicationLogWritable;
      const snapshot = await communicationLogActiveFileSnapshot();
      const writable = await snapshot.handle.createWritable({ keepExistingData: true });
      await writable.seek(snapshot.file.size);
      communicationLogWritable = writable;
      return writable;
    };
    const communicationLogEnqueue = (_stage, operation) => ({
      operation: Promise.resolve().then(operation)
    });
    const create7zArchive = async bytes => {
      events.push(['compress', communicationLogActiveFileName]);
      const result = new Uint8Array(bytes.byteLength + 4);
      result.set([55, 122, 0, 1]);
      result.set(bytes, 4);
      return result;
    };
    const extract7zArchive = async archive => archive.slice(4);

    ${production}

    await communicationLogSegmentDirectoryHandle.getFileHandle('active-a.jsonl', { create: true });
    await communicationLogStorageAppendRecord({
      timestamp: '2026-09-27T01:00:01.000Z', seq: 1, payload: 'alpha'
    });
    const activeImmediatelyAfterSeal = communicationLogActiveFileName;
    const filesImmediatelyAfterSeal = Array.from(
      communicationLogSegmentDirectoryHandle.files.keys()
    );
    await communicationLogCompressionChain;
    return {
      activeImmediatelyAfterSeal,
      filesImmediatelyAfterSeal,
      manifest: JSON.parse(JSON.stringify(communicationLogSegmentManifest)),
      finalFiles: Array.from(communicationLogSegmentDirectoryHandle.files.keys()),
      events
    };
  `);

  const result = await run(globalThis.crypto);
  assert.equal(result.activeImmediatelyAfterSeal, 'active-b.jsonl',
    'recording must switch to the other active file before compression');
  assert.ok(result.filesImmediatelyAfterSeal.includes('active-a.jsonl'),
    'closed source must remain in place while compression runs');
  assert.ok(result.filesImmediatelyAfterSeal.includes('active-b.jsonl'),
    'new active file must exist before compression completes');
  assert.equal(result.manifest.segments.length, 1);
  assert.equal(result.manifest.segments[0].raw_name, 'active-a.jsonl');
  assert.ok(!result.finalFiles.includes('active-a.jsonl'),
    'verified closed source must be retired after compression');
  assert.ok(result.finalFiles.includes('active-b.jsonl'),
    'new active file must remain the recording target');
});

test('Issue 166 production compression failure preserves the only sealed raw copy', async () => {
  const compress = productionFunctionSource('communicationLogCompressSealedSegment');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('webcrypto', `
    const crypto = webcrypto;
    const source = new TextEncoder().encode('{"seq":1}\\n');
    const rawHandle = {
      async getFile() {
        return { async arrayBuffer() { return source.slice().buffer; } };
      }
    };
    let removed = false;
    const communicationLogSegmentDirectoryHandle = {
      async getFileHandle(name) {
        if (name === 'segment-000001.jsonl') return rawHandle;
        return {
          async createWritable() {
            return { async write() {}, async close() {}, async abort() {} };
          },
          async getFile() {
            return { async arrayBuffer() { return new Uint8Array([1]).buffer; } };
          }
        };
      },
      async removeEntry() { removed = true; }
    };
    const communicationLogSegmentManifest = { segments: [] };
    const communicationLogWriteSegmentManifest = async () => {};
    const communicationLogWriteExactFile = async (_directory, _name, bytes) => ({
      async getFile() {
        return { async arrayBuffer() { return bytes.slice().buffer; } };
      }
    });
    const communicationLogBytesEqual = async (a, b) =>
      a.length === b.length && a.every((value, index) => value === b[index]);
    const communicationLogSha256 = async bytes => {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    };
    const communicationLogArchiveMTime = () => 0;
    const create7zArchive = async bytes => bytes.slice();
    const extract7zArchive = async () => new Uint8Array([0]);
    const boundedDiagnosticText = value => String(value);
    const errorMessage = error => error?.message || String(error);
    const logDiagnostic = () => {};
    ${compress}
    const sourceHash = await communicationLogSha256(source);
    const segment = {
      ordinal: 1,
      raw_name: 'segment-000001.jsonl',
      archive_name: 'segment-000001.7z',
      member_name: 'segment-000001.jsonl',
      raw_bytes: source.length,
      source_sha256: sourceHash,
      compression_state: 'sealed'
    };
    let rejected = false;
    try {
      await communicationLogCompressSealedSegment(segment);
    } catch {
      rejected = true;
    }
    return { rejected, removed, state: segment.compression_state };
  `);

  const result = await run(globalThis.crypto);
  assert.equal(result.rejected, true);
  assert.equal(result.removed, false,
    'verification failure must never delete the sealed raw source');
  assert.equal(result.state, 'failed');
});


test('Issue 166 reload recovery owns every durable compression state', () => {
  const recover = productionFunctionSource('communicationLogRecoverSegmentState');
  assert.match(recover, /compression_state === 'compressed'/);
  assert.match(recover, /compression_state = 'sealed'/);
  assert.match(recover, /source_sha256/);
  assert.match(recover, /communicationLogQueueSegmentCompression/);
  assert.match(recover, /Missing recoverable raw segment/);
});

test('Issue 166 reconstruction sorts by ordinal and appends the frozen active prefix last', () => {
  const snapshot = productionFunctionSource('communicationLogLogicalSnapshot');
  assert.match(snapshot, /sort\(\(left, right\) => left\.ordinal - right\.ordinal\)/);
  const historicalPush = snapshot.indexOf('parts.push(bytes)');
  const activePush = snapshot.indexOf('parts.push(frozen.active_bytes)');
  assert.ok(historicalPush >= 0 && activePush > historicalPush);
  assert.match(snapshot, /communicationLogReadHistoricalSegment/);
});


test('Issue 166 bounded Duplicate filtering preserves exact accepted JSONL bytes', () => {
  const filter = productionFunctionSource('communicationLogFilterJsonlBytes');
  const run = new Function(`
    ${filter}
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const first = '{"timestamp":"2026-09-27T01:00:01.000Z","v":"A  B"}\\n';
    const second = '{"timestamp":"2026-09-27T01:00:02.000Z","v":"C"}\\n';
    const third = '{"timestamp":"2026-09-27T01:00:03.000Z","v":"D"}\\n';
    const result = communicationLogFilterJsonlBytes(
      encoder.encode(first + second + third),
      Date.parse('2026-09-27T01:00:02.000Z'),
      Date.parse('2026-09-27T01:00:02.000Z')
    );
    return { text: decoder.decode(result.bytes), second };
  `);
  const result = run();
  assert.equal(result.text, result.second,
    'accepted records must retain their original byte representation');
});

test('Issue 166 Duplicate restart cleanup retains parameters but clears transient hold', () => {
  const recover = productionFunctionSource('communicationLogRecoverDuplicateRequest');
  assert.match(recover, /duplicate_request/);
  assert.match(recover, /removeEntry\(output\)/);
  assert.match(recover, /communicationLogRotationHold\s*=\s*0/);
  assert.doesNotMatch(recover, /delete communicationLogSegmentManifest\.duplicate_request/);
});
