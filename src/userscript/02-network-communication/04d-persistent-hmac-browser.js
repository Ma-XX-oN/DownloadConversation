  /**
   * Expose only the Tampermonkey script-installation storage interface.
   * A shared storage adapter is NOT an exclusive transaction authority.
   * @returns {Object|null} Storage adapter or null when GM is unavailable.
   */
  function communicationPersistentHmacTampermonkeyStorage() {
    if (typeof GM === 'undefined' || typeof GM.getValue !== 'function' ||
        typeof GM.setValue !== 'function') return null;
    return Object.freeze({
      get(name, fallback) { return GM.getValue(name, fallback); },
      set(name, value) { return GM.setValue(name, value); }
    });
  }

  /**
   * Coordinate one HTTPS origin with native exclusive Web Locks.
   * Only the lock is provided here; IndexedDB authority is separate.
   * @param {Object} browserNavigator - Current tab's navigator.
   * @param {Object} browserLocation - Current tab's location.
   * @returns {Object|null} Same-origin serializing authority or unavailable.
   */
  function communicationPersistentHmacChatgptAuthority(
    browserNavigator, browserLocation) {
    const origin = 'https://chatgpt.com';
    if (browserLocation?.origin !== origin ||
        typeof browserNavigator?.locks?.request !== 'function') return null;
    const name = 'downloadconversation:secret-marker-key-v2:all-tabs';
    return Object.freeze({
      capability: 'exclusive-chatgpt-web-lock-only-v1',
      async runExclusive(callback) {
        if (browserLocation.origin !== origin ||
            typeof callback !== 'function') {
          throw new Error('persistent-key-origin-or-callback-invalid');
        }
        return browserNavigator.locks.request(name, { mode: 'exclusive' },
          async lock => {
            if (!lock || lock.mode !== 'exclusive') {
              throw new Error('persistent-key-web-lock-not-acquired');
            }
            return callback();
          });
      }
    });
  }

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
