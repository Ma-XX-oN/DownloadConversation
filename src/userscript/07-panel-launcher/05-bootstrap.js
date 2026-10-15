     * @param {boolean} open - True to show the volume popup.
     * @returns {void} No value is returned.
     */
    const setSoundPopupOpen = open => {
      if (!soundPopup || !soundControl) return;
      soundPopup.hidden = !open;
      soundControl.setAttribute('aria-expanded', String(open));
    };
    renderSoundVolume();
    soundControl?.addEventListener('click', event => {
      event.stopPropagation();
      const open = Boolean(soundPopup?.hidden);
      setSoundPopupOpen(open);
      if (open && agentSoundVolume > 0) void unlockAgentSoundAudio();
    });
    soundPopup?.addEventListener('click', event => event.stopPropagation());
    soundVolumeInput?.addEventListener('input', () => {
      const parsed = Number.parseInt(soundVolumeInput.value, 10);
      agentSoundVolume = Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0;
      localStorage.setItem(AGENT_SOUND_VOLUME_STORAGE_KEY, String(agentSoundVolume));
      renderSoundVolume();
      logDiagnostic('lifecycle', 'agent-sound-volume-changed', {
        volume: agentSoundVolume,
        source: 'user-input'
      });
      if (agentSoundVolume > 0) void unlockAgentSoundAudio();
      else agentSoundClearPendingTerminal();
    });
    document.addEventListener('click', event => {
      if (!soundPopup || soundPopup.hidden) return;
      if (event.target instanceof Node && panel.querySelector('.tm-sound-control-row')?.contains(event.target)) return;
      setSoundPopupOpen(false);
    });
    /**
     * Handles run selected exports.
     *
     * @returns {void} No value is returned.
     */
    const runSelectedExports = async () => {
      const jsonl = panel.querySelector('[data-role="format-jsonl"]');
      const md = panel.querySelector('[data-role="format-md"]');
      /** Selected output formats generated from the same acquired Conversation API snapshot. */
      const kinds = [];
      if (jsonl?.checked) kinds.push('jsonl');
      if (md?.checked) kinds.push('md');
      if (kinds.length) await runExport(kinds, { compressed: exportCompressionEnabled });
    };
    panel.querySelector('[data-role="extract"]').addEventListener('click', () => void runSelectedExports());
    for (const [role, key, fallback] of [
      ['format-jsonl', EXPORT_JSONL_STORAGE_KEY, false],
      ['format-md', EXPORT_MD_STORAGE_KEY, true]
    ]) {
      const input = panel.querySelector(`[data-role="${role}"]`);
      if (!(input instanceof HTMLInputElement)) continue;
      const stored = localStorage.getItem(key);
      input.checked = stored === null ? fallback : stored === 'true';
      input.addEventListener('change', () => {
        localStorage.setItem(key, String(input.checked));
        updateUi();
      });
    }
    panel.addEventListener('mouseleave', () => {
      if (!panel.matches(':focus-within') && !exportInProgress && !testInProgress) {
        panel.style.display = 'none';
      }
    });
    document.body.append(panel);
    updateUi();
    refreshDiagnosticLog();
    logDiagnostic('debug', 'recorder-panel-created', {
      script_version: VERSION,
      core_version: CORE_VERSION
    });
  }

  /**
   * Mounts the launcher only after the host has loaded and direct BODY reconciliation is quiet.
   *
   * Lifecycle console output follows the startup/saved-option gate.  Expensive topology and DOM-method
   * instrumentation remains available behind `DEEP_LAUNCHER_DIAGNOSTICS` for future regressions.
   *
   * @returns {void} No value is returned.
   */
  function bootstrapUi() {
    logConsoleDiagnostic('debug', `[DownloadConversation v${VERSION} | AIConversationCore v${CORE_VERSION}] bootstrap`, {
      ready_state: document.readyState,
      has_body: Boolean(document.body)
    });

    const quietMs = 1000;
    let loadReady = document.readyState === 'complete';
    let bodyObserver = null;
    let quietTimer = null;
    let launcherMountCount = 0;
    let launcherRemovalReported = false;

    /**
     * Schedules one launcher mount after the current direct-BODY quiet interval.
     *
     * @returns {void} No value is returned.
     */
    const scheduleLauncherMount = () => {
      if (!loadReady || !document.body) return;
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        quietTimer = null;
        if (!document.body || document.getElementById(LAUNCHER_ID)) return;
        const reason = launcherMountCount === 0 ? 'initial' : 'remount-after-body-reconciliation';
        makeLauncher();
        const launcher = document.getElementById(LAUNCHER_ID);
        if (!(launcher instanceof HTMLElement)) return;
        launcherMountCount += 1;
        launcherRemovalReported = false;
        const children = [...document.body.childNodes];
        logConsoleDiagnostic('debug', `[DownloadConversation v${VERSION}] launcher mounted`, {
          reason,
          ready_state: document.readyState,
          quiet_ms: quietMs,
          body_child_count: children.length,
          body_child_index: children.indexOf(launcher)
        });
      }, quietMs);
    };

    /**
     * Observes the current BODY so host reconciliation resets the launcher quiet interval.
     *
     * @param {HTMLBodyElement} body - Current BODY whose direct children are observed.
     * @returns {void} No value is returned.
     */
    const observeBody = body => {
      bodyObserver?.disconnect();
      bodyObserver = new MutationObserver(records => {
        if (!records.some(record => record.type === 'childList' && record.target === body)) return;
        if (launcherMountCount > 0 && !document.getElementById(LAUNCHER_ID) && !launcherRemovalReported) {
          launcherRemovalReported = true;
          logConsoleDiagnostic('warnings', `[DownloadConversation v${VERSION}] launcher disconnected; waiting for BODY quiet`, {
            ready_state: document.readyState,
            body_child_count: body.childNodes.length,
            quiet_ms: quietMs
          });
        }
        scheduleLauncherMount();
      });
      bodyObserver.observe(body, { childList: true });
      scheduleLauncherMount();
    };

    if (document.body) observeBody(document.body);
    else {
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        observer.disconnect();
        logConsoleDiagnostic('debug', `[DownloadConversation v${VERSION}] BODY appeared`, {
          ready_state: document.readyState
        });
        observeBody(document.body);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    if (!loadReady) {
      window.addEventListener('load', () => {
        loadReady = true;
        logConsoleDiagnostic('debug', `[DownloadConversation v${VERSION}] load complete; waiting for BODY quiet`, {
          quiet_ms: quietMs
        });
        scheduleLauncherMount();
      }, { once: true });
    }
  }

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
    /** @returns {void} Captures DOM readiness. */
    const onReady = () => {
      bindBody();
      schedule('dom-content-loaded');
    };
    /** @returns {void} Captures load completion. */
    const onLoad = () => {
      bindBody();
      schedule('load');
    };
    /** @returns {void} Captures page restoration. */
    const onShow = () => {
      bindBody();
      schedule('pageshow');
    };
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
    window.addEventListener('load', onLoad, { once: true });
    window.addEventListener('pageshow', onShow);
    window.addEventListener('pagehide', () => {
      stopped = true;
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