
  /**
   * Clamps one Date to optional inclusive bounds.
   *
   * @param {Date} value - Candidate local date/time.
   * @param {Date|null} minimum - Optional inclusive minimum.
   * @param {Date|null} maximum - Optional inclusive maximum.
   * @returns {Date} Clamped copy.
   */
  function dateTimeControlClampDate(value, minimum = null, maximum = null) {
    let time = value.getTime();
    if (!Number.isFinite(time)) throw new Error('Invalid date/time control value.');
    if (minimum && time < minimum.getTime()) time = minimum.getTime();
    if (maximum && time > maximum.getTime()) time = maximum.getTime();
    const result = new Date(time);
    result.setMilliseconds(0);
    return result;
  }

  /**
   * Returns the number of days in one local calendar month.
   *
   * @param {number} year - Full local year.
   * @param {number} monthIndex - Zero-based local month.
   * @returns {number} Number of days in the month.
   */
  function dateTimeControlDaysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  /**
   * Adjusts one local date/time field while carrying into surrounding fields.
   *
   * Month/year changes preserve the day when possible and clamp it to the last
   * valid day otherwise (for example Jan 31 -> Feb 28/29). Day/hour/minute/second
   * use native Date rollover so neighbouring fields advance or retreat naturally.
   *
   * @param {Date} value - Current local date/time.
   * @param {'year'|'month'|'day'|'hour'|'minute'|'second'} field - Field to adjust.
   * @param {number} delta - Signed integer increment.
   * @returns {Date} Adjusted copy.
   */
  function dateTimeControlAdjustDate(value, field, delta) {
    const next = new Date(value.getTime());
    next.setMilliseconds(0);
    if (!Number.isInteger(delta) || delta === 0) return next;
    if (field === 'year') {
      const day = next.getDate();
      next.setDate(1);
      next.setFullYear(next.getFullYear() + delta);
      next.setDate(Math.min(day, dateTimeControlDaysInMonth(
        next.getFullYear(), next.getMonth()
      )));
      return next;
    }
    if (field === 'month') {
      const day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + delta);
      next.setDate(Math.min(day, dateTimeControlDaysInMonth(
        next.getFullYear(), next.getMonth()
      )));
      return next;
    }
    if (field === 'day') next.setDate(next.getDate() + delta);
    else if (field === 'hour') next.setHours(next.getHours() + delta);
    else if (field === 'minute') next.setMinutes(next.getMinutes() + delta);
    else if (field === 'second') next.setSeconds(next.getSeconds() + delta);
    else throw new Error(`Unknown date/time field: ${field}`);
    return next;
  }

  /**
   * Installs reusable date/time spinner and range-dialog styling.
   *
   * @returns {void} No value is returned.
   */
  function injectSingleDateTimeControlStyles() {
    const styleId = `${PANEL_ID}-date-time-style`;
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .tm-date-time-control{display:inline-flex;align-items:center;gap:2px;white-space:nowrap;font:13px/1.2 system-ui,sans-serif}
      .tm-date-time-field{display:grid;grid-template-rows:18px 28px 18px;align-items:center;justify-items:center}
      .tm-date-time-step{width:100%;height:18px;padding:0!important;border:0!important;border-radius:4px!important;background:transparent!important;color:#ddd!important;line-height:16px!important;cursor:pointer}
      .tm-date-time-step:hover{background:#3a3a3a!important}
      .tm-date-time-input{box-sizing:border-box;height:28px;padding:3px 4px;border:1px solid #666;border-radius:5px;background:#181818;color:#fff;text-align:center;font:13px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}
      .tm-date-time-input[data-date-time-field="year"]{width:5.2ch}
      .tm-date-time-input:not([data-date-time-field="year"]){width:3.2ch}
      .tm-date-time-separator{align-self:center;color:#bbb;margin:0 1px}
      .tm-date-range-overlay{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;box-sizing:border-box;background:rgba(0,0,0,.62)}
      .tm-date-range-dialog{max-width:calc(100vw - 32px);padding:16px;border:1px solid #666;border-radius:12px;background:#202020;color:#f2f2f2;box-shadow:0 10px 40px rgba(0,0,0,.5);font:13px/1.35 system-ui,sans-serif}
      .tm-date-range-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .tm-date-range-label{font-weight:600}
      .tm-date-range-actions{display:flex;gap:8px;margin-left:auto}
      .tm-date-range-actions button{border:1px solid #666;border-radius:8px;background:#292929;color:#fff;padding:8px 12px;font:inherit;cursor:pointer}
      .tm-date-range-actions button:disabled{opacity:.45;cursor:not-allowed}
      .tm-date-range-error{min-height:1.35em;margin-top:8px;color:#ffb4b4}
    `;
    (document.head || document.documentElement)?.append(style);
  }

  /**
   * Creates one reusable local-time date/time spinner control.
   *
   * The control exposes year/month/day hour:minute:second text fields with
   * increment/decrement buttons above and below every field. Stepping uses local
   * Date arithmetic so carries/borrows update surrounding fields correctly.
   *
   * @param {Object} options - Control configuration.
   * @param {string} options.label - Accessible control label.
   * @param {Date} options.value - Initial local date/time.
   * @param {Date|null} [options.minimum] - Optional inclusive minimum.
   * @param {Date|null} [options.maximum] - Optional inclusive maximum.
   * @param {Function|null} [options.onChange] - Optional changed callback.
   * @returns {Object} Element and date/bounds accessors.
   */
  function createSingleDateTimeControl({
    label,
    value,
    minimum = null,
    maximum = null,
    onChange = null
  }) {
    injectSingleDateTimeControlStyles();
    const root = document.createElement('div');
    root.className = 'tm-date-time-control';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', label);
    root.innerHTML = `
      <span class="tm-date-time-field"><button class="tm-date-time-step" type="button" data-date-time-step="up" data-date-time-target="year" aria-label="Increment year">▲</button><input class="tm-date-time-input" data-date-time-field="year" inputmode="numeric" maxlength="4" aria-label="Year"><button class="tm-date-time-step" type="button" data-date-time-step="down" data-date-time-target="year" aria-label="Decrement year">▼</button></span><span class="tm-date-time-separator">/</span>
      <span class="tm-date-time-field"><button class="tm-date-time-step" type="button" data-date-time-step="up" data-date-time-target="month" aria-label="Increment month">▲</button><input class="tm-date-time-input" data-date-time-field="month" inputmode="numeric" maxlength="2" aria-label="Month"><button class="tm-date-time-step" type="button" data-date-time-step="down" data-date-time-target="month" aria-label="Decrement month">▼</button></span><span class="tm-date-time-separator">/</span>
      <span class="tm-date-time-field"><button class="tm-date-time-step" type="button" data-date-time-step="up" data-date-time-target="day" aria-label="Increment day">▲</button><input class="tm-date-time-input" data-date-time-field="day" inputmode="numeric" maxlength="2" aria-label="Day"><button class="tm-date-time-step" type="button" data-date-time-step="down" data-date-time-target="day" aria-label="Decrement day">▼</button></span><span class="tm-date-time-separator">&nbsp;</span>
      <span class="tm-date-time-field"><button class="tm-date-time-step" type="button" data-date-time-step="up" data-date-time-target="hour" aria-label="Increment hour">▲</button><input class="tm-date-time-input" data-date-time-field="hour" inputmode="numeric" maxlength="2" aria-label="Hour"><button class="tm-date-time-step" type="button" data-date-time-step="down" data-date-time-target="hour" aria-label="Decrement hour">▼</button></span><span class="tm-date-time-separator">:</span>
      <span class="tm-date-time-field"><button class="tm-date-time-step" type="button" data-date-time-step="up" data-date-time-target="minute" aria-label="Increment minute">▲</button><input class="tm-date-time-input" data-date-time-field="minute" inputmode="numeric" maxlength="2" aria-label="Minute"><button class="tm-date-time-step" type="button" data-date-time-step="down" data-date-time-target="minute" aria-label="Decrement minute">▼</button></span><span class="tm-date-time-separator">:</span>
      <span class="tm-date-time-field"><button class="tm-date-time-step" type="button" data-date-time-step="up" data-date-time-target="second" aria-label="Increment second">▲</button><input class="tm-date-time-input" data-date-time-field="second" inputmode="numeric" maxlength="2" aria-label="Second"><button class="tm-date-time-step" type="button" data-date-time-step="down" data-date-time-target="second" aria-label="Decrement second">▼</button></span>
    `;

    let minDate = minimum ? new Date(minimum.getTime()) : null;
    let maxDate = maximum ? new Date(maximum.getTime()) : null;
    let current = dateTimeControlClampDate(value, minDate, maxDate);
    const fields = Object.fromEntries(
      Array.from(root.querySelectorAll('[data-date-time-field]')).map(input => [
        input.getAttribute('data-date-time-field'), input
      ])
    );
    const pad2 = number => String(number).padStart(2, '0');

    const render = () => {
      fields.year.value = String(current.getFullYear()).padStart(4, '0');
      fields.month.value = pad2(current.getMonth() + 1);
      fields.day.value = pad2(current.getDate());
      fields.hour.value = pad2(current.getHours());
      fields.minute.value = pad2(current.getMinutes());
      fields.second.value = pad2(current.getSeconds());
    };

    const notify = () => {
      render();
      if (typeof onChange === 'function') onChange(new Date(current.getTime()));
    };

    const commitText = () => {
      const year = Number.parseInt(fields.year.value, 10);
      const month = Number.parseInt(fields.month.value, 10);
      const day = Number.parseInt(fields.day.value, 10);
      const hour = Number.parseInt(fields.hour.value, 10);
      const minute = Number.parseInt(fields.minute.value, 10);
      const second = Number.parseInt(fields.second.value, 10);
      if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
        render();
        return;
      }
      const safeMonth = Math.min(12, Math.max(1, month));
      const safeDay = Math.min(
        dateTimeControlDaysInMonth(year, safeMonth - 1),
        Math.max(1, day)
      );
      const candidate = new Date(
        year,
        safeMonth - 1,
        safeDay,
        Math.min(23, Math.max(0, hour)),
        Math.min(59, Math.max(0, minute)),
        Math.min(59, Math.max(0, second)),
        0
      );
      current = dateTimeControlClampDate(candidate, minDate, maxDate);
      notify();
    };

    root.addEventListener('click', event => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-date-time-step]')
        : null;
      if (!(button instanceof HTMLButtonElement) || !root.contains(button)) return;
      const field = button.getAttribute('data-date-time-target');
      const delta = button.getAttribute('data-date-time-step') === 'up' ? 1 : -1;
      current = dateTimeControlClampDate(
        dateTimeControlAdjustDate(current, field, delta),
        minDate,
        maxDate
      );
      notify();
    });

    root.addEventListener('change', event => {
      if (event.target instanceof HTMLInputElement
          && event.target.matches('[data-date-time-field]')) {
        commitText();
      }
    });
    root.addEventListener('keydown', event => {
      if (!(event.target instanceof HTMLInputElement)
          || !event.target.matches('[data-date-time-field]')) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        commitText();
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const field = event.target.getAttribute('data-date-time-field');
      const delta = event.key === 'ArrowUp' ? 1 : -1;
      current = dateTimeControlClampDate(
        dateTimeControlAdjustDate(current, field, delta),
        minDate,
        maxDate
      );
      notify();
    });

    render();
    return {
      element: root,
      getDate: () => new Date(current.getTime()),
      setDate(next) {
        current = dateTimeControlClampDate(next, minDate, maxDate);
        notify();
      },
      setBounds(nextMinimum, nextMaximum) {
        minDate = nextMinimum ? new Date(nextMinimum.getTime()) : null;
        maxDate = nextMaximum ? new Date(nextMaximum.getTime()) : null;
        current = dateTimeControlClampDate(current, minDate, maxDate);
        notify();
      },
      focus() {
        fields.year.focus();
        fields.year.select();
      }
    };
  }
