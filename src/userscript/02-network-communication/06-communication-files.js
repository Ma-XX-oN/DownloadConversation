   * Copies one committed source snapshot to a new sibling and verifies exact bytes.
   *
   * @param {Blob} sourceFile - Committed source file snapshot.
   * @param {string} destinationName - New sibling filename that must not exist.
   * @returns {Promise<void>} Resolves after the destination is committed and verified.
   */
  async function communicationLogCopyForRename(sourceFile, destinationName) {
    if (!communicationLogDirectoryHandle) {
      throw new Error('Communication log directory is not ready.');
    }
    if (await communicationLogFileExists(destinationName)) {
      throw new Error(`Communication log file already exists: ${destinationName}`);
    }

    let destinationCreated = false;
    let writable = null;
    try {
      const destinationHandle = await communicationLogDirectoryHandle.getFileHandle(
        destinationName,
        { create: true }
      );
      destinationCreated = true;
      writable = await destinationHandle.createWritable();
      await writable.write(sourceFile);
      await writable.close();
      writable = null;

      const copiedFile = await destinationHandle.getFile();
      if (copiedFile.size !== sourceFile.size
          || !(await communicationLogBlobsEqual(sourceFile, copiedFile))) {
        throw new Error(`Communication log copy verification failed: ${destinationName}`);
      }
    } catch (error) {
      await abortWritableQuietly(writable);
      if (destinationCreated) {
        try { await communicationLogDirectoryHandle.removeEntry(destinationName); } catch {}
      }
      throw error;
    }
  }

  /**
   * Renames the active communication log by verified copy-then-delete.
   *
   * The operation is serialized behind pending communication writes. The original
   * is deleted only after the new sibling is byte-for-byte verified, and the active
   * filename is switched only after that delete succeeds.
   *
   * @param {string} newFileName - Exact new basename in the authorized directory.
   * @returns {Promise<string>} The new active filename.
   */
  function communicationLogRename(newFileName) {
    const queued = communicationLogEnqueue('rename', async () => {
      const validatedName = communicationLogValidateFileName(newFileName);
      if (!communicationLogReady || !communicationLogDirectoryHandle || !communicationLogFileName) {
        throw new Error('Communication log directory/file is not ready.');
      }
      if (validatedName === communicationLogFileName) return communicationLogFileName;
      if (await communicationLogFileExists(validatedName)) {
        throw new Error(`Communication log file already exists: ${validatedName}`);
      }

      await communicationLogCloseActiveWriter();
      const sourceName = communicationLogFileName;
      const sourceSnapshot = await communicationLogRefreshedFileSnapshot();
      await communicationLogCopyForRename(sourceSnapshot.file, validatedName);

      try {
        await communicationLogDirectoryHandle.removeEntry(sourceName);
      } catch (error) {
        try { await communicationLogDirectoryHandle.removeEntry(validatedName); } catch {}
        throw error;
      }

      communicationLogFileName = validatedName;
      return validatedName;
    });
    return queued.operation;
  }

  /**
   * Changes a duplicate JSONL member name to its sibling 7z archive name.
   *
   * @param {string} memberName - Duplicate member filename.
   * @returns {string} Archive filename with the final extension replaced by .7z.
   */
  function communicationLogDuplicateArchiveFileName(memberName) {
    const extensionIndex = memberName.lastIndexOf('.');
    return extensionIndex > 0
      ? `${memberName.slice(0, extensionIndex)}.7z`
      : `${memberName}.7z`;
  }

  /**
   * Creates a committed point-in-time duplicate of the active communication log.
   *
   * The lowest unused positive `(N)` suffix is inserted immediately before the
   * extension with no intervening space. The active filename never changes.
   *
   * @returns {Promise<string>} The created duplicate filename.
   */
  function communicationLogArchiveDuplicate() {
    const queued = communicationLogEnqueue('duplicate', async () => {
      if (!communicationLogReady || !communicationLogDirectoryHandle || !communicationLogFileName) {
        throw new Error('Communication log directory/file is not ready.');
      }

      await communicationLogCloseActiveWriter();
      const sourceSnapshot = await communicationLogRefreshedFileSnapshot();
      let duplicateNumber = 1;
      let duplicateName = communicationLogDuplicateFileName(
        communicationLogFileName,
        duplicateNumber
      );
      while (await communicationLogFileExists(duplicateName)
          || await communicationLogFileExists(
            communicationLogDuplicateArchiveFileName(duplicateName)
          )) {
        duplicateNumber += 1;
        duplicateName = communicationLogDuplicateFileName(
          communicationLogFileName,
          duplicateNumber
        );
      }

      const memberName = duplicateName;
      const archiveName = communicationLogDuplicateArchiveFileName(duplicateName);
      const archive = await create7zArchive(
        new Uint8Array(await sourceSnapshot.file.arrayBuffer()),
        memberName
      );
      let writable = null;
      let archiveCreated = false;
      try {
        const archiveHandle = await communicationLogDirectoryHandle.getFileHandle(
          archiveName,
          { create: true }
        );
        archiveCreated = true;
        writable = await archiveHandle.createWritable();
        await writable.write(new Blob([archive], { type: 'application/x-7z-compressed' }));
        await writable.close();
        writable = null;
        const verified = await archiveHandle.getFile();
        if (verified.size !== archive.byteLength) {
          throw new Error(
            `Communication log archive verification failed: expected ${archive.byteLength} bytes, found ${verified.size}.`
          );
        }
      } catch (error) {
        await abortWritableQuietly(writable);
        if (archiveCreated) {
          try { await communicationLogDirectoryHandle.removeEntry(archiveName); } catch {}
        }
        throw error;
      }
      return archiveName;
    });
    return queued.operation;
  }

  /**
   * Truncates the active communication log to a verified zero-byte committed file.
   *
   * The reset is serialized with normal communication writes. The authorized
   * directory and active filename remain unchanged, and the next record lazily
   * reopens the normal long-lived writer at the new EOF.
   *
   * @returns {Promise<void>} Resolves after the empty file is committed and verified.
   */
  function communicationLogReset() {
    const queued = communicationLogEnqueue('reset', async () => {
      await communicationLogCloseActiveWriter();
      const refreshed = await communicationLogRefreshedFileSnapshot();
      let writable = null;
      try {
        writable = await refreshed.handle.createWritable({ keepExistingData: true });
        await writable.truncate(0);
        await writable.close();
        writable = null;
        communicationLogWriterDirty = false;
        const verified = await communicationLogRefreshedFileSnapshot();
        if (verified.file.size !== 0) {
          throw new Error(`Communication log reset verification failed: expected 0 bytes, found ${verified.file.size}.`);
        }
      } catch (error) {
        await abortWritableQuietly(writable);
        throw error;
      }
    });
    return queued.operation;
  }

  /**
   * Issue 166 communication-log storage boundary.
   *
   * Producers submit complete structured records here. They do not know whether
   * the current bytes live in an active raw segment, a sealed segment, or an
   * archived historical segment. Segment rotation can therefore replace this
   * implementation without leaving the legacy raw-file append API on the
   * recorder execution path.
   */
  /**
   * Returns the next unused monotonically increasing sealed-segment ordinal.
   *
   * @returns {Promise<number>} Next segment ordinal.
   */
  async function communicationLogNextSegmentOrdinal() {
    const stem = communicationLogFileName.replace(/\\.jsonl$/i, '');
    const pattern = new RegExp(
      `^${stem.replace(/[.*+?^\\${}()|[\\]\\\\]/g, '\\\\  const communicationLogStorage = Object.freeze({
    /**
     * Persists one complete communication record through the active storage layer.
     *
     * @param {Object} record - Complete JSON-compatible communication record.
     * @returns {Promise<void>} Resolves after the record bytes are accepted.
     */
    appendRecord(record) {
      const line = `${JSON.stringify(record)}\n`;
      const queued = communicationLogEnqueue('storage-append', async () => {
        await communicationLogOpenWriter();
        await communicationLogWritable.write(line);
        communicationLogWriterDirty = true;
      });
      return queued.operation;
    }
  });')}\\\\.segment-(\\\\d{6})\\\\.(?:jsonl|7z)   * Copies one committed source snapshot to a new sibling and verifies exact bytes.
   *
   * @param {Blob} sourceFile - Committed source file snapshot.
   * @param {string} destinationName - New sibling filename that must not exist.
   * @returns {Promise<void>} Resolves after the destination is committed and verified.
   */
  async function communicationLogCopyForRename(sourceFile, destinationName) {
    if (!communicationLogDirectoryHandle) {
      throw new Error('Communication log directory is not ready.');
    }
    if (await communicationLogFileExists(destinationName)) {
      throw new Error(`Communication log file already exists: ${destinationName}`);
    }

    let destinationCreated = false;
    let writable = null;
    try {
      const destinationHandle = await communicationLogDirectoryHandle.getFileHandle(
        destinationName,
        { create: true }
      );
      destinationCreated = true;
      writable = await destinationHandle.createWritable();
      await writable.write(sourceFile);
      await writable.close();
      writable = null;

      const copiedFile = await destinationHandle.getFile();
      if (copiedFile.size !== sourceFile.size
          || !(await communicationLogBlobsEqual(sourceFile, copiedFile))) {
        throw new Error(`Communication log copy verification failed: ${destinationName}`);
      }
    } catch (error) {
      await abortWritableQuietly(writable);
      if (destinationCreated) {
        try { await communicationLogDirectoryHandle.removeEntry(destinationName); } catch {}
      }
      throw error;
    }
  }

  /**
   * Renames the active communication log by verified copy-then-delete.
   *
   * The operation is serialized behind pending communication writes. The original
   * is deleted only after the new sibling is byte-for-byte verified, and the active
   * filename is switched only after that delete succeeds.
   *
   * @param {string} newFileName - Exact new basename in the authorized directory.
   * @returns {Promise<string>} The new active filename.
   */
  function communicationLogRename(newFileName) {
    const queued = communicationLogEnqueue('rename', async () => {
      const validatedName = communicationLogValidateFileName(newFileName);
      if (!communicationLogReady || !communicationLogDirectoryHandle || !communicationLogFileName) {
        throw new Error('Communication log directory/file is not ready.');
      }
      if (validatedName === communicationLogFileName) return communicationLogFileName;
      if (await communicationLogFileExists(validatedName)) {
        throw new Error(`Communication log file already exists: ${validatedName}`);
      }

      await communicationLogCloseActiveWriter();
      const sourceName = communicationLogFileName;
      const sourceSnapshot = await communicationLogRefreshedFileSnapshot();
      await communicationLogCopyForRename(sourceSnapshot.file, validatedName);

      try {
        await communicationLogDirectoryHandle.removeEntry(sourceName);
      } catch (error) {
        try { await communicationLogDirectoryHandle.removeEntry(validatedName); } catch {}
        throw error;
      }

      communicationLogFileName = validatedName;
      return validatedName;
    });
    return queued.operation;
  }

  /**
   * Changes a duplicate JSONL member name to its sibling 7z archive name.
   *
   * @param {string} memberName - Duplicate member filename.
   * @returns {string} Archive filename with the final extension replaced by .7z.
   */
  function communicationLogDuplicateArchiveFileName(memberName) {
    const extensionIndex = memberName.lastIndexOf('.');
    return extensionIndex > 0
      ? `${memberName.slice(0, extensionIndex)}.7z`
      : `${memberName}.7z`;
  }

  /**
   * Creates a committed point-in-time duplicate of the active communication log.
   *
   * The lowest unused positive `(N)` suffix is inserted immediately before the
   * extension with no intervening space. The active filename never changes.
   *
   * @returns {Promise<string>} The created duplicate filename.
   */
  function communicationLogArchiveDuplicate() {
    const queued = communicationLogEnqueue('duplicate', async () => {
      if (!communicationLogReady || !communicationLogDirectoryHandle || !communicationLogFileName) {
        throw new Error('Communication log directory/file is not ready.');
      }

      await communicationLogCloseActiveWriter();
      const sourceSnapshot = await communicationLogRefreshedFileSnapshot();
      let duplicateNumber = 1;
      let duplicateName = communicationLogDuplicateFileName(
        communicationLogFileName,
        duplicateNumber
      );
      while (await communicationLogFileExists(duplicateName)
          || await communicationLogFileExists(
            communicationLogDuplicateArchiveFileName(duplicateName)
          )) {
        duplicateNumber += 1;
        duplicateName = communicationLogDuplicateFileName(
          communicationLogFileName,
          duplicateNumber
        );
      }

      const memberName = duplicateName;
      const archiveName = communicationLogDuplicateArchiveFileName(duplicateName);
      const archive = await create7zArchive(
        new Uint8Array(await sourceSnapshot.file.arrayBuffer()),
        memberName
      );
      let writable = null;
      let archiveCreated = false;
      try {
        const archiveHandle = await communicationLogDirectoryHandle.getFileHandle(
          archiveName,
          { create: true }
        );
        archiveCreated = true;
        writable = await archiveHandle.createWritable();
        await writable.write(new Blob([archive], { type: 'application/x-7z-compressed' }));
        await writable.close();
        writable = null;
        const verified = await archiveHandle.getFile();
        if (verified.size !== archive.byteLength) {
          throw new Error(
            `Communication log archive verification failed: expected ${archive.byteLength} bytes, found ${verified.size}.`
          );
        }
      } catch (error) {
        await abortWritableQuietly(writable);
        if (archiveCreated) {
          try { await communicationLogDirectoryHandle.removeEntry(archiveName); } catch {}
        }
        throw error;
      }
      return archiveName;
    });
    return queued.operation;
  }

  /**
   * Truncates the active communication log to a verified zero-byte committed file.
   *
   * The reset is serialized with normal communication writes. The authorized
   * directory and active filename remain unchanged, and the next record lazily
   * reopens the normal long-lived writer at the new EOF.
   *
   * @returns {Promise<void>} Resolves after the empty file is committed and verified.
   */
  function communicationLogReset() {
    const queued = communicationLogEnqueue('reset', async () => {
      await communicationLogCloseActiveWriter();
      const refreshed = await communicationLogRefreshedFileSnapshot();
      let writable = null;
      try {
        writable = await refreshed.handle.createWritable({ keepExistingData: true });
        await writable.truncate(0);
        await writable.close();
        writable = null;
        communicationLogWriterDirty = false;
        const verified = await communicationLogRefreshedFileSnapshot();
        if (verified.file.size !== 0) {
          throw new Error(`Communication log reset verification failed: expected 0 bytes, found ${verified.file.size}.`);
        }
      } catch (error) {
        await abortWritableQuietly(writable);
        throw error;
      }
    });
    return queued.operation;
  }

  /**
   * Issue 166 communication-log storage boundary.
   *
   * Producers submit complete structured records here. They do not know whether
   * the current bytes live in an active raw segment, a sealed segment, or an
   * archived historical segment. Segment rotation can therefore replace this
   * implementation without leaving the legacy raw-file append API on the
   * recorder execution path.
   */

    );
    let maximum = 0;
    for await (const [name, entry] of communicationLogDirectoryHandle.entries()) {
      if (entry?.kind !== 'file') continue;
      const match = pattern.exec(name);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
    return maximum + 1;
  }

  /**
   * Builds the immutable raw and archive names for one segment ordinal.
   *
   * @param {number} ordinal - Positive segment ordinal.
   * @returns {Object} Raw/member/archive names.
   */
  function communicationLogSegmentNames(ordinal) {
    const stem = communicationLogFileName.replace(/\\.jsonl$/i, '');
    const suffix = String(ordinal).padStart(6, '0');
    return {
      raw: `${stem}.segment-${suffix}.jsonl`,
      archive: `${stem}.segment-${suffix}.7z`
    };
  }

  /**
   * Compresses and round-trip verifies one immutable sealed raw segment.
   *
   * The raw source is removed only after the committed archive extracts to the
   * exact same bytes. Any failure retains the raw source for recovery/retry.
   *
   * @param {string} rawName - Immutable raw segment filename.
   * @param {string} archiveName - Destination 7z filename.
   * @returns {Promise<void>} Resolves only after verified archive commit.
   */
  async function communicationLogCompressSealedSegment(rawName, archiveName) {
    try {
      const rawHandle = await communicationLogDirectoryHandle.getFileHandle(rawName);
      const rawFile = await rawHandle.getFile();
      const source = new Uint8Array(await rawFile.arrayBuffer());
      const archive = await create7zArchive(source, rawName);
      const extracted = await extract7zArchive(archive);
      if (extracted.byteLength !== source.byteLength) {
        throw new Error('Sealed segment round-trip byte count mismatch.');
      }
      for (let index = 0; index < source.byteLength; index += 1) {
        if (source[index] !== extracted[index]) {
          throw new Error(`Sealed segment round-trip mismatch at byte ${index}.`);
        }
      }

      const archiveHandle = await communicationLogDirectoryHandle.getFileHandle(
        archiveName,
        { create: true }
      );
      let writable = null;
      try {
        writable = await archiveHandle.createWritable();
        await writable.write(archive);
        await writable.close();
        writable = null;
      } catch (error) {
        await abortWritableQuietly(writable);
        throw error;
      }

      const committed = new Uint8Array(await (await archiveHandle.getFile()).arrayBuffer());
      const committedExtracted = await extract7zArchive(committed);
      if (committedExtracted.byteLength !== source.byteLength) {
        throw new Error('Committed archive verification byte count mismatch.');
      }
      for (let index = 0; index < source.byteLength; index += 1) {
        if (source[index] !== committedExtracted[index]) {
          throw new Error(`Committed archive verification mismatch at byte ${index}.`);
        }
      }
      await communicationLogDirectoryHandle.removeEntry(rawName);
      logDiagnostic('debug', 'communication-log-segment-compressed', {
        raw_name: rawName,
        archive_name: archiveName,
        raw_bytes: source.byteLength,
        archive_bytes: committed.byteLength
      });
    } catch (error) {
      communicationLogReportFailure(`segment-compression:${rawName}`, error);
      throw error;
    }
  }

  /**
   * Freezes the threshold-crossing active file, establishes a fresh active file,
   * then starts compression without holding the serialized append chain.
   *
   * @returns {Promise<void>} Resolves after the new active writer is established.
   */
  async function communicationLogSealActiveSegment() {
    await communicationLogCloseActiveWriter();
    const sourceSnapshot = await communicationLogRefreshedFileSnapshot();
    if (sourceSnapshot.file.size === 0) return;
    const ordinal = await communicationLogNextSegmentOrdinal();
    const names = communicationLogSegmentNames(ordinal);
    await communicationLogCopyForRename(sourceSnapshot.file, names.raw);

    let writable = null;
    try {
      writable = await sourceSnapshot.handle.createWritable({ keepExistingData: true });
      await writable.truncate(0);
      await writable.close();
      writable = null;
      communicationLogWriterDirty = false;
      communicationLogActiveBytes = 0;
      await communicationLogOpenWriter();
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }

    void communicationLogCompressSealedSegment(names.raw, names.archive)
      .catch(() => {});
  }

  /**
   * Persists one complete JSONL record and rotates only after that record crosses
   * the configured segment target.
   *
   * @param {Object} record - Complete JSON-compatible communication record.
   * @returns {Promise<void>} Resolves after the record is accepted.
   */
  function communicationLogStorageAppendRecord(record) {
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = new TextEncoder().encode(line).byteLength;
    const queued = communicationLogEnqueue('storage-append', async () => {
      await communicationLogOpenWriter();
      await communicationLogWritable.write(line);
      communicationLogWriterDirty = true;
      communicationLogActiveBytes = (communicationLogActiveBytes ?? 0) + lineBytes;
      if (communicationLogActiveBytes >= COMMUNICATION_LOG_SEGMENT_TARGET_BYTES) {
        await communicationLogSealActiveSegment();
      }
    });
    return queued.operation;
  }

  const communicationLogStorage = Object.freeze({
    appendRecord: communicationLogStorageAppendRecord
  });

  /**
   * Reports disk-recorder failures through existing diagnostics without throwing into page networking.
   *
   * @param {string} stage - Recorder stage that failed.
   * @param {Object} error - Failure value.
   * @returns {void} No value is returned.
   */
  function communicationLogReportFailure(stage, error) {
    logDiagnostic('warnings', 'communication-log-write-failure', {
      stage,
      file_name: communicationLogFileName,
      message: boundedDiagnosticText(errorMessage(error), 2000)
    });
  }

  /**
   * Writes one structured communication event to the active append-only JSONL file.
   *
   * @param {string} type - Stable record type.
   * @param {Object} data - Event-specific JSON-compatible fields.
   * @returns {Promise<boolean>} True when the record committed to disk.
   */
  async function communicationLogRecord(type, data = {}) {
    if (!communicationLogReady) {
      communicationLogDroppedBeforeReady += 1;
      return false;
    }
    const record = {
      timestamp: new Date().toISOString(),
      monotonic_ms: Math.round(performance.now() * 1000) / 1000,
      time_origin: performance.timeOrigin,
      session_id: communicationLogSessionId,
      sequence: ++communicationLogSequence,
      type,
      ...data
    };
    await communicationLogStorage.appendRecord(record);
    return true;
  }

  /**
   * Waits briefly for asynchronous IndexedDB handle restoration used by document-start interception.
   *
   * @returns {Promise<boolean>} True when the disk recorder becomes ready within the bounded wait.
   */
  async function communicationLogAwaitReady() {
    if (communicationLogReady) return true;
    if (!communicationLogInitializationPromise) return false;
    await Promise.race([
      communicationLogInitializationPromise.catch(() => false),
      new Promise(resolve => setTimeout(resolve, COMMUNICATION_LOG_READY_WAIT_MS))
    ]);
    return communicationLogReady;
  }

  /**
   * Waits for recorder readiness and records one intentional pre-ready drop when unavailable.
   *
   * @param {Object|null} body - Optional cloned body to cancel when the recorder remains unavailable.
   * @returns {Promise<boolean>} True when recording may continue; otherwise false after drop cleanup.
   */
  async function communicationLogAwaitReadyOrDrop(body = null) {
    if (await communicationLogAwaitReady()) return true;
    communicationLogDroppedBeforeReady += 1;
    await cancelReadableBodyQuietly(body);
    return false;
  }

  /**
   * Persists one textual body stream in bounded JSONL chunks without accumulating the whole body.
   *
   * @param {ReadableStream|null} body - Cloned Request/Response body stream.
   * @param {string} recordType - JSONL chunk record type.
   * @param {Object} context - Correlation metadata repeated on each chunk.
   * @returns {Promise<Object>} Persisted byte/chunk counts, plus incomplete-stream metadata when reading aborts.
   */
  async function communicationLogStreamBody(body, recordType, context) {
    if (!body) return { byte_count: 0, chunk_count: 0 };
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const redactionState = communicationLogCreateRedactionState();
    let safePending = '';
    let byteCount = 0;
