  /**
   * Same-realm, same-origin shared CSC preferences for registered plugins.
   * IndexedDB is authoritative. BroadcastChannel is invalidation only.
   * No GM grants, localStorage fallback, key bytes or page postMessage.
   * @returns {Object} Asynchronous durable store and tab notifications.
   */
  function cscControlSharedStore() {
    const dbName = 'dc-csc-shared-controls-v1';
    const table = 'preferences';
    const key = 'dc-csc-capture-options-v1';
    let opened = null;
    let closed = false;
    const owner = Array.from(crypto.getRandomValues(new Uint8Array(16)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    const channel = typeof BroadcastChannel === 'function'
      ? new BroadcastChannel('dc-csc-settings-v1') : null;
    const subscribers = new Set();
    /**
     * Inform controls that the durable value changed.
     * @returns {void} Finish notifying local listeners.
     */
    const notify = () => {
      for (const subscriber of subscribers) subscriber();
    };
    if (channel) {
      channel.onmessage = event => {
        const msg = event?.data;
        if (msg?.type === 'settings-committed-v1' &&
            msg.key === key && msg.owner !== owner) notify();
      };
    }

    /**
     * Open the single native same-origin database connection.
     * @returns {Promise<IDBDatabase>} Resolve the reusable IndexedDB connection.
     */
    const connect = () => {
      if (closed) return Promise.reject(Error('csc-settings-store-closed'));
      if (typeof indexedDB === 'undefined' ||
          typeof indexedDB.open !== 'function') {
        return Promise.reject(Error('csc-settings-indexeddb-unavailable'));
      }
      if (opened) return opened;
      opened = new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(table)) {
            request.result.createObjectStore(table);
          }
        };
        request.onerror = () => reject(
          request.error || Error('csc-settings-open-failed'));
        request.onblocked = () => reject(Error('csc-settings-open-blocked'));
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => database.close();
          resolve(database);
        };
      }).catch(error => {
        opened = null;
        throw error;
      });
      return opened;
    };
    /**
     * Read the latest committed shared settings.
     * @returns {Promise<Object|null>} Resolve saved options or null if uninitialized.
     */
    const read = async () => {
      const database = await connect();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(table, 'readonly');
        const request = transaction.objectStore(table).get(key);
        let value;
        request.onsuccess = () => { value = request.result ?? null; };
        transaction.oncomplete = () => resolve(value);
        transaction.onabort = () => reject(
          transaction.error || Error('csc-settings-read-aborted'));
        transaction.onerror = () => reject(
          transaction.error || Error('csc-settings-read-failed'));
      });
    };
    /**
     * Commit a complete scope before notifying other tabs.
     * @param {Object} value - Versioned nonsecret capture policy to persist
     * @returns {Promise<void>} Resolve after the durable transaction completes.
     */
    const write = async value => {
      if (closed) throw Error('csc-settings-store-closed');
      const database = await connect();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(table, 'readwrite');
        transaction.objectStore(table).put(value, key);
        transaction.oncomplete = () => {
          try {
            channel?.postMessage({
              type: 'settings-committed-v1', key, owner
            });
          } catch {
            // Already durable: peers reread IndexedDB on focus/visibility.
            // Failed notification must not strand this committed write.
          }
          resolve();
        };
        transaction.onabort = () => reject(
          transaction.error || Error('csc-settings-write-aborted'));
        transaction.onerror = () => reject(
          transaction.error || Error('csc-settings-write-failed'));
      });
    };
    /**
     * Register cross-tab and foreground reconciliation.
     * @param {Function} callback - Reconciliation listener after invalidation
     * @returns {Function} Return a listener cleanup callback.
     */
    const subscribe = callback => {
      if (closed) throw Error('csc-settings-store-closed');
      subscribers.add(callback);
      /**
       * Refresh state after the document becomes visible.
       * @returns {void} Invoke the listener only when the tab is visible.
       */
      const visible = () => {
        if (document.visibilityState === 'visible') callback();
      };
      /**
       * Refresh state after the tab regains focus.
       * @returns {void} Invoke the listener for foreground reconciliation.
       */
      const focus = () => callback();
      document.addEventListener('visibilitychange', visible);
      window.addEventListener('focus', focus);
      return () => {
        subscribers.delete(callback);
        document.removeEventListener('visibilitychange', visible);
        window.removeEventListener('focus', focus);
      };
    };
    /**
     * Close the store and notification listeners.
     * @returns {void} Release notification and database resources.
     */
    const dispose = () => {
      closed = true;
      subscribers.clear();
      channel?.close();
      if (opened) void opened.then(database => database.close(),
        () => undefined);
    };
    return Object.freeze({ read, write, subscribe, dispose });
  }
