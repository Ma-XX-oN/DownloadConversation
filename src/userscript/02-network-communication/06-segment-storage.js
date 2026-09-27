  /** Internal directory containing sealed/compressed segments for the logical log. */
  let communicationLogSegmentDirectoryHandle = null;
  /** Compact durable ordering/integrity metadata for the logical log. */
  let communicationLogSegmentManifest = null;
  /** Background compression chain; active recorder writes do not await it. */
  let communicationLogCompressionChain = Promise.resolve();
  /** Exact bytes accepted into the current active raw segment. */
  let communicationLogActiveSegmentBytes = 0;

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
   * Loads or initializes compact durable segment metadata.
   *
   * @returns {Promise<Object>} Current logical-log segment manifest.
   */
  async function communicationLogReadSegmentManifest() {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory) throw new Error('Communication segment directory is not ready.');
    try {
      const handle = await directory.getFileHandle('manifest.json', { create: false });
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text());
      if (parsed?.schema !== 1 || !Array.isArray(parsed.segments)) {
        throw new Error('Invalid communication segment manifest.');
      }
      return parsed;
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
      return {
        schema: 1,
        logical_log_id: currentConversationId() || crypto.randomUUID(),
        next_ordinal: 1,
        segments: []
      };
    }
  }

  /**
   * Commits the current compact segment manifest.
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
   * Compresses, round-trip verifies, then retires one sealed raw segment.
   *
   * @param {Object} segment - Durable sealed-segment metadata.
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
      throw new Error(`Sealed segment ${segment.ordinal} changed before compression.`);
    }

    try {
      segment.compression_state = 'compressing';
      setStatus(`Communication log: compressing sealed segment ${segment.ordinal}; recording continues.`);
      await communicationLogWriteSegmentManifest();
      const archiveBytes = await create7zArchive(rawBytes, segment.member_name);
      const archiveHandle = await communicationLogWriteExactFile(
        directory,
        segment.archive_name,
        archiveBytes
      );
      const committedArchive = new Uint8Array(await (await archiveHandle.getFile()).arrayBuffer());
      const extracted = await extract7zArchive(committedArchive);
      const extractedHash = await communicationLogSha256(extracted);
      if (!(await communicationLogBytesEqual(extracted, rawBytes))
          || extractedHash !== segment.source_sha256) {
        throw new Error(`Archive round-trip verification failed for segment ${segment.ordinal}.`);
      }
      segment.archive_bytes = committedArchive.byteLength;
      segment.compression_state = 'compressed';
      segment.verified_sha256 = extractedHash;
      await communicationLogWriteSegmentManifest();
      await directory.removeEntry(segment.raw_name);
      setStatus(`Communication log: sealed segment ${segment.ordinal} compressed; recording continues.`);
      logDiagnostic('debug', 'communication-log-segment-compressed', {
        ordinal: segment.ordinal,
        raw_bytes: segment.raw_bytes,
        archive_bytes: segment.archive_bytes
      });
    } catch (error) {
      segment.compression_state = 'failed';
      segment.failure = boundedDiagnosticText(errorMessage(error), 2000);
      await communicationLogWriteSegmentManifest().catch(() => {});
      setStatus(`Communication log: segment ${segment.ordinal} compression failed; sealed raw retained and recording continues.`);
      logDiagnostic('warnings', 'communication-log-segment-compression-failed', {
        ordinal: segment.ordinal,
        raw_name: segment.raw_name,
        message: segment.failure
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
   * Verifies and clears the active file after sealing its exact bytes.
   *
   * @param {number} expectedBytes - Expected committed active byte count.
   * @param {string} expectedHash - Expected SHA-256 of committed active bytes.
   * @returns {Promise<void>} Resolves after verified truncation.
   */
  async function communicationLogTruncateActiveAfterSeal(expectedBytes, expectedHash) {
    const snapshot = await communicationLogRefreshedFileSnapshot();
    const bytes = new Uint8Array(await snapshot.file.arrayBuffer());
    if (bytes.byteLength !== expectedBytes || await communicationLogSha256(bytes) !== expectedHash) {
      throw new Error('Active communication segment changed during seal transaction.');
    }
    let writable = null;
    try {
      writable = await snapshot.handle.createWritable({ keepExistingData: true });
      await writable.truncate(0);
      await writable.close();
      writable = null;
      communicationLogWriterDirty = false;
      communicationLogActiveSegmentBytes = 0;
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }
  }

  /**
   * Freezes the active segment, establishes the next active file, then queues compression.
   *
   * @returns {Promise<Object|null>} Sealed segment metadata, or null for an empty active segment.
   */
  async function communicationLogSealActiveSegment() {
    await communicationLogCloseActiveWriter();
    const snapshot = await communicationLogRefreshedFileSnapshot();
    if (snapshot.file.size === 0) return null;
    const rawBytes = new Uint8Array(await snapshot.file.arrayBuffer());
    const range = communicationLogTimestampRangeFromJsonl(rawBytes);
    if (!range) {
      throw new Error('Sealed communication segment has no trustworthy content timestamp range.');
    }
    const ordinal = communicationLogSegmentManifest.next_ordinal++;
    const suffix = String(ordinal).padStart(6, '0');
    const memberStart = communicationLogArchiveTimestamp(range.start_timestamp);
    const memberEnd = communicationLogArchiveTimestamp(range.end_timestamp);
    const rawName = `segment-${suffix}_${memberStart}_${memberEnd}.jsonl`;
    const archiveBase = communicationLogFileName.replace(/\\.jsonl$/i, '');
    const archiveName = await communicationLogUnusedRoleArchiveName(
      communicationLogSegmentDirectoryHandle,
      archiveBase,
      range,
      'seg'
    );
    const sourceHash = await communicationLogSha256(rawBytes);
    await communicationLogWriteExactFile(
      communicationLogSegmentDirectoryHandle,
      rawName,
      rawBytes
    );
    const segment = {
      ordinal,
      raw_name: rawName,
      archive_name: archiveName,
      member_name: rawName,
      raw_bytes: rawBytes.byteLength,
      source_sha256: sourceHash,
      start_timestamp: range.start_timestamp,
      end_timestamp: range.end_timestamp,
      compression_state: 'sealed'
    };
    communicationLogSegmentManifest.segments.push(segment);
    await communicationLogWriteSegmentManifest();
    await communicationLogTruncateActiveAfterSeal(rawBytes.byteLength, sourceHash);
    await communicationLogOpenWriter();
    void communicationLogQueueSegmentCompression(segment).catch(() => {});
    return segment;
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
      if (communicationLogActiveSegmentBytes >= COMMUNICATION_LOG_SEGMENT_TARGET_BYTES) {
        await communicationLogSealActiveSegment();
      }
    });
    return queued.operation;
  }

  /** Segmented communication storage facade. */
  const communicationLogStorage = Object.freeze({
    appendRecord: communicationLogStorageAppendRecord
  });
