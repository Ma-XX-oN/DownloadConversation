
  /** ID of the communication Duplicate range dialog overlay. */
  const COMMUNICATION_LOG_DUPLICATE_RANGE_DIALOG_ID =
    'tm-conversation-duplicate-range-dialog';

  /**
   * Resolves the currently available communication-log timestamp range.
   *
   * The earliest timestamp is taken only from the filesystem-authoritative first
   * historical segment filename. The latest timestamp is read from the durable
   * segment manifest. No historical archive is opened or decompressed merely to
   * populate the dialog.
   *
   * @returns {Promise<Object>} Inclusive start/end ISO timestamp range.
   */
  async function communicationLogDuplicateAvailableRange() {
    const segments = await communicationLogHistoricalSegmentsFromDirectory();
    if (segments.length === 0) {
      throw new Error(
        'Duplicate range start is unavailable because no timestamped segment file exists.'
      );
    }
    const manifest = await communicationLogReadSegmentManifest();
    const startTimestamp = segments[0].start_timestamp;
    const endTimestamp = manifest.active_last_timestamp;
    const startMs = Date.parse(startTimestamp);
    const endMs = Date.parse(endTimestamp);
    if (!Number.isFinite(startMs)) {
      throw new Error('Duplicate range start timestamp from segment filename is invalid.');
    }
    if (!Number.isFinite(endMs)) {
      throw new Error('Duplicate range end timestamp is unavailable in the segment manifest.');
    }
    if (endMs < startMs) {
      throw new Error('Communication Duplicate range end precedes its start.');
    }
    return {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp
    };
  }

  /**
   * Shows the communication-log Duplicate local date/time range dialog.
   *
   * Each visible field is local time. The selected start second is inclusive at
   * millisecond 000 and the selected end second is inclusive through millisecond
   * 999 so a seconds-only control includes every record in the chosen final
   * second.
   *
   * @returns {Promise<Object|null>} Duplicate bounds, or null when cancelled.
   */
  async function communicationLogShowDuplicateRangeDialog() {
    document.getElementById(COMMUNICATION_LOG_DUPLICATE_RANGE_DIALOG_ID)?.remove();
    const range = await communicationLogDuplicateAvailableRange();
    const minimum = new Date(Date.parse(range.start_timestamp));
    const maximumExact = new Date(Date.parse(range.end_timestamp));
    minimum.setMilliseconds(0);
    const maximum = new Date(maximumExact.getTime());
    maximum.setMilliseconds(0);

    injectSingleDateTimeControlStyles();
    const overlay = document.createElement('div');
    overlay.id = COMMUNICATION_LOG_DUPLICATE_RANGE_DIALOG_ID;
    overlay.className = 'tm-date-range-overlay';
    overlay.innerHTML = `
      <div class="tm-date-range-dialog" role="dialog" aria-modal="true" aria-label="Duplicate communication log date range">
        <div class="tm-date-range-row">
          <span class="tm-date-range-label">Duplicate:</span>
          <span data-role="duplicate-range-start"></span>
          <span aria-hidden="true">–</span>
          <span data-role="duplicate-range-end"></span>
          <span class="tm-date-range-actions"><button type="button" data-role="duplicate-range-ok">OK</button><button type="button" data-role="duplicate-range-cancel">Cancel</button></span>
        </div>
        <div class="tm-date-range-error" data-role="duplicate-range-error" aria-live="polite"></div>
      </div>
    `;
    const startHost = overlay.querySelector('[data-role="duplicate-range-start"]');
    const endHost = overlay.querySelector('[data-role="duplicate-range-end"]');
    const okButton = overlay.querySelector('[data-role="duplicate-range-ok"]');
    const cancelButton = overlay.querySelector('[data-role="duplicate-range-cancel"]');
    const errorOutput = overlay.querySelector('[data-role="duplicate-range-error"]');
    if (!(startHost instanceof HTMLElement)
        || !(endHost instanceof HTMLElement)
        || !(okButton instanceof HTMLButtonElement)
        || !(cancelButton instanceof HTMLButtonElement)) {
      throw new Error('Communication Duplicate range dialog could not be constructed.');
    }

    let startControl;
    let endControl;
    /**
     * Validates the currently selected start/end relationship and updates OK state.
     *
     * @returns {boolean} True when start is not later than end.
     */
    const validate = () => {
      if (!startControl || !endControl) return true;
      const valid = startControl.getDate().getTime() <= endControl.getDate().getTime();
      okButton.disabled = !valid;
      if (errorOutput) {
        errorOutput.textContent = valid ? '' : 'Start date/time must not be after end date/time.';
      }
      return valid;
    };
    startControl = createSingleDateTimeControl({
      label: 'Duplicate start local date and time',
      value: minimum,
      minimum,
      maximum,
      onChange: validate
    });
    endControl = createSingleDateTimeControl({
      label: 'Duplicate end local date and time',
      value: maximum,
      minimum,
      maximum,
      onChange: validate
    });
    startHost.append(startControl.element);
    endHost.append(endControl.element);
    validate();

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.append(overlay);
    startControl.focus();

    return new Promise(resolve => {
      let settled = false;
      /**
       * Closes the range dialog once and restores the previous focus target.
       *
       * @param {Object|null} value - Selected bounds or cancellation marker.
       * @returns {void} No value is returned.
       */
      const finish = value => {
        if (settled) return;
        settled = true;
        overlay.remove();
        previousFocus?.focus();
        resolve(value);
      };
      okButton.addEventListener('click', () => {
        if (!validate()) return;
        const start = startControl.getDate();
        const end = endControl.getDate();
        start.setMilliseconds(0);
        end.setMilliseconds(999);
        finish({
          start_timestamp: start.toISOString(),
          end_timestamp: end.toISOString()
        });
      });
      cancelButton.addEventListener('click', () => finish(null));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(null);
      });
      overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      });
    });
  }

  /**
   * Intercepts the recorder Duplicate button before its legacy direct handler.
   *
   * The range picker remains a separate reusable UI module while the existing
   * panel constructor stays unchanged. Accepted bounds are passed directly into
   * the established Duplicate storage operation.
   *
   * @param {MouseEvent} event - Captured document click event.
   * @returns {void} No value is returned.
   */
  function communicationLogHandleDuplicateRangeClick(event) {
    const button = event.target instanceof Element
      ? event.target.closest('[data-role="duplicate-communication-log"]')
      : null;
    if (!(button instanceof HTMLButtonElement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled || communicationLogUiActionInProgress || !communicationLogFileName) return;

    button.disabled = true;
    setStatus('Duplicate: preparing available local date/time range…');
    void communicationLogShowDuplicateRangeDialog()
      .then(bounds => {
        if (!bounds) {
          button.disabled = false;
          updateUi();
          setStatus('Communication log Duplicate cancelled.');
          return;
        }
        button.disabled = false;
        return runCommunicationLogPanelAction(button, {
          idleLabel: 'Duplicate communication log',
          busyLabel: 'Duplicating communication log',
          busyTitle: 'Duplicating…',
          operation: () => communicationLogArchiveDuplicate({
            start_timestamp: bounds.start_timestamp,
            end_timestamp: bounds.end_timestamp
          }),
          onSuccess: duplicateName =>
            setStatus(`Communication log duplicated as ${duplicateName}.`),
          failurePrefix: 'Communication log duplicate failed'
        });
      })
      .catch(error => {
        button.disabled = false;
        updateUi();
        setStatus(`Communication log duplicate failed: ${errorMessage(error)}`);
        logDiagnostic('errors', 'communication-log-duplicate-range-failure', {
          message: boundedDiagnosticText(errorMessage(error), 2000)
        });
      });
  }

  document.addEventListener('click', communicationLogHandleDuplicateRangeClick, true);
