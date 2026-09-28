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
  assert.match(source, /active-a\.jsonl/);
  assert.match(source, /active-b\.jsonl/);
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
  assert.match(body, /active_eof/);
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
