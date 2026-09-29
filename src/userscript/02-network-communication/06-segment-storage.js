  /** Internal directory containing sealed/compressed segments for the logical log. */
  let communicationLogSegmentDirectoryHandle = null;
  /** Small durable active-boundary and interrupted-Duplicate control record. */
  let communicationLogSegmentManifest = null;
  /** Background compression chain; active recorder writes do not await it. */
  let communicationLogCompressionChain = Promise.resolve();
  /** Exact bytes accepted into the current active raw segment. */
  let communicationLogActiveSegmentBytes = 0;
  /** Alternating private active files; a closed source is never copied/truncated. */
  const COMMUNICATION_LOG_ACTIVE_FILE_NAMES = Object.freeze([
    'active-a.jsonl',
    'active-b.jsonl'
  ]);
  /** Current append target inside the private segment directory. */
  let communicationLogActiveFileName = null;
  /** Timestamp of the last complete record accepted into the active file. */
  let communicationLogActiveLastTimestamp = null;
  /** Threshold rotation deferred while held or while the alternate is occupied. */
  let communicationLogRotationPending = false;
  /** Duplicate snapshot hold preventing active-file rotation. */
  let communicationLogRotationHold = 0;
  /** One Duplicate operation may run per logical conversation. */
  let communicationLogDuplicateInProgress = false;

  /**
   * Reads the current active file from the private segment directory.
   *
   * @returns {Promise<Object>} Fresh handle and file snapshot.
   */
  async function communicationLogActiveFileSnapshot() {
    if (!communicationLogSegmentDirectoryHandle || !communicationLogActiveFileName) {
      throw new Error('Communication active segment is not ready.');
    }
    const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
      communicationLogActiveFileName,
      { create: true }
    );
    return { handle, file: await handle.getFile() };
  }

  /**
   * Switches the append target to the other alternating file without copying bytes.
   *
   * @returns {Promise<string>} New active filename.
   */
  async function communicationLogAvailableAlternateActiveFile() {
    const current = communicationLogActiveFileName;
    const next = COMMUNICATION_LOG_ACTIVE_FILE_NAMES.find(name => name !== current);
    if (!next) throw new Error('Communication active-file alternation is invalid.');
    try {
      const occupied = await communicationLogSegmentDirectoryHandle.getFileHandle(
        next,
        { create: false }
      );
      if ((await occupied.getFile()).size > 0) {
        communicationLogRotationPending = true;
        return null;
      }
      await communicationLogSegmentDirectoryHandle.removeEntry(next);
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
    return next;
  }

  /**
   * Switches to one preflighted alternating active filename.
   *
   * @param {string|null} next - Available alternate filename.
   * @returns {Promise<string|null>} New active filename, or null when unavailable.
   */
  async function communicationLogSwitchActiveFile(next = null) {
    const selected = next ?? await communicationLogAvailableAlternateActiveFile();
    if (!selected) return null;
    communicationLogActiveFileName = selected;
    const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
      communicationLogActiveFileName,
      { create: true }
    );
    const file = await handle.getFile();
    if (file.size !== 0) {
      throw new Error(`New communication active file is not empty: ${selected}`);
    }
    communicationLogActiveSegmentBytes = 0;
    communicationLogActiveLastTimestamp = null;
    communicationLogRotationPending = false;
    return selected;
  }

  /**
   * Returns the stable internal segment-directory name for this logical log.
   *
   * @returns {string} Stable internal directory name.
   */
  function communicationLogSegmentDirectoryName() {
    const identity = sanitizeFileName(currentConversationId() || communicationLogConversationName() || 'conversation');
    return `.DownloadConversation-${identity}-segments`;
  }

  /**
   * Loads or initializes the small control/recovery manifest.
   *
   * Historical segment membership is filesystem-derived and is never catalogued
   * here. Legacy active_last_timestamp cache fields are discarded on read.
   *
   * @returns {Promise<Object>} Current control/recovery manifest.
   */
  async function communicationLogReadSegmentManifest() {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory) throw new Error('Communication segment directory is not ready.');
    try {
      const handle = await directory.getFileHandle('manifest.json', { create: false });
      const parsed = JSON.parse(await (await handle.getFile()).text());
      if (parsed?.schema !== 2 || typeof parsed.logical_log_id !== 'string') {
        throw new Error('Invalid communication segment manifest.');
      }
      delete parsed.active_last_timestamp;
      if (typeof parsed.conversation_name !== 'string') parsed.conversation_name = null;
      return parsed;
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
      return {
        schema: 2,
        logical_log_id: currentConversationId() || crypto.randomUUID(),
        conversation_name: communicationLogConversationName() ?? null,
        active_committed_eof: 0
      };
    }
  }

  /**
   * Commits the current small control/recovery manifest.
   *
   * @returns {Promise<void>} Resolves after manifest commit.
   */
  async function communicationLogWriteSegmentManifest() {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory || !communicationLogSegmentManifest) {
      throw new Error('Communication segment manifest is not ready.');
    }
    const handle = await directory.getFileHandle('manifest.json', { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(JSON.stringify(communicationLogSegmentManifest, null, 2) + '\n');
      await writable.close();
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }
  }

  /**
   * Refreshes human-readable conversation identity in the durable manifest.
   *
   * @returns {Promise<boolean>} True when a changed title was committed.
   */
  async function communicationLogSyncManifestConversationName() {
    if (!communicationLogSegmentManifest) return false;
    const conversationName = communicationLogConversationName();
    if (!conversationName
        || communicationLogSegmentManifest.conversation_name === conversationName) {
      return false;
    }
    communicationLogSegmentManifest.conversation_name = conversationName;
    await communicationLogWriteSegmentManifest();
    return true;
  }

  /**
   * Hashes exact bytes for segment/archive verification.
   *
   * @param {Uint8Array} bytes - Exact bytes to hash.
   * @returns {Promise<string>} Lowercase hexadecimal SHA-256 digest.
   */
  async function communicationLogSha256(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Writes and byte-verifies one internal segment file.
   *
   * @param {Object} directory - Target File System Access directory handle.
   * @param {string} name - Exact target filename.
   * @param {Uint8Array} bytes - Exact bytes to commit.
   * @returns {Promise<Object>} Verified file handle.
   */
  async function communicationLogWriteExactFile(directory, name, bytes) {
    const handle = await directory.getFileHandle(name, { create: true });
    let writable = null;
    try {
      writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      writable = null;
      const file = await handle.getFile();
      const committed = new Uint8Array(await file.arrayBuffer());
      if (committed.byteLength !== bytes.byteLength
          || !(await communicationLogBytesEqual(committed, bytes))) {
        throw new Error(`Exact file verification failed: ${name}`);
      }
      return handle;
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }
  }

  /**
   * Compares two byte arrays exactly.
   *
   * @param {Uint8Array} left - First byte array.
   * @param {Uint8Array} right - Second byte array.
   * @returns {Promise<boolean>} True when every byte is identical.
   */
  async function communicationLogBytesEqual(left, right) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  /**
   * Compresses, round-trip verifies, then retires one closed raw active file.
   *
   * @param {Object} segment - Immutable closed-source metadata.
   * @returns {Promise<void>} Resolves after verified compression or rejects while retaining raw bytes.
   */
  async function communicationLogCompressSealedSegment(segment) {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory) throw new Error('Communication segment directory is not ready.');
    const rawHandle = await directory.getFileHandle(segment.raw_name, { create: false });
    const rawFile = await rawHandle.getFile();
    const rawBytes = new Uint8Array(await rawFile.arrayBuffer());
    const sourceHash = await communicationLogSha256(rawBytes);
    if (rawBytes.byteLength !== segment.raw_bytes || sourceHash !== segment.source_sha256) {
      throw new Error(`Closed communication source changed before compression: ${segment.raw_name}`);
    }

    try {
      setStatus(`Communication log: compressing ${segment.raw_name}; recording continues.`);
      const archiveBytes = await createArchive(rawBytes);
      const archiveHandle = await communicationLogWriteExactFile(
        directory,
        segment.archive_name,
        archiveBytes
      );
      const committedArchive = new Uint8Array(await (await archiveHandle.getFile()).arrayBuffer());
      const extracted = await extractArchive(committedArchive);
      if (!(await communicationLogBytesEqual(extracted, rawBytes))
          || await communicationLogSha256(extracted) !== segment.source_sha256) {
        throw new Error(`Archive round-trip verification failed: ${segment.archive_name}`);
      }
      await directory.removeEntry(segment.raw_name);
      if (communicationLogRotationPending) {
        const pending = communicationLogEnqueue('pending-rotation', async () => {
          if (communicationLogRotationHold === 0
              && communicationLogActiveSegmentBytes >= COMMUNICATION_LOG_SEGMENT_TARGET_BYTES) {
            await communicationLogSealActiveSegment();
          }
        });
        void pending.operation.catch(() => {});
      }
      setStatus(`Communication log: ${segment.archive_name} verified; recording continues.`);
      logDiagnostic('debug', 'communication-log-segment-compressed', {
        raw_name: segment.raw_name,
        archive_name: segment.archive_name,
        raw_bytes: segment.raw_bytes,
        archive_bytes: committedArchive.byteLength
      });
    } catch (error) {
      setStatus(
        `Communication log: compression failed for ${segment.raw_name}; `
        + 'closed raw source retained and recording continues.'
      );
      logDiagnostic('warnings', 'communication-log-segment-compression-failed', {
        raw_name: segment.raw_name,
        archive_name: segment.archive_name,
        message: boundedDiagnosticText(errorMessage(error), 2000)
      });
      throw error;
    }
  }

  /**
   * Serializes background compression without blocking active appends.
   *
   * @param {Object} segment - Durable sealed-segment metadata.
   * @returns {Promise<void>} Compression operation promise.
   */
  function communicationLogQueueSegmentCompression(segment) {
    const operation = communicationLogCompressionChain.then(
      () => communicationLogCompressSealedSegment(segment)
    );
    communicationLogCompressionChain = operation.catch(() => undefined);
    return operation;
  }

  /**
   * Checks whether one exact file exists in a specific directory.
   *
   * @param {Object} directory - File System Access directory handle.
   * @param {string} name - Exact filename.
   * @returns {Promise<boolean>} True when the file exists.
   */
  async function communicationLogFileExistsInDirectory(directory, name) {
    try {
      await directory.getFileHandle(name, { create: false });
      return true;
    } catch (error) {
      if (error?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  /**
   * Closes the current active file, switches append ownership, then compresses
   * the closed immutable source directly.  No raw copy or truncation occurs.
   *
   * @returns {Promise<Object|null>} Sealed segment metadata, or null when empty.
   */
  async function communicationLogSealActiveSegment() {
    const alternate = await communicationLogAvailableAlternateActiveFile();
    if (!alternate) return null;

    await communicationLogCloseActiveWriter();
    const snapshot = await communicationLogActiveFileSnapshot();
    if (snapshot.file.size === 0) return null;

    const rawName = communicationLogActiveFileName;
    const rawBytes = new Uint8Array(await snapshot.file.arrayBuffer());
    const range = communicationLogTimestampRangeFromJsonl(rawBytes);
    if (!range) {
      throw new Error('Sealed communication segment has no trustworthy content timestamp range.');
    }

    const memberStart = communicationLogArchiveTimestamp(range.start_timestamp);
    const memberEnd = communicationLogArchiveTimestamp(range.end_timestamp);
    const archiveName = communicationLogRoleArchiveName('segment', range, 'seg');
    if (await communicationLogFileExistsInDirectory(
      communicationLogSegmentDirectoryHandle,
      archiveName
    )) {
      throw new Error(`Communication segment filename collision: ${archiveName}`);
    }
    const sourceHash = await communicationLogSha256(rawBytes);

    const segment = {
      raw_name: rawName,
      archive_name: archiveName,
      raw_bytes: rawBytes.byteLength,
      source_sha256: sourceHash,
      start_timestamp: range.start_timestamp,
      end_timestamp: range.end_timestamp
    };
    await communicationLogSwitchActiveFile(alternate);
    await communicationLogOpenWriter();
    void communicationLogQueueSegmentCompression(segment).catch(() => {});
    return segment;
  }

  /**
   * Releases one Duplicate rotation hold and immediately services pending
   * threshold rotation when possible.
   *
   * @returns {Promise<void>} Resolves after pending rotation is handled.
   */
  async function communicationLogReleaseRotationHold() {
    communicationLogRotationHold = Math.max(0, communicationLogRotationHold - 1);
    if (communicationLogRotationHold !== 0 || !communicationLogRotationPending) return;
    if (communicationLogActiveSegmentBytes < COMMUNICATION_LOG_SEGMENT_TARGET_BYTES) {
      communicationLogRotationPending = false;
      return;
    }
    await communicationLogSealActiveSegment();
  }

  /**
   * Appends one complete JSONL record and rotates only after its record boundary.
   *
   * @param {Object} record - Complete structured communication record.
   * @returns {Promise<void>} Resolves after the record is accepted by active storage.
   */
  async function communicationLogStorageAppendRecord(record) {
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = new TextEncoder().encode(line).byteLength;
    const queued = communicationLogEnqueue('storage-append', async () => {
      await communicationLogOpenWriter();
      await communicationLogWritable.write(line);
      communicationLogWriterDirty = true;
      communicationLogActiveSegmentBytes += lineBytes;
      communicationLogActiveLastTimestamp =
        typeof record?.timestamp === 'string' ? record.timestamp : null;
      if (communicationLogActiveSegmentBytes >= COMMUNICATION_LOG_SEGMENT_TARGET_BYTES) {
        if (communicationLogRotationHold > 0) {
          communicationLogRotationPending = true;
        } else {
          await communicationLogSealActiveSegment();
        }
      }
    });
    return queued.operation;
  }

  /** Segmented communication storage facade. */
  const communicationLogStorage = Object.freeze({
    appendRecord: communicationLogStorageAppendRecord
  });