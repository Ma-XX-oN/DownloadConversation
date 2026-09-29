          });
          return Reflect.apply(innerHtml.set, this, [value]);
        }
      });
    }

    const textContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (textContent?.set) {
      Object.defineProperty(Node.prototype, 'textContent', {
        ...textContent,
        set(value) {
          logLauncherRemovalOperation('Node.textContent=', this, {
            replacement_length: typeof value === 'string' ? value.length : null
          });
          return Reflect.apply(textContent.set, this, [value]);
        }
      });
    }

    const outerHtml = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    if (outerHtml?.set) {
      Object.defineProperty(Element.prototype, 'outerHTML', {
        ...outerHtml,
        set(value) {
          logLauncherRemovalOperation('Element.outerHTML=', this, {
            replacement_length: typeof value === 'string' ? value.length : null
          });
          return Reflect.apply(outerHtml.set, this, [value]);
        }
      });
    }
  }

  /**
   * Handles make launcher.
   *
   * @returns {void} No value is returned.
   */
  function makeLauncher() {
    const existing = document.getElementById(LAUNCHER_ID);
    if (existing || !document.body) {
      logConsoleDiagnostic('debug', `[DownloadConversation v${VERSION}] makeLauncher skipped`, {
        existing: launcherNodeSummary(existing),
        has_body: Boolean(document.body)
      });
      return;
    }
    injectStyles();
    /** Floating button that remains available to open the recorder panel. */
    const launcher = document.createElement('button');
    launcher.id = LAUNCHER_ID;
    launcher.type = 'button';
    /**
     * Opens recorder popup.
     *
     * @returns {void} No value is returned.
     */
    const openRecorderPopup = () => {
      makePanel();
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.style.display = 'block';
      updateUi();
      if (panel && !generalStatusShown) {
        logDiagnostic('debug', 'general-status-shown', { script_version: VERSION, console_enabled: consoleDiagnostics });
        generalStatusShown = true;
      }
    };
    launcher.addEventListener('click', openRecorderPopup);
    launcher.addEventListener('mouseenter', openRecorderPopup);
    launcher.addEventListener('focus', openRecorderPopup);
    document.body.append(launcher);
    if (DEEP_LAUNCHER_DIAGNOSTICS) watchLauncherLifecycle(launcher);
  }

  /**
   * Binds one persistent checkbox to a state setter and the shared recorder UI refresh.
   *
   * @param {Element} panel - Recorder panel containing the checkbox.
   * @param {string} role - Stable data-role value identifying the checkbox.
   * @param {string} storageKey - Local-storage key retaining the preference.
   * @param {boolean} initialValue - Current preference value applied at panel creation.
   * @param {Function} applyValue - Callback that updates the corresponding in-memory state.
   * @returns {void} No value is returned.
   */
  function bindStoredCheckbox(panel, role, storageKey, initialValue, applyValue) {
    const checkbox = panel.querySelector(`[data-role="${role}"]`);
    if (!(checkbox instanceof HTMLInputElement)) return;
    checkbox.checked = initialValue;
    checkbox.addEventListener('change', () => {
      applyValue(checkbox.checked);
      localStorage.setItem(storageKey, String(checkbox.checked));
      updateUi();
    });
  }

  /**
   * Handles make panel.
   *
   * @returns {void} No value is returned.
   */
  function makePanel() {
    if (document.getElementById(PANEL_ID) || !document.body) return;
    logDiagnostic('debug', 'recorder-panel-create-start', { script_version: VERSION });
    injectStyles();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.display = 'none';
    panel.innerHTML = `
      <button class="tm-close" type="button" aria-label="Close">×</button>
      <div class="tm-title" data-role="title"></div>
      <div class="tm-log-head"><span class="tm-label" data-role="log-count">Log: 0 items</span><button class="tm-icon-button" data-role="save-log" type="button" aria-label="Save diagnostic log" title="Save log"></button><button class="tm-icon-button" data-role="copy-log" type="button" aria-label="Copy diagnostic log" title="Copy log"></button><button class="tm-icon-button" data-role="toggle-log" type="button" aria-label="Show diagnostic log" aria-expanded="false" title="Show log">+</button></div>
      <div class="tm-log-output" data-role="log-output" hidden></div>
      <div class="tm-status" data-role="status"></div>
      <div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><label><input data-role="console-diagnostics" type="checkbox"> console</label><button data-role="test" type="button">Test</button></div>
      <div class="tm-row"><span class="tm-label">Communication log</span></div>
      <div class="tm-row tm-communication-log-row"><div class="tm-log-name-viewport" data-role="communication-log-name-viewport" role="textbox" aria-readonly="true" aria-label="Current communication log filename" title="Current communication log filename"><span class="tm-log-name-text" data-role="communication-log-name"></span></div><button class="tm-icon-button" data-role="rename-communication-log" type="button" aria-label="Rename communication log" title="Rename communication log"></button><button class="tm-icon-button" data-role="duplicate-communication-log" type="button" aria-label="Duplicate communication log" title="Duplicate communication log"></button><button class="tm-icon-button" data-role="reset-communication-log" type="button" aria-label="Reset communication log" title="Reset communication log"></button></div>
      <div class="tm-row"><span class="tm-label">Screen on when extracting</span><button class="tm-switch" data-role="screen-on" type="button" role="switch" aria-checked="false" aria-label="Keep screen on while extracting"><span class="tm-switch-thumb"></span></button></div>
      <div class="tm-row tm-sound-control-row"><button class="tm-sound-control" data-role="agent-sound-control" type="button" aria-haspopup="dialog" aria-expanded="false">Sound <span data-role="agent-sound-control-value"></span></button><div class="tm-sound-popup" data-role="agent-sound-popup" hidden role="dialog" aria-label="Agent sound volume"><input class="tm-sound-volume-slider" data-role="agent-sound-volume" type="range" min="0" max="10" step="1" aria-label="Agent sound volume"><output class="tm-sound-volume-value" data-role="agent-sound-volume-value"></output></div></div>
      <div class="tm-row"><button data-role="jump" type="button">Jump</button></div>
      <div class="tm-row tm-extract-formats"><button data-role="extract" type="button">Extract</button><label><input data-role="format-jsonl" type="checkbox"> JSONL</label><label><input data-role="format-md" type="checkbox" checked> MD</label></div>
      <div class="tm-row tm-md-metadata"><span class="tm-label">MD headings</span><label><input data-role="show-timestamps" type="checkbox"> Timestamp</label><label><input data-role="show-record-numbers" type="checkbox"> Record #</label><label><input data-role="show-turn-ids" type="checkbox"> Turn ID</label><label><input data-role="show-debug-provenance" type="checkbox"> provenance</label></div>
    `;
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
    const saveLogButton = panel.querySelector('[data-role="save-log"]');
    if (saveLogButton) saveLogButton.innerHTML = saveIconMarkup();
    const copyLogButton = panel.querySelector('[data-role="copy-log"]');
    if (copyLogButton) copyLogButton.innerHTML = copyIconMarkup();
    panel.querySelector('[data-role="save-log"]').addEventListener('click', () => {
      void saveDiagnosticLog().catch(error => {
        logDiagnostic('errors', 'diagnostic-log-save-failure', {
          message: errorMessage(error)
        });
        setStatus(`Diagnostic log save failed: ${errorMessage(error)}`);
      });
    });
    panel.querySelector('[data-role="toggle-log"]').addEventListener('click', () => {
      diagnosticLogExpanded = !diagnosticLogExpanded;
      refreshDiagnosticLog();
    });
    panel.querySelector('[data-role="copy-log"]').addEventListener('click', () => {
      void copyDiagnosticLog().catch(error => {
        logDiagnostic('errors', 'diagnostic-log-copy-failure', {
          message: errorMessage(error)
        });
      });
    });
    panel.querySelector('[data-role="test"]').addEventListener('click', event => openTestMatrix(event.currentTarget));
    panel.querySelector('[data-role="jump"]').addEventListener('click', () => void runJump());
    const {
      communicationLogNameViewport,
      renameCommunicationLogButton,
      duplicateCommunicationLogButton,
      resetCommunicationLogButton
    } = communicationLogPanelControls(panel);
    if (renameCommunicationLogButton) renameCommunicationLogButton.innerHTML = renameIconMarkup();
    if (duplicateCommunicationLogButton) duplicateCommunicationLogButton.innerHTML = duplicateIconMarkup();
    if (resetCommunicationLogButton) resetCommunicationLogButton.innerHTML = resetIconMarkup();
    communicationLogNameViewport?.addEventListener('pointerenter', refreshCommunicationLogNameOverflow);
    renameCommunicationLogButton?.addEventListener('click', () => {
      if (renameCommunicationLogButton.disabled || communicationLogUiActionInProgress || !communicationLogFileName) return;
      const requestedName = window.prompt('Rename communication log', communicationLogFileName);
      if (requestedName === null || requestedName === communicationLogFileName) return;
      void runCommunicationLogPanelAction(renameCommunicationLogButton, {
        idleLabel: 'Rename communication log',
        busyLabel: 'Renaming communication log',
        busyTitle: 'Renaming…',
        operation: () => communicationLogRename(requestedName),
        onSuccess: newFileName => setStatus(`Communication log renamed to ${newFileName}.`),
        failurePrefix: 'Communication log rename failed'
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
    panel.querySelector('[data-role="screen-on"]').addEventListener('click', () => {
      screenOnWhenCapturing = !screenOnWhenCapturing;
      localStorage.setItem(SCREEN_ON_STORAGE_KEY, String(screenOnWhenCapturing));
      if (screenOnWhenCapturing) void acquireWakeLock();
      else void releaseWakeLock();
      updateUi();
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
