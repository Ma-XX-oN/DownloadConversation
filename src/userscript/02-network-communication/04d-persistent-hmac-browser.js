  /**
   * Build the production tab's lazy persistent key service.
   * Uses the verified atomic IndexedDB adapter and cross-tab lock.
   * @returns {Object} Lifecycle service with native same-origin coordination.
   */
  function communicationPersistentHmacCurrentTabService() {
    const pageNavigator = typeof navigator === 'undefined' ? null : navigator;
    const pageLocation = typeof location === 'undefined' ? null : location;
    const sharedStorage = communicationPersistentHmacIndexedDbStorage(
      typeof indexedDB === 'undefined' ? null : indexedDB, pageLocation);
    const service = communicationPersistentHmacService({
      storage: sharedStorage,
      authority: communicationPersistentHmacIndexedDbAuthority(
        pageNavigator, pageLocation, sharedStorage),
      crypto: typeof crypto === 'undefined' ? null : crypto
    });
    if (!sharedStorage || typeof setTimeout !== 'function') return service;
    let stopped = false;
    let timer = null;
    /**
     * Check on startup and while this tab stays alive. Timers can be
     * throttled; admission always rechecks the atomic expiry itself.
     * @returns {Promise<void>} A checked and rescheduled expiry poll.
     */
    async function checkExpiry() {
      let nextDelay = 60000;
      try {
        const state = await service.status();
        if (Number.isSafeInteger(state.expires_at_ms)) {
          nextDelay = Math.max(1000, Math.min(60000,
            state.expires_at_ms - Date.now()));
        }
      } catch {
        // Admission/status still reject storage errors; retry this poll.
      } finally {
        if (!stopped) timer = setTimeout(checkExpiry, nextDelay);
      }
    }
    timer = setTimeout(checkExpiry, 0);
    return Object.freeze({ ...service,
      dispose() {
        stopped = true;
        clearTimeout(timer);
        service.dispose();
      }
    });
  }
