
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
  // Debug favicon events use logCapturePosition; never start them before its state.
  faviconProvenanceStart();
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