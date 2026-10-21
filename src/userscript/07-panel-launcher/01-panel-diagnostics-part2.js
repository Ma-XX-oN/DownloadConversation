

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
      #${LAUNCHER_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:36px;height:32px;border:1px solid #777;border-radius:9px;background:#242424;color:#fff;padding:0;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.35);cursor:pointer}
      #${LAUNCHER_ID}::before{content:'';width:16px;height:16px;border-radius:50%;background:#d0d0d0;display:block}
      #${PANEL_ID}{position:fixed;right:16px;bottom:54px;z-index:2147483647;width:min(390px,calc(100vw - 20px));max-height:calc(100dvh - 76px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;box-sizing:border-box;padding:10px;border:1px solid rgba(127,127,127,.55);border-radius:12px;background:#181818;color:#f2f2f2;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px/1.35 system-ui,sans-serif}
      #${PANEL_ID} .tm-title{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 32px 6px 0;font-weight:600}
      #${PANEL_ID} .tm-close{position:absolute;right:9px;top:7px;border:0;background:transparent;color:#fff;font-size:24px;cursor:pointer}
      #${PANEL_ID} .tm-status{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:2px 0 4px;min-height:0;max-width:100%;font-size:12px;color:#bbb}
      #${PANEL_ID} .tm-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px;min-width:0}
      #${PANEL_ID} .tm-sound-control-row{position:relative}
      #${PANEL_ID} .tm-sound-control{min-width:92px}
      #${PANEL_ID} .tm-sound-popup[hidden]{display:none}
      #${PANEL_ID} .tm-sound-popup{position:absolute;left:0;top:calc(100% + 6px);z-index:3;display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px;border:1px solid rgba(127,127,127,.55);border-radius:9px;background:rgba(24,24,24,.99);box-shadow:0 4px 14px rgba(0,0,0,.4)}
      #${PANEL_ID} .tm-sound-volume-slider{writing-mode:vertical-lr;direction:rtl;width:24px;height:120px}
      #${PANEL_ID} .tm-sound-volume-value{min-width:2ch;text-align:center;font-variant-numeric:tabular-nums}
      #${PANEL_ID} .tm-communication-log-row{flex-wrap:nowrap;min-width:0;gap:5px}
      #${PANEL_ID} .tm-recording-location{display:flex;flex-direction:column;gap:3px;min-width:0}
      #${PANEL_ID} .tm-log-name-viewport{flex:1 1 auto;min-width:0;overflow:hidden;color:#fff;box-sizing:border-box}
      #${PANEL_ID} .tm-log-name-text{display:block;width:max-content;min-width:100%;box-sizing:border-box;padding:5px 0;white-space:nowrap;transform:translateX(0);transition:transform var(--tm-log-name-duration,1.5s) linear .35s}
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
      #${PANEL_ID} .tm-log-head{display:flex;align-items:center;gap:6px;margin-top:3px}
      #${PANEL_ID} .tm-log-head [data-role="log-count"]{margin-right:auto}
      #${PANEL_ID} .tm-icon-button{box-sizing:border-box;flex:0 0 28px;width:28px;height:27px;padding:3px;display:grid;place-items:center;transition:opacity .2s ease}
      #${PANEL_ID} .tm-icon-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      #${PANEL_ID} .tm-icon-button img{width:16px;height:16px;display:block;object-fit:contain}
      #${PANEL_ID} .tm-copy-fade{opacity:0}
      #${PANEL_ID} .tm-log-output{margin:6px 0 10px;max-height:190px;overflow:auto;border:1px solid #555;border-radius:8px;background:#111;font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;color:#ddd}
      #${PANEL_ID} .tm-log-row{padding:6px 8px;white-space:pre-wrap;overflow-wrap:anywhere}
      #${PANEL_ID} .tm-log-row:nth-child(even){background:rgba(255,255,255,.055)}
      #${PANEL_ID} .tm-switch{margin-left:auto;width:42px;height:24px;padding:2px;flex:0 0 42px;border-radius:999px;position:relative}
      #${PANEL_ID} .tm-switch-thumb{display:block;width:18px;height:18px;border-radius:50%;background:#aaa;transform:translateX(0);transition:transform .16s ease,background .16s ease}
      #${PANEL_ID} .tm-switch[aria-checked="true"] .tm-switch-thumb{transform:translateX(16px);background:#fff}
      #${PANEL_ID} .tm-extract-formats{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
      #${PANEL_ID} .tm-export-compression{width:34px;height:28px;padding:3px 4px;display:flex;align-items:center;justify-content:center}
      #${PANEL_ID} .tm-export-compression svg{display:block;width:28px;height:20px}
      #${PANEL_ID} .tm-extract-formats label{display:flex;gap:5px;align-items:center}
      #${PANEL_ID} .tm-last-log-problem{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:#e5b6a0;margin:2px 0}
      #${PANEL_ID} .tm-user-feedback{min-height:16px;font-size:12px;line-height:1.4;color:#ddd;white-space:normal;overflow-wrap:anywhere;margin:3px 0 9px}
      #${PANEL_ID} .tm-last-log-problem[hidden],#${PANEL_ID} .tm-log-output[hidden]{display:none}
      #${PANEL_ID} .tm-recording-options{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 8px}
      #${PANEL_ID} .tm-recording-options select{min-width:0;width:100%;padding:6px 8px}
      #${PANEL_ID} .tm-recording-modes{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px}
      #${PANEL_ID} .tm-recording-modes label,#${PANEL_ID} .tm-md-metadata label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
      #${PANEL_ID} .tm-recording-modes input,#${PANEL_ID} .tm-md-metadata input{margin:0}
      #${PANEL_ID} .tm-file-label{flex:0 0 auto}
      #${PANEL_ID} .tm-communication-log-row .tm-icon-button{width:28px;min-width:28px}
      #${PANEL_ID} .tm-capture-options .tm-label{flex:1 1 auto;min-width:0}
      #${PANEL_ID} .tm-md-metadata{gap:5px 10px}
      #${PANEL_ID} button[data-role="jump"],#${PANEL_ID} button[data-role="test"]{padding:6px 10px}
      #${PANEL_ID} button[data-role="extract"]{padding:0;align-items:center;justify-items:center}
      #${PANEL_ID} .tm-sound-control{padding:6px 9px}
      @media(max-width:430px){#${PANEL_ID}{right:10px;bottom:48px;max-height:calc(100dvh - 58px);padding:8px}#${PANEL_ID} .tm-recording-modes{gap:4px 9px}#${PANEL_ID} .tm-communication-log-row{gap:3px}}

      #${PANEL_ID} .tm-log-head{margin:10px 0 5px}
      #${PANEL_ID} .tm-last-log-problem{margin:4px 0 10px;min-height:15px}
      #${PANEL_ID} .tm-diagnostics-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;margin:0 0 12px}
      #${PANEL_ID} .tm-diagnostics-row select{width:100%;min-width:0;padding:6px 9px}
      #${PANEL_ID} .tm-recorder-section{border-top:1px solid #494949;padding:9px 0 7px}
      #${PANEL_ID} .tm-recorder-section .tm-row{margin-top:0}
      #${PANEL_ID} .tm-recording-section{display:grid;gap:9px}
      #${PANEL_ID} .tm-communication-log-row{gap:6px}
      #${PANEL_ID} .tm-log-name-text{font-weight:600;padding:3px 0}
      #${PANEL_ID} .tm-recording-modes{display:flex;justify-content:space-between;flex-wrap:nowrap;gap:4px}
      #${PANEL_ID} .tm-recording-modes label{white-space:nowrap;gap:5px}
      #${PANEL_ID} .tm-recording-actions{justify-content:center;gap:14px}
      #${PANEL_ID} .tm-recording-actions .tm-icon-button{width:40px;height:36px;flex:0 0 40px}
      #${PANEL_ID} .tm-recording-actions .tm-icon-button svg{width:21px;height:21px}
      #${PANEL_ID} .tm-log-settings-popup[hidden]{display:none}
      #${PANEL_ID} .tm-log-settings-popup{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:30;box-sizing:border-box;width:min(330px,calc(100vw - 32px));max-height:85dvh;overflow:auto;padding:14px;border:1px solid #777;border-radius:12px;background:#202020;display:flex;flex-direction:column;gap:10px}
      #${PANEL_ID} .tm-log-settings-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
      #${PANEL_ID} .tm-log-settings-heading button{font-size:22px;padding:1px 8px}
      #${PANEL_ID} .tm-log-settings-popup label{display:flex;align-items:center;gap:8px;cursor:pointer}
      #${PANEL_ID} .tm-log-settings-popup input{width:16px;height:16px;accent-color:#78b8ff}
      #${PANEL_ID} .tm-log-settings-popup small{color:#bbb;line-height:1.4}
      #${PANEL_ID} .tm-export-section{display:grid;gap:8px}
      #${PANEL_ID} .tm-md-metadata{display:flex;justify-content:space-between;flex-wrap:nowrap;gap:4px;font-size:12px}
      #${PANEL_ID} .tm-md-metadata label{gap:3px}
      #${PANEL_ID} .tm-extract-formats{display:flex;justify-content:flex-start;gap:12px;flex-wrap:nowrap}
      #${PANEL_ID} .tm-extract-formats label{white-space:nowrap}
      #${PANEL_ID} .tm-export-action{display:grid;place-items:center;width:36px;height:32px;flex:0 0 36px;padding:0}
      #${PANEL_ID} .tm-export-action svg{display:block;width:23px;height:23px;transform:translateY(-1px)}
      #${PANEL_ID} .tm-export-compression{border-radius:8px;min-width:34px;flex:0 0 34px}
      #${PANEL_ID} .tm-export-compression svg{width:28px}
      #${PANEL_ID} .tm-tool-actions{border-top:1px solid #494949;padding:12px 0 3px;margin-top:4px;justify-content:space-around;gap:12px;flex-wrap:nowrap}
      #${PANEL_ID} .tm-tool-actions .tm-tool-button{width:48px;height:40px;padding:3px;font-size:24px;line-height:1;flex:0 0 48px}
      #${PANEL_ID} .tm-tool-actions .tm-sound-control{height:40px;min-width:96px;font-size:14px;padding:6px}
      #${PANEL_ID} .tm-sound-popup{bottom:calc(100% + 4px);top:auto;left:0;min-width:64px;z-index:12}
      #${PANEL_ID} .tm-sound-volume-slider{appearance:slider-vertical;accent-color:#78b8ff;min-height:145px;cursor:pointer}
      #${PANEL_ID} .tm-sound-volume-slider::-webkit-slider-runnable-track{background:repeating-linear-gradient(to top,#8192a8 0 2px,#323b49 2px 15px);border-radius:6px;border:1px solid #a4b1c3;width:12px}
      #${PANEL_ID} .tm-sound-volume-slider::-webkit-slider-thumb{appearance:none;background:#b2d8ff;border:2px solid #fff;box-shadow:0 0 0 2px #296ca8;width:22px;height:14px;border-radius:5px}
      #${PANEL_ID} .tm-sound-volume-value{font-size:14px;font-weight:700;color:#fff}
      #${PANEL_ID} .tm-sound-popup{flex-direction:row;align-items:center;flex-wrap:wrap;justify-content:center}
      #${PANEL_ID} .tm-volume-ticks{height:145px;display:flex;flex-direction:column;justify-content:space-between;font:700 12px/1 system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000}
      #${PANEL_ID} .tm-sound-volume-value{flex:0 0 100%;text-align:center}

      #${PANEL_ID} .tm-status{margin:0;max-height:0;overflow:hidden}
      #${PANEL_ID} .tm-status:not(:empty){max-height:2px}
      @media(max-width:390px){#${PANEL_ID} .tm-md-metadata{font-size:11px;gap:2px}#${PANEL_ID} .tm-recording-modes{gap:2px}#${PANEL_ID} .tm-extract-formats{gap:8px}}
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
    if (title) {
      title.textContent = `ChatGPT Recorder v${VERSION}`;
      title.title = title.textContent;
    }
    const extract = panel.querySelector('[data-role="extract"]');
    const jsonl = panel.querySelector('[data-role="format-jsonl"]');
    const md = panel.querySelector('[data-role="format-md"]');
    const exportCompression = panel.querySelector('[data-role="export-compression"]');
    const timestamps = panel.querySelector('[data-role="show-timestamps"]');
    const recordNumbers = panel.querySelector('[data-role="show-record-numbers"]');
    const turnIds = panel.querySelector('[data-role="show-turn-ids"]');
    const debugProvenance = panel.querySelector('[data-role="show-debug-provenance"]');
    const test = panel.querySelector('[data-role="test"]');
    const jump = panel.querySelector('[data-role="jump"]');
    const formatsSelected = Boolean(jsonl?.checked || md?.checked);
    if (extract) {
      extract.disabled = exportInProgress || testInProgress || jumpInProgress || !formatsSelected;
      extract.innerHTML = exportInProgress ? '…' : exportArrowIconMarkup();
      extract.setAttribute('aria-label', exportInProgress ? 'Exporting conversation' : 'Export conversation');
    }
    if (jsonl) jsonl.disabled = exportInProgress || testInProgress || jumpInProgress;
    if (md) md.disabled = exportInProgress || testInProgress || jumpInProgress;
    if (exportCompression) {
      const compressed = exportCompressionEnabled;
      const description = compressed ? 'Save compressed' : 'Save uncompressed';
      exportCompression.disabled = exportInProgress || testInProgress || jumpInProgress;
      exportCompression.setAttribute('aria-checked', String(compressed));
      exportCompression.setAttribute('aria-label', compressed ? 'Save compressed' : 'Save uncompressed');
      exportCompression.title = description;
      exportCompression.innerHTML = exportCompressionIconMarkup(compressed);
    }
    const metadataDisabled = exportInProgress || testInProgress || jumpInProgress || !md?.checked;
    if (timestamps) timestamps.disabled = metadataDisabled;
    if (recordNumbers) recordNumbers.disabled = metadataDisabled;
    if (turnIds) turnIds.disabled = metadataDisabled;
    if (debugProvenance) debugProvenance.disabled = metadataDisabled;
    if (test) {
      test.disabled = exportInProgress || testInProgress || jumpInProgress;
      test.textContent = testInProgress ? '…' : '🧪';
    }
    if (jump) {
      jump.disabled = exportInProgress || testInProgress || jumpInProgress;
      jump.textContent = jumpInProgress ? '…' : '🪂';
    }
    const screen = panel.querySelector('[data-role="screen-on"]');
    if (screen) screen.setAttribute('aria-checked', String(screenOnWhenCapturing));
    refreshStatus();
  }

  /**
   * Summarizes one DOM node for launcher-lifecycle console diagnostics.
   *
   * @param {Node|null} node - The DOM node to summarize.
