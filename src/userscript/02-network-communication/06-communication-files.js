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

      // The physical active files are private alternating segment files.  Rename
      // therefore changes the logical/user-facing basename only; no log bytes
      // are copied and the active writer remains attached to the same file.
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
   * @param {Object} options - Optional inclusive Duplicate timestamp bounds.
   * @returns {Promise<string>} The created duplicate filename.
   */
  async function communicationLogArchiveDuplicate(options = {}) {
    if (!communicationLogReady || !communicationLogDirectoryHandle || !communicationLogFileName) {
      throw new Error('Communication log directory/file is not ready.');
    }
    if (communicationLogDuplicateInProgress) {
      throw new Error('A Duplicate operation is already running for this conversation.');
    }
    communicationLogDuplicateInProgress = true;

    const started = performance.now();
    /**
     * Formats elapsed Duplicate wall time for indeterminate progress.
     *
     * @returns {string} Human-readable elapsed duration.
     */
    const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s elapsed`;
    let plan = null;
    let holdEstablished = false;
    let archiveName = null;
    try {
      const boundary = communicationLogEnqueue('duplicate-snapshot', async () => {
        setStatus(`Duplicate: establishing snapshot boundary; ${elapsed()}.`);
        communicationLogRotationHold += 1;
        holdEstablished = true;
        communicationLogSegmentManifest.duplicate_request = {
          start_timestamp: options.start_timestamp ?? null,
          end_timestamp: options.end_timestamp ?? null
        };
        await communicationLogWriteSegmentManifest();
        plan = await communicationLogCaptureSnapshotPlan();
        await communicationLogOpenWriter();
        return plan;
      });
      await boundary.operation;

      setStatus(
        `Duplicate: streaming historical segments and frozen active prefix; `
        + `${elapsed()}; recording continues.`
      );
      const streamed = await communicationLogStreamDuplicateArchive(plan, options);
      archiveName = streamed.archive_name;
      communicationLogSegmentManifest.duplicate_output = archiveName;
      await communicationLogWriteSegmentManifest();

      let writable = null;
      let archiveCreated = false;
      try {
        setStatus(`Duplicate: finalizing/writing ${archiveName}; ${elapsed()}.`);
        const archiveHandle = await communicationLogDirectoryHandle.getFileHandle(
          archiveName,
          { create: true }
        );
        archiveCreated = true;
        writable = await archiveHandle.createWritable();
        await writable.write(new Blob(
          [streamed.archive],
          { type: 'application/x-7z-compressed' }
        ));
        await writable.close();
        writable = null;
        const verified = await archiveHandle.getFile();
        if (verified.size !== streamed.archive.byteLength) {
          throw new Error(
            `Communication log archive verification failed: expected `
            + `${streamed.archive.byteLength} bytes, found ${verified.size}.`
          );
        }
      } catch (error) {
        await abortWritableQuietly(writable);
        if (archiveCreated) {
          try { await communicationLogDirectoryHandle.removeEntry(archiveName); } catch {}
        }
        throw error;
      }

      setStatus(`Duplicate completed: ${archiveName}; ${elapsed()}.`);
      return archiveName;
    } finally {
      communicationLogDuplicateInProgress = false;
      if (communicationLogSegmentManifest) {
        delete communicationLogSegmentManifest.duplicate_request;
        delete communicationLogSegmentManifest.duplicate_output;
        await communicationLogWriteSegmentManifest().catch(() => {});
      }
      if (holdEstablished) {
        const release = communicationLogEnqueue(
          'duplicate-release',
          () => communicationLogReleaseRotationHold()
        );
        await release.operation.catch(() => {});
      }
    }
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
        await communicationLogResetSegmentHistory();
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
