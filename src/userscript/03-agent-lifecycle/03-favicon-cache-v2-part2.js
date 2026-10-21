  /**
   * Checks a sequence's bounded cross-tab renderer failure cooldown.
   * @param {IDBDatabase} db - Shared origin cache.
   * @param {string} version - Compatible dataset version.
   * @param {string} id - Complete five-field sequence identity.
   * @returns {Promise<boolean>} Whether retry must wait.
   */
  async function faviconSequenceCooling(db, version, id) {
    const row = await faviconSequenceRequest(db.transaction('datasets', 'readonly')
      .objectStore('datasets').get(version));
    return Number.isSafeInteger(row?.failed_sequences?.[id])
      && row.failed_sequences[id] > Date.now();
  }

  /**
   * Records a failed render without touching last_used or publishing readiness.
   * @param {IDBDatabase} db - Shared origin cache.
   * @param {string} version - Compatible dataset version.
   * @param {string} id - Complete five-field sequence identity.
   * @returns {Promise<void>} Committed bounded cooldown.
   */
  async function faviconSequenceRecordFailure(db, version, id) {
    const tx = db.transaction('datasets', 'readwrite');
    const done = faviconSequenceTransaction(tx);
    try {
      const store = tx.objectStore('datasets');
      const row = await faviconSequenceRequest(store.get(version));
      if (!row) throw Error('missing-failure-dataset');
      const now = Date.now();
      const active = Object.entries(row.failed_sequences || {})
        .filter(([, until]) => Number.isSafeInteger(until) && until > now);
      active.push([id, now + FAVICON_SEQUENCE_FAILURE_BACKOFF_MS]);
      row.failed_sequences = Object.fromEntries(
        active.slice(-FAVICON_SEQUENCE_FAILURE_LIMIT));
      store.put(row);
      await done;
    } catch (error) {
      try { tx.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }

  /**
   * Waits for a missing sequence's exclusive lock and renders only if still absent.
   * @param {FaviconDatasetSession} session - Locked dataset reader.
   * @param {Object} key - Requested sequence descriptor.
   * @param {AbortSignal} signal - Session cancellation signal.
   * @returns {Promise<Blob|null>} Fully published requested frame or null.
   */
  async function faviconSequenceEnsure(session, key, signal) {
    await navigator.locks.request(FAVICON_SEQUENCE_LOCK + 'seq:' + key.id,
      { mode: 'exclusive', signal }, async () => {
        if (await faviconSequenceRead(session.db, key.id, key.pulse_index)) return;
        if (await faviconSequenceCooling(session.db, key.version, key.id)) return;
        const args = Object.freeze({ version: key.version,
          original_favicon_url: key.url, theme: key.theme,
          base_type: key.base, progress_step: key.progress });
        const generate = Promise.resolve().then(() => session.renderer(args, signal));
        const canceled = new Promise((resolve, reject) => {
          if (signal.aborted) { reject(Error('generation-aborted')); return; }
          signal.addEventListener('abort', () => reject(Error('generation-aborted')), { once: true });
        });
        let frames;
        try {
          frames = await Promise.race([generate, canceled]);
          await faviconSequenceValidate(frames, signal);
        } catch (error) {
          if (signal.aborted || error?.name === 'AbortError') throw error;
          await faviconSequenceRecordFailure(session.db, key.version, key.id);
          faviconSequenceWarn('render-failed', error);
          return;
        }
        if (signal.aborted) throw Error('generation-aborted');
        await faviconSequencePublish(session.db, key, frames);
      });
    return signal.aborted ? null : faviconSequenceRead(session.db, key.id, key.pulse_index);
  }

  /**
   * Holds one shared dataset lock until close, including outstanding requests.
   */
  class FaviconDatasetSession {
    /**
     * Creates a shared reader for locally generated icon sequences.
     * @param {IDBDatabase} db - Open durable connection.
     * @param {Object} entry - Registered compatible version entry.
     * @param {Function} release - Callback releasing held shared lock.
     * @param {Function} renderer - Provisional DC #333 sequence renderer.
     */
    constructor(db, entry, release, renderer) {
      this.db = db;
      this.version = entry.version;
      this.update_every_ms = entry.update_every_ms;
      this.release = release;
      this.renderer = renderer;
      this.cache = new Map();
      this.pending = new Map();
      this.controller = new AbortController();
      this.closing = false;
      this.nextTouch = Date.now() + FAVICON_SEQUENCE_TTL_MS;
    }

    /**
     * Retrieves a requested frame, generating its exact sequence once if absent.
     * @param {string} original_favicon_url - Captured stock link href.
     * @param {string} theme - Actual current light/dark scheme.
     * @param {number} base_type - Yellow/green/red/white index.
     * @param {number} progress_step - Completed 5-minute step.
     * @param {number} pulse_index - Frame 0..20 within one sequence.
     * @returns {Promise<Blob|null>} Requested original PNG Blob or null on failure.
     */
    async read_png(original_favicon_url, theme, base_type, progress_step, pulse_index) {
      if (this.closing || !Number.isInteger(pulse_index) || pulse_index < 0 || pulse_index > 20) return null;
      const id = faviconSequenceKey(this.version, original_favicon_url, theme, base_type, progress_step);
      if (!id) return null;
      const frameKey = JSON.stringify([id, pulse_index]);
      if (this.cache.has(frameKey)) {
        const blob = this.cache.get(frameKey);
        this.cache.delete(frameKey);
        this.cache.set(frameKey, blob);
        return blob;
      }
      if (this.pending.has(frameKey)) return this.pending.get(frameKey);
      const key = { id, version: this.version, url: original_favicon_url,
        theme, base: base_type, progress: progress_step, pulse_index };
      const task = (async () => {
        let png = await faviconSequenceRead(this.db, id, pulse_index);
        if (!png) png = await faviconSequenceEnsure(this, key, this.controller.signal);
        if (png && !this.closing) {
          this.cache.set(frameKey, png);
          if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value);
          if (Date.now() >= this.nextTouch) {
            await faviconSequenceTouch(this.db, this.version);
            this.nextTouch = Date.now() + FAVICON_SEQUENCE_TTL_MS;
          }
        }
        return this.closing ? null : png;
      })().catch(error => {
        if (!this.controller.signal.aborted && error?.name !== 'AbortError') {
          faviconSequenceWarn('read-or-render', error);
        }
        return null;
      })
        .finally(() => this.pending.delete(frameKey));
      this.pending.set(frameKey, task);
      return task;
    }

    /**
     * Cancels unfinished generation, drains readers, releases dataset lock.
     * @returns {Promise<void>} Completion of session teardown.
     */
    async close() {
      if (this.closing) return this.closedPromise;
      this.closing = true;
      this.controller.abort();
      this.closedPromise = (async () => {
        await Promise.allSettled([...this.pending.values()]);
        this.cache.clear();
        this.release();
        await this.lockPromise;
      })();
      return this.closedPromise;
    }
  }

  /**
   * Acquires a long-lived shared dataset lock before serving any sequence.
   * @param {IDBDatabase} db - Cache database connection.
   * @param {Object} entry - Compatible registered version.
   * @param {Function} renderer - Provisional #333 render callback.
   * @returns {Promise<FaviconDatasetSession|null>} Shared reader or null.
   */
  function faviconSequenceShared(db, entry, renderer) {
    return new Promise(resolve => {
      let resolved = false;
      const lockPromise = navigator.locks.request(FAVICON_SEQUENCE_LOCK + 'dataset:' + entry.version,
        { mode: 'shared' }, async () => {
          let release;
          const hold = new Promise(done => { release = done; });
          try {
            await faviconSequenceTouch(db, entry.version);
            const session = new FaviconDatasetSession(db, entry, release, renderer);
            session.lockPromise = lockPromise;
            resolved = true;
            resolve(session);
            await hold;
          } catch (error) { faviconSequenceWarn('session', error); if (!resolved) resolve(null); }
        });
      lockPromise.catch(error => { faviconSequenceWarn('shared-lock', error); if (!resolved) resolve(null); });
    });
  }

  /**
   * Evicts stale collections only when no tab retains a shared reader lock.
   * @param {IDBDatabase} db - Shared cache.
   * @returns {Promise<void>} Completed best-effort sweep.
   */
  async function faviconSequenceSweep(db) {
    const keys = await faviconSequenceRequest(db.transaction('datasets', 'readonly')
      .objectStore('datasets').getAllKeys());
    for (const version of keys) {
      await navigator.locks.request(FAVICON_SEQUENCE_LOCK + 'dataset:' + version,
        { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (!lock) return;
          const tx = db.transaction(['datasets', 'sequences', 'pngs'], 'readwrite');
          const done = faviconSequenceTransaction(tx);
          const metadata = tx.objectStore('datasets');
          const old = await faviconSequenceRequest(metadata.get(version));
          if (old && Date.now() - old.last_used > FAVICON_SEQUENCE_TTL_MS) {
            for (const name of ['sequences', 'pngs']) {
              const store = tx.objectStore(name);
              const cursor = store.index('by_version').openKeyCursor(IDBKeyRange.only(version));
              cursor.onsuccess = () => {
                if (cursor.result) { store.delete(cursor.result.primaryKey); cursor.result.continue(); }
              };
            }
            metadata.delete(version);
          }
          await done;
        });
    }
  }

  /**
   * Starts startup and periodic stale collection cleanup once per origin tab.
   * @param {IDBDatabase} db - Cache database connection.
   * @returns {void} No result.
   */
  function faviconSequenceStartSweep(db) {
    if (faviconSequenceSweeper !== null) return;
    faviconSequenceSweeper = setInterval(() => {
      void faviconSequenceSweep(db).catch(error => faviconSequenceWarn('sweep', error));
    }, FAVICON_SEQUENCE_TTL_MS);
    void faviconSequenceSweep(db).catch(error => faviconSequenceWarn('startup-sweep', error));
  }

  /**
   * Opens a session using a supplied provisional local #333 renderer.
   * @param {string} version_key - Selected normalized minimum version.
   * @param {Function} render_sequence - Exact-tuple 21-frame renderer.
   * @returns {Promise<FaviconDatasetSession|null>} Shared session or null.
   */
  async function open_favicon_dataset(version_key, render_sequence) {
    if (!faviconSequenceSupported() || !faviconSequenceVersions.has(version_key)
      || typeof render_sequence !== 'function') return null;
    try {
      const db = await faviconSequenceDatabase();
      faviconSequenceStartSweep(db);
      return await faviconSequenceShared(db, faviconSequenceVersions.get(version_key), render_sequence);
    } catch (error) { faviconSequenceWarn('open', error); return null; }
  }