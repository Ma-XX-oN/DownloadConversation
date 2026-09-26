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
   * Serializes one JSONL append through the active long-lived communication writer.
   *
   * @param {string} line - Complete newline-terminated JSONL record.
   * @returns {Promise<void>} Resolves after the bytes are accepted by the active writer.
   */
  function communicationLogAppendLine(line) {
    const queued = communicationLogEnqueue('append', async () => {
      await communicationLogOpenWriter();
      await communicationLogWritable.write(line);
      communicationLogWriterDirty = true;
    });
    return queued.operation;
  }

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
    await communicationLogAppendLine(`${JSON.stringify(record)}\n`);
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
