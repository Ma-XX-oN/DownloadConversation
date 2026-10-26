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
    /** Inform live controls that the authoritative durable value changed. */
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

    /** Open exactly one native same-origin settings database connection. */
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
    /** Read the committed current scope without a storage fallback. */
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
    /** Commit a full versioned scope and then broadcast invalidation. */
    const write = async value => {
      if (closed) throw Error('csc-settings-store-closed');
      const database = await connect();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(table, 'readwrite');
        transaction.objectStore(table).put(value, key);
        transaction.oncomplete = () => {
          channel?.postMessage({
            type: 'settings-committed-v1', key, owner
          });
          resolve();
        };
        transaction.onabort = () => reject(
          transaction.error || Error('csc-settings-write-aborted'));
        transaction.onerror = () => reject(
          transaction.error || Error('csc-settings-write-failed'));
      });
    };
    /** Subscribe to remote invalidation and foreground reconciliation. */
    const subscribe = callback => {
      if (closed) throw Error('csc-settings-store-closed');
      subscribers.add(callback);
      /** Reconcile delayed notifications on document visibility. */
      const visible = () => {
        if (document.visibilityState === 'visible') callback();
      };
      /** Reconcile delayed notifications after the tab regains focus. */
      const focus = () => callback();
      document.addEventListener('visibilitychange', visible);
      window.addEventListener('focus', focus);
      return () => {
        subscribers.delete(callback);
        document.removeEventListener('visibilitychange', visible);
        window.removeEventListener('focus', focus);
      };
    };
    /** Close notifications and release native database handles. */
    const dispose = () => {
      closed = true;
      subscribers.clear();
      channel?.close();
      if (opened) void opened.then(database => database.close(),
        () => undefined);
    };
    return Object.freeze({ read, write, subscribe, dispose });
  }
