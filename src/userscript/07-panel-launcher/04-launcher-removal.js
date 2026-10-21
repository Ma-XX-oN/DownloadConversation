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
   * Renders an export arrow centred inside its SVG viewport.
   *
   * @returns {string} Inline SVG markup for the export button.
   */
  function exportArrowIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<path d="M4 12h16m-6-6 6 6-6 6" fill="none" '
      + 'stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /**
   * Renders the raw/compressed export icon as an arrow entering a size-coded circle.
   *
   * @param {boolean} compressed - True for the small compressed circle; false for the large raw circle.
   * @returns {string} Inline SVG markup for the export-mode toggle.
   */
  function exportCompressionIconMarkup(compressed) {
    const radius = compressed ? 4 : 8;
    return `<svg viewBox="0 0 28 20" aria-hidden="true" focusable="false"><circle cx="14" cy="10" r="${radius}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
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
      <div class="tm-log-head"><span class="tm-label" data-role="log-count">Log: 0 items</span></div>
      <div class="tm-last-log-problem" data-role="last-log-problem" role="status" hidden></div>
      <div class="tm-user-feedback" data-role="user-feedback" role="status" aria-live="polite"></div>
      <div class="tm-log-output" data-role="log-output" hidden></div>
      <div class="tm-row tm-diagnostics-row"><label for="tm-recorder-diagnostics">Diagnostics:</label><select id="tm-recorder-diagnostics" data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select></div>
      <div class="tm-recorder-section tm-recording-section">
        <div class="tm-recording-location"><div class="tm-row tm-communication-log-row"><div class="tm-log-name-viewport" data-role="communication-log-directory" aria-label="Destination directory"></div><button class="tm-icon-button" data-role="change-communication-log-directory" type="button" aria-label="Change destination directory" title="Change destination directory"></button></div><div class="tm-row tm-communication-log-row"><div class="tm-log-name-viewport" data-role="communication-log-name-viewport" role="textbox" aria-readonly="true" aria-label="Current communication log filename base" title="Current communication log filename base"><span class="tm-log-name-text" data-role="communication-log-name"></span></div><button class="tm-icon-button" data-role="rename-communication-log" type="button" aria-label="Rename communication log" title="Rename communication log"></button><button class="tm-icon-button" data-role="reset-communication-log-filename" type="button" aria-label="Reset filename to project and conversation" title="Reset filename to project and conversation"></button></div></div>
        <div class="tm-row tm-recording-modes"><label><input data-role="record-general" type="checkbox" checked> Gen</label><label><input data-role="record-communication" type="checkbox" checked> Comm</label><label><input data-role="console-diagnostics" type="checkbox"> Con</label><label><input data-role="record-one-group" type="checkbox"> 1</label><label><input data-role="workstack-enabled" type="checkbox"> WS</label></div>
        <div class="tm-row tm-recording-actions"><button class="tm-icon-button" data-role="save-log" type="button" aria-label="Save merged log" title="Save merged log"></button><button class="tm-icon-button" data-role="reset-communication-log" type="button" aria-label="Reset communication log" title="Reset communication log"></button><button class="tm-icon-button" data-role="log-settings" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="tm-recorder-log-settings" aria-label="Logging settings" title="Logging settings"></button></div>
          <div class="tm-log-settings-popup" data-role="log-settings-popup" id="tm-recorder-log-settings" role="dialog" aria-label="Logging categories" hidden>
            <div class="tm-log-settings-heading"><strong>Logging categories</strong><button type="button" data-role="close-log-settings" aria-label="Close logging settings">×</button></div>
            <label><input type="checkbox" data-log-category="favicon-stock"> Stock favicon changes</label>
            <label><input type="checkbox" data-log-category="favicon-theme"> Theme and candidate selection</label>
            <label><input type="checkbox" data-log-category="favicon-write"> DC favicon assignments</label>
            <label><input type="checkbox" data-log-category="favicon-cache"> Favicon cache activity</label>
            <label><input type="checkbox" data-log-category="other"> Other diagnostics</label>
            <small>Use Diagnostics: Debug to record favicon events. Gen, Comm and Con remain separate.</small>
          </div>
      </div>
      <div class="tm-recorder-section tm-export-section">
        <div class="tm-row tm-md-metadata"><label><input data-role="show-timestamps" type="checkbox"> Timestamp</label><label><input data-role="show-record-numbers" type="checkbox"> Record #</label><label><input data-role="show-turn-ids" type="checkbox"> Turn ID</label><label><input data-role="show-debug-provenance" type="checkbox"> Provenance</label></div>
        <div class="tm-row tm-extract-formats"><label><input data-role="format-jsonl" type="checkbox"> JSONL</label><label><input data-role="format-md" type="checkbox" checked> MD</label><button class="tm-icon-button tm-export-action" data-role="extract" type="button" aria-label="Export conversation" title="Export conversation"></button><button class="tm-export-compression" data-role="export-compression" type="button" role="switch" aria-checked="false" aria-label="Save uncompressed" title="Save uncompressed"></button></div>
      </div>
      <div class="tm-row tm-tool-actions">
        <div class="tm-sound-control-row"><button class="tm-sound-control" data-role="agent-sound-control" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Sound volume">🔊 <span data-role="agent-sound-control-value"></span></button><div class="tm-sound-popup" data-role="agent-sound-popup" hidden role="dialog" aria-label="Agent sound volume"><span class="tm-volume-ticks" aria-hidden="true"><span>10</span><span>5</span><span>0</span></span><input class="tm-sound-volume-slider" data-role="agent-sound-volume" type="range" min="0" max="10" step="1" aria-label="Agent sound volume"><output class="tm-sound-volume-value" data-role="agent-sound-volume-value"></output></div></div>
        <button class="tm-tool-button" data-role="jump" type="button" aria-label="Jump to entry" title="Jump to entry">🪂</button>
        <button class="tm-tool-button" data-role="test" type="button" aria-label="Run tests" title="Run tests">🧪</button>
      </div>
      <div class="tm-status" data-role="status" role="status"></div>
    `;
    const title = panel.querySelector('[data-role="title"]');
    if (title) title.textContent = `ChatGPT Recorder v${VERSION}`;