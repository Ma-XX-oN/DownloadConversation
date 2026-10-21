  /**
   * @param {Object} item - Stored record.
   * @returns {Object} Validated record.
   */
  function communicationPersistentHmacValidated(item) {
    const hourMs = 60 * 60 * 1000;
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        item.format !== 'dc-secret-key-record/2' ||
        !/^[a-f0-9]{64}$/.test(item.key_hex ?? '') ||
        !/^[a-f0-9]{32}$/.test(item.generation ?? '') ||
        !Number.isSafeInteger(item.epoch) || item.epoch < 1 ||
        !['open', 'draining'].includes(item.phase) ||
        !Array.isArray(item.pending) || item.pending.length > 256 ||
        item.pending.some(token => !/^[a-f0-9]{32}$/.test(token)) ||
        new Set(item.pending).size !== item.pending.length ||
        !Number.isSafeInteger(item.issued_at_ms) ||
        !Number.isSafeInteger(item.expires_at_ms) ||
        item.expires_at_ms - item.issued_at_ms < 23 * hourMs ||
        item.expires_at_ms - item.issued_at_ms > 25 * hourMs ||
        !Array.isArray(item.cycle_events) ||
        !item.cycle_events.length ||
        item.cycle_events.some((event, i) =>
          !event || event.type !== 'hmac-key-cycle' ||
          !/^[a-f0-9]{32}$/.test(event.generation ?? '') ||
          !Number.isSafeInteger(event.epoch) || event.epoch !== i + 1 ||
          event.id !== 'hmac-key-cycle:' + event.epoch + ':' +
            event.generation ||
          !Number.isSafeInteger(event.occurred_at_ms) ||
          !['initial', 'manual', 'scheduled', 'overdue'].includes(
            event.reason)) ||
        item.cycle_events.at(-1).generation !== item.generation ||
        item.cycle_events.at(-1).epoch !== item.epoch ||
        item.cycle_events.at(-1).occurred_at_ms !== item.issued_at_ms) {
      throw new Error('persistent-key-storage-corrupt');
    }
    if (item.phase === 'open' && item.next !== null) {
      throw new Error('persistent-key-storage-corrupt');
    }
    if (item.phase === 'draining' && (!item.next ||
        !/^[a-f0-9]{64}$/.test(item.next.key_hex ?? '') ||
        !/^[a-f0-9]{32}$/.test(item.next.generation ?? '') ||
        item.next.generation === item.generation ||
        item.next.key_hex === item.key_hex ||
        !Number.isSafeInteger(item.next.epoch) ||
        item.next.epoch !== item.epoch + 1 ||
        !['manual', 'scheduled', 'overdue'].includes(item.next.reason))) {
      throw new Error('persistent-key-storage-corrupt');
    }
    return item;
  }

