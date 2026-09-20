
  /**
   * Returns the AgentPanelSpeaker config-reset icon using its exact PNG bytes.
   *
   * @returns {string} Inline image markup for the Reset button.
   */
  function resetIconMarkup() {
    return '<img src="data:image/png;base64,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" alt="" aria-hidden="true">';
  }

  /**
   * Refreshes diagnostic log.
   *
   * Collapsed logs update only their count and controls. Thousands of hidden row
   * elements are not rebuilt on every diagnostic event during an instrumented export.
   *
   * @returns {void} No value is returned.
   */
  function refreshDiagnosticLog() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const count = panel.querySelector('[data-role="log-count"]');
    const output = panel.querySelector('[data-role="log-output"]');
    const toggle = panel.querySelector('[data-role="toggle-log"]');
    if (count) count.textContent = `Log: ${diagnosticLog.length} item${diagnosticLog.length === 1 ? '' : 's'}`;
    if (output && diagnosticLogExpanded) {
      output.replaceChildren(...diagnosticLog.map(entry => {
        const row = document.createElement('div');
        row.className = 'tm-log-row';
        row.textContent = diagnosticLogLine(entry);
        return row;
      }));
      output.scrollTop = output.scrollHeight;
    }
    if (output) output.hidden = !diagnosticLogExpanded;
    if (toggle instanceof HTMLButtonElement) {
      toggle.textContent = diagnosticLogExpanded ? '−' : '+';
      toggle.setAttribute('aria-expanded', String(diagnosticLogExpanded));
      toggle.setAttribute('aria-label', diagnosticLogExpanded ? 'Hide diagnostic log' : 'Show diagnostic log');
      toggle.title = diagnosticLogExpanded ? 'Hide log' : 'Show log';
    }
  }

  /**
   * Handles copy diagnostic log.
   *
   * @returns {void} No value is returned.
   */
  async function copyDiagnosticLog() {
    const text = diagnosticLog.map(diagnosticLogLine).join('\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    const button = document.querySelector(`#${PANEL_ID} [data-role="copy-log"]`);
    if (!(button instanceof HTMLButtonElement)) return;
    button.innerHTML = checkIconMarkup();
    button.classList.add('tm-copy-confirmed');
    button.setAttribute('aria-label', 'Copied');
    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.add('tm-copy-fade');
      setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove('tm-copy-confirmed');
        button.innerHTML = copyIconMarkup();
        button.setAttribute('aria-label', 'Copy diagnostic log');
        requestAnimationFrame(() => button.classList.remove('tm-copy-fade'));
      }, 200);
    }, 800);
  }

  /**
   * Redacts transient signed URL tokens from diagnostic payloads without mutating callers.
   *
   * @param {Object} value - The diagnostic value to sanitize.
   * @returns {Object} The sanitized diagnostic value.
   */
  function redactDiagnosticSignedTokens(value) {
    if (typeof value === 'string') {
      return value.replace(/([?&](?:sig|signature)=)[^&#\s]*/gi, '$1[redacted]');
    }
    if (Array.isArray(value)) return value.map(redactDiagnosticSignedTokens);
    if (value && typeof value === 'object' &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redactDiagnosticSignedTokens(item)])
      );
    }
    return value;
  }

  /**
   * Writes recorder diagnostics to DevTools during startup or when continued console output is enabled.
   *
   * This gate is independent of the panel's severity filter and covers direct lifecycle messages too.
   *
   * @param {'errors'|'warnings'|'debug'|'verbose'} level - Severity selecting the DevTools console method.
   * @param {string} message - Console message, including its recorder prefix.
   * @param {Object|null} data - Diagnostic payload redacted before console output.
   * @returns {void} No value is returned.
   */
  function logConsoleDiagnostic(level, message, data = null) {
    if (generalStatusShown && !consoleDiagnostics) return;
    const args = [redactDiagnosticSignedTokens(message)];
    if (data !== null) args.push(redactDiagnosticSignedTokens(data));
    (level === 'errors' ? console.error : level === 'warnings' ? console.warn : console.log)(...args);
  }

  /**
   * Mirrors diagnostics through the console gate, then retains entries accepted by the panel filter.
   *
   * @param {Object} level - The diagnostics severity level.
   * @param {string} message - The assertion failure message.
   * @param {Object|null} data - The data value required by this function.
   * @returns {void} No value is returned.
   */
  function logDiagnostic(level, message, data = null) {
    logConsoleDiagnostic(level, `[ChatGPT Recorder ${level}] ${message}`, data);
    if (!diagnosticEnabled(level)) return;
    const safeData = redactDiagnosticSignedTokens(data);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: safeData
    };
    diagnosticLog.push(entry);
    if (diagnosticLog.length > MAX_DIAGNOSTIC_LOG_ITEMS) {
      diagnosticLog.splice(0, diagnosticLog.length - MAX_DIAGNOSTIC_LOG_ITEMS);
    }
    schedulePersistDiagnosticLog();
    refreshDiagnosticLog();
  }

  /**
   * Handles inject styles.
   *
   * @returns {void} No value is returned.
   */
  function injectStyles() {
    if (document.getElementById(`${PANEL_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${PANEL_ID}-style`;
    style.textContent = `
      #${LAUNCHER_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:36px;height:32px;box-sizing:border-box;border:1px solid #777;border-radius:9px;background:#242424;color:#fff;padding:0;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.35);cursor:pointer}
      #${LAUNCHER_ID}::before{content:'';width:16px;height:16px;border-radius:50%;background:#d0d0d0;display:block}
      #${PANEL_ID}{position:fixed;right:16px;bottom:54px;z-index:2147483647;width:300px;box-sizing:border-box;padding:12px;border:1px solid rgba(127,127,127,.55);border-radius:12px;background:rgba(24,24,24,.97);color:#f2f2f2;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px/1.35 system-ui,sans-serif}
      #${PANEL_ID} .tm-title{font-size:16px;margin:0 28px 8px 0}
      #${PANEL_ID} .tm-close{position:absolute;right:9px;top:7px;border:0;background:transparent;color:#fff;font-size:24px;cursor:pointer}
      #${PANEL_ID} .tm-status{white-space:pre-wrap;margin:10px 0 12px;min-height:24px}
      #${PANEL_ID} .tm-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
      #${PANEL_ID} .tm-sound-control-row{position:relative}
      #${PANEL_ID} .tm-sound-control{min-width:92px}
      #${PANEL_ID} .tm-sound-popup[hidden]{display:none}
      #${PANEL_ID} .tm-sound-popup{position:absolute;left:0;top:calc(100% + 6px);z-index:3;display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px;border:1px solid rgba(127,127,127,.55);border-radius:9px;background:rgba(24,24,24,.99);box-shadow:0 4px 14px rgba(0,0,0,.4)}
      #${PANEL_ID} .tm-sound-volume-slider{writing-mode:vertical-lr;direction:rtl;width:24px;height:120px}
      #${PANEL_ID} .tm-sound-volume-value{min-width:2ch;text-align:center;font-variant-numeric:tabular-nums}
      #${PANEL_ID} .tm-communication-log-row{flex-wrap:nowrap}
      #${PANEL_ID} .tm-log-name-viewport{flex:1 1 auto;min-width:0;overflow:hidden;color:#fff;box-sizing:border-box}
      #${PANEL_ID} .tm-log-name-text{display:block;width:max-content;min-width:100%;box-sizing:border-box;padding:7px 0;white-space:nowrap;transform:translateX(0);transition:transform var(--tm-log-name-duration,1.5s) linear .35s}
      #${PANEL_ID} .tm-log-name-viewport:hover .tm-log-name-text{transform:translateX(calc(-1 * var(--tm-log-name-overflow,0px)))}
      #${PANEL_ID} .tm-communication-log-row button{flex:0 0 auto}
      #${PANEL_ID} select,#${PANEL_ID} button,#${TEST_MATRIX_ID} button{border:1px solid #666;background:#292929;color:#fff;font:inherit}
      #${PANEL_ID} select,#${PANEL_ID} button{border-radius:9px;padding:9px 12px}
      #${PANEL_ID} select{flex:1;min-width:150px}
      #${PANEL_ID} button,#${TEST_MATRIX_ID} button{cursor:pointer}
      #${PANEL_ID} button:disabled,#${TEST_MATRIX_ID} button:disabled{opacity:.45;cursor:not-allowed}
      #${PANEL_ID} .tm-label{color:#ddd}
      #${TEST_MATRIX_ID}{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:24px;box-sizing:border-box}
      #${TEST_MATRIX_ID} .tm-test-dialog{width:min(920px,96vw);max-height:88vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid #666;border-radius:12px;background:#202020;color:#f2f2f2;box-shadow:0 10px 40px rgba(0,0,0,.5);font:13px/1.35 system-ui,sans-serif}
      #${TEST_MATRIX_ID} .tm-test-dialog-head,#${TEST_MATRIX_ID} .tm-test-actions{display:flex;align-items:center;gap:10px;padding:10px 12px}
      #${TEST_MATRIX_ID} .tm-test-dialog-head{justify-content:space-between;border-bottom:1px solid #555}
      #${TEST_MATRIX_ID} .tm-test-dialog-head strong{font-size:16px}
      #${TEST_MATRIX_ID} .tm-test-table-wrap{overflow:auto}
      #${TEST_MATRIX_ID} .tm-test-table{width:100%;border-collapse:collapse}
      #${TEST_MATRIX_ID} .tm-test-table th,#${TEST_MATRIX_ID} .tm-test-table td{padding:8px 10px;border-bottom:1px solid #444;text-align:left;vertical-align:top}
      #${TEST_MATRIX_ID} .tm-test-table th{position:sticky;top:0;background:#292929;z-index:1}
      #${TEST_MATRIX_ID} .tm-test-table td:nth-child(2),#${TEST_MATRIX_ID} .tm-test-table td:nth-child(3),#${TEST_MATRIX_ID} .tm-test-table td:nth-child(4){white-space:nowrap}
      #${TEST_MATRIX_ID} button{border-radius:8px;padding:7px 10px}
      #${TEST_MATRIX_ID} .tm-test-actions{justify-content:flex-end;border-top:1px solid #555}
      #${PANEL_ID} .tm-log-head{display:flex;align-items:center;gap:6px;margin-top:4px}
      #${PANEL_ID} .tm-log-head [data-role="log-count"]{margin-right:auto}
      #${PANEL_ID} .tm-icon-button{box-sizing:border-box;width:30px;height:28px;padding:4px;display:grid;place-items:center;transition:opacity .2s ease}
      #${PANEL_ID} .tm-icon-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      #${PANEL_ID} .tm-icon-button img{width:16px;height:16px;display:block;object-fit:contain}
      #${PANEL_ID} .tm-copy-fade{opacity:0}
      #${PANEL_ID} .tm-log-output{margin:6px 0 10px;max-height:190px;overflow:auto;border:1px solid #555;border-radius:8px;background:#111;font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;color:#ddd}
      #${PANEL_ID} .tm-log-row{padding:6px 8px;white-space:pre-wrap;overflow-wrap:anywhere}
      #${PANEL_ID} .tm-log-row:nth-child(even){background:rgba(255,255,255,.055)}
      #${PANEL_ID} .tm-switch{margin-left:auto;width:42px;height:24px;padding:2px;border-radius:999px;position:relative}
      #${PANEL_ID} .tm-switch-thumb{display:block;width:18px;height:18px;border-radius:50%;background:#aaa;transform:translateX(0);transition:transform .16s ease,background .16s ease}
      #${PANEL_ID} .tm-switch[aria-checked="true"] .tm-switch-thumb{transform:translateX(16px);background:#fff}
      #${PANEL_ID} .tm-extract-formats{display:grid;grid-template-columns:auto auto auto;gap:6px 12px;align-items:center}
      #${PANEL_ID} .tm-extract-formats label{display:flex;gap:5px;align-items:center}
    `;
    (document.head || document.documentElement).append(style);
  }

  /**
   * Updates UI.
   *
   * @returns {void} No value is returned.
   */
  function updateUi() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const title = panel.querySelector('[data-role="title"]');
    if (title) title.textContent = `ChatGPT Recorder v${VERSION}`;
    const extract = panel.querySelector('[data-role="extract"]');
    const jsonl = panel.querySelector('[data-role="format-jsonl"]');
    const md = panel.querySelector('[data-role="format-md"]');
    const timestamps = panel.querySelector('[data-role="show-timestamps"]');
    const recordNumbers = panel.querySelector('[data-role="show-record-numbers"]');
    const turnIds = panel.querySelector('[data-role="show-turn-ids"]');
    const debugProvenance = panel.querySelector('[data-role="show-debug-provenance"]');
    const test = panel.querySelector('[data-role="test"]');
    const jump = panel.querySelector('[data-role="jump"]');
    const formatsSelected = Boolean(jsonl?.checked || md?.checked);
    if (extract) {
      extract.disabled = exportInProgress || testInProgress || jumpInProgress || !formatsSelected;
      extract.textContent = exportInProgress ? 'Extracting…' : 'Extract';
    }
    if (jsonl) jsonl.disabled = exportInProgress || testInProgress || jumpInProgress;
    if (md) md.disabled = exportInProgress || testInProgress || jumpInProgress;
    const metadataDisabled = exportInProgress || testInProgress || jumpInProgress || !md?.checked;
    if (timestamps) timestamps.disabled = metadataDisabled;
    if (recordNumbers) recordNumbers.disabled = metadataDisabled;
    if (turnIds) turnIds.disabled = metadataDisabled;
    if (debugProvenance) debugProvenance.disabled = metadataDisabled;
    if (test) {
      test.disabled = exportInProgress || testInProgress || jumpInProgress;
      test.textContent = testInProgress ? 'Testing…' : 'Test';
    }
    if (jump) {
      jump.disabled = exportInProgress || testInProgress || jumpInProgress;
      jump.textContent = jumpInProgress ? 'Jumping…' : 'Jump';
    }
    const screen = panel.querySelector('[data-role="screen-on"]');
    if (screen) screen.setAttribute('aria-checked', String(screenOnWhenCapturing));
    refreshStatus();
  }

  /**
   * Summarizes one DOM node for launcher-lifecycle console diagnostics.
   *
   * @param {Node|null} node - The DOM node to summarize.
