  // Catalogue URL is bound only after DC #333 publishes its stable asset path.
  let faviconCacheCatalogueUrl = null;
  // Each tab memoizes validated boundaries and resolved numeric versions.
  let faviconCacheCataloguePromise = null;
  const faviconCacheResolvedVersions = new Map();
  // One IndexedDB connection backs every dataset session in this origin.
  let faviconCacheDatabasePromise = null;
  // A single periodic timer opportunistically removes inactive stale datasets.
  let faviconCacheSweepTimer = null;
  const FAVICON_CACHE_DATABASE_NAME = 'dc-favicon-cache-v1';
  const FAVICON_CACHE_LOCK_PREFIX = 'dc-favicon-cache-v1:';

  /**
   * Emits bounded diagnostic details without failing the stock favicon.
   * @param {string} stage - Failed cache operation.
   * @param {unknown} error - Failure evidence without resource bytes.
   * @returns {void} No result.
   */
  function faviconCacheWarn(stage, error) {
    if (typeof logDiagnostic === 'function') {
      logDiagnostic('warnings', 'favicon-cache-unavailable', {
        stage, reason: String(error?.message ?? error).slice(0, 180)
      });
    }
  }

  /**
   * Checks required browser APIs before using the shared cache.
   * @returns {boolean} Whether durable storage and locks are available.
   */
  function faviconCacheSupported() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
      && typeof navigator?.locks?.request === 'function'
      && typeof crypto?.subtle?.digest === 'function'
      && typeof GM_xmlhttpRequest === 'function';
  }

  /**
   * Fetches one resource through the granted Tampermonkey binary transport.
   * @param {string} url - HTTPS raw GitHub resource URL.
   * @param {'text'|'arraybuffer'} type - Expected transport representation.
   * @returns {Promise<string|ArrayBuffer>} Complete resource response.
   */
  function faviconCacheFetch(url, type) {
    if (!/^https:\/\/raw\.githubusercontent\.com\/Ma-XX-oN\/DownloadConversation\//.test(url)) {
      return Promise.reject(Error('favicon-url-not-approved'));
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method: 'GET', url, responseType: type, timeout: 30000,
        onload(result) {
          if (result.status !== 200
            || (type === 'text' && typeof result.response !== 'string')
            || (type === 'arraybuffer' && !(result.response instanceof ArrayBuffer))) {
            reject(Error('favicon-http-or-response-type'));
          } else resolve(result.response);
        },
        onerror() { reject(Error('favicon-network')); },
        ontimeout() { reject(Error('favicon-timeout')); },
        onabort() { reject(Error('favicon-abort')); }
      });
    });
  }

  /**
   * Loads and validates the V1 catalogue exactly once per successful tab load.
   * @returns {Promise<Map<string, Object>>} Dataset descriptors by normalized boundary.
   */
  async function faviconCacheLoadCatalogue() {
    if (!faviconCacheCataloguePromise) {
      faviconCacheCataloguePromise = (async () => {
        if (!faviconCacheCatalogueUrl) throw Error('catalogue-not-published');
        const json = await faviconCacheFetch(faviconCacheCatalogueUrl, 'text');
        return faviconCacheParseCatalogue(json);
      })().catch(error => {
        faviconCacheCataloguePromise = null;
        throw error;
      });
    }
    return faviconCacheCataloguePromise;
  }

  /**
   * Resolves a DC version to the greatest compatible minimum boundary.
   * @param {string} version - Full running script version including ignored suffix.
   * @returns {Promise<string|null>} Normalized selected boundary or null.
   */
  async function get_compatible_version_key(version) {
    const numeric = faviconCacheTriplet(version);
    if (!numeric || !faviconCacheSupported()) return null;
    const numberKey = numeric.join('.');
    if (faviconCacheResolvedVersions.has(numberKey)) return faviconCacheResolvedVersions.get(numberKey);
    try {
      const entries = await faviconCacheLoadCatalogue();
      let selected = null;
      for (const entry of entries.values()) {
        if (faviconCacheCompare(entry.triplet, numeric) <= 0
          && (!selected || faviconCacheCompare(entry.triplet, selected.triplet) > 0)) selected = entry;
      }
      if (!selected) return null;
      faviconCacheResolvedVersions.set(numberKey, selected.version);
      return selected.version;
    } catch (error) {
      faviconCacheWarn('catalogue', error);
      return null;
    }
  }

  /**
   * Opens the schema-versioned per-origin cache database.
   * @returns {Promise<IDBDatabase>} Open IndexedDB connection.
   */
  function faviconCacheDatabase() {
    if (!faviconCacheDatabasePromise) {
      faviconCacheDatabasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(FAVICON_CACHE_DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('datasets')) {
            db.createObjectStore('datasets', { keyPath: 'version' });
          }
          if (!db.objectStoreNames.contains('pngs')) {
            const store = db.createObjectStore('pngs', {
              keyPath: ['version', 'variant_id', 'base_type', 'completion_time', 'pulse_index']
            });
            store.createIndex('by_version', 'version', { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || Error('indexeddb-open'));
        request.onblocked = () => reject(Error('indexeddb-blocked'));
      }).catch(error => {
        faviconCacheDatabasePromise = null;
        throw error;
      });
    }
    return faviconCacheDatabasePromise;
  }

  /**
   * Converts a completed IndexedDB request to a rejecting Promise.
   * @param {IDBRequest} request - IndexedDB request to observe.
   * @returns {Promise<unknown>} Requested IndexedDB value.
   */
  function faviconCacheRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error('indexeddb-request'));
    });
  }

  /**
   * Waits for an IndexedDB transaction's commit, abort or error.
   * @param {IDBTransaction} transaction - Transaction already containing requests.
   * @returns {Promise<void>} Resolution only after complete atomic commit.
   */
  function faviconCacheTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || Error('indexeddb-error'));
      transaction.onabort = () => reject(transaction.error || Error('indexeddb-abort'));
    });
  }

  /**
   * Reads a single dataset marker without loading any PNG records.
   * @param {IDBDatabase} db - Cache database connection.
   * @param {string} key - Normalized dataset boundary.
   * @returns {Promise<Object|undefined>} Persisted metadata, when present.
   */
  function faviconCacheMetadata(db, key) {
    return faviconCacheRequest(db.transaction('datasets', 'readonly').objectStore('datasets').get(key));
  }

  /**
   * Matches persisted readiness to this immutable catalogue descriptor.
   * @param {Object|undefined} meta - Stored dataset marker.
   * @param {Object} entry - Frozen catalogue descriptor.
   * @returns {boolean} Whether the complete matching import is committed.
   */
  function faviconCacheReady(meta, entry) {
    return meta?.ready === true && meta.version === entry.version
      && meta.sha256 === entry.favicons.sha256 && meta.bytes === entry.favicons.bytes
      && Number.isSafeInteger(meta.last_used) && Array.isArray(meta.variants)
      && meta.variants.length > 0;
  }

  /**
   * Stores all verified PNG Blobs and the ready marker atomically.
   * @param {IDBDatabase} db - Shared cache database.
   * @param {Object} entry - Validated catalogue dataset descriptor.
   * @param {Object} verified - Fully validated binary pack and indexed spans.
   * @returns {Promise<void>} Promise of complete transaction commit.
   */
  async function faviconCacheImport(db, entry, verified) {
    const existing = await faviconCacheRequest(db.transaction('pngs', 'readonly')
      .objectStore('pngs').index('by_version').getAllKeys(IDBKeyRange.only(entry.version)));
    const tx = db.transaction(['datasets', 'pngs'], 'readwrite');
    const rows = tx.objectStore('pngs');
    const committed = faviconCacheTransaction(tx);
    try {
      for (const key of existing) rows.delete(key);
      for (const span of verified.spans) {
        const png = verified.data.slice(span.offset, span.offset + span.bytes);
        rows.put({ version: entry.version, variant_id: span.variant_id,
          base_type: span.base_type, completion_time: span.completion_time,
          pulse_index: span.pulse_index, blob: new Blob([png], { type: 'image/png' }) });
      }
      tx.objectStore('datasets').put({ version: entry.version, ready: true,
        sha256: entry.favicons.sha256, bytes: entry.favicons.bytes,
        update_every_ms: entry.update_every_ms, variants: verified.variants,
        last_used: Date.now() });
    } catch (error) {
      tx.abort();
      await committed.catch(() => {});
      throw error;
    }
    await committed;
  }

  /**
   * Imports a cold dataset under its exclusive cross-tab Web Lock.
   * @param {IDBDatabase} db - Shared cache database connection.
   * @param {Object} entry - Selected immutable catalogue descriptor.
   * @returns {Promise<boolean>} Whether a complete matching cache is now ready.
   */
  async function faviconCacheEnsure(db, entry) {
    return navigator.locks.request(FAVICON_CACHE_LOCK_PREFIX + entry.version, { mode: 'exclusive' }, async () => {
      const current = await faviconCacheMetadata(db, entry.version);
      if (faviconCacheReady(current, entry)) return true;
      const { commit, path } = entry.favicons;
      const url = `https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/${commit}/${path}`;
      const binary = await faviconCacheFetch(url, 'arraybuffer');
      const verified = await faviconCacheValidatePack(binary, entry);
      await faviconCacheImport(db, entry, verified);
      return true;
    });
  }

  /**
   * Throttles dataset-level last-use writes across concurrent shared readers.
   * @param {IDBDatabase} db - Shared cache database.
   * @param {string} key - Active dataset boundary.
   * @returns {Promise<void>} Completion of any necessary metadata update.
   */
  async function faviconCacheTouch(db, key) {
    const tx = db.transaction('datasets', 'readwrite');
    const store = tx.objectStore('datasets');
    const finished = faviconCacheTransaction(tx);
    const meta = await faviconCacheRequest(store.get(key));
    if (!meta?.ready) { await finished; throw Error('missing-active-dataset'); }
    const now = Date.now();
    if (now - meta.last_used >= FAVICON_CACHE_TTL_MS) {
      meta.last_used = now;
      store.put(meta);
    }
    await finished;
  }

  /**
   * Represents one open dataset protected by a held shared Web Lock.
   */
  class FaviconDatasetSession {
    /**
     * Creates a session for a previously verified and locked dataset.
     * @param {IDBDatabase} db - Origin-scoped IndexedDB connection.
     * @param {Object} entry - Selected immutable catalogue entry.
     * @param {Object} meta - Persisted dataset metadata.
     * @param {Function} release - Unlock callback held until close.
     */
    constructor(db, entry, meta, release) {
      this.db = db;
      this.version = entry.version;
      this.update_every_ms = entry.update_every_ms;
      this.variants = new Map(meta.variants.map(v => [v.source_sha256, v.id]));
      this.ids = new Set(meta.variants.map(v => v.id));
      this.cache = new Map();
      this.pending = new Set();
      this.nextTouch = meta.last_used + FAVICON_CACHE_TTL_MS;
      this.closing = false;
      this.release = release;
    }

    /**
     * Resolves an original favicon's resource digest to its exact variant.
     * @param {string} source_sha256 - SHA-256 digest of stock resource bytes.
     * @returns {string|null} Internal variant identifier or null.
     */
    find_variant(source_sha256) {
      return this.closing ? null : this.variants.get(source_sha256) ?? null;
    }

    /**
     * Loads only one requested PNG Blob, caching warm requests in this tab.
     * @param {string} variant_id - Verified variant identifier.
     * @param {number} base_type - Yellow, green, red or white (0..3).
     * @param {number} completion_time - Completed 5-minute steps (0..6).
     * @param {number} pulse_index - Precomputed pulse frame index (0..20).
     * @returns {Promise<Blob|null>} Requested stored Blob or null.
     */
    async read_png(variant_id, base_type, completion_time, pulse_index) {
      if (this.closing || !this.ids.has(variant_id)
        || !Number.isInteger(base_type) || base_type < 0 || base_type > 3
        || !Number.isInteger(completion_time) || completion_time < 0 || completion_time > 6
        || !Number.isInteger(pulse_index) || pulse_index < 0 || pulse_index > 20) return null;
      const key = `${variant_id}:${base_type}:${completion_time}:${pulse_index}`;
      if (this.cache.has(key)) {
        const cached = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, cached);
        return cached;
      }
      if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value);
      const task = (async () => {
        const tx = this.db.transaction('pngs', 'readonly');
        const record = await faviconCacheRequest(tx.objectStore('pngs').get([
          this.version, variant_id, base_type, completion_time, pulse_index
        ]));
        if (!(record?.blob instanceof Blob) || record.blob.type !== 'image/png') throw Error('missing-png');
        if (Date.now() >= this.nextTouch) {
          await faviconCacheTouch(this.db, this.version);
          this.nextTouch = Date.now() + FAVICON_CACHE_TTL_MS;
        }
        return record.blob;
      })().catch(error => { this.cache.delete(key); faviconCacheWarn('read', error); return null; });
      this.cache.set(key, task);
      this.pending.add(task);
      void task.finally(() => this.pending.delete(task));
      return task;
    }

    /**
     * Waits for pending reads then releases the cross-tab shared lock.
     * @returns {Promise<void>} Completion after held lock release.
     */
    async close() {
      if (this.closing) return this.closedPromise;
      this.closing = true;
      this.closedPromise = (async () => {
        try {
          await Promise.allSettled([...this.pending]);
          await faviconCacheTouch(this.db, this.version);
        } catch (error) { faviconCacheWarn('close', error); }
        finally { this.cache.clear(); this.release(); }
        await this.lockPromise;
      })();
      return this.closedPromise;
    }
  }

  /**
   * Opens a reader only after acquiring and rechecking its shared Web Lock.
   * @param {IDBDatabase} db - Origin-scoped cache database.
   * @param {Object} entry - Selected immutable dataset descriptor.
   * @returns {Promise<FaviconDatasetSession|null>} Locked live dataset or null.
   */
  function faviconCacheShared(db, entry) {
    return new Promise(resolve => {
      let reported = false;
      const lockPromise = navigator.locks.request(
        FAVICON_CACHE_LOCK_PREFIX + entry.version, { mode: 'shared' }, async () => {
          let release;
          const untilClosed = new Promise(done => { release = done; });
          try {
            const meta = await faviconCacheMetadata(db, entry.version);
            if (!faviconCacheReady(meta, entry)) { reported = true; resolve(null); return; }
            await faviconCacheTouch(db, entry.version);
            const session = new FaviconDatasetSession(db, entry, meta, release);
            session.lockPromise = lockPromise;
            reported = true;
            resolve(session);
            await untilClosed;
          } catch (error) {
            faviconCacheWarn('shared', error);
            if (!reported) { reported = true; resolve(null); }
          }
        }
      );
      lockPromise.catch(error => {
        faviconCacheWarn('lock', error);
        if (!reported) resolve(null);
      });
    });
  }

  /**
   * Opens the selected dataset as a shared cross-tab session, loading if absent.
   * @param {string} version_key - Exact normalized catalogue dataset boundary.
   * @returns {Promise<FaviconDatasetSession|null>} Read-only session or null.
   */
  async function open_favicon_dataset(version_key) {
    if (!faviconCacheSupported()) return null;
    try {
      const entries = await faviconCacheLoadCatalogue();
      const entry = entries.get(version_key);
      if (!entry || version_key !== entry.version) return null;
      const db = await faviconCacheDatabase();
      faviconCacheStartSweep(db);
      if (faviconCacheReady(await faviconCacheMetadata(db, version_key), entry)) {
        const warm = await faviconCacheShared(db, entry);
        if (warm) return warm;
      }
      await faviconCacheEnsure(db, entry);
      return await faviconCacheShared(db, entry);
    } catch (error) {
      faviconCacheWarn('open', error);
      return null;
    }
  }

  /**
   * Evicts inactive datasets only under available exclusive dataset locks.
   * @param {IDBDatabase} db - Shared cache database connection.
   * @returns {Promise<void>} Completed best-effort stale sweep.
   */
  async function faviconCacheSweep(db) {
    const keys = await faviconCacheRequest(db.transaction('datasets', 'readonly').objectStore('datasets').getAllKeys());
    for (const key of keys) {
      await navigator.locks.request(FAVICON_CACHE_LOCK_PREFIX + key,
        { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (!lock) return;
          const tx = db.transaction(['datasets', 'pngs'], 'readwrite');
          const metadata = tx.objectStore('datasets');
          const images = tx.objectStore('pngs');
          const finished = faviconCacheTransaction(tx);
          const state = await faviconCacheRequest(metadata.get(key));
          if (state && Date.now() - state.last_used > FAVICON_CACHE_TTL_MS) {
            const cursorRequest = images.index('by_version').openKeyCursor(IDBKeyRange.only(key));
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result;
              if (cursor) { images.delete(cursor.primaryKey); cursor.continue(); }
            };
            metadata.delete(key);
          }
          await finished;
        });
    }
  }

  /**
   * Starts one immediate and periodic opportunistic stale-data cleanup.
   * @param {IDBDatabase} db - Shared IndexedDB database connection.
   * @returns {void} No result.
   */
  function faviconCacheStartSweep(db) {
    if (faviconCacheSweepTimer !== null) return;
    faviconCacheSweepTimer = setInterval(() => {
      void faviconCacheSweep(db).catch(error => faviconCacheWarn('cleanup', error));
    }, FAVICON_CACHE_TTL_MS);
    void faviconCacheSweep(db).catch(error => faviconCacheWarn('cleanup', error));
  }