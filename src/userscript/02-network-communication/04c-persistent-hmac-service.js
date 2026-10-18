  /**
   * Manage V2 HMAC identity with a verified single-origin transaction
   * authority. There is deliberately NO fallback to GM notifications,
   * unguarded GM read/write, or read/write/verify pseudo-CAS.
   *
   * @param {Object} dependencies - GM storage, verified authority and WebCrypto.
   * @returns {Object} Closed persistent key lifecycle API.
   */
  function communicationPersistentHmacService(dependencies) {
    const { storage, authority, crypto: secureCrypto } = dependencies;
    const recordName = 'downloadconversation:secret-marker-key-v2';
    const scopeStorage = 'tampermonkey-script-installation';
    const format = 'dc-secret-marker/2';
    const internal = new Map();
    let disposed = false;

    /**
     * @returns {void} Require the verified chatgpt.com serialized authority.
     */
    function available() {
      if (disposed) throw new Error('persistent-key-disposed');
      if (!authority || authority.capability !== 'linearizable-chatgpt-web-lock-fenced-v1' ||
          typeof authority.runExclusive !== 'function') {
        throw new Error('persistent-key-shared-authority-unavailable');
      }
      if (typeof storage?.get !== 'function' || typeof storage?.set !== 'function') {
        throw new Error('persistent-key-storage-unavailable');
      }
      if (typeof secureCrypto?.getRandomValues !== 'function') {
        throw new Error('persistent-key-crypto-unavailable');
      }
    }

    /**
     * @param {number} bytes - Requested random length.
     * @returns {string} Hex.
     */
    function randomHex(bytes) {
      const data = secureCrypto.getRandomValues(new Uint8Array(bytes));
      return Array.from(data, n => n.toString(16).padStart(2, '0')).join('');
    }

    /**
     * @param {Object} item - Stored record.
     * @returns {Object} Validated record.
     */
    function validated(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          item.format !== 'dc-secret-key-record/2' ||
          !/^[a-f0-9]{64}$/.test(item.key_hex ?? '') ||
          !/^[a-f0-9]{32}$/.test(item.generation ?? '') ||
          !Number.isSafeInteger(item.epoch) || item.epoch < 1 ||
          !['open', 'draining'].includes(item.phase) ||
          !Array.isArray(item.pending) || item.pending.length > 256 ||
          item.pending.some(token => !/^[a-f0-9]{32}$/.test(token)) ||
          new Set(item.pending).size !== item.pending.length) {
        throw new Error('persistent-key-storage-corrupt');
      }
      if (item.phase === 'open' && item.next !== null) {
        throw new Error('persistent-key-storage-corrupt');
      }
      if (item.phase === 'draining' && (!item.next ||
          !/^[a-f0-9]{64}$/.test(item.next.key_hex ?? '') ||
          !/^[a-f0-9]{32}$/.test(item.next.generation ?? '') ||
          item.next.generation === item.generation ||
          item.next.key_hex === item.key_hex ||
          !Number.isSafeInteger(item.next.epoch) ||
          item.next.epoch !== item.epoch + 1)) {
        throw new Error('persistent-key-storage-corrupt');
      }
      return item;
    }

    /**
     * @returns {Object} Cryptographic first-generation record.
     */
    function initial() {
      return { format: 'dc-secret-key-record/2', key_hex: randomHex(32),
        generation: randomHex(16), epoch: 1, phase: 'open',
        pending: [], next: null };
    }

    /**
     * Execute storage reads/writes solely under a verified same-origin fence.
     * The authority must fence all capture admissions and rotation across
     * every chatgpt.com tab, not merely writes. Browser testing remains gated.
     * @param {Function} fn - Exclusive operation.
     * @returns {Promise<*>} Exclusive result.
     */
    async function transaction(fn) {
      available();
      return authority.runExclusive(async () => {
        if (disposed) throw new Error('persistent-key-disposed');
        /**
         * Read and validate the atomic shared persistent key record.
         * @returns {Promise<Object|null>} Stored record or absent state.
         */
        const read = async () => {
          let stored;
          try { stored = await storage.get(recordName, null); }
          catch { throw new Error('persistent-key-storage-read-failed'); }
          return stored === null ? null : validated(stored);
        };
        /**
         * Persist and verify exactly one complete storage record.
         * @param {Object} value - Complete versioned key record.
         * @returns {Promise<void>} Resolves after successful readback.
         */
        const write = async (value) => {
          validated(value);
          try { await storage.set(recordName, value); }
          catch { throw new Error('persistent-key-storage-write-failed'); }
          const actual = await read();
          if (JSON.stringify(actual) !== JSON.stringify(value)) {
            throw new Error('persistent-key-storage-readback-failed');
          }
        };
        return fn(read, write);
      });
    }

    /**
     * @param {Object} stored - Record.
     * @returns {Object} Public marker metadata.
     */
    function metadata(stored) {
      return Object.freeze({ redaction_format: format,
        redaction_scope: stored.generation,
        redaction_key_generation: stored.generation,
        redaction_key_epoch: stored.epoch,
        redaction_key_storage: scopeStorage });
    }

    /**
     * @param {Object} stored - Draining record.
     * @returns {Object} Next record.
     */
    function finishRotation(stored) {
      return { format: stored.format, key_hex: stored.next.key_hex,
        generation: stored.next.generation, epoch: stored.next.epoch,
        phase: 'open', pending: [], next: null };
    }

    /**
     * Admit one logical capture against the freshly read authoritative epoch.
     * Captures bind to a private key copy; they never return K to page callers.
     * @returns {Promise<Object>} Nonsecret admission token and segment metadata.
     */
    async function admit() {
      const result = await transaction(async (read, write) => {
        let stored = await read();
        if (!stored) { stored = initial(); await write(stored); }
        if (stored.phase !== 'open') throw new Error('persistent-key-rotation-draining');
        if (stored.pending.length >= 256) throw new Error('persistent-key-admission-capacity');
        let token = randomHex(16);
        while (stored.pending.includes(token)) token = randomHex(16);
        const next = { ...stored, pending: [...stored.pending, token] };
        await write(next);
        return { token, key_hex: stored.key_hex, metadata: metadata(stored) };
      });
      const key = Uint8Array.from(result.key_hex.match(/../g), x => parseInt(x, 16));
      if (disposed) {
        key.fill(0);
        throw new Error('persistent-key-disposed');
      }
      internal.set(result.token, key);
      return { token: result.token, metadata: result.metadata };
    }

    /**
     * Send an admitted key to the dedicated COMM Worker, transferring bytes.
     * This is not an acknowledgment of Worker receipt/durable disk writing.
     * @param {string} token - Existing capture admission.
     * @param {Object} worker - Worker/message-port compatible transport.
     * @returns {void} No return value.
     */
    function provision(token, worker) {
      available();
      const key = internal.get(token);
      if (!key || typeof worker?.postMessage !== 'function') {
        throw new Error('persistent-key-invalid-provision');
      }
      const transferred = key.slice();
      try {
        worker.postMessage({ type: 'dc-hmac-key-v2', token,
          key_bytes: transferred }, [transferred.buffer]);
      } catch {
        transferred.fill(0);
        throw new Error('persistent-key-worker-provision-failed');
      }
    }

    /**
     * Release a completed/explicitly failed capture. A draining rotation is
     * published only when the shared pending set has become empty.
     * @param {string} token - Existing admission.
     * @returns {Promise<void>} Storage-confirmed completion.
     */
    async function complete(token) {
      if (!internal.has(token)) throw new Error('persistent-key-unknown-admission');
      await transaction(async (read, write) => {
        const stored = await read();
        if (!stored || !stored.pending.includes(token)) {
          throw new Error('persistent-key-admission-not-found');
        }
        const pending = stored.pending.filter(item => item !== token);
        const next = { ...stored, pending };
        await write(next.phase === 'draining' && pending.length === 0
          ? finishRotation(next) : next);
      });
      internal.get(token).fill(0);
      internal.delete(token);
    }

    /**
     * Request confirmed rotation; mark drain before publishing the next epoch.
     * @param {boolean} confirmed - Explicit user approval.
     * @returns {Promise<Object>} Nonsecret state; pending means NOT completed.
     */
    async function randomize(confirmed) {
      if (confirmed !== true) throw new Error('persistent-key-rotation-not-confirmed');
      return transaction(async (read, write) => {
        const stored = await read();
        if (!stored) throw new Error('persistent-key-not-initialized');
        if (stored.phase !== 'open') throw new Error('persistent-key-rotation-draining');
        if (stored.epoch >= Number.MAX_SAFE_INTEGER) {
          throw new Error('persistent-key-epoch-overflow');
        }
        const next = { ...stored, phase: 'draining',
          next: { key_hex: randomHex(32), generation: randomHex(16),
            epoch: stored.epoch + 1 } };
        await write(next.pending.length === 0 ? finishRotation(next) : next);
        return { state: next.pending.length ? 'DRAINING' : 'COMMITTED',
          generation: next.pending.length ? stored.generation : next.next.generation,
          epoch: next.pending.length ? stored.epoch : next.next.epoch };
      });
    }

    /**
     * @returns {Promise<Object>} Nonsecret status, including interruption state.
     */
    async function status() {
      return transaction(async read => {
        const stored = await read();
        return stored ? { state: stored.phase, ...metadata(stored),
          pending_count: stored.pending.length } : { state: 'uninitialized' };
      });
    }

    /**
     * Finish only a verified drained rotation left after an interrupted write.
     * Never discard active admissions or overwrite a newer epoch.
     * @returns {Promise<Object>} Nonsecret recovery status.
     */
    async function recover() {
      return transaction(async (read, write) => {
        const stored = await read();
        if (!stored) return { state: 'uninitialized' };
        if (stored.phase === 'draining' && stored.pending.length === 0) {
          const next = finishRotation(stored);
          await write(next);
          return { state: 'COMMITTED', ...metadata(next) };
        }
        return { state: stored.phase === 'draining' ? 'DRAINING' : 'READY',
          ...metadata(stored), pending_count: stored.pending.length };
      });
    }

    /**
     * @returns {void} Zero local key snapshots without changing shared state.
     */
    function dispose() {
      for (const key of internal.values()) key.fill(0);
      internal.clear();
      disposed = true;
    }

    return Object.freeze({ admit, provision, complete, randomize, status,
      recover, dispose });
  }

  /**
   * Expose only the Tampermonkey script-installation storage interface.
   * A shared storage adapter is NOT an exclusive transaction authority.
   * @returns {Object|null} Storage adapter or null when GM is unavailable.
   */
  function communicationPersistentHmacTampermonkeyStorage() {
    if (typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') {
      return null;
    }
    return Object.freeze({
      async get(name, fallback) { return GM_getValue(name, fallback); },
      async set(name, value) { await GM_setValue(name, value); }
    });
  }

  /**
   * Coordinate same-origin ChatGPT tabs using the browser's native Web Locks.
   * All GM key reads, writes, capture admissions, and rotation operations run
   * INSIDE one held lock. IndexedDB transactions cannot safely enclose awaits
   * to the separate Tampermonkey GM storage API; Web Locks can.
   * This function MUST NOT be used by another origin or a non-secure page.
   * No key bytes are placed into page-origin IndexedDB.
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
      capability: 'linearizable-chatgpt-web-lock-fenced-v1',
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
