
  /** Unique overlay identity for combined log extraction. */
  const LOG_EXTRACTION_DIALOG_ID = 'tm-recorder-extract-logs-dialog';

  /**
   * Resolves trustworthy timestamps from the selected existing log stores.
   *
   * @param {boolean} includeGeneral - Whether to include retained diagnostics.
   * @param {boolean} includeComm - Whether to include the existing communication log.
   * @returns {Promise<Object>} Inclusive available range with selected-source availability.
   */
  async function logExtractionAvailableRange(includeGeneral, includeComm) {
    const general = includeGeneral ? diagnosticLogTimestampRange() : null;
    let comm = null;
    if (includeComm && communicationLogReady) {
      try {
        comm = await communicationLogDuplicateAvailableRange();
      } catch (error) {
        logDiagnostic('warnings', 'log-extraction-communication-range-unavailable', {
          message: errorMessage(error)
        });
      }
    }
    const ranges = [general, comm].filter(range =>
      range && Number.isFinite(Date.parse(range.start_timestamp))
        && Number.isFinite(Date.parse(range.end_timestamp))
    );
    if (!ranges.length) throw new Error('No trustworthy timestamps are available for extraction.');
    const start = Math.min(...ranges.map(range => Date.parse(range.start_timestamp)));
    const end = Math.max(...ranges.map(range => Date.parse(range.end_timestamp)));
    return {
      start_timestamp: new Date(start).toISOString(),
      end_timestamp: new Date(end).toISOString(),
      general_available: Boolean(general),
      communication_available: Boolean(comm)
    };
  }

  /**
   * Opens the existing local date/time selector with per-extraction log choices.
   *
   * Changing these checkboxes does not change the main panel logging preferences.
   * The result is a selection contract; issue #220 owns merging/writing events.
   *
   * @param {HTMLElement|null} opener - Original button for focus restoration.
   * @returns {Promise<Object|null>} Selected date range and sources, or cancellation.
   */
  async function showLogExtractionDialog(opener = null) {
    document.getElementById(LOG_EXTRACTION_DIALOG_ID)?.remove();
    const panel = document.getElementById(PANEL_ID);
    const selectedGen = panel?.querySelector('[data-role="record-general"]')?.checked ?? true;
    const selectedComm = panel?.querySelector('[data-role="record-communication"]')?.checked ?? true;
    const range = await logExtractionAvailableRange(selectedGen, selectedComm);
    const minimum = new Date(range.start_timestamp);
    const maximum = new Date(range.end_timestamp);
    minimum.setMilliseconds(0);
    maximum.setMilliseconds(0);
    injectSingleDateTimeControlStyles();
    const overlay = document.createElement('div');
    overlay.id = LOG_EXTRACTION_DIALOG_ID;
    overlay.className = 'tm-date-range-overlay';
    overlay.innerHTML = `
      <div class="tm-date-range-dialog" role="dialog" aria-modal="true"
           aria-label="Extract logs">
        <div class="tm-date-range-row">
          <span class="tm-date-range-label">From:</span>
          <span data-role="extract-log-start"></span>
          <span class="tm-date-range-label">To:</span>
          <span data-role="extract-log-end"></span>
        </div>
        <div class="tm-date-range-row">
          <label><input type="checkbox" data-role="extract-log-gen"> Gen</label>
          <label><input type="checkbox" data-role="extract-log-comm"> Comm</label>
          <span class="tm-date-range-actions">
            <button type="button" data-role="extract-log-save">Save</button>
            <button type="button" data-role="extract-log-cancel">Cancel</button>
          </span>
        </div>
        <div class="tm-date-range-error" data-role="extract-log-error" aria-live="polite"></div>
      </div>`;
    const startHost = overlay.querySelector('[data-role="extract-log-start"]');
    const endHost = overlay.querySelector('[data-role="extract-log-end"]');
    const gen = overlay.querySelector('[data-role="extract-log-gen"]');
    const comm = overlay.querySelector('[data-role="extract-log-comm"]');
    const save = overlay.querySelector('[data-role="extract-log-save"]');
    const cancel = overlay.querySelector('[data-role="extract-log-cancel"]');
    const errorOutput = overlay.querySelector('[data-role="extract-log-error"]');
    if (!(startHost instanceof HTMLElement)
        || !(endHost instanceof HTMLElement)
        || !(gen instanceof HTMLInputElement)
        || !(comm instanceof HTMLInputElement)
        || !(save instanceof HTMLButtonElement)
        || !(cancel instanceof HTMLButtonElement)) {
      throw new Error('Log extraction dialog is incomplete.');
    }
    gen.checked = selectedGen && range.general_available;
    comm.checked = selectedComm && range.communication_available;
    let fromControl;
    let toControl;
    /**
     * Validates selected sources and ordered bounds before allowing Save.
     *
     * @returns {boolean} Whether at least one source and a valid range are selected.
     */
    const validate = () => {
      const chronological = !fromControl || !toControl
        || fromControl.getDate().getTime() <= toControl.getDate().getTime();
      const selected = gen.checked || comm.checked;
      save.disabled = !chronological || !selected;
      if (errorOutput) {
        errorOutput.textContent = !selected
          ? 'Select Gen and/or Comm.' : chronological
            ? '' : 'From must not be later than To.';
      }
      return !save.disabled;
    };
    fromControl = createSingleDateTimeControl({
      label: 'Log extraction start local date and time',
      value: minimum, minimum, maximum, onChange: validate
    });
    toControl = createSingleDateTimeControl({
      label: 'Log extraction end local date and time',
      value: maximum, minimum, maximum, onChange: validate
    });
    startHost.append(fromControl.element);
    endHost.append(toControl.element);
    gen.addEventListener('change', validate);
    comm.addEventListener('change', validate);
    validate();
    const previousFocus = opener instanceof HTMLElement
      ? opener : document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
    document.body.append(overlay);
    return new Promise(resolve => {
      let settled = false;
      /**
       * Closes the dialog exactly once while restoring the originating focus.
       *
       * @param {Object|null} selection - Accepted bounds or cancellation.
       * @param {boolean} restore - Whether to restore focus locally.
       * @returns {void} Nothing.
       */
      const finish = (selection, restore = true) => {
        if (settled) return;
        settled = true;
        overlay.remove();
        if (restore && previousFocus?.isConnected) {
          previousFocus.focus({ preventScroll: true });
        }
        resolve(selection);
      };
      save.addEventListener('click', () => {
        if (!validate()) return;
        const from = fromControl.getDate();
        const to = toControl.getDate();
        from.setMilliseconds(0);
        to.setMilliseconds(999);
        finish({
          start_timestamp: from.toISOString(),
          end_timestamp: to.toISOString(),
          general: gen.checked,
          communication: comm.checked
        });
      });
      cancel.addEventListener('click', () => finish(null));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(null);
      });
      installModalContract(overlay, {
        defaultButton: save,
        onClose: () => finish(null, false),
        opener: previousFocus
      });
      fromControl.focus();
    });
  }
