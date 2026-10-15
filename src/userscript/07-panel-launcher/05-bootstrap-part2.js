  /**
   * Captures startup theme evidence without polling, page-wide observation or page changes.
   * Only html/body attribute changes trigger snapshots; lifecycle events are bounded.
   * @returns {void} No value is returned.
   */
  function installThemeStartupDiagnostics() {
    const started = performance.now();
    let lastState = '';
    let bodyObserver = null;
    let trackedBody = null;
    let pendingFrame = false;
    let stopped = false;
    let snapshotCount = 0;
    /** Original native setAttribute implementation, restored at page exit. */
    const nativeSetAttribute = Element.prototype.setAttribute;
    /** Original native removeAttribute implementation, restored at page exit. */
    const nativeRemoveAttribute = Element.prototype.removeAttribute;
    /**
     * Records a bounded call site without recording application message text.
     * @param {string} operation - Attribute operation name.
     * @param {string} name - Attribute name.
     * @param {string|null} before - Previous attribute value.
     * @param {string|null} after - New attribute value.
     * @returns {void} No value is returned.
     */
    const recordWriter = (operation, name, before, after) => {
      if (before === after) return;
      const stack = new Error().stack?.split(/\r?\n/).slice(2, 7)
        .map(line => line.trim().slice(0, 240)) ?? [];
      logDiagnostic('debug', 'theme-attribute-writer', {
        operation, attribute: name, before, after,
        elapsed_ms: Math.round(performance.now() - started),
        stack
      });
      schedule('theme-writer');
    };
    /**
     * Traces direct JavaScript writes to relevant root theme attributes.
     * @param {string} name - Attribute name.
     * @param {string} value - Attribute value.
     * @returns {void} The original method's result is returned.
     */
    const tracedSetAttribute = function(name, value) {
      if (this !== document.documentElement ||
        (name !== 'data-theme' && name !== 'data-appearance-theme')) {
        return Reflect.apply(nativeSetAttribute, this, [name, value]);
      }
      const before = this.getAttribute(name);
      const result = Reflect.apply(nativeSetAttribute, this, [name, value]);
      recordWriter('setAttribute', name, before, this.getAttribute(name));
      return result;
    };
    /**
     * Traces direct JavaScript removals from root theme attributes.
     * @param {string} name - Attribute name.
     * @returns {void} The original method's result is returned.
     */
    const tracedRemoveAttribute = function(name) {
      if (this !== document.documentElement ||
        (name !== 'data-theme' && name !== 'data-appearance-theme')) {
        return Reflect.apply(nativeRemoveAttribute, this, [name]);
      }
      const before = this.getAttribute(name);
      const result = Reflect.apply(nativeRemoveAttribute, this, [name]);
      recordWriter('removeAttribute', name, before, this.getAttribute(name));
      return result;
    };
    Element.prototype.setAttribute = tracedSetAttribute;
    Element.prototype.removeAttribute = tracedRemoveAttribute;

    /**
     * Reads a privacy-safe background property from a mounted element.
     * @param {Element|null} element - DOM element to inspect.
     * @returns {string|null} Computed background colour, or null.
     */
    const background = element => element ? getComputedStyle(element).backgroundColor : null;
    /**
     * Reads a bounded snapshot of root theme state and background colours.
     * @param {string} reason - Lifecycle checkpoint.
     * @returns {void} No value is returned.
     */
    const capture = reason => {
      if (stopped) return;
      const html = document.documentElement;
      const body = document.body;
      const app = document.querySelector('#__next, #root, [data-testid="conversation-turns"]');
      const data = {
        reason,
        elapsed_ms: Math.round(performance.now() - started),
        theme: html?.getAttribute('data-theme') ?? null,
        appearance_theme: html?.getAttribute('data-appearance-theme') ?? null,
        html_class: html?.className?.toString().slice(0, 150) ?? null,
        prefers_dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        html_background: background(html),
        body_background: background(body),
        app_background: background(app),
        body_replaced: trackedBody !== null && trackedBody !== body,
        ready_state: document.readyState
      };
      const state = JSON.stringify({ ...data, reason: null, elapsed_ms: null });
      if (state === lastState) return;
      lastState = state;
      snapshotCount += 1;
      logDiagnostic('debug', 'theme-startup-snapshot', data);
    };
    /**
     * Coalesces synchronous DOM changes to a single post-style calculation.
     * @param {string} reason - Reason for the snapshot.
     * @returns {void} No value is returned.
     */
    const schedule = reason => {
      if (pendingFrame || stopped) return;
      pendingFrame = true;
      requestAnimationFrame(() => {
        pendingFrame = false;
        capture(reason);
      });
    };
    /**
     * Attaches an attribute-only observer to the active body if it exists.
     * @returns {void} No value is returned.
     */
    const bindBody = () => {
      if (trackedBody === document.body) return;
      bodyObserver?.disconnect();
      trackedBody = document.body;
      if (trackedBody) {
        bodyObserver = new MutationObserver(() => schedule('body-attribute'));
        bodyObserver.observe(trackedBody, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme', 'data-appearance-theme']
        });
      }
      schedule('body-bound');
    };
    const htmlObserver = new MutationObserver(() => schedule('html-attribute'));
    if (document.documentElement) {
      htmlObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-appearance-theme']
      });
    }
    /**
     * Captures DOM readiness.
     * @returns {void} No value is returned.
     */
    const onReady = () => {
      bindBody();
      schedule('dom-content-loaded');
    };
    /**
     * Captures load completion.
     * @returns {void} No value is returned.
     */
    const onLoad = () => {
      bindBody();
      schedule('load');
    };
    /**
     * Captures page restoration.
     * @returns {void} No value is returned.
     */
    const onShow = () => {
      bindBody();
      schedule('pageshow');
    };
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
    window.addEventListener('load', onLoad, { once: true });
    window.addEventListener('pageshow', onShow);
    window.addEventListener('pagehide', () => {
      stopped = true;
      if (Element.prototype.setAttribute === tracedSetAttribute) {
        Element.prototype.setAttribute = nativeSetAttribute;
      }
      if (Element.prototype.removeAttribute === tracedRemoveAttribute) {
        Element.prototype.removeAttribute = nativeRemoveAttribute;
      }
      htmlObserver.disconnect();
      bodyObserver?.disconnect();
      window.removeEventListener('pageshow', onShow);
      logDiagnostic('debug', 'theme-startup-observer-stopped', {
        elapsed_ms: Math.round(performance.now() - started),
        snapshots: snapshotCount
      });
    }, { once: true });
    bindBody();
    capture('installation');
    schedule('first-animation-frame');
  }

  installThemeStartupDiagnostics();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquireWakeLock();
    else void releaseWakeLock();
  });

  document.addEventListener('click', captureConversationClickDiagnostic, true);
  window.addEventListener('pagehide', () => {
    finishConversationClickDiagnostic(activeClickDiagnostic, 'pagehide');
    if (diagnosticPersistTimer !== null) {
      clearTimeout(diagnosticPersistTimer);
      diagnosticPersistTimer = null;
    }
    persistDiagnosticLog();
  });
  if (DEEP_LAUNCHER_DIAGNOSTICS) {
    installLauncherRemovalDiagnostics();
    installLauncherTopologyDiagnostics();
  }
  // Capture sequencing and recording-group state are now initialized.
  // Record the current version once per page initialization, unfiltered.
  logDiagnostic('lifecycle', 'dc-version-transition', { version: VERSION });
  communicationLogInitializationPromise = initializeCommunicationDiskRecorder();
  installLiveTailTracking();
  /** Persisted scalar volume present when the userscript was initialized. */
  const initialSoundVolume = localStorage.getItem(AGENT_SOUND_VOLUME_STORAGE_KEY);
  /** Legacy boolean setting used only when no explicit volume was saved. */
  const legacySoundPreference = localStorage.getItem(LEGACY_AGENT_SOUNDS_STORAGE_KEY);
  logDiagnostic('lifecycle', 'agent-sound-volume-initialized', {
    volume: agentSoundVolume,
    source: initialSoundVolume !== null
      ? 'saved-volume'
      : legacySoundPreference === 'true' || legacySoundPreference === 'false'
        ? 'legacy-preference'
        : 'default',
    valid_saved_value: initialSoundVolume !== null &&
      /^(?:10|[0-9])$/.test(initialSoundVolume)
  });
  installNetworkCapture();
  bootstrapUi();
})();