  /** Persistent diagnostic event categories; Gen/Comm recording remains separate. */
  const DIAGNOSTIC_CATEGORY_STORAGE_KEY = 'tm-recorder-diagnostic-categories';
  /** Explicit persisted categories exposed by the logging gear. */
  const DIAGNOSTIC_CATEGORIES = Object.freeze([
    'favicon-stock', 'favicon-theme', 'favicon-write',
    'favicon-cache', 'other'
  ]);

  /**
   * Load only declared boolean category values, defaulting to current logging.
   *
   * @returns {Object} - Current boolean values for supported categories.
   */
  function diagnosticCategoryLoad() {
    const defaults = Object.fromEntries(DIAGNOSTIC_CATEGORIES.map(key => [key, true]));
    try {
      const raw = localStorage.getItem(DIAGNOSTIC_CATEGORY_STORAGE_KEY);
      if (!raw) return defaults;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
      for (const key of DIAGNOSTIC_CATEGORIES) {
        if (typeof saved[key] === 'boolean') defaults[key] = saved[key];
      }
    } catch {
      // A malformed/blocked storage entry must not suppress normal diagnostics.
    }
    return defaults;
  }
  /** Mutable category preferences loaded once per page. */
  const diagnosticCategorySettings = diagnosticCategoryLoad();

  /**
   * Route existing and new events without changing global diagnostic severity.
   *
   * @param {string} message - Diagnostic event name.
   * @returns {string} - One of the supported diagnostic categories.
   */
  function diagnosticCategoryForEvent(message) {
    if (/^agent-favicon-(?:stock-|original-|external-)/.test(message))
      return 'favicon-stock';
    if (message === 'agent-favicon-browser-theme-changed' ||
        message === 'agent-favicon-app-theme-changed')
      return 'favicon-theme';
    if (/^agent-favicon-dc-/.test(message))
      return 'favicon-write';
    if (/^(?:agent-favicon-cache-|favicon-sequence-)/.test(message))
      return 'favicon-cache';
    return 'other';
  }

  /**
   * Check a category before mirroring to console or saving to the log.
   *
   * @param {string} message - Diagnostic event name.
   * @returns {boolean} - Whether that event category is enabled.
   */
  function diagnosticCategoryEnabled(message) {
    return diagnosticCategorySettings[diagnosticCategoryForEvent(message)] !== false;
  }

  /**
   * Bind gear popup controls and persist the user's chosen event categories.
   *
   * @param {HTMLElement} panel - Recorder panel containing the gear and popup.
   * @returns {void} - Binds category controls, persistence and dismissal.
   */
  function bindDiagnosticCategoryPopup(panel) {
    const trigger = panel.querySelector('[data-role="log-settings"]');
    const popup = panel.querySelector('[data-role="log-settings-popup"]');
    if (!trigger || !popup) return;
    /**
     * Dismisses the settings popup without changing saved categories.
     * @returns {void} Closes the dialog.
     */
    const close = () => {
      popup.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };
    for (const input of popup.querySelectorAll('input[data-log-category]')) {
      const category = input.dataset.logCategory;
      if (!DIAGNOSTIC_CATEGORIES.includes(category)) continue;
      input.checked = diagnosticCategorySettings[category] !== false;
      input.addEventListener('change', () => {
        diagnosticCategorySettings[category] = input.checked;
        localStorage.setItem(DIAGNOSTIC_CATEGORY_STORAGE_KEY,
          JSON.stringify(diagnosticCategorySettings));
      });
    }
    trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M9.7 2h4.6l.7 2.6 2.3 1.3 2.6-.7 2.3 4-1.9 1.9v2.6'
      + 'l1.9 1.9-2.3 4-2.6-.7-2.3 1.3-.7 2.6H9.7L9 20.2l-2.3-1.3'
      + '-2.6.7-2.3-4 1.9-1.9v-2.6L1.8 9.2l2.3-4 2.6.7L9 4.6z"/>'
      + '<circle cx="12" cy="12" r="3"/></svg>';
    trigger.addEventListener('click', () => {
      popup.hidden = !popup.hidden;
      trigger.setAttribute('aria-expanded', String(!popup.hidden));
      if (!popup.hidden) popup.querySelector('input')?.focus();
    });
    popup.querySelector('[data-role="close-log-settings"]')
      ?.addEventListener('click', () => { close(); trigger.focus(); });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !popup.hidden) {
        close();
        trigger.focus();
        event.stopPropagation();
      }
    });
    document.addEventListener('pointerdown', event => {
      if (!popup.hidden && !popup.contains(event.target) && event.target !== trigger)
        close();
    });
    panel.querySelector('.tm-close')?.addEventListener('click', close);
  }
