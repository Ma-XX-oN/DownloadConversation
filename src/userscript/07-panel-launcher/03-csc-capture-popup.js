
  /** DC #318 popup, mounted immediately beside the existing '1' label. */
  /**
   * Mount the recorder control popup without changing recording-group semantics.
   * @param {HTMLElement} panel - Existing recorder panel
   * @returns {void} Mount the recorder control popup without changing recording-group semantics.
   */
  function bindCscCapturePopup(panel) {
    const group = panel.querySelector('[data-role="record-one-group"]');
    const groupLabel = group?.closest('label');
    if (!groupLabel || panel.querySelector('[data-role="csc-popup-trigger"]')) return;
    const controls = cscControlsCurrent();
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'tm-icon-button tm-csc-gear';
    trigger.dataset.role = 'csc-popup-trigger';
    trigger.textContent = '⚙';
    trigger.setAttribute('aria-label', 'COMM capture and HMAC settings');
    trigger.setAttribute('aria-controls', 'tm-csc-capture-popup');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    groupLabel.after(trigger);

    const dialog = document.createElement('section');
    dialog.id = 'tm-csc-capture-popup';
    dialog.className = 'tm-csc-settings-popup';
    dialog.dataset.role = 'csc-popup';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'COMM capture settings');
    dialog.setAttribute('aria-modal', 'false');
    dialog.hidden = true;
    dialog.innerHTML = [
      '<div class="tm-csc-head"><strong>COMM capture settings</strong>',
      '<button type="button" data-csc-close aria-label="Close COMM settings">×</button></div>',
      '<fieldset><legend>Capture scope</legend>',
      '<label><input type="radio" name="tm-csc-mode" data-csc-mode="replay-essentials">',
      ' Replay essentials</label>',
      '<small>Same-origin JSON and SSE capture for replay, plus network',
      ' provenance (method, URL, status, timing and sanitized headers).',
      ' Binary bodies, cross-origin data and authentication-related headers',
      ' are off by default. Unsupported or inaccessible content is recorded',
      ' as omitted or incomplete, not silently discarded.</small>',
      '<label><input type="radio" name="tm-csc-mode" data-csc-mode="everything">',
      ' Record everything browser-accessible</label>',
      '<small>Opt-in to all accessible request/response content, not an',
      ' unlimited promise about browser-opaque or blocked bodies.</small>',
      '</fieldset>',
      '<fieldset><legend>Additional capture classes</legend>',
      '<label><input type="checkbox" data-csc-flag="binary"> Binary payloads</label>',
      '<label><input type="checkbox" data-csc-flag="cross_origin">',
      ' Readable cross-origin response bodies</label>',
      '<label><input type="checkbox" data-csc-flag="auth_headers">',
      ' Authentication-related headers</label>',
      '<label><input type="checkbox" data-csc-flag="all">',
      ' All of the above</label>',
      '</fieldset>',
      '<p id="tm-csc-privacy-warning" class="tm-csc-warning">Privacy warning: expanded capture can',
      ' retain credentials, private messages and sensitive network data.',
      ' Browser-inaccessible opaque responses remain unavailable.',
      ' HMAC processing never authorizes raw key export.</p>',
      '<div class="tm-csc-status" role="status" aria-live="polite"',
      ' data-csc-status></div>',
      '<div class="tm-csc-key"><strong>Persistent HMAC</strong>',
      '<div data-csc-key></div><div data-csc-expiry></div>',
      '<button type="button" data-csc-randomize>Randomize…</button></div>',
      '<div class="tm-csc-actions"><button type="button" data-csc-apply>',
      ' Apply capture settings</button></div>'
    ].join('');
    dialog.setAttribute('aria-describedby', 'tm-csc-privacy-warning');
    const section = panel.querySelector('.tm-recording-section');
    section.append(dialog);
    if (!document.getElementById('tm-csc-capture-style')) {
      const style = document.createElement('style');
      style.id = 'tm-csc-capture-style';
      style.textContent = [
        '#tm-conversation-recorder .tm-csc-gear{margin-left:2px;',
        'width:23px;height:23px;min-width:23px;font-size:15px;',
        'border:1px solid currentColor;border-radius:5px;background:transparent;',
        'color:inherit;cursor:pointer}',
        '#tm-conversation-recorder .tm-recording-section{position:relative}',
        '#tm-conversation-recorder .tm-csc-settings-popup{position:absolute;',
        'z-index:120;right:6px;top:68px;max-height:70vh;overflow-y:auto;',
        'width:min(340px,calc(100vw - 35px));box-sizing:border-box;',
        'padding:12px;background:var(--main-surface-primary,Canvas);',
        'color:var(--text-primary,CanvasText);border:1px solid currentColor;',
        'border-radius:8px;box-shadow:0 4px 16px #0005}',
        '#tm-conversation-recorder .tm-csc-settings-popup[hidden]{display:none}',
        '#tm-conversation-recorder .tm-csc-head{display:flex;',
        'align-items:center;justify-content:space-between;gap:8px}',
        '#tm-conversation-recorder .tm-csc-settings-popup fieldset{display:grid;',
        'gap:7px;margin:8px 0;padding:7px;border:1px solid currentColor}',
        '#tm-conversation-recorder .tm-csc-settings-popup label{display:block}',
        '#tm-conversation-recorder .tm-csc-settings-popup small{display:block;',
        'font-size:11px;line-height:1.35;opacity:.85}',
        '#tm-conversation-recorder .tm-csc-warning{font-size:12px;',
        'line-height:1.4;border-left:3px solid #c88700;padding-left:8px}',
        '#tm-conversation-recorder .tm-csc-key{margin-top:8px}',
        '#tm-conversation-recorder .tm-csc-key div{overflow-wrap:anywhere}',
        '#tm-conversation-recorder .tm-csc-actions{margin-top:10px}',
        '#tm-conversation-recorder .tm-csc-settings-popup button{',
        'cursor:pointer;background:transparent;color:inherit;',
        'border:1px solid currentColor;border-radius:4px;padding:4px 8px}'
      ].join('');
      document.head.append(style);
    }
    const modes = [...dialog.querySelectorAll('[data-csc-mode]')];
    const flags = [...dialog.querySelectorAll('[data-csc-flag]')];
    const allFlags = flags.find(input => input.dataset.cscFlag === 'all');
    allFlags.addEventListener('change', () => {
      for (const input of flags) input.checked = allFlags.checked;
    });
    for (const input of flags) {
      if (input === allFlags) continue;
      input.addEventListener('change', () => {
        allFlags.checked = flags.filter(flag => flag !== allFlags)
          .every(flag => flag.checked);
      });
    }
    const status = dialog.querySelector('[data-csc-status]');
    const identity = dialog.querySelector('[data-csc-key]');
    const due = dialog.querySelector('[data-csc-expiry]');
    const randomize = dialog.querySelector('[data-csc-randomize]');
    const apply = dialog.querySelector('[data-csc-apply]');
    const closeButton = dialog.querySelector('[data-csc-close]');
    /**
     * Render saved options and only nonsecret HMAC state.
     * @param {Object} model - Current controller snapshot
     * @returns {void} Render saved options and only nonsecret HMAC state.
     */
    function render(model) {
      const { settings, settings_state, key_state, key_restart,
        expires_at_ms, error, can_randomize } = model;
      for (const input of modes) input.checked = input.dataset.cscMode === settings.mode;
      for (const input of flags) {
        input.checked = settings[input.dataset.cscFlag] ||
          (settings.all && input !== allFlags);
      }
      status.textContent = 'Worker configuration: ' + settings_state +
        (error ? ' (' + error + ')' : '');
      identity.textContent = 'Key restart: ' + (key_restart || 'not initialized');
      identity.setAttribute('title', 'Nonsecret key-cycle timestamp, never key bytes');
      due.textContent = 'Status: ' + key_state + '; next due: ' +
        (Number.isFinite(expires_at_ms) ?
          new Date(expires_at_ms).toLocaleString() : 'unavailable');
      randomize.disabled = !can_randomize;
    }
    /**
     * Dismiss the popup and optionally restore keyboard focus.
     * @param {boolean} refocus - Restore focus to the triggering button
     * @returns {void} Dismiss the popup and optionally restore keyboard focus.
     */
    function close(refocus = false) {
      dialog.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (refocus) trigger.focus();
    }
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      const open = dialog.hidden;
      dialog.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (open) {
        modes[0].focus();
        void controls.refreshKey().catch(() => {});
      }
    });
    closeButton.addEventListener('click', () => close(true));
    dialog.addEventListener('click', event => event.stopPropagation());
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !dialog.hidden) {
        close(true);
        event.stopPropagation();
      }
    });
    document.addEventListener('pointerdown', event => {
      if (!dialog.hidden && !dialog.contains(event.target) &&
          event.target !== trigger) close();
    });
    panel.querySelector('.tm-close')?.addEventListener('click', () => close());
    apply.addEventListener('click', () => {
      const next = { schema: CSC_CONTROL_SCHEMA,
        mode: modes.find(item => item.checked)?.dataset.cscMode || 'replay-essentials' };
      for (const input of flags) next[input.dataset.cscFlag] = input.checked;
      const sensitive = next.mode === 'everything' ||
        next.binary || next.cross_origin || next.auth_headers || next.all;
      const confirmed = !sensitive || window.confirm(
        'Expanded COMM recording can retain credentials and private data. ' +
        'Do you explicitly authorize these capture options?');
      if (!confirmed) {
        render(controls.snapshot());
        return;
      }
      apply.disabled = true;
      void controls.setOptions(next, confirmed).catch(error => {
        status.textContent = 'Settings rejected: ' + error.message;
      }).finally(() => { apply.disabled = false; });
    });
    randomize.addEventListener('click', () => {
      if (!window.confirm('Randomize the shared HMAC key? Active captures must ' +
        'drain under the old key and GEN/COMM boundaries must be durable.')) return;
      randomize.disabled = true;
      void controls.randomize(true).catch(error => {
        status.textContent = 'Randomize failed: ' + error.message;
      }).finally(() => {
        randomize.disabled = !controls.snapshot().can_randomize;
      });
    });
    controls.onChange(render);
    void controls.init().catch(error => {
      status.textContent = 'CSC startup failed: ' + error.message;
    });
  }
