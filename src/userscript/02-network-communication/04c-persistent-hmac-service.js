  /**
   * Manage persistent HMAC keys with timestamp-identified key cycles.
   *
   * @param {Object} dependencies - Atomic storage, verified authority and WebCrypto.
   * @returns {Object} Closed persistent key lifecycle API.
   */
  function communicationPersistentHmacService(dependencies) {
    const { storage, authority, crypto: secureCrypto } = dependencies;
    const now = dependencies.now || (() => Date.now());
    const hourMs = 60 * 60 * 1000;
    const recordName = 'downloadconversation:secret-marker-key-v2';
    const scopeStorage = 'chatgpt-origin-indexeddb';
    const format = 'dc-secret-marker/2';
    const internal = new Map();
    let disposed = false;

    /**
     * @returns {void} Require the verified chatgpt.com serialized authority.
     */
    function available() {
      if (disposed) throw new Error('persistent-key-disposed');
      if (!authority || authority.capability !== 'linearizable-chatgpt-key-record-v2' ||
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
     * @returns {Object} Cryptographic first-generation record.
     */
    function initial() {
      const issued = now();
      return { format: 'dc-secret-key-record/2', key_hex: randomHex(32),
        epoch: 1, phase: 'open', pending: [], next: null,
        issued_at_ms: issued, expires_at_ms: deadline(issued),
        cycle_events: [cycleEvent(1, issued, 'initial')] };
    }

    /**
     * Execute storage reads/writes solely under a verified same-origin fence.
     * The authority must fence all capture admissions and rotation across
     * every chatgpt.com tab, not merely writes. Browser testing remains gated.
     * @param {Function} fn - Exclusive operation.
     * @param {boolean} [cleanupAfterDispose] - Permit only private release.
     * @returns {Promise<*>} Exclusive result.
     */
    async function transaction(fn, cleanupAfterDispose = false) {
      if (!cleanupAfterDispose) available();
      else if (authority?.capability !== 'linearizable-chatgpt-key-record-v2' ||
          typeof authority?.runExclusive !== 'function' ||
          typeof storage?.get !== 'function' ||
          typeof storage?.set !== 'function') {
        throw new Error('persistent-key-cleanup-authority-unavailable');
      }
      return authority.runExclusive(async () => {
        if (disposed && !cleanupAfterDispose) throw new Error('persistent-key-disposed');
        /**
         * Read and validate the atomic shared persistent key record.
         * @returns {Promise<Object|null>} Stored record or absent state.
         */
        const read = async () => {
          let stored;
          try { stored = await storage.get(recordName, null); }
          catch { throw new Error('persistent-key-storage-read-failed'); }
          return stored === null ? null : communicationPersistentHmacValidated(stored);
        };
        /**
         * Persist and verify exactly one complete storage record.
         * @param {Object} value - Complete versioned key record.
         * @returns {Promise<void>} Resolves after successful readback.
         */
        const write = async (value) => {
          communicationPersistentHmacValidated(value);
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
        key_restart: new Date(stored.issued_at_ms).toISOString(),
        redaction_key_epoch: stored.epoch,
        redaction_key_storage: scopeStorage });
    }

    /**
     * @param {Object} stored - Draining record.
     * @returns {Object} Next record.
     */
    function finishRotation(stored) {
      // Strictly monotonic even for immediate successive Randomize calls.
      const issued = Math.max(now(), stored.issued_at_ms + 1);
      const epoch = stored.next.epoch;
      return { format: stored.format, key_hex: stored.next.key_hex,
        epoch, phase: 'open', pending: [], next: null,
        issued_at_ms: issued, expires_at_ms: deadline(issued),
        cycle_events: [...stored.cycle_events,
          cycleEvent(epoch, issued, stored.next.reason)] };
    }

    /**
     * @param {number} issued - Committed rotation wall-clock time.
     * @returns {number} Random due time in inclusive 23–25 hour interval.
     */
    function deadline(issued) {
      const sample = Number.parseInt(randomHex(4), 16);
      return issued + 23 * hourMs +
        Math.floor(sample / 4294967296 * (2 * hourMs + 1));
    }

    /**
     * @param {number} epoch - Public key epoch.
     * @param {number} time - Authoritative activation timestamp.
     * @param {string} reason - Initial, scheduled, overdue or manual.
     * @returns {Object} Stable nonsecret record for GEN and COMM.
     */
    function cycleEvent(epoch, time, reason) {
      const key_restart = new Date(time).toISOString();
      return { type: 'hmac-key-cycle',
        id: 'hmac-key-cycle:' + key_restart,
        key_restart, epoch, occurred_at_ms: time, reason };
    }

    /**
     * @param {Function} read - Shared record reader.
     * @param {Function} write - Atomic record writer.
     * @returns {Promise<Object|null>} Fresh record, or absent state.
     */
    async function rotateIfDue(read, write) {
      const stored = await read();
      if (!stored || stored.phase !== 'open') return stored;
      const time = now();
      if (time + 1000 < stored.issued_at_ms) {
        throw Error('persistent-key-clock-regression');
      }
      if (time < stored.expires_at_ms) return stored;
      if (stored.epoch >= Number.MAX_SAFE_INTEGER) {
        throw Error('persistent-key-epoch-overflow');
      }
      const reason = time - stored.issued_at_ms > 25 * hourMs
        ? 'overdue' : 'scheduled';
      const draining = { ...stored, phase: 'draining',
        next: { key_hex: randomHex(32),
          epoch: stored.epoch + 1, reason } };
      const next = stored.pending.length === 0
        ? finishRotation(draining) : draining;
      await write(next);
      return next;
    }

    /**
     * Remove only a never-provisioned admission, including ambiguous commits.
     * Re-read beneath the same native fence and do not erase other captures.
     * @param {string} token - Private 128-bit admission identifier.
     * @returns {Promise<void>} Confirmed cleanup or explicit failure.
     */
    async function reconcileUnpublishedAdmission(token) {
      await transaction(async (read, write) => {
        const stored = await read();
        if (!stored) throw new Error('persistent-key-admission-not-found');
        if (!stored.pending.includes(token)) return;
        const pending = stored.pending.filter(item => item !== token);
        const next = { ...stored, pending };
        await write(next.phase === 'draining' && pending.length === 0
          ? finishRotation(next) : next);
      }, true);
    }

    /**
     * Admit one logical capture against the freshly read authoritative epoch.
     * Captures bind to a private key copy; they never return K to page callers.
     * @returns {Promise<Object>} Nonsecret admission token and segment metadata.
     */
    async function admit() {
      let unpublishedToken = null;
      let result;
      try {
        result = await transaction(async (read, write) => {
          let stored = await rotateIfDue(read, write);
          if (!stored) { stored = initial(); await write(stored); }
          if (stored.phase !== 'open') throw new Error('persistent-key-rotation-draining');
          if (stored.pending.length >= 256) throw new Error('persistent-key-admission-capacity');
          let token = randomHex(16);
          while (stored.pending.includes(token)) token = randomHex(16);
          unpublishedToken = token;
          const next = { ...stored, pending: [...stored.pending, token] };
          await write(next);
          return { token, key_hex: stored.key_hex, metadata: metadata(stored) };
        });
      } catch (error) {
        if (unpublishedToken) {
          try { await reconcileUnpublishedAdmission(unpublishedToken); }
          catch { throw new Error('persistent-key-admission-reconciliation-failed'); }
        }
        throw error;
      }
      const key = Uint8Array.from(result.key_hex.match(/../g), x => parseInt(x, 16));
      if (disposed) {
        key.fill(0);
        // A disposal after commit must not orphan an unpublished token.
        await reconcileUnpublishedAdmission(result.token);
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
      const key = internal.get(token);
      if (!key) throw new Error('persistent-key-unknown-admission');
      await transaction(async (read, write) => {
        const stored = await read();
        if (!stored || !stored.pending.includes(token)) {
          throw new Error('persistent-key-admission-not-found');
        }
        const pending = stored.pending.filter(item => item !== token);
        const next = { ...stored, pending };
        const committed = next.phase === 'draining' && pending.length === 0
          ? finishRotation(next) : next;
        try { await write(committed); }
        catch (error) {
          if (JSON.stringify(await read()) !== JSON.stringify(committed)) {
            throw error;
          }
        }
      });
      key.fill(0);
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
          next: { key_hex: randomHex(32),
            epoch: stored.epoch + 1, reason: 'manual' } };
        const committed = next.pending.length === 0
          ? finishRotation(next) : next;
        try { await write(committed); }
        catch (error) {
          // A lost GM acknowledgement can follow a successful commit.
          // Re-read inside the SAME lock before interpreting its outcome.
          const observed = await read();
          if (JSON.stringify(observed) !== JSON.stringify(committed)) {
            throw error;
          }
        }
        return { state: next.pending.length ? 'DRAINING' : 'COMMITTED',
          key_restart: new Date(next.pending.length
            ? stored.issued_at_ms : committed.issued_at_ms).toISOString(),
          epoch: next.pending.length ? stored.epoch : next.next.epoch };
      });
    }

    /**
     * @returns {Promise<Object>} Nonsecret status, including interruption state.
     */
    async function status() {
      return transaction(async (read, write) => {
        const stored = await rotateIfDue(read, write);
        return stored ? { state: stored.phase, ...metadata(stored),
          pending_count: stored.pending.length,
          expires_at_ms: stored.expires_at_ms } : { state: 'uninitialized' };
      });
    }

    /**
     * Finish only a verified drained rotation left after an interrupted write.
     * Never discard active admissions or overwrite a newer epoch.
     * @returns {Promise<Object>} Nonsecret recovery status.
     */
    async function recover() {
      return transaction(async (read, write) => {
        const stored = await rotateIfDue(read, write);
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

    /**
     * @param {number} afterEpoch - Exclusive previous epoch to query.
     * @returns {Promise<Object[]>} Committed nonsecret dual-log cycle events.
     */
    async function cycleEvents(afterEpoch = 0) {
      return transaction(async read => {
        const record = await read();
        return record ? record.cycle_events.filter(
          event => event.epoch > afterEpoch) : [];
      });
    }

    return Object.freeze({ admit, provision, complete, randomize, status,
      recover, cycleEvents, dispose });
  }

