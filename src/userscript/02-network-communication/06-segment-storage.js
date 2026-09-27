  /**\n   * Loads or initializes compact durable segment metadata.\n   *\n   * @returns {Promise<Object>} Current logical-log segment manifest.\n   */\n  async function communicationLogReadSegmentManifest() {
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

  /**\n   * Commits the current compact segment manifest.\n   *\n   * @returns {Promise<void>} Resolves after manifest commit.\n   */\n  async function communicationLogWriteSegmentManifest() {
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

  /**\n   * Hashes exact bytes for segment/archive verification.\n   *\n   * @param {Uint8Array} bytes - Exact bytes to hash.\n   * @returns {Promise<string>} Lowercase hexadecimal SHA-256 digest.\n   */\n  async function communicationLogSha256(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**\n   * Writes and byte-verifies one internal segment file.\n   *\n   * @param {Object} directory - Target File System Access directory handle.\n   * @param {string} name - Exact target filename.\n   * @param {Uint8Array} bytes - Exact bytes to commit.\n   * @returns {Promise<Object>} Verified file handle.\n   */\n  async function communicationLogWriteExactFile(directory, name, bytes) {
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

  /**\n   * Compares two byte arrays exactly.\n   *\n   * @param {Uint8Array} left - First byte array.\n   * @param {Uint8Array} right - Second byte array.\n   * @returns {Promise<boolean>} True when every byte is identical.\n   */\n  async function communicationLogBytesEqual(left, right) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  /**\n   * Compresses, round-trip verifies, then retires one sealed raw segment.\n   *\n   * @param {Object} segment - Durable sealed-segment metadata.\n   * @returns {Promise<void>} Resolves after verified compression or rejects while retaining raw bytes.\n   */\n  async function communicationLogCompressSealedSegment(segment) {
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
      logDiagnostic('debug', 'communication-log-segment-compressed', {
        ordinal: segment.ordinal,
        raw_bytes: segment.raw_bytes,
        archive_bytes: segment.archive_bytes
      });
    } catch (error) {
      segment.compression_state = 'failed';
      segment.failure = boundedDiagnosticText(errorMessage(error), 2000);
      await communicationLogWriteSegmentManifest().catch(() => {});
      logDiagnostic('warnings', 'communication-log-segment-compression-failed', {
        ordinal: segment.ordinal,
        raw_name: segment.raw_name,
        message: segment.failure
      });
      throw error;
    }
  }

  /**\n   * Serializes background compression without blocking active appends.\n   *\n   * @param {Object} segment - Durable sealed-segment metadata.\n   * @returns {Promise<void>} Compression operation promise.\n   */\n  function communicationLogQueueSegmentCompression(segment) {
    const operation = communicationLogCompressionChain.then(
      () => communicationLogCompressSealedSegment(segment)
    );
    communicationLogCompressionChain = operation.catch(() => undefined);
    return operation;
  }

  /**\n   * Verifies and clears the active file after sealing its exact bytes.\n   *\n   * @param {number} expectedBytes - Expected committed active byte count.\n   * @param {string} expectedHash - Expected SHA-256 of committed active bytes.\n   * @returns {Promise<void>} Resolves after verified truncation.\n   */\n  async function communicationLogTruncateActiveAfterSeal(expectedBytes, expectedHash) {
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
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }
  }

  /**\n   * Freezes the active segment, establishes the next active file, then queues compression.\n   *\n   * @returns {Promise<Object|null>} Sealed segment metadata, or null for an empty active segment.\n   */\n  async function communicationLogSealActiveSegment() {
    await communicationLogCloseActiveWriter();
    const snapshot = await communicationLogRefreshedFileSnapshot();
    if (snapshot.file.size === 0) return null;
    const rawBytes = new Uint8Array(await snapshot.file.arrayBuffer());
    const ordinal = communicationLogSegmentManifest.next_ordinal++;
    const suffix = String(ordinal).padStart(6, '0');
    const rawName = `segment-${suffix}.jsonl`;
    const archiveName = `segment-${suffix}.7z`;
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
      compression_state: 'sealed'
    };
    communicationLogSegmentManifest.segments.push(segment);
    await communicationLogWriteSegmentManifest();
    await communicationLogTruncateActiveAfterSeal(rawBytes.byteLength, sourceHash);
    await communicationLogOpenWriter();
    void communicationLogQueueSegmentCompression(segment).catch(() => {});
    return segment;
  }

  /**\n   * Recovers sealed pending/failed segments after reload.\n   *\n   * @returns {Promise<void>} Resolves after recovery work is scheduled.\n   */\n  async function communicationLogRecoverSegmentState() {
    for (const segment of communicationLogSegmentManifest.segments) {
      if (segment.compression_state === 'compressed') continue;
      let rawHandle;
      try {
        rawHandle = await communicationLogSegmentDirectoryHandle.getFileHandle(
          segment.raw_name,
          { create: false }
        );
      } catch (error) {
        if (error?.name === 'NotFoundError') {
          throw new Error(`Missing recoverable raw segment: ${segment.raw_name}`);
        }
        throw error;
      }
      const rawBytes = new Uint8Array(await (await rawHandle.getFile()).arrayBuffer());
      const hash = await communicationLogSha256(rawBytes);
      if (rawBytes.byteLength !== segment.raw_bytes || hash !== segment.source_sha256) {
        throw new Error(`Recoverable raw segment verification failed: ${segment.raw_name}`);
      }
      const active = await communicationLogRefreshedFileSnapshot();
      if (active.file.size === segment.raw_bytes) {
        const activeBytes = new Uint8Array(await active.file.arrayBuffer());
        if (await communicationLogSha256(activeBytes) === segment.source_sha256) {
          await communicationLogTruncateActiveAfterSeal(segment.raw_bytes, segment.source_sha256);
        }
      }
      segment.compression_state = 'sealed';
      void communicationLogQueueSegmentCompression(segment).catch(() => {});
    }
  }

  /**\n   * Initializes durable segmented storage before recorder readiness.\n   *\n   * @returns {Promise<void>} Resolves when active and historical state is ready.\n   */\n  async function communicationLogInitializeSegmentStorage() {
    communicationLogSegmentDirectoryHandle =
      await communicationLogDirectoryHandle.getDirectoryHandle(
        communicationLogSegmentDirectoryName(),
        { create: true }
      );
    communicationLogSegmentManifest = await communicationLogReadSegmentManifest();
    await communicationLogRecoverSegmentState();
  }

  /**\n   * Appends one complete JSONL record and rotates only after its record boundary.\n   *\n   * @param {Object} record - Complete structured communication record.\n   * @returns {Promise<void>} Resolves after the record is accepted by active storage.\n   */\n  async function communicationLogStorageAppendRecord(record) {
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = new TextEncoder().encode(line).byteLength;
    const queued = communicationLogEnqueue('storage-append', async () => {
      await communicationLogOpenWriter();
      await communicationLogWritable.write(line);
      communicationLogWriterDirty = true;
      const snapshot = await communicationLogRefreshedFileSnapshot();
      const pendingBytes = communicationLogWriterDirty ? lineBytes : 0;
      if (snapshot.file.size + pendingBytes >= COMMUNICATION_LOG_SEGMENT_TARGET_BYTES) {
        await communicationLogSealActiveSegment();
      }
    });
    return queued.operation;
  }


  /**\n   * Returns exact verified raw bytes for one historical segment.\n   *\n   * @param {Object} segment - Historical segment metadata.\n   * @returns {Promise<Uint8Array>} Verified raw JSONL segment bytes.\n   */\n  async function communicationLogReadHistoricalSegment(segment) {
    if (segment.compression_state === 'compressed') {
      const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
        segment.archive_name,
        { create: false }
      );
      const archive = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      const bytes = await extract7zArchive(archive);
      if (bytes.byteLength !== segment.raw_bytes
          || await communicationLogSha256(bytes) !== segment.source_sha256) {
        throw new Error(`Historical archive verification failed: segment ${segment.ordinal}`);
      }
      return bytes;
    }
    const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
      segment.raw_name,
      { create: false }
    );
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (bytes.byteLength !== segment.raw_bytes
        || await communicationLogSha256(bytes) !== segment.source_sha256) {
      throw new Error(`Historical raw verification failed: segment ${segment.ordinal}`);
    }
    return bytes;
  }

  /**\n   * Reconstructs the logical JSONL stream in canonical ordinal order.\n   *\n   * @returns {Promise<Uint8Array>} Exact logical-log snapshot bytes.\n   */\n  async function communicationLogLogicalSnapshotBytes() {
    await communicationLogCloseActiveWriter();
    const ordered = [...communicationLogSegmentManifest.segments]
      .sort((left, right) => left.ordinal - right.ordinal);
    const parts = [];
    let total = 0;
    for (const segment of ordered) {
      const bytes = await communicationLogReadHistoricalSegment(segment);
      parts.push(bytes);
      total += bytes.byteLength;
    }
    const active = await communicationLogRefreshedFileSnapshot();
    const activeBytes = new Uint8Array(await active.file.arrayBuffer());
    parts.push(activeBytes);
    total += activeBytes.byteLength;
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      combined.set(part, offset);
      offset += part.byteLength;
    }
    return combined;
  }

  /**\n   * Clears historical segment membership for an explicit log reset.\n   *\n   * @returns {Promise<void>} Resolves after historical segment state is reset.\n   */\n  async function communicationLogResetSegmentHistory() {
    if (!communicationLogSegmentDirectoryHandle) return;
    await communicationLogCompressionChain;
    const name = communicationLogSegmentDirectoryName();
    await communicationLogDirectoryHandle.removeEntry(name, { recursive: true });
    communicationLogSegmentDirectoryHandle =
      await communicationLogDirectoryHandle.getDirectoryHandle(name, { create: true });
    communicationLogSegmentManifest = await communicationLogReadSegmentManifest();
    await communicationLogWriteSegmentManifest();
    communicationLogActiveSegmentBytes = 0;
  }
