  /**
   * Validate the non-migrating, timestamp-scoped HMAC key record.
   * @param {Object} item - Stored record.
   * @returns {Object} Validated record.
   */
  function communicationPersistentHmacValidated(item) {
    const hourMs = 60 * 60 * 1000;
    /**
     * @param {number} value - Candidate epoch milliseconds.
     * @returns {boolean} Safe UTC time within the JavaScript Date range.
     */
    const validTime = value => Number.isSafeInteger(value) &&
      value >= 0 && value <= 8640000000000000;
    /**
     * @param {Object} event - Committed nonsecret key lifecycle event.
     * @returns {boolean} Event timestamp equals its canonical UTC string.
     */
    const eventTime = event => validTime(event.occurred_at_ms) &&
      event.key_restart === new Date(event.occurred_at_ms).toISOString();
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        item.format !== 'dc-secret-key-record/3' ||
        'generation' in item ||
        !/^[a-f0-9]{64}$/.test(item.key_hex ?? '') ||
        !Number.isSafeInteger(item.epoch) || item.epoch < 1 ||
        !['open', 'draining'].includes(item.phase) ||
        !Array.isArray(item.pending) || item.pending.length > 256 ||
        item.pending.some(token => !/^[a-f0-9]{32}$/.test(token)) ||
        new Set(item.pending).size !== item.pending.length ||
        !validTime(item.issued_at_ms) ||
        !validTime(item.expires_at_ms) ||
        item.expires_at_ms - item.issued_at_ms < 23 * hourMs ||
        item.expires_at_ms - item.issued_at_ms > 25 * hourMs ||
        !Array.isArray(item.cycle_events) ||
        item.cycle_events.length !== item.epoch ||
        item.cycle_events.some((event, i) =>
          !event || event.type !== 'hmac-key-cycle' ||
          !eventTime(event) ||
          event.id !== 'hmac-key-cycle:' + event.key_restart ||
          event.epoch !== i + 1 ||
          (i > 0 && event.occurred_at_ms <=
            item.cycle_events[i - 1].occurred_at_ms) ||
          !['initial', 'manual', 'scheduled', 'overdue'].includes(
            event.reason) ||
          (i === 0 && event.reason !== 'initial')) ||
        item.cycle_events.at(-1).epoch !== item.epoch ||
        item.cycle_events.at(-1).occurred_at_ms !== item.issued_at_ms) {
      throw new Error('persistent-key-storage-corrupt');
    }
    if (item.phase === 'open' && item.next !== null) {
      throw new Error('persistent-key-storage-corrupt');
    }
    if (item.phase === 'draining' && (!item.next ||
        'generation' in item.next ||
        !/^[a-f0-9]{64}$/.test(item.next.key_hex ?? '') ||
        item.next.key_hex === item.key_hex ||
        !Number.isSafeInteger(item.next.epoch) ||
        item.next.epoch !== item.epoch + 1 ||
        !['manual', 'scheduled', 'overdue'].includes(item.next.reason))) {
      throw new Error('persistent-key-storage-corrupt');
    }
    return item;
  }
