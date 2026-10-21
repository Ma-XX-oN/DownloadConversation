  // Frozen V2.0 cache provider; runtime manifest binding belongs to DC #332.
  // Expiry and last_used touch interval, milliseconds.
  const FAVICON_SEQUENCE_TTL_MS = 600000;
  // Same-origin persistent 21-PNG sequence database name.
  const FAVICON_SEQUENCE_DB = 'dc-favicon-sequences-v2';
  // Cross-tab Web Locks prefix for sequence and dataset locks.
  const FAVICON_SEQUENCE_LOCK = 'dc-favicon-v2:';
  // Maximum accepted PNG Blob size, bytes.
  const FAVICON_SEQUENCE_MAX_PNG = 524288;
  // Shared negative-render retry cooldown duration, milliseconds.
  const FAVICON_SEQUENCE_FAILURE_BACKOFF_MS = 5000;
  // Maximum active tuple cooldown records retained per version.
  const FAVICON_SEQUENCE_FAILURE_LIMIT = 64;
  // Local numeric minimum-compatible version boundaries.
  const faviconSequenceVersions = new Map();
  // Cached version selection results (invalidated on configuration).
  const faviconSequenceResolved = new Map();
  // Shared deferred IndexedDB connection.
  let faviconSequenceDatabasePromise = null;
  // Per-tab interval handle for inactive dataset expiry.
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

