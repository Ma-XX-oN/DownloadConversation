
  /**
   * Returns the AgentPanelSpeaker config-reset icon using its exact PNG bytes.
   *
   * @returns {string} Inline image markup for the Reset button.
   */
  function resetIconMarkup() {
    return '<img src="data:image/png;base64,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" alt="" aria-hidden="true">';
  }

  /**
   * Refreshes diagnostic log.
   *
   * Collapsed logs update only their count and controls. Thousands of hidden row
   * elements are not rebuilt on every diagnostic event during an instrumented export.
   *
   * @returns {void} No value is returned.
   */
  function refreshDiagnosticLog() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const count = panel.querySelector('[data-role="log-count"]');
    const output = panel.querySelector('[data-role="log-output"]');
    const toggle = panel.querySelector('[data-role="toggle-log"]');
    if (count) count.textContent = `Log: ${diagnosticLog.length} item${diagnosticLog.length === 1 ? '' : 's'}`;
    const lastProblem = panel.querySelector('[data-role="last-log-problem"]');
    if (lastProblem) {
      const problem = diagnosticLog.findLast(entry =>
        ['errors', 'warnings'].includes(entry?.level)
      );
      lastProblem.textContent = problem
        ? `${problem.level}: ${problem.message}` : '';
      lastProblem.hidden = !problem;
      lastProblem.title = lastProblem.textContent;
    }
    if (output && diagnosticLogExpanded) {
      output.replaceChildren(...diagnosticLog.map(entry => {
        const row = document.createElement('div');
        row.className = 'tm-log-row';
        row.textContent = diagnosticLogLine(entry);
        return row;
      }));
      output.scrollTop = output.scrollHeight;
    }
    if (output) output.hidden = !diagnosticLogExpanded;
    if (toggle instanceof HTMLButtonElement) {
      toggle.textContent = diagnosticLogExpanded ? '−' : '+';
      toggle.setAttribute('aria-expanded', String(diagnosticLogExpanded));
      toggle.setAttribute('aria-label', diagnosticLogExpanded ? 'Hide diagnostic log' : 'Show diagnostic log');
      toggle.title = diagnosticLogExpanded ? 'Hide log' : 'Show log';
    }
  }

  /**
   * Redacts transient signed URL tokens from diagnostic payloads without mutating callers.
   *
   * @param {Object} value - The diagnostic value to sanitize.
   * @returns {Object} The sanitized diagnostic value.
   */
  function redactDiagnosticSignedTokens(value) {
    if (typeof value === 'string') {
      return value.replace(/([?&](?:sig|signature)=)[^&#\s]*/gi, '$1[redacted]');
    }
    if (Array.isArray(value)) return value.map(redactDiagnosticSignedTokens);
    if (value && typeof value === 'object' &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redactDiagnosticSignedTokens(item)])
      );
    }
    return value;
  }

  /**
   * Writes recorder diagnostics to DevTools during startup or when continued console output is enabled.
   *
   * This gate is independent of the panel's severity filter and covers direct lifecycle messages too.
   *
   * @param {'errors'|'warnings'|'debug'|'verbose'} level - Severity selecting the DevTools console method.
   * @param {string} message - Console message, including its recorder prefix.
   * @param {Object|null} data - Diagnostic payload redacted before console output.
   * @returns {void} No value is returned.
   */
  function logConsoleDiagnostic(level, message, data = null) {
    if (generalStatusShown && !consoleDiagnostics) return;
    const args = [redactDiagnosticSignedTokens(message)];
    if (data !== null) args.push(redactDiagnosticSignedTokens(data));
    (level === 'errors' ? console.error : level === 'warnings' ? console.warn : console.log)(...args);
  }

  /**
   * Mirrors diagnostics through the console gate, then retains entries accepted by the panel filter.
   *
   * @param {Object} level - The diagnostics severity level.
   * @param {string} message - The assertion failure message.
   * @param {Object|null} data - The data value required by this function.
   * @returns {void} No value is returned.
   */
  function logDiagnostic(level, message, data = null) {
    if (!diagnosticCategoryEnabled(message)) return;
    logConsoleDiagnostic(level, `[ChatGPT Recorder ${level}] ${message}`, data);
    if (localStorage.getItem('tm-recorder-general-capture') === 'false') return;
    if (!diagnosticEnabled(level)) return;
    const safeData = redactDiagnosticSignedTokens(data);
    const entry = {
      timestamp: new Date().toISOString(),
      capture_order: logCapturePosition(),
      recording_group_uuid: recordingGroupState().ready
        ? recordingGroupState().uuid : null,
      level,
      message,
      data: safeData
    };
    diagnosticLog.push(entry);
    if (diagnosticLog.length > MAX_DIAGNOSTIC_LOG_ITEMS) {
      const evicted = diagnosticLog.splice(0, diagnosticLog.length - MAX_DIAGNOSTIC_LOG_ITEMS);
      for (const item of evicted) {
        if (item?.level === 'lifecycle' &&
            item.message === 'dc-version-transition' &&
            item.data && Object.hasOwn(item.data, 'version') &&
            (typeof item.data.version === 'string' || item.data.version === null)) {
          diagnosticLogBaselineVersion = item.data.version;
        }
      }
    }
    schedulePersistDiagnosticLog();
    refreshDiagnosticLog();
  }

