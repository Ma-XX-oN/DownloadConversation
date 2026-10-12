  /**
   * Restores the GEN diagnostic tail and its historical version baseline.
   * Older plain-array snapshots have no trustworthy prior version.
   * Corrupt snapshots are discarded together with their metadata.
   * @returns {void} No value is returned.
   */
  function restoreDiagnosticLog() {
    diagnosticLog = [];
    diagnosticLogBaselineVersion = null;
    try {
      const raw = sessionStorage.getItem(DIAGNOSTIC_LOG_STORAGE_KEY);
      if (raw === null) return;
      const stored = JSON.parse(raw);
      const legacy = Array.isArray(stored);
      const records = legacy ? stored : stored?.records;
      const baseline = legacy ? null : stored?.version_before_persisted;
      if (!Array.isArray(records) ||
          (!legacy && !(baseline === null || typeof baseline === 'string'))) return;
      if (records.some(entry => !entry || typeof entry !== 'object' ||
          Array.isArray(entry))) return;
      const omitted = Math.max(0, records.length - MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS);
      let effective = baseline;
      for (let i = 0; i < omitted; i++) {
        const entry = records[i];
        if (entry.level === 'lifecycle' && entry.message === 'dc-version-transition' &&
            entry.data && typeof entry.data === 'object' &&
            Object.prototype.hasOwnProperty.call(entry.data, 'version') &&
            (entry.data.version === null || typeof entry.data.version === 'string')) {
          effective = entry.data.version;
        }
      }
      diagnosticLog = records.slice(-MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS);
      diagnosticLogBaselineVersion = effective;
    } catch {
      // Storage access and malformed JSON are nonfatal: start with unknown history.
    }
  }

  restoreDiagnosticLog();

  // #234 provenance: one ordinary timestamped lifecycle event per startup.
  // #236 guarantees this specific lifecycle event bypasses severity filtering.
  logDiagnostic('lifecycle', 'dc-version-transition', { version: VERSION });
  logConsoleDiagnostic('debug', `[DownloadConversation v${VERSION} | AIConversationCore v${CORE_VERSION}] version identity`);

