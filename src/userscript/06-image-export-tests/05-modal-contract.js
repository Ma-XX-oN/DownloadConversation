   * @param {Object} options2.null - The null value required by this function.
   * @param {Object} options2.opener - The element that opened the modal.
   * @param {Object} options2.null - The null value required by this function.
   * @returns {void} No value is returned.
   */
  function installModalContract(overlay, { defaultButton = null, onClose = null, opener = null } = {}) {
    lastModalOpener = opener instanceof HTMLElement ? opener : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = overlay.querySelector('[role="dialog"]');
    if (!(dialog instanceof HTMLElement)) return;
    /**
     * Handles focusables.
     *
     * @returns {void} No value is returned.
     */
    const focusables = () => modalFocusableElements(dialog);
    // Most recent focusable modal control; static-content clicks restore this keyboard anchor.
    let lastModalFocusedControl = null;
    dialog.addEventListener('focusin', event => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && focusables().includes(target)) lastModalFocusedControl = target;
    });
    dialog.addEventListener('click', event => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      const clickedControl = target.closest(
        'button, input, select, textarea, a[href], label, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
      );
      if (clickedControl) return;
      if (lastModalFocusedControl?.isConnected && dialog.contains(lastModalFocusedControl)) {
        lastModalFocusedControl.focus({ preventScroll: true });
      }
    });
    /**
     * Handles close.
     *
     * @returns {void} No value is returned.
     */
    const close = () => {
      if (typeof onClose === 'function') onClose();
      const restore = lastModalOpener;
      lastModalOpener = null;
      if (restore?.isConnected) restore.focus({ preventScroll: true });
    };
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (testInProgress) return;
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab') {
        const items = focusables();
        if (!items.length) {
          event.preventDefault();
          return;
        }
        const current = document.activeElement;
        const index = items.indexOf(current);
        const next = event.shiftKey
          ? (index <= 0 ? items.length - 1 : index - 1)
          : (index < 0 || index === items.length - 1 ? 0 : index + 1);
        event.preventDefault();
        items[next].focus();
        return;
      }
      if (event.key === 'Enter') {
        if (document.activeElement instanceof HTMLTextAreaElement) return;
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement) return;
        const button = typeof defaultButton === 'function' ? defaultButton() : defaultButton;
        if (button instanceof HTMLButtonElement && !button.disabled) {
          event.preventDefault();
          button.click();
        }
      }
    });
    const initial = typeof defaultButton === 'function' ? defaultButton() : defaultButton;
    (initial instanceof HTMLElement ? initial : focusables()[0])?.focus({ preventScroll: true });
  }

  /**
   * Closes test matrix.
   *
   * @returns {void} No value is returned.
   */
  function closeTestMatrix() {
    document.getElementById(TEST_MATRIX_ID)?.remove();
  }

  /**
   * Opens test matrix.
   *
   * @param {Object|null} opener - The element that opened the modal.
   * @returns {void} No value is returned.
   */
  function openTestMatrix(opener = null) {
    if (document.getElementById(TEST_MATRIX_ID)) return;
    testMatrixPreviousResults = loadTestResultHistory();
    testMatrixCurrentResults = new Map();
    const tests = builtInTests();
    const overlay = document.createElement('div');
    overlay.id = TEST_MATRIX_ID;
    overlay.innerHTML = `
      <div class="tm-test-dialog" role="dialog" aria-modal="true" aria-labelledby="${TEST_MATRIX_ID}-title">
        <div class="tm-test-dialog-head">
          <strong id="${TEST_MATRIX_ID}-title">Built-in tests</strong>
          <button type="button" data-role="close-test-matrix" aria-label="Close tests">×</button>
        </div>
        <div class="tm-test-table-wrap">
          <table class="tm-test-table">
            <thead><tr><th>Test</th><th>Type</th><th>Previous Result</th><th>Current Result</th><th></th></tr></thead>
            <tbody>
              ${tests.map(([name]) => `
                <tr data-test-name="${escapeHtmlAttribute(name)}">
                  <td>${escapeHtmlText(name)}</td>
                  <td>Automatic</td>
                  <td data-role="previous-result">—</td>
                  <td data-role="current-result">—</td>
                  <td><button type="button" data-role="run-test">Run</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="tm-test-actions">
          <button type="button" data-role="run-all-tests">Run All</button>
          <button type="button" data-role="close-test-matrix">Close</button>
        </div>
      </div>`;
    overlay.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target === overlay || target.closest('[data-role="close-test-matrix"]')) {
        if (!testInProgress) { closeTestMatrix(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }
        return;
      }
      const row = target.closest('tr[data-test-name]');
      if (target.closest('[data-role="run-test"]') && row) {
        const name = row.getAttribute('data-test-name');
        /**
         * Handles test.
         */
        const test = tests.find(([candidate]) => candidate === name);
        if (test) void runOneTest(test[0], test[1]);
        return;
      }
      if (target.closest('[data-role="run-all-tests"]')) void runTests();
    });
    document.body.append(overlay);
    refreshTestMatrix();
    installModalContract(overlay, {
      defaultButton: () => overlay.querySelector('[data-role="run-all-tests"]'),
      onClose: closeTestMatrix,
      opener
    });
  }

  /**
   * Handles diagnostic enabled.
   *
   * @param {Object} level - The diagnostics severity level.
   * @returns {boolean} `true` when `diagnosticEnabled` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function diagnosticEnabled(level) {
    return (DIAGNOSTIC_LEVELS[level] ?? 0) <= (DIAGNOSTIC_LEVELS[diagnosticsLevel] ?? 0);
  }

  /**
   * Persists the bounded tail of the diagnostic log to session storage.
   *
   * The larger in-memory capacity is retained for same-page live captures, while the
   * persisted tail is separately bounded to avoid making every browser session write
   * proportional to the full instrumentation history.
   *
   * @returns {void} No value is returned.
   */
  function persistDiagnosticLog() {
    try {
      sessionStorage.setItem(
        DIAGNOSTIC_LOG_STORAGE_KEY,
        JSON.stringify(diagnosticLog.slice(-MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS))
      );
    } catch {}
  }

  /**
   * Schedules a bounded diagnostic-log persistence write.
   *
   * @returns {void} No value is returned.
   */
  function schedulePersistDiagnosticLog() {
    if (diagnosticPersistTimer !== null) return;
    diagnosticPersistTimer = setTimeout(() => {
      diagnosticPersistTimer = null;
      persistDiagnosticLog();
    }, DIAGNOSTIC_PERSIST_DELAY_MS);
  }

  /**
   * Handles diagnostic log line.
   *
   * @param {Object} entry - The diagnostics entry to format.
   * @returns {string} The string produced by `diagnosticLogLine`.
   */
  function diagnosticLogLine(entry) {
    const suffix = entry.data === null || entry.data === undefined
      ? ''
      : ` ${JSON.stringify(entry.data)}`;
    return `${entry.timestamp} [${entry.level}] ${entry.message}${suffix}`;
  }

  /**
   * Handles copy icon markup.
   *
   * @returns {string} The string produced by `copyIconMarkup`.
   */
  function copyIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M15 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';
  }

  /**
   * Handles check icon markup.
   *
   * @returns {string} The string produced by `checkIconMarkup`.
   */
  function checkIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4 4L19 7"></path></svg>';
  }

  /**
   * Returns the shared pencil/edit action icon.
   *
   * @returns {string} Inline SVG markup for the Rename button.
   */
  function renameIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"></path><path d="m13.5 6.5 4 4"></path></svg>';
  }

  /**
   * Returns the approved branching Duplicate action icon.
   *
   * @returns {string} Inline SVG markup for the Duplicate button.
   */
  function duplicateIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="8" width="6" height="8" rx="1.5"></rect><rect x="16.5" y="2" width="6" height="7" rx="1.5"></rect><rect x="16.5" y="15" width="6" height="7" rx="1.5"></rect><path d="M7.5 12h3c2.8 0 2.8-6.5 6-6.5"></path><path d="M7.5 12h3c2.8 0 2.8 6.5 6 6.5"></path><path d="m14.5 4 2 1.5-2 1.5"></path><path d="m14.5 17 2 1.5-2 1.5"></path></svg>';
  }
