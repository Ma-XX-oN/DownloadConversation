import { productionFunctionSource } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const manifestFns = [
  'communicationLogCreateSegmentManifest',
  'communicationLogQuarantineMalformedManifest',
  'communicationLogReadSegmentManifest',
  'communicationLogWriteSegmentManifest'
].map(productionFunctionSource).join('\n');

/**
 * Exercises real production manifest functions against in-memory File System Access APIs.
 *
 * @param {string} original - Exact original manifest text.
 * @param {Object} options - Synthetic failure or concurrent-write settings.
 * @returns {Object} Test fixture and read/write entry points.
 */
function manifestHarness(original, options = {}) {
  const files = new Map([
    ['manifest.json', new TextEncoder().encode(original)],
    ['active-a.jsonl', new TextEncoder().encode('{"version":{"gen":"old","comm":null}}\n')]
  ]);
  const diagnostics = [];
  let backupCount = 0;
  const directory = {
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name)) {
        if (!create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        files.set(name, new Uint8Array());
      }
      return {
        async getFile() { return new Blob([files.get(name)]); },
        async createWritable() {
          let bytes = null;
          return {
            async write(value) {
              bytes = typeof value === 'string'
                ? new TextEncoder().encode(value) : new Uint8Array(value);
            },
            async close() {
              const written = bytes ?? new Uint8Array();
              if (name.startsWith('manifest.corrupt-')) {
                backupCount += 1;
                files.set(name, options.corruptBackup
                  ? new TextEncoder().encode('invalid backup') : written);
                if (options.concurrentManifestChange) {
                  files.set('manifest.json', new TextEncoder().encode('{"schema":3,"logical_log_id":"peer"}'));
                }
              } else {
                files.set(name, written);
              }
            }
          };
        }
      };
    }
  };
  const context = {
    Blob,
    TextEncoder,
    Uint8Array,
    Date,
    crypto: { randomUUID: () => 'fixed-backup-id' },
    communicationLogSegmentDirectoryHandle: directory,
    communicationLogSegmentManifest: null,
    currentConversationId: () => 'conversation-id',
    communicationLogConversationName: () => 'test-chat',
    conversationProjectName: () => null,
    location: { pathname: '/c/conversation-id' },
    logDiagnostic: (level, message, data) => diagnostics.push({ level, message, data }),
    abortWritableQuietly: async () => {}
  };
  vm.runInNewContext(`
    const COMMUNICATION_LOG_SEGMENT_SCHEMA = 3;
    ${manifestFns}
    this.read = () => communicationLogReadSegmentManifest();
    this.persist = async manifest => {
      communicationLogSegmentManifest = manifest;
      await communicationLogWriteSegmentManifest();
    };
  `, context);
  return { files, diagnostics, directory, getBackupCount: () => backupCount,
    read: context.read, persist: context.persist };
}

test('truncated manifest is quarantined byte-for-byte; existing active bytes survive reconstruction', async () => {
  const malformed = '{"schema":3,"logical_log_id":';
  const fixture = manifestHarness(malformed);
  const activeBefore = fixture.files.get('active-a.jsonl').slice();
  const recovered = await fixture.read();
  assert.equal(recovered.schema, 3);
  assert.equal(recovered.logical_log_id, 'conversation-id');
  assert.equal(fixture.getBackupCount(), 1);
  const backup = Array.from(fixture.files.entries()).find(([name]) =>
    name.startsWith('manifest.corrupt-'));
  assert.ok(backup, 'The only damaged metadata copy must remain available');
  assert.equal(new TextDecoder().decode(backup[1]), malformed);
  assert.equal(new TextDecoder().decode(fixture.files.get('manifest.json')), malformed,
    'Original must remain intact until successful reconstruction');
  await fixture.persist(recovered);
  assert.deepEqual(fixture.files.get('active-a.jsonl'), activeBefore);
  assert.equal(JSON.parse(new TextDecoder().decode(fixture.files.get('manifest.json'))).schema, 3);
  assert.ok(fixture.diagnostics.some(entry =>
    entry.message === 'communication-log-manifest-quarantined'));
});

test('empty manifest can be reconstructed while keeping its zero-byte original as a backup', async () => {
  const fixture = manifestHarness('');
  const recovered = await fixture.read();
  assert.equal(recovered.schema, 3);
  assert.equal(fixture.getBackupCount(), 1);
  const backup = Array.from(fixture.files.entries()).find(([name]) =>
    name.startsWith('manifest.corrupt-'));
  assert.equal(backup[1].byteLength, 0);
});

