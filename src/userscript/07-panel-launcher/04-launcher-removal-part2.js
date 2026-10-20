
    panel.querySelector('.tm-close').addEventListener('click', () => {
      panel.style.display = 'none';
      const launcher = document.getElementById(LAUNCHER_ID);
      if (launcher) launcher.style.display = '';
    });
    const diagnostics = panel.querySelector('[data-role="diagnostics"]');
    diagnostics.value = diagnosticsLevel;
    diagnostics.addEventListener('change', () => {
      diagnosticsLevel = diagnostics.value;
      localStorage.setItem('tm-conversation-recorder-diagnostics', diagnosticsLevel);
      logDiagnostic('debug', 'diagnostics-level-changed', { diagnostics_level: diagnosticsLevel });
      refreshDiagnosticLog();
    });
    const consoleOutput = panel.querySelector('[data-role="console-diagnostics"]');
    consoleOutput.checked = consoleDiagnostics;
    consoleOutput.addEventListener('change', () => {
      consoleDiagnostics = consoleOutput.checked;
      localStorage.setItem(CONSOLE_DIAGNOSTICS_STORAGE_KEY, String(consoleDiagnostics));
      logDiagnostic('debug', 'console-diagnostics-changed', { enabled: consoleDiagnostics });
    });
    const workStackToggle = panel.querySelector('[data-role="workstack-enabled"]');
    workStackToggle.checked = localStorage.getItem(WORKSTACK_ENABLED_KEY) === 'true';
    workStackToggle.addEventListener('change', () => {
      setWorkStackEnabled(workStackToggle.checked);
    });
    const oneGroup = panel.querySelector('[data-role="record-one-group"]');
    oneGroup.checked = recordingGroupState().enabled;
    oneGroup.addEventListener('change', () => {
      if (!oneGroup.checked) {
        recordingGroupDisable();
        setStatus('Single-tab recording group ended.');
        return;
      }
      oneGroup.disabled = true;
      void recordingGroupEnable().then(ready => {
        if (!ready) {
          oneGroup.checked = false;
          recordingGroupDisable();
          setStatus('Single-tab recording group could not acquire ownership.');
        } else {
          setStatus('Single-tab recording group started.');
        }
      }).catch(error => {
        oneGroup.checked = false;
        recordingGroupDisable();
        logDiagnostic('errors', 'recording-group-enable-failed', {
          message: errorMessage(error)
        });
        setStatus('Single-tab recording group could not start.');
      }).finally(() => {
        oneGroup.disabled = false;
      });
    });
    const generalCapture = panel.querySelector('[data-role="record-general"]');
    const communicationCapture = panel.querySelector('[data-role="record-communication"]');
    generalCapture.checked = localStorage.getItem('tm-recorder-general-capture') !== 'false';
    communicationCapture.checked = localStorage.getItem('tm-recorder-communication-capture') !== 'false';
    generalCapture.addEventListener('change', () => {
      localStorage.setItem('tm-recorder-general-capture', String(generalCapture.checked));
    });
    communicationCapture.addEventListener('change', () => {
      localStorage.setItem('tm-recorder-communication-capture', String(communicationCapture.checked));
    });
    const saveLogButton = panel.querySelector('[data-role="save-log"]');
    if (saveLogButton) saveLogButton.innerHTML = saveIconMarkup();
    panel.querySelector('[data-role="save-log"]').addEventListener('click', event => {
      void runMergedLogExtraction(event.currentTarget).catch(error => {
        logDiagnostic('errors', 'merged-log-dialog-failure', {
          message: errorMessage(error)
        });
        setStatus('Log extraction dialog failed: ' + errorMessage(error));
      });
    });
    panel.querySelector('[data-role="test"]').addEventListener('click', event => openTestMatrix(event.currentTarget));
    panel.querySelector('[data-role="jump"]').addEventListener('click', () => void runJump());
    const {
      communicationLogNameViewport,
      changeCommunicationLogDirectoryButton,
      renameCommunicationLogButton,
      resetCommunicationLogFilenameButton,
      duplicateCommunicationLogButton,
      resetCommunicationLogButton
    } = communicationLogPanelControls(panel);
    if (changeCommunicationLogDirectoryButton) changeCommunicationLogDirectoryButton.innerHTML = renameIconMarkup();
    if (renameCommunicationLogButton) renameCommunicationLogButton.innerHTML = renameIconMarkup();
    if (resetCommunicationLogFilenameButton) resetCommunicationLogFilenameButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 4v8h8"/></svg>';
    if (duplicateCommunicationLogButton) duplicateCommunicationLogButton.innerHTML = duplicateIconMarkup();
    if (resetCommunicationLogButton) resetCommunicationLogButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6v5h5"/><path d="M5.5 11a8 8 0 1 1 .8 5"/></svg>';
    communicationLogNameViewport?.addEventListener('pointerenter', refreshCommunicationLogNameOverflow);
    changeCommunicationLogDirectoryButton?.addEventListener('click', () => {
      if (communicationLogUiActionInProgress || communicationLogDirectoryPickerOpening) return;
      const pickerWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      if (typeof pickerWindow.showDirectoryPicker !== 'function') {
        setStatus('Directory chooser is unavailable in this browser.');
        return;
      }
      communicationLogDirectoryPickerOpening = true;
      let picker;
      try {
        picker = pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
      } catch (error) {
        communicationLogDirectoryPickerOpening = false;
        setStatus('Directory selection failed: ' + errorMessage(error));
        return;
      }
      void Promise.resolve(picker).then(async handle => {
        if (await communicationLogPermissionState(handle) !== 'granted') {
          throw new Error('Read/write permission was not granted.');
        }
        await communicationLogWriteChain;
        await communicationLogStoreDirectoryHandle(handle);
        await communicationLogActivateDirectory(handle);
        setStatus('Communication log destination changed to ' + handle.name + '.');
      }).catch(error => {
        if (error?.name !== 'AbortError') setStatus('Directory selection failed: ' + errorMessage(error));
      }).finally(() => {
        communicationLogDirectoryPickerOpening = false;
        refreshStatus();
      });
    });
    renameCommunicationLogButton?.addEventListener('click', () => {
      if (renameCommunicationLogButton.disabled || communicationLogUiActionInProgress || !communicationLogFileName) return;
      const currentBase = communicationLogDisplayLocation(communicationLogDirectoryHandle, communicationLogFileName).base;
      const requestedBase = window.prompt('Rename communication log filename base', currentBase);
      if (requestedBase === null || requestedBase === currentBase) return;
      const requestedName = requestedBase + '.jsonl';
      void runCommunicationLogPanelAction(renameCommunicationLogButton, {
        idleLabel: 'Rename communication log',
        busyLabel: 'Renaming communication log',
        busyTitle: 'Renaming…',
        operation: () => communicationLogRename(requestedName),
        onSuccess: newFileName => {
          conversationFilenameSetOverride(newFileName.replace(/\.jsonl$/, ''));
          setStatus(`Communication log renamed to ${newFileName}.`);
        },
        failurePrefix: 'Communication log rename failed'
      });
    });
    resetCommunicationLogFilenameButton?.addEventListener('click', () => {
      if (communicationLogUiActionInProgress || !conversationFilenameOverride()) return;
      const automaticBase = `${conversationProjectName()
        ? sanitizeFileName(conversationProjectName()).replace(/\s+/g, '-') : 'Unknown'}__${sanitizeFileName(conversationTitle())}`;
      void runCommunicationLogPanelAction(resetCommunicationLogFilenameButton, {
        idleLabel: 'Reset filename',
        busyLabel: 'Resetting filename',
        busyTitle: 'Resetting filename…',
        operation: async () => {
          // Reset the explicit override only once the logical rename succeeds.
          const name = await communicationLogRename(automaticBase + '.jsonl');
          conversationFilenameSetOverride(null);
          return name;
        },
        onSuccess: name => setStatus(`Filename reset to ${name}.`),
        failurePrefix: 'Filename reset failed'
      });
    });
    duplicateCommunicationLogButton?.addEventListener('click', () => {
      if (duplicateCommunicationLogButton.disabled || communicationLogUiActionInProgress || !communicationLogFileName) return;
      void runCommunicationLogPanelAction(duplicateCommunicationLogButton, {
        idleLabel: 'Duplicate communication log',
        busyLabel: 'Duplicating communication log',
        busyTitle: 'Duplicating…',
        operation: communicationLogArchiveDuplicate,
        onSuccess: duplicateName => setStatus(`Communication log duplicated as ${duplicateName}.`),
        failurePrefix: 'Communication log duplicate failed'
      });
    });
    resetCommunicationLogButton?.addEventListener('click', () => {
      if (resetCommunicationLogButton.disabled || communicationLogUiActionInProgress) return;
      void runCommunicationLogPanelAction(resetCommunicationLogButton, {
        idleLabel: 'Reset communication log',
        busyLabel: 'Resetting communication log',
        busyTitle: 'Resetting…',
        operation: communicationLogReset,
        onSuccess: () => {
          logDiagnostic('debug', 'communication-log-reset-complete', {
            file_name: communicationLogFileName
          });
          setStatus('Communication log reset to empty.');
        },
        failurePrefix: 'Communication log reset failed'
      });
    });
    bindStoredCheckbox(panel, 'show-timestamps', SHOW_TIMESTAMPS_STORAGE_KEY, showTimestamps, value => {
      showTimestamps = value;
    });
    bindStoredCheckbox(panel, 'show-record-numbers', SHOW_RECORD_NUMBERS_STORAGE_KEY, showRecordNumbers, value => {
      showRecordNumbers = value;
    });
    bindStoredCheckbox(panel, 'show-turn-ids', SHOW_TURN_IDS_STORAGE_KEY, showTurnIds, value => {
      showTurnIds = value;
    });
    bindStoredCheckbox(panel, 'show-debug-provenance', SHOW_DEBUG_PROVENANCE_STORAGE_KEY, showDebugProvenance, value => {
      showDebugProvenance = value;
    });
    const exportCompression = panel.querySelector('[data-role="export-compression"]');
    if (exportCompression) {
      exportCompression.innerHTML = exportCompressionIconMarkup(exportCompressionEnabled);
      exportCompression.addEventListener('click', () => {
        exportCompressionEnabled = !exportCompressionEnabled;
        localStorage.setItem(EXPORT_COMPRESSION_STORAGE_KEY, String(exportCompressionEnabled));
        updateUi();
      });
    }
    const soundControl = panel.querySelector('[data-role="agent-sound-control"]');
    const soundPopup = panel.querySelector('[data-role="agent-sound-popup"]');
    const soundVolumeInput = panel.querySelector('[data-role="agent-sound-volume"]');
    const soundVolumeValue = panel.querySelector('[data-role="agent-sound-volume-value"]');
    const soundControlValue = panel.querySelector('[data-role="agent-sound-control-value"]');
    /**
     * Renders the current integer sound volume into the popup and control label.
     *
     * @returns {void} No value is returned.
     */
    const renderSoundVolume = () => {
      const value = String(agentSoundVolume);
      if (soundVolumeInput instanceof HTMLInputElement) soundVolumeInput.value = value;
      if (soundVolumeValue) soundVolumeValue.textContent = value;
      if (soundControlValue) soundControlValue.textContent = value;
    };
    /**
     * Opens or closes the sound-volume popup and mirrors the expanded state for accessibility.
     *
