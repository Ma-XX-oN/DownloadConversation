  /**
   * Returns the number of days in one local calendar month.
   *
   * @param {number} year - Full local year.
   * @param {number} monthIndex - Zero-based local month index.
   * @returns {number} Number of local calendar days in the month.
   */
  function localDateTimeDaysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  /**
   * Adjusts one local date/time field with normal carry/borrow semantics.
   *
   * Year/month adjustments preserve the local day where possible and clamp it
   * to the final day of the destination month. Smaller fields use the native
   * local Date setters so seconds/minutes/hours/days carry or borrow through
   * surrounding fields naturally.
   *
   * @param {Date} source - Current local date/time value.
   * @param {'year'|'month'|'day'|'hour'|'minute'|'second'} field - Field to step.
   * @param {number} delta - Signed whole-field increment.
   * @returns {Date} New adjusted Date without mutating source.
   */
  function localDateTimeAdjust(source, field, delta) {
    const date = new Date(source.getTime());
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid local date/time value.');
    if (!Number.isInteger(delta)) throw new Error('Date/time step must be an integer.');
    if (delta === 0) return date;

    if (field === 'year' || field === 'month') {
      const originalDay = date.getDate();
      const targetYear = field === 'year'
        ? date.getFullYear() + delta
        : date.getFullYear();
      const targetMonth = field === 'month'
        ? date.getMonth() + delta
        : date.getMonth();
      date.setDate(1);
      if (field === 'year') date.setFullYear(targetYear);
      else date.setMonth(targetMonth);
      date.setDate(Math.min(
        originalDay,
        localDateTimeDaysInMonth(date.getFullYear(), date.getMonth())
      ));
      return date;
    }

    if (field === 'day') date.setDate(date.getDate() + delta);
    else if (field === 'hour') date.setHours(date.getHours() + delta);
    else if (field === 'minute') date.setMinutes(date.getMinutes() + delta);
    else if (field === 'second') date.setSeconds(date.getSeconds() + delta);
    else throw new Error(`Unsupported local date/time field: ${field}`);
    return date;
  }

  /**
   * Installs reusable local date/time-control styling once.
   *
   * @returns {void} No value is returned.
   */
  function localDateTimeControlInjectStyles() {
    const styleId = 'tm-local-datetime-control-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .tm-local-datetime{display:inline-grid;grid-template-columns:4.8ch auto 2.8ch auto 2.8ch .7ch 2.8ch auto 2.8ch auto 2.8ch;grid-template-rows:18px 30px 18px;align-items:center;gap:0 2px;font-variant-numeric:tabular-nums}
      .tm-local-datetime-field{display:grid;grid-template-rows:18px 30px 18px;align-items:center;justify-items:stretch}
      .tm-local-datetime-field button{height:18px!important;min-height:18px!important;padding:0!important;border:0!important;border-radius:4px!important;line-height:15px!important;font-size:11px!important}
      .tm-local-datetime-field input{width:100%;height:28px;box-sizing:border-box;padding:2px 1px;border:1px solid #666;border-radius:4px;background:#181818;color:#fff;text-align:center;font:inherit;font-variant-numeric:tabular-nums}
      .tm-local-datetime-separator{grid-row:2;align-self:center;text-align:center;color:#ddd}
    `;
    (document.head || document.documentElement)?.append(style);
  }

  /**
   * Creates one reusable local date/time editor.
   *
   * The control owns six text fields and one increment/decrement pair per field.
   * Its value is always represented as a local Date and returned as an independent
   * Date object so callers may compose one or more controls without shared state.
   *
   * @param {Date|string|number} initialValue - Initial local date/time value.
   * @param {Object} options - Optional control configuration.
   * @param {string} options.label - Accessible label prefix.
   * @returns {Object} Control element plus getDate/setDate methods.
   */
  function localDateTimeControlCreate(initialValue, options = {}) {
    localDateTimeControlInjectStyles();
    let current = new Date(initialValue);
    if (!Number.isFinite(current.getTime())) throw new Error('Invalid initial local date/time.');
    current.setMilliseconds(0);

    const root = document.createElement('div');
    root.className = 'tm-local-datetime';
    const label = options.label || 'Date/time';
    const definitions = [
      ['year', 'yyyy', 4],
      ['month', 'MM', 2],
      ['day', 'dd', 2],
      ['hour', 'hh', 2],
      ['minute', 'mm', 2],
      ['second', 'ss', 2]
    ];
    const inputs = new Map();

    /**
     * Returns one display field from the current local Date.
     *
     * @param {string} field - Field name.
     * @returns {number} Local field value.
     */
    const fieldValue = field => {
      if (field === 'year') return current.getFullYear();
      if (field === 'month') return current.getMonth() + 1;
      if (field === 'day') return current.getDate();
      if (field === 'hour') return current.getHours();
      if (field === 'minute') return current.getMinutes();
      return current.getSeconds();
    };

    /** Renders all six text fields from current. */
    const render = () => {
      for (const [field, _placeholder, width] of definitions) {
        const input = inputs.get(field);
        if (!input) continue;
        input.value = String(fieldValue(field)).padStart(width, '0');
      }
    };

    /**
     * Applies one typed field value while preserving valid surrounding fields.
     *
     * @param {string} field - Field being edited.
     * @param {string} text - User-entered field text.
     * @returns {void} No value is returned.
     */
    const commitField = (field, text) => {
      const numeric = Number(text);
      if (!Number.isInteger(numeric)) {
        render();
        return;
      }
      const date = new Date(current.getTime());
      if (field === 'year') {
        const day = date.getDate();
        date.setDate(1);
        date.setFullYear(numeric);
        date.setDate(Math.min(day, localDateTimeDaysInMonth(date.getFullYear(), date.getMonth())));
      } else if (field === 'month' && numeric >= 1 && numeric <= 12) {
        const day = date.getDate();
        date.setDate(1);
        date.setMonth(numeric - 1);
        date.setDate(Math.min(day, localDateTimeDaysInMonth(date.getFullYear(), date.getMonth())));
      } else if (field === 'day'
          && numeric >= 1
          && numeric <= localDateTimeDaysInMonth(date.getFullYear(), date.getMonth())) {
        date.setDate(numeric);
      } else if (field === 'hour' && numeric >= 0 && numeric <= 23) {
        date.setHours(numeric);
      } else if (field === 'minute' && numeric >= 0 && numeric <= 59) {
        date.setMinutes(numeric);
      } else if (field === 'second' && numeric >= 0 && numeric <= 59) {
        date.setSeconds(numeric);
      } else if (field !== 'year') {
        render();
        return;
      }
      if (!Number.isFinite(date.getTime())) {
        render();
        return;
      }
      date.setMilliseconds(0);
      current = date;
      render();
    };

    definitions.forEach(([field, placeholder, width], index) => {
      if (index === 3) {
        const separator = document.createElement('span');
        separator.className = 'tm-local-datetime-separator';
        separator.textContent = ' ';
        root.append(separator);
      }
      const wrapper = document.createElement('span');
      wrapper.className = 'tm-local-datetime-field';
      wrapper.dataset.datetimeField = field;
      const up = document.createElement('button');
      up.type = 'button';
      up.dataset.datetimeStep = 'up';
      up.textContent = '▲';
      up.setAttribute('aria-label', `${label}: increment ${field}`);
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.placeholder = placeholder;
      input.maxLength = width;
      input.setAttribute('aria-label', `${label}: ${field}`);
      const down = document.createElement('button');
      down.type = 'button';
      down.dataset.datetimeStep = 'down';
      down.textContent = '▼';
      down.setAttribute('aria-label', `${label}: decrement ${field}`);
      up.addEventListener('click', () => {
        current = localDateTimeAdjust(current, field, 1);
        current.setMilliseconds(0);
        render();
      });
      down.addEventListener('click', () => {
        current = localDateTimeAdjust(current, field, -1);
        current.setMilliseconds(0);
        render();
      });
      input.addEventListener('change', () => commitField(field, input.value));
      input.addEventListener('blur', () => commitField(field, input.value));
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          commitField(field, input.value);
          input.select();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          current = localDateTimeAdjust(current, field, event.key === 'ArrowUp' ? 1 : -1);
          current.setMilliseconds(0);
          render();
          input.select();
        }
      });
      wrapper.append(up, input, down);
      root.append(wrapper);
      inputs.set(field, input);

      if (index === 0 || index === 1) {
        const separator = document.createElement('span');
        separator.className = 'tm-local-datetime-separator';
        separator.textContent = '/';
        root.append(separator);
      } else if (index === 3 || index === 4) {
        const separator = document.createElement('span');
        separator.className = 'tm-local-datetime-separator';
        separator.textContent = ':';
        root.append(separator);
      }
    });
    render();

    return {
      element: root,
      getDate() { return new Date(current.getTime()); },
      setDate(value) {
        const next = new Date(value);
        if (!Number.isFinite(next.getTime())) throw new Error('Invalid local date/time value.');
        next.setMilliseconds(0);
        current = next;
        render();
      }
    };
  }
