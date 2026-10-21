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
    return communicationPersistentHmacService({
      storage: sharedStorage,
      authority: communicationPersistentHmacIndexedDbAuthority(
        pageNavigator, pageLocation, sharedStorage),
      crypto: typeof crypto === 'undefined' ? null : crypto
    });
  }