test('backup corruption cannot cause the damaged manifest to be replaced or data deleted', async () => {
  const malformed = '{"schema":3';
  const fixture = manifestHarness(malformed, { corruptBackup: true });
  await assert.rejects(fixture.read(), /backup could not be verified/);
  assert.equal(new TextDecoder().decode(fixture.files.get('manifest.json')), malformed);
  assert.ok(fixture.files.has('active-a.jsonl'));
});

test('concurrent peer modification aborts reconstruction without overwriting the peer manifest', async () => {
  const fixture = manifestHarness('{"schema":3', { concurrentManifestChange: true });
  await assert.rejects(fixture.read(), /changed during quarantine/);
  assert.equal(JSON.parse(new TextDecoder().decode(
    fixture.files.get('manifest.json'))).logical_log_id, 'peer');
  assert.equal(fixture.getBackupCount(), 1);
});

test('valid current manifest needs no backup and retains durable recovery metadata', async () => {
  const original = '{"schema":3,"logical_log_id":"old-id","duplicate_request":{"id":3}}';
  const fixture = manifestHarness(original);
  const manifest = await fixture.read();
  assert.equal(manifest.logical_log_id, 'old-id');
  assert.equal(manifest.duplicate_request.id, 3);
  assert.equal(fixture.getBackupCount(), 0);
});

test('non-permission failures remove the page blocker and disarm the gesture capture', () => {
  const removed = [];
  const signals = [];
  const context = {
    document: { getElementById: () => ({ remove: () => removed.push('blocker') }) },
    window: { removeEventListener: name => removed.push(name) },
    logDiagnostic: (...args) => signals.push(args),
    boundedDiagnosticText: value => String(value),
    errorMessage: error => error.message
  };
  vm.runInNewContext(`
    let communicationLogStorageFailed = false;
    let communicationLogDirectoryGestureArmed = true;
    let communicationLogPromptShown = true;
    function communicationLogHandleDirectoryGesture() {}
    ${productionFunctionSource('communicationLogDisarmDirectoryGesture')}
    ${productionFunctionSource('communicationLogSuspendDirectoryAfterStorageFailure')}
    communicationLogSuspendDirectoryAfterStorageFailure('manifest-read', Error('incomplete JSON'));
    this.result = {
      failed: communicationLogStorageFailed,
      armed: communicationLogDirectoryGestureArmed,
      prompt: communicationLogPromptShown
    };
  `, context);
  assert.equal(context.result.failed, true);
  assert.equal(context.result.armed, false);
  assert.equal(context.result.prompt, false);
  assert.deepEqual(removed, ['click', 'keydown', 'blocker']);
  assert.equal(signals[0][1], 'communication-log-storage-unavailable');
});

test('granted handle and failing storage startup never request another folder', async () => {
  let blocked = 0;
  let suspended = 0;
  const ctx = {
    logDiagnostic() {},
    boundedDiagnosticText: value => String(value),
    logConsoleDiagnostic() {},
    communicationLogInstallDirectoryRetryObservers() {},
    communicationLogLoadDirectoryHandle: async () => ({
      queryPermission: async () => 'granted'
    }),
    communicationLogPermissionState: async () => 'granted',
    communicationLogActivateDirectory: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
    communicationLogReportFailure() {},
    communicationLogShowDirectoryPrompt: () => { blocked += 1; },
    communicationLogSuspendDirectoryAfterStorageFailure: () => { suspended += 1; }
  };
  vm.runInNewContext(`
    let communicationLogPendingDirectoryHandle = null;
    ${productionFunctionSource('initializeCommunicationDiskRecorder')}
    this.runStartup = initializeCommunicationDiskRecorder;
  `, ctx);
  assert.equal(await ctx.runStartup(), false);
  assert.equal(blocked, 0);
  assert.equal(suspended, 1);
});

test('a failed storage flag prevents unbounded focus-triggered manifest retries', async () => {
  let reads = 0;
  const context = {
    communicationLogLoadDirectoryHandle: () => { reads += 1; return Promise.resolve(null); }
  };
  vm.runInNewContext(`
    let communicationLogReady = false;
    let communicationLogDirectoryPickerOpening = false;
    let communicationLogDirectoryReselectRequired = false;
    let communicationLogStorageFailed = true;
    let communicationLogDirectoryRestorePromise = null;
    let communicationLogInitializationPromise = null;
    let communicationLogPromptShown = false;
    ${productionFunctionSource('communicationLogRetryStoredDirectory')}
    this.retry = communicationLogRetryStoredDirectory;
  `, context);
  assert.equal(await context.retry(), false);
  assert.equal(await context.retry(), false);
  assert.equal(reads, 0);
});
