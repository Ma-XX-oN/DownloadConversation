
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
   * Saves the current diagnostic log as one 7z archive through the browser download flow.
   *
   * @returns {Promise<void>} Resolves after the download has been triggered.
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
    const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s elapsed`;
    const base = `DownloadConversation_${sanitizeFileName(conversationTitle())}`;
    const directory = communicationLogReady ? communicationLogDirectoryHandle : null;
    let archiveName = communicationLogRoleArchiveName(base, range, 'log');
    if (directory) {
      archiveName = await communicationLogUnusedRoleArchiveName(directory, base, range, 'log');
    }
    const memberName = archiveName.replace(/\\.log\\.7z$/i, '.txt');
    try {
      setStatus(`Diagnostic log: compressing; ${elapsed()}.`);
      const archive = await create7zArchive(new TextEncoder().encode(text), memberName);
      setStatus(`Diagnostic log: preparing save; ${elapsed()}.`);
      if (directory) {
        const handle = await communicationLogWriteExactFile(directory, archiveName, archive);
        const committed = new Uint8Array(await (await handle.getFile()).arrayBuffer());
        const extracted = await extract7zArchive(committed);
        if (!(await communicationLogBytesEqual(extracted, new TextEncoder().encode(text)))) {
          try { await directory.removeEntry(archiveName); } catch {}
          throw new Error('Diagnostic archive round-trip verification failed.');
        }
      } else {
        downloadBlob(new Blob([archive], { type: 'application/x-7z-compressed' }), archiveName);
      }
      setStatus(`Diagnostic log saved as ${archiveName}; ${elapsed()}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDiagnostic('errors', 'diagnostic-log-save-failed', { archive_name: archiveName, message });
      setStatus(`Diagnostic log save failed: ${message}`);
      throw error;
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
