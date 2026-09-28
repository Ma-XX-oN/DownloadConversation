
  /**
   * Returns the diagnostic archive/save icon.
   *
   * @returns {string} Inline SVG markup for the Save button.
   */
  function saveIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg>';
  }

  /**
   * Returns the one canonical diagnostic-log serialization used by Copy and Save.
   *
   * @returns {string} Canonical newline-delimited diagnostic text.
   */
  function diagnosticLogText() {
    return diagnosticLog.map(diagnosticLogLine).join('\n');
  }

  /**
   * Returns the trustworthy content timestamp range represented by diagnostics.
   *
   * @returns {Object|null} ISO start/end timestamps, or null for an empty/untrusted log.
   */
  function diagnosticLogTimestampRange() {
    const timestamps = diagnosticLog
      .map(entry => entry?.timestamp)
      .filter(timestamp => typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)))
      .sort();
    return timestamps.length
      ? { start_timestamp: timestamps[0], end_timestamp: timestamps[timestamps.length - 1] }
      : null;
  }

  /**
   * Formats one trustworthy diagnostic timestamp for an archive filename.
   *
   * @param {string} timestamp - ISO diagnostic timestamp.
   * @returns {string} Filesystem-safe UTC timestamp.
   */
  function diagnosticLogArchiveTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) {
      throw new Error('Diagnostic archive timestamp is not trustworthy.');
    }
    /**
     * Pads one local date/time field to two digits.
     *
     * @param {number} value - Local calendar/time field.
     * @returns {string} Two-digit field.
     */
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()},${pad(date.getMonth() + 1)},${pad(date.getDate())};`
      + `${pad(date.getHours())},${pad(date.getMinutes())},${pad(date.getSeconds())}`;
  }

  /**
   * Returns the final diagnostic content time at whole-second precision.
   *
   * @param {Object} range - Trustworthy diagnostic timestamp range.
   * @returns {number} Unix modification time in milliseconds.
   */
  function diagnosticLogArchiveMTime(range) {
    const endMs = Date.parse(range?.end_timestamp);
    if (!Number.isFinite(endMs)) {
      throw new Error('Diagnostic archive end timestamp is not trustworthy.');
    }
    return Math.floor(endMs / 1000) * 1000;
  }

  /**
   * Builds the diagnostic archive filename without communication-log helpers.
   *
   * @param {Object} range - Trustworthy diagnostic timestamp range.
   * @returns {string} Timestamped diagnostic archive filename.
   */
  function diagnosticLogArchiveName(range) {
    const base = `DownloadConversation_${sanitizeFileName(conversationTitle())}`;
    return `${base}_${diagnosticLogArchiveTimestamp(range.start_timestamp)}-`
      + `${diagnosticLogArchiveTimestamp(range.end_timestamp)}.log.xz`;
  }

  /**
   * Returns a printable-ASCII member name accepted by the archive bridge.
   *
   * @param {string} archiveName - Diagnostic archive filename.
   * @returns {string} Archive member filename.
   */
  function diagnosticLogArchiveMemberName(archiveName) {
    return archiveName.replace(/\.log\.XZ$/i, '.jsonl').replace(/[^\x20-\x7e]/g, '_');
  }

  /**
   * Compares diagnostic source/extracted bytes exactly.
   *
   * @param {Uint8Array} left - Expected bytes.
   * @param {Uint8Array} right - Extracted bytes.
   * @returns {boolean} True only for byte-identical values.
   */
  function diagnosticLogBytesEqual(left, right) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  /**
   * Saves exact bytes into the already-authorized main communication directory.
   *
   * This helper deliberately has no dependency on communication segment/archive code.
   *
   * @param {Object} directory - Authorized main directory handle.
   * @param {string} name - Destination archive filename.
   * @param {Uint8Array} bytes - Exact archive bytes.
   * @returns {Promise<Object>} Committed file handle.
   */
  async function diagnosticLogWriteArchive(directory, name, bytes) {
    const handle = await directory.getFileHandle(name, { create: true });
    let writable = null;
    try {
      writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      writable = null;
      const committed = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (!diagnosticLogBytesEqual(committed, bytes)) {
        throw new Error('Diagnostic archive destination verification failed.');
      }
      return handle;
    } catch (error) {
      if (writable) {
        try { await writable.abort(); } catch {}
      }
      throw error;
    }
  }

  /**
   * Resolves the archive primitive from this diagnostic module's lexical scope.
   *
   * @returns {Object} Callable archive create/extract operations.
   */
  function diagnosticLogArchiveApi() {
    if (typeof createXzArchive !== 'function') {
      throw new ReferenceError('Diagnostic archive create function is unavailable in this runtime scope.');
    }
    if (typeof extractXzArchive !== 'function') {
      throw new ReferenceError('Diagnostic archive extract function is unavailable in this runtime scope.');
    }
    return {
      create: createXzArchive,
      extract: extractXzArchive
    };
  }

  /**
   * Saves the canonical diagnostic log as one verified XZ archive.
   *
   * @returns {Promise<void>} Resolves after the archive is committed/downloaded.
   */
  async function saveDiagnosticLog() {
    const text = diagnosticLogText();
    if (!text) {
      setStatus('Diagnostic log is empty; no archive was created.');
      return;
    }
    const range = diagnosticLogTimestampRange();
    if (!range) {
      setStatus('Diagnostic log has no trustworthy content timestamps; no archive was created.');
      return;
    }
    const button = document.querySelector(`#${PANEL_ID} [data-role="save-log"]`);
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.title = 'Compressing diagnostic log…';
    const started = performance.now();
    /**
     * Returns elapsed diagnostic archive-save time.
     *
     * @returns {string} Human-readable elapsed duration.
     */
    const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s elapsed`;
    let phase = 'naming';
    let archiveName = null;
    try {
      archiveName = diagnosticLogArchiveName(range);
      const memberName = diagnosticLogArchiveMemberName(archiveName);
      const sourceBytes = new TextEncoder().encode(text);
      const memberMTimeMs = diagnosticLogArchiveMTime(range);

      phase = 'archive-create';
      const archiveApi = diagnosticLogArchiveApi();
      setStatus(`Diagnostic log: compressing; ${elapsed()}.`);
      const archive = await archiveApi.create(sourceBytes, memberName, memberMTimeMs);

      phase = 'archive-verify';
      const extracted = await archiveApi.extract(archive);
      if (!diagnosticLogBytesEqual(extracted, sourceBytes)) {
        throw new Error('Diagnostic archive round-trip verification failed.');
      }

      phase = 'destination';
      setStatus(`Diagnostic log: preparing save; ${elapsed()}.`);
      const directory = communicationLogReady ? communicationLogDirectoryHandle : null;
      if (directory) {
        await diagnosticLogWriteArchive(directory, archiveName, archive);
      } else {
        downloadBlob(new Blob([archive], { type: 'application/x-xz' }), archiveName);
      }
      setStatus(`Diagnostic log saved as ${archiveName}; ${elapsed()}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDiagnostic('errors', 'diagnostic-log-save-failed', {
        phase,
        archive_name: archiveName,
        error_name: error instanceof Error ? error.name : typeof error,
        message
      });
      setStatus(`Diagnostic log save failed during ${phase}: ${message}`);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.title = 'Save log';
    }
  }

  /**
   * Handles copy diagnostic log.
   *
   * @returns {Promise<void>} Resolves after clipboard feedback is scheduled.
   */
  async function copyDiagnosticLog() {
    const text = diagnosticLogText();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    const button = document.querySelector(`#${PANEL_ID} [data-role="copy-log"]`);
    if (!(button instanceof HTMLButtonElement)) return;
    button.innerHTML = checkIconMarkup();
    button.classList.add('tm-copy-confirmed');
    button.setAttribute('aria-label', 'Copied');
    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.add('tm-copy-fade');
      setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove('tm-copy-confirmed');
        button.innerHTML = copyIconMarkup();
        button.setAttribute('aria-label', 'Copy diagnostic log');
        requestAnimationFrame(() => button.classList.remove('tm-copy-fade'));
      }, 200);
    }, 800);
  }
