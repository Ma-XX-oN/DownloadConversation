  // Frozen V2.0 cache provider; runtime manifest binding belongs to DC #332.
  const FAVICON_SEQUENCE_TTL_MS = 600000;
  const FAVICON_SEQUENCE_DB = 'dc-favicon-sequences-v2';
  const FAVICON_SEQUENCE_LOCK = 'dc-favicon-v2:';
  const FAVICON_SEQUENCE_MAX_PNG = 524288;
  const FAVICON_SEQUENCE_FAILURE_BACKOFF_MS = 5000;
  const FAVICON_SEQUENCE_FAILURE_LIMIT = 64;
  const faviconSequenceVersions = new Map();
  const faviconSequenceResolved = new Map();
  let faviconSequenceDatabasePromise = null;
  let faviconSequenceSweeper = null;

  /**
   * Parses numeric major.minor.patch, ignoring every suffix for ordering.
   * @param {string} version - DC script version.
   * @returns {number[]|null} Numeric triplet or null for invalid input.
   */
  function faviconSequenceTriplet(version) {
    if (typeof version !== 'string') return null;
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[A-Za-z0-9.-]+)?$/.exec(version);
    if (!match) return null;
    const parts = match.slice(1, 4).map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
  }

  /**
   * Compares only numeric version triplets.
   * @param {number[]} a - First major/minor/patch.
   * @param {number[]} b - Second major/minor/patch.
   * @returns {number} Signed comparison.
   */
  function faviconSequenceCompare(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  }

  /**
   * Binds provisional version boundaries without any external catalogue.
   * @param {Object[]} entries - Locally supported minimum versions and cadence.
   * @returns {void} Updates the local version registry.
   */
  function faviconCacheV2Configure(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 128) throw Error('v2-boundaries');
    const prepared = new Map();
    for (const entry of entries) {
      const parsed = faviconSequenceTriplet(entry?.version);
      const version = parsed?.join('.');
      if (!parsed || prepared.has(version) || !Number.isSafeInteger(entry.update_every_ms)
        || entry.update_every_ms < 1) throw Error('v2-boundary');
      prepared.set(version, { version, triplet: parsed, update_every_ms: entry.update_every_ms });
    }
    faviconSequenceVersions.clear();
    for (const [key, value] of prepared) faviconSequenceVersions.set(key, value);
    faviconSequenceResolved.clear();
  }

  /**
   * Resolves the greatest matching numeric lower-bound version.
   * @param {string} version - Running DC version, optional ignored suffix.
   * @returns {Promise<string|null>} Selected compatible normalized boundary.
   */
  async function get_compatible_version_key(version) {
    const target = faviconSequenceTriplet(version);
    if (!target) return null;
    const key = target.join('.');
    if (faviconSequenceResolved.has(key)) return faviconSequenceResolved.get(key);
    let selected = null;
    for (const entry of faviconSequenceVersions.values()) {
      if (faviconSequenceCompare(entry.triplet, target) <= 0
        && (!selected || faviconSequenceCompare(entry.triplet, selected.triplet) > 0)) selected = entry;
    }
    if (selected) faviconSequenceResolved.set(key, selected.version);
    return selected?.version ?? null;
  }

  /**
   * Reports a bounded diagnostic without introducing an image fallback.
   * @param {string} stage - Cache operation label.
   * @param {unknown} error - Caught failure reason.
   * @returns {void} No result.
   */
  function faviconSequenceWarn(stage, error) {
    if (typeof logDiagnostic === 'function') {
      logDiagnostic('warnings', 'favicon-sequence-unavailable', {
        stage, reason: String(error?.message ?? error).slice(0, 160)
      });
    }
  }

  /**
   * Verifies the browser has all necessary durable/locking primitives.
   * @returns {boolean} True only for supported browsers.
   */
  function faviconSequenceSupported() {
    return typeof indexedDB !== 'undefined' && typeof navigator?.locks?.request === 'function'
      && typeof Blob !== 'undefined' && typeof AbortController !== 'undefined'
      && typeof createImageBitmap === 'function';
  }

  /**
   * Opens a versioned, origin-scoped sequence cache.
   * @returns {Promise<IDBDatabase>} Shared cache connection.
   */
  function faviconSequenceDatabase() {
    if (!faviconSequenceDatabasePromise) {
      faviconSequenceDatabasePromise = new Promise((resolve, reject) => {
        const r = indexedDB.open(FAVICON_SEQUENCE_DB, 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore('datasets', { keyPath: 'version' });
          db.createObjectStore('sequences', { keyPath: 'id' }).createIndex('by_version', 'version');
          db.createObjectStore('pngs', { keyPath: ['sequence', 'pulse_index'] })
            .createIndex('by_version', 'version');
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error || Error('db-open'));
        r.onblocked = () => reject(Error('db-blocked'));
      }).catch(error => { faviconSequenceDatabasePromise = null; throw error; });
    }
    return faviconSequenceDatabasePromise;
  }

  /**
   * Converts an IndexedDB request to a Promise.
   * @param {IDBRequest} r - Active database request.
   * @returns {Promise<unknown>} Requested value.
   */
  function faviconSequenceRequest(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || Error('db-request'));
    });
  }

  /**
   * Resolves only after an IndexedDB transaction actually commits.
   * @param {IDBTransaction} tx - Transaction with requests already queued.
   * @returns {Promise<void>} Committed transaction.
   */
  function faviconSequenceTransaction(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || Error('db-abort'));
      tx.onerror = () => reject(tx.error || Error('db-error'));
    });
  }

  /**
   * Touches the dataset's usage time no more than once per ten minutes.
   * @param {IDBDatabase} db - IndexedDB connection.
   * @param {string} version - Selected dataset boundary.
   * @returns {Promise<void>} Committed or skipped metadata update.
   */
  async function faviconSequenceTouch(db, version) {
    const tx = db.transaction('datasets', 'readwrite');
    const done = faviconSequenceTransaction(tx);
    const store = tx.objectStore('datasets');
    try {
      const old = await faviconSequenceRequest(store.get(version));
      const now = Date.now();
      if (!old || now - old.last_used >= FAVICON_SEQUENCE_TTL_MS) {
        store.put({ ...old, version, last_used: now });
      }
      await done;
    } catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
  }

  /**
   * Validates the exact key of one requested 21-frame sequence.
   * @param {string} version - Minimum compatible version.
   * @param {string} url - Original stock icon URL.
   * @param {string} theme - Actual source rendering scheme.
   * @param {number} base - Base colour index 0..3.
   * @param {number} progress - 5-minute step 0..6.
   * @returns {string|null} Collision-safe sequence identity or null.
   */
  function faviconSequenceKey(version, url, theme, base, progress) {
    if (!faviconSequenceVersions.has(version) || typeof url !== 'string'
      || url.length < 1 || url.length > 4096 || !/^https?:\/\//.test(url)
      || !['light', 'dark'].includes(theme)
      || !Number.isInteger(base) || base < 0 || base > 3
      || !Number.isInteger(progress) || progress < 0 || progress > 6) return null;
    return JSON.stringify([version, url, theme, base, progress]);
  }

  /**
   * Reads one PNG only when a complete sequence marker exists.
   * @param {IDBDatabase} db - Cache connection.
   * @param {string} id - Sequence key.
   * @param {number} index - Pulse frame 0..20.
   * @returns {Promise<Blob|null>} Stored frame or null.
   */
  async function faviconSequenceRead(db, id, index) {
    const tx = db.transaction(['sequences', 'pngs'], 'readonly');
    const meta = await faviconSequenceRequest(tx.objectStore('sequences').get(id));
    if (meta?.ready !== true || meta.count !== 21) return null;
    const record = await faviconSequenceRequest(tx.objectStore('pngs').get([id, index]));
    return record?.blob instanceof Blob && record.blob.type === 'image/png' ? record.blob : null;
  }

  /**
   * Validates all 21 locally rendered PNGs before any store mutation.
   * @param {ReadonlyArray<Blob>} frames - Provisional #333 output.
   * @param {AbortSignal} signal - Abort on session close/navigation.
   * @returns {Promise<void>} Completes after validating every image.
   */
  async function faviconSequenceValidate(frames, signal) {
    if (!Array.isArray(frames) || frames.length !== 21) throw Error('frame-count');
    let width = 0;
    let height = 0;
    for (const png of frames) {
      if (signal.aborted) throw Error('generation-aborted');
      if (!(png instanceof Blob) || png.type !== 'image/png'
        || png.size < 57 || png.size > FAVICON_SEQUENCE_MAX_PNG) throw Error('frame-blob');
      let image;
      try {
        image = await createImageBitmap(png);
        if (image.width < 1 || image.width > 1024 || image.height < 1 || image.height > 1024
          || (width && (image.width !== width || image.height !== height))) throw Error('frame-dimensions');
        width = image.width;
        height = image.height;
      } finally { image?.close(); }
    }
  }

  /**
   * Stores 21 native PNG Blobs and their ready marker in one transaction.
   * @param {IDBDatabase} db - Cache connection.
   * @param {Object} key - Requested sequence data.
   * @param {ReadonlyArray<Blob>} frames - Verified 21 frames.
   * @returns {Promise<void>} Atomic commit completion.
   */
  async function faviconSequencePublish(db, key, frames) {
    const tx = db.transaction(['sequences', 'pngs'], 'readwrite');
    const done = faviconSequenceTransaction(tx);
    try {
      const rows = tx.objectStore('pngs');
      for (let pulse_index = 0; pulse_index < 21; pulse_index++) {
        rows.put({ version: key.version, sequence: key.id, pulse_index, blob: frames[pulse_index] });
      }
      tx.objectStore('sequences').put({ id: key.id, version: key.version, ready: true, count: 21 });
      await done;
    } catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
  }

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