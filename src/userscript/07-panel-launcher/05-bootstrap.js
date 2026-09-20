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
      logDiagnostic('debug', 'agent-sound-volume-changed', { volume: agentSoundVolume });
      if (agentSoundVolume > 0) void unlockAgentSoundAudio();
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
      if (kinds.length) await runExport(kinds);
    };
    panel.querySelector('[data-role="extract"]').addEventListener('click', () => void runSelectedExports());
    panel.querySelector('[data-role="format-jsonl"]').addEventListener('change', updateUi);
    panel.querySelector('[data-role="format-md"]').addEventListener('change', updateUi);
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
  communicationLogInitializationPromise = initializeCommunicationDiskRecorder();
  installLiveTailTracking();
  installNetworkCapture();
  bootstrapUi();
})();