  /**
   * Store one complete HMAC record in origin-scoped IndexedDB.
   * Web Locks serialize service operations across participating tabs;
   * readwrite transactions commit each record atomically.
   * Page scripts on this origin can access the stored key (approved risk).
   * @param {IDBFactory|null} api - Browser IndexedDB factory.
   * @param {Location|null} pageLocation - Current page origin.
   * @returns {Object|null} Promise-based record storage adapter.
   */
  function communicationPersistentHmacIndexedDbStorage(api, pageLocation) {
    if (pageLocation?.origin !== 'https://chatgpt.com' ||
        !api || typeof api.open !== 'function') return null;
    const databaseName = 'downloadconversation-persistent-hmac-v2';
    const objectStoreName = 'records';

    /**
     * @returns {Promise<IDBDatabase>} Opened database.
     */
    function openDatabase() {
      return new Promise((resolve, reject) => {
        let request;
        let failed = false;
        try { request = api.open(databaseName, 1); }
        catch (error) { reject(error); return; }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(objectStoreName)) {
            db.createObjectStore(objectStoreName);
          }
        };
        request.onerror = () => {
          failed = true;
          reject(request.error || Error('persistent-key-indexeddb-open-failed'));
        };
        request.onblocked = () => {
          failed = true;
          reject(Error('persistent-key-indexeddb-open-blocked'));
        };
        request.onsuccess = () => {
          const db = request.result;
          if (failed) { db.close(); return; }
          db.onversionchange = () => db.close();
          resolve(db);
        };
      });
    }

    /**
     * @param {'readonly'|'readwrite'} mode - Transaction mode.
     * @param {string} name - Record identifier.
     * @param {Object|undefined} value - Value for a write.
     * @returns {Promise<Object|undefined>} Committed transaction result.
     */
    async function transact(mode, name, value) {
      const db = await openDatabase();
      try {
        return await new Promise((resolve, reject) => {
          let tx;
          try { tx = db.transaction(objectStoreName, mode); }
          catch (error) { reject(error); return; }
          let result;
          tx.oncomplete = () => resolve(result);
          tx.onabort = () => reject(tx.error ||
            Error('persistent-key-indexeddb-transaction-aborted'));
          tx.onerror = () => reject(tx.error ||
            Error('persistent-key-indexeddb-transaction-failed'));
          try {
            const store = tx.objectStore(objectStoreName);
            const request = mode === 'readonly'
              ? store.get(name) : store.put(value, name);
            request.onsuccess = () => {
              if (mode === 'readonly') result = request.result;
            };
          } catch (error) {
            try { tx.abort(); } catch {}
            reject(error);
          }
        });
      } finally { db.close(); }
    }

    return Object.freeze({
      async get(name, fallback) {
        const value = await transact('readonly', name);
        return value === undefined ? fallback : value;
      },
      async set(name, value) {
        await transact('readwrite', name, value);
      }
    });
  }

  /**
   * Strong authority uses Web Locks plus the atomic IndexedDB record.
   * Only the installed same-origin browser can certify this combination.
   * @param {Navigator|null} pageNavigator - Browser Web Locks host.
   * @param {Location|null} pageLocation - Current origin.
   * @param {Object|null} storage - IndexedDB adapter.
   * @returns {Object|null} Verified-capability candidate.
   */
  function communicationPersistentHmacIndexedDbAuthority(
    pageNavigator, pageLocation, storage) {
    if (!storage || pageLocation?.origin !== 'https://chatgpt.com' ||
        typeof pageNavigator?.locks?.request !== 'function') return null;
    const lockName = 'downloadconversation:secret-marker-key-v2:all-tabs';
    return Object.freeze({
      capability: 'linearizable-chatgpt-key-record-v2',
      async runExclusive(callback) {
        if (pageLocation.origin !== 'https://chatgpt.com' ||
            typeof callback !== 'function') {
          throw Error('persistent-key-origin-or-callback-invalid');
        }
        return pageNavigator.locks.request(lockName, { mode: 'exclusive' },
          async lock => {
            if (lock?.mode !== 'exclusive') {
              throw Error('persistent-key-web-lock-not-acquired');
            }
            return callback();
          });
      }
    });
  }
