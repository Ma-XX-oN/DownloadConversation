
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
   * Saves the current diagnostic log as one 7z archive through the browser download flow.
   *
   * @returns {Promise<void>} Resolves after the download has been triggered.
   */
  async function saveDiagnosticLog() {
    const text = diagnosticLogText();
    if (!text) return;
    const button = document.querySelector(`#${PANEL_ID} [data-role="save-log"]`);
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.title = 'Preparing diagnostic archive…';
    const base = `DownloadConversation_${sanitizeFileName(conversationTitle())}_diagnostic-log`;
    // The direct 7-Zip bridge currently accepts ASCII member names only. Keep
    // the visible archive title intact while using a deterministic safe member.
    const memberName = 'diagnostic-log.txt';
    const archiveName = `${base}.7z`;
    try {
      const archive = await create7zArchive(new TextEncoder().encode(text), memberName);
      downloadBlob(new Blob([archive], { type: 'application/x-7z-compressed' }), archiveName);
      setStatus(`Diagnostic log saved as ${archiveName}.`);
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
