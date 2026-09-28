import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const storagePath = new URL(
  '../src/userscript/02-network-communication/06-segment-storage.js',
  import.meta.url
);
const recoveryPath = new URL(
  '../src/userscript/02-network-communication/06-segment-recovery.js',
  import.meta.url
);

test('Issue 166 dual-active rotation never copies or truncates the sealed source', async () => {
  const source = await readFile(storagePath, 'utf8');
  assert.match(source, /COMMUNICATION_LOG_ACTIVE_FILE_NAMES/);
  assert.match(source, /communicationLogSwitchActiveFile\s*\(/);
  assert.match(source, /communicationLogQueueSegmentCompression\s*\(/);
  const sealStart = source.indexOf('async function communicationLogSealActiveSegment');
  const appendStart = source.indexOf('async function communicationLogStorageAppendRecord');
  assert.ok(sealStart >= 0 && appendStart > sealStart);
  const seal = source.slice(sealStart, appendStart);
  assert.doesNotMatch(seal, /communicationLogWriteExactFile\s*\(/);
  assert.doesNotMatch(seal, /\.truncate\s*\(/);
  assert.match(seal, /communicationLogSwitchActiveFile\s*\(/);
});

test('Issue 166 active files live in the private segment directory', async () => {
  const source = await readFile(storagePath, 'utf8');
  assert.match(
    source,
    /communicationLogSegmentDirectoryHandle\.getFileHandle\(\s*communicationLogActiveFileName/
  );
});

test('Issue 166 startup derives active ownership from alternating file state', async () => {
  const source = await readFile(recoveryPath, 'utf8');
  assert.match(source, /communicationLogRecoverAlternatingActiveFiles\s*\(/);
  assert.match(source, /COMMUNICATION_LOG_ACTIVE_FILE_NAMES/);
  const storage = await readFile(storagePath, 'utf8');
  assert.match(storage, /active-a\.jsonl/);
  assert.match(storage, /active-b\.jsonl/);
  assert.doesNotMatch(source, /persisted_active|active_file_name\s*:/);
});

test('Issue 166 startup awaits activation so asynchronous failures reach its catch', async () => {
  const lifecycle = await readFile(
    new URL('../src/userscript/02-network-communication/03-communication-lifecycle.js', import.meta.url),
    'utf8'
  );
  const start = lifecycle.indexOf('async function initializeCommunicationDiskRecorder');
  assert.ok(start >= 0);
  const body = lifecycle.slice(start, lifecycle.indexOf('\n  /**', start + 20));
  assert.match(body, /return await communicationLogActivateDirectory\(handle\)/);
  assert.match(body, /communication-log-startup-caught/);
});

test('Issue 166 Duplicate freezes EOF without sealing and holds rotation', async () => {
  const duplicate = await readFile(
    new URL('../src/userscript/02-network-communication/06-communication-files.js', import.meta.url),
    'utf8'
  );
  const start = duplicate.indexOf('async function communicationLogArchiveDuplicate');
  assert.ok(start >= 0);
  const body = duplicate.slice(start, duplicate.indexOf('\n  /**', start + 20));
  assert.match(body, /communicationLogDuplicateInProgress/);
  assert.match(body, /communicationLogRotationHold/);
  assert.match(body, /communicationLogCaptureSnapshotPlan\s*\(/);
  const snapshot = await readFile(
    new URL('../src/userscript/02-network-communication/06-segment-snapshot.js', import.meta.url),
    'utf8'
  );
  assert.match(snapshot, /active_eof:\s*activeEof/);
  assert.doesNotMatch(body, /communicationLogSealActiveSegment\s*\(/);
  assert.match(body, /finally\s*\{/);
});

test('Issue 166 Duplicate uses streaming reconstruction rather than a whole-log buffer', async () => {
  const duplicate = await readFile(
    new URL('../src/userscript/02-network-communication/06-communication-files.js', import.meta.url),
    'utf8'
  );
  const start = duplicate.indexOf('async function communicationLogArchiveDuplicate');
  const body = duplicate.slice(start, duplicate.indexOf('\n  /**', start + 20));
  assert.match(body, /communicationLogStreamDuplicateArchive\s*\(/);
  assert.doesNotMatch(body, /communicationLogLogicalSnapshot\s*\(/);
  assert.doesNotMatch(body, /logicalSnapshot\.bytes/);
});

test('Issue 166 private segment filenames do not repeat the conversation prefix', async () => {
  const source = await readFile(storagePath, 'utf8');
  const start = source.indexOf('async function communicationLogSealActiveSegment');
  const end = source.indexOf('async function communicationLogReleaseRotationHold', start);
  const seal = source.slice(start, end);
  assert.match(seal, /communicationLogRoleArchiveName\(\s*'segment'/s);
  assert.match(seal, /Communication segment filename collision/);
  assert.doesNotMatch(seal, /archiveBase/);
});

test('Issue 166 manifest is control state, not a historical segment catalogue', async () => {
  const storage = await readFile(storagePath, 'utf8');
  const snapshot = await readFile(
    new URL('../src/userscript/02-network-communication/06-segment-snapshot.js', import.meta.url),
    'utf8'
  );
  assert.match(storage, /active_committed_eof/);
  assert.match(storage, /active_last_timestamp/);
  assert.doesNotMatch(storage, /next_ordinal|\.segments\.push/);
  assert.match(snapshot, /communicationLogSegmentDirectoryHandle\.entries\(\)/);
  assert.match(snapshot, /archive_name\.localeCompare/);
});

test('Issue 166 startup never creates the logical top-level JSONL as the active file', async () => {
  const lifecycle = await readFile(
    new URL('../src/userscript/02-network-communication/03-communication-lifecycle.js', import.meta.url),
    'utf8'
  );
  const redaction = await readFile(
    new URL('../src/userscript/02-network-communication/04-communication-redaction.js', import.meta.url),
    'utf8'
  );
  const initialize = lifecycle.indexOf('await communicationLogInitializeSegmentStorage()');
  const swap = lifecycle.indexOf('await communicationLogRecoverSwapFiles()');
  assert.ok(initialize >= 0 && swap > initialize,
    'private segment storage must exist before any active-file swap recovery');
  assert.match(redaction,
    /communicationLogSegmentDirectoryHandle\s*&&\s*communicationLogActiveFileName/);
  assert.match(redaction, /return communicationLogActiveFileSnapshot\(\)/);
});


test('Issue 166 reload does not close an oversized active writer while alternate is occupied', async () => {
  const source = await readFile(storagePath, 'utf8');
  const start = source.indexOf('async function communicationLogSealActiveSegment');
  const end = source.indexOf('async function communicationLogReleaseRotationHold', start);
  assert.ok(start >= 0 && end > start);
  const seal = source.slice(start, end);
  const preflight = seal.indexOf('communicationLogAvailableAlternateActiveFile');
  const close = seal.indexOf('communicationLogCloseActiveWriter');
  assert.ok(preflight >= 0 && close >= 0);
  assert.ok(preflight < close,
    'occupied alternate must be detected before closing the long-lived active writer');
  const unavailable = seal.indexOf('if (!alternate)');
  assert.ok(unavailable > preflight && unavailable < close,
    'occupied alternate must return without destroying/recreating Chromium crswap');
});

test('Issue 166 active crswap recovery enumerates the private segment directory on reload', async () => {
  const source = await readFile(
    new URL('../src/userscript/02-network-communication/05-communication-recovery.js', import.meta.url),
    'utf8'
  );
  const start = source.indexOf('async function communicationLogRecoverSwapFiles');
  const end = source.indexOf('async function communicationLogOpenWriter', start);
  assert.ok(start >= 0 && end > start);
  const recover = source.slice(start, end);
  assert.match(recover, /const recoveryDirectory = communicationLogSegmentDirectoryHandle/);
  assert.match(recover, /recoveryDirectory\.entries\(\)/);
  assert.match(recover, /recoveryDirectory\.removeEntry\(/);
});
