   *
   * Recovery treats the committed real file as authoritative, ignores only an incomplete
   * final JSONL line in each candidate, and never merges a divergent candidate.
   *
   * @returns {Promise<void>} Resolves after compatible recovery and swap cleanup complete.
   */
  async function communicationLogRecoverSwapFiles() {
    if (!communicationLogDirectoryHandle || !communicationLogFileName) {
      throw new Error('Communication log directory/file is not ready for swap recovery.');
    }
    const baselineSnapshot = await communicationLogRefreshedFileSnapshot();
    const baseline = baselineSnapshot.file;
    // Escape the literal log filename before recognizing Chromium sibling swap names.
    const escapedLogName = communicationLogFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const swapPattern = new RegExp(`^${escapedLogName}(?:\\.\\d+)?\\.crswap$`);
    // Retain candidate file snapshots so selection and cleanup use one observed swap state.
    const candidates = [];

    for await (const [name, entry] of communicationLogDirectoryHandle.entries()) {
      if (entry?.kind !== 'file' || !swapPattern.test(name)) continue;
      try {
        const file = await entry.getFile();
        let completeLength = file.size;
        if (file.size > 0) {
          const finalByte = new Uint8Array(await file.slice(file.size - 1, file.size).arrayBuffer())[0];
          if (finalByte !== 10) {
            completeLength = 0;
            for (let end = file.size; end > 0 && completeLength === 0;) {
              const start = Math.max(0, end - COMMUNICATION_LOG_COMPARE_CHUNK_BYTES);
              const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
              const newlineIndex = bytes.lastIndexOf(10);
              if (newlineIndex >= 0) completeLength = start + newlineIndex + 1;
              else end = start;
            }
          }
        }
        const prefixLength = Math.min(baseline.size, completeLength);
        const compatible = prefixLength === 0 ||
          await communicationLogBlobsEqual(baseline, file, 0, 0, prefixLength);
        if (!compatible) {
          logDiagnostic('warnings', 'communication-log-swap-incompatible', {
            file_name: name,
            committed_size: baseline.size,
            recoverable_size: completeLength,
            swap_size: file.size
          });
          continue;
        }
        candidates.push({
          name,
          file,
          complete_length: completeLength,
          last_modified: Number(file.lastModified) || 0
        });
      } catch (error) {
        communicationLogReportFailure(`swap-inspect:${name}`, error);
      }
    }

    const extensions = candidates
      .filter(candidate => candidate.complete_length > baseline.size)
      .sort((left, right) =>
        right.complete_length - left.complete_length || right.last_modified - left.last_modified);
    const selected = extensions[0] ?? null;
    if (selected) {
      const suffix = selected.file.slice(baseline.size, selected.complete_length);
      await communicationLogAppendData(suffix);
      logDiagnostic('debug', 'communication-log-swap-recovered', {
        file_name: selected.name,
        committed_size: baseline.size,
        recovered_size: selected.complete_length,
        appended_bytes: selected.complete_length - baseline.size
      });
    }

    const recovered = (await communicationLogRefreshedFileSnapshot()).file;
    for (const candidate of candidates) {
      try {
        const removable = candidate.complete_length <= recovered.size &&
          (candidate.complete_length === 0 || await communicationLogBlobsEqual(
            recovered,
            candidate.file,
            0,
            0,
            candidate.complete_length
          ));
        if (!removable) {
          logDiagnostic('warnings', 'communication-log-swap-incompatible', {
            file_name: candidate.name,
            committed_size: recovered.size,
            recoverable_size: candidate.complete_length,
            reason: 'candidate diverges from recovered committed log'
          });
          continue;
        }
        await communicationLogDirectoryHandle.removeEntry(candidate.name);
      } catch (error) {
        communicationLogReportFailure(`swap-cleanup:${candidate.name}`, error);
      }
    }
  }

  /**
   * Opens the normal long-lived communication writer at a freshly observed committed EOF.
   *
   * @returns {Promise<Object>} Active FileSystemWritableFileStream.
   */
  async function communicationLogOpenWriter() {
    if (communicationLogWritable) return communicationLogWritable;
    const refreshed = await communicationLogRefreshedFileSnapshot();
    let writable = null;
    try {
      writable = await refreshed.handle.createWritable({ keepExistingData: true });
      await writable.seek(refreshed.file.size);
      communicationLogWritable = writable;
      communicationLogWriterDirty = false;
      return communicationLogWritable;
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }
  }

  /**
   * Commits pending long-lived writer bytes and leaves the next append to reopen lazily.
   *
   * @param {string} reason - Checkpoint trigger used for failure diagnostics.
   * @returns {Promise<boolean>} True when dirty bytes were checkpointed.
   */
  function communicationLogCheckpoint(reason) {
    const queued = communicationLogEnqueue(`checkpoint:${reason}`, async () => {
      if (!communicationLogWritable || !communicationLogWriterDirty) return false;
      try {
        await communicationLogWritable.close();
        communicationLogWritable = null;
        communicationLogWriterDirty = false;
        return true;
      } catch (error) {
        communicationLogWritable = null;
        if (!communicationLogIsStaleFileStateError(error)) {
          communicationLogReady = false;
          throw error;
        }
        try {
          await communicationLogRecoverSwapFiles();
          communicationLogWriterDirty = false;
          return true;
        } catch (recoveryError) {
          communicationLogReady = false;
          throw recoveryError;
        }
      }
    }, false);
    return queued.chain;
  }

  /**
   * Validates an exact communication-log filename without silently rewriting it.
   *
   * @param {string} fileName - Candidate basename in the authorized directory.
   * @returns {string} The unchanged validated basename.
   */
  function communicationLogValidateFileName(fileName) {
    if (typeof fileName !== 'string'
        || fileName.length === 0
        || fileName.trim() !== fileName
        || fileName === '.'
        || fileName === '..'
        || /[<>:"/\\|?*\u0000-\u001F]/.test(fileName)
        || /[. ]$/.test(fileName)) {
      throw new Error('Invalid communication log filename.');
    }
    return fileName;
  }

  /**
   * Builds the deterministic duplicate filename for one positive suffix number.
   *
   * @param {string} fileName - Original communication-log filename.
   * @param {number} number - Positive duplicate suffix number.
   * @returns {string} Filename with `(N)` inserted immediately before the extension.
   */
  function communicationLogDuplicateFileName(fileName, number) {
    if (!Number.isInteger(number) || number < 1) {
      throw new Error('Communication log duplicate number must be a positive integer.');
    }
    const extensionIndex = fileName.lastIndexOf('.');
    const hasExtension = extensionIndex > 0;
    const stem = hasExtension ? fileName.slice(0, extensionIndex) : fileName;
    const extension = hasExtension ? fileName.slice(extensionIndex) : '';
    return `${stem}(${number})${extension}`;
  }

  /**
   * Checks whether a sibling file currently exists in the authorized directory.
   *
   * @param {string} fileName - Exact sibling filename.
   * @returns {Promise<boolean>} True when the sibling exists.
   */
  async function communicationLogFileExists(fileName) {
    if (!communicationLogDirectoryHandle) {
      throw new Error('Communication log directory is not ready.');
    }
    try {
      await communicationLogDirectoryHandle.getFileHandle(fileName, { create: false });
      return true;
    } catch (error) {
      if (error?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  /**
   * Commits and releases the active long-lived writer before a file mutation.
   *
   * @returns {Promise<void>} Resolves after any active writer is closed.
   */
  async function communicationLogCloseActiveWriter() {
    if (!communicationLogWritable) return;
    try {
      await communicationLogWritable.close();
    } finally {
      communicationLogWritable = null;
      communicationLogWriterDirty = false;
    }
  }

  /**
   * Serializes one communication-log operation and recovers the shared write chain after failure.
   *
   * @param {string} stage - Diagnostic stage reported when the operation rejects.
   * @param {Function} task - Deferred filesystem/recording operation executed behind prior work.
   * @param {unknown} failureValue - Value used to recover the shared chain after failure.
   * @returns {Object} Original operation promise plus the recovered shared-chain promise.
   */
  function communicationLogEnqueue(stage, task, failureValue = undefined) {
    const operation = communicationLogWriteChain.then(task);
    communicationLogWriteChain = operation.catch(communicationError => {
      communicationLogReportFailure(stage, communicationError);
      return failureValue;
    });
    return { operation, chain: communicationLogWriteChain };
  }

  /**
