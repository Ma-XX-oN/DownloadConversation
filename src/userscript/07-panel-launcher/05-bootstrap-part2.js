
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      reconnectChatGPTSubjectHost();
      if (communicationLogDirectoryHandle) {
        void cscAttachPhysicalDirectory(communicationLogDirectoryHandle)
          .catch(error => logDiagnostic('error', 'csc-assembly-rebind-failed', {
            reason: String(error?.message ?? 'unknown').slice(0, 160)
          }));
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquireWakeLock();
    else void releaseWakeLock();
  });

  document.addEventListener('click', captureConversationClickDiagnostic, true);
  window.addEventListener('pagehide', () => {
    disconnectChatGPTSubjectHost();
    cscDisposePhysicalDirectory();
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
  cscControlsRegisterHmacFactory(communicationPersistentHmacCurrentTabService);
  void cscControlsCurrent().init();
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
  // Title monitoring must not block recorder startup.
  try {
    agentFaviconTitleMonitorStart();
  } catch (error) {
    logConsoleDiagnostic('warnings', '[ChatGPT Recorder] favicon title watch disabled', {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
  // Optional favicon diagnostics must never prevent the recorder from mounting.
  try {
    faviconProvenanceStart();
  } catch (error) {
    logConsoleDiagnostic('warnings', '[ChatGPT Recorder] favicon diagnostics disabled', {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
})();