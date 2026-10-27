
  /**
   * Small Worker-owned durable manifest for archive digests and logical name.
   * Physical fragments remain the authority for data and capture recovery.
   * @param {Object} scope - Dedicated Worker global with WebCrypto.
   * @returns {Object} Manifest controls bound to one namespace.
   */
  function cscCommDiskManifest(scope) {
    const schema = 'dc-csc-comm-segments/2';
    const encoder = new TextEncoder();
    let directory = null;
    let state = null;
    /**
     * Computes the SHA256 digest from the physical file bytes.
     * @param {Uint8Array} bytes - Exact stored bytes.
     * @returns {Promise<string>} Lowercase hexadecimal digest.
     */
    async function digest(bytes) {
      if (!scope.crypto?.subtle) {
        throw new Error('csc-writer-digest-unavailable');
      }
      const hash = new Uint8Array(await scope.crypto.subtle.digest(
        'SHA-256', bytes));
      return Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
    }
    /**
     * Fetches a private file without creating a missing entry.
     * @param {string} fileName - Manifest or archive name.
     * @returns {Promise<Uint8Array|null>} Physical bytes or null if absent.
     */
    async function getBytes(fileName) {
      try {
        const handle = await directory.getFileHandle(fileName, {
          create: false
        });
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
      } catch (error) {
        if (error?.name === 'NotFoundError') return null;
        throw error;
      }
    }
    /**
     * Commits a small manifest and compares exact physical readback.
     * @returns {Promise<void>} Verified manifest persistence.
     */
    async function commit() {
      if (!directory || !state) throw new Error('csc-writer-manifest-unready');
      const bytes = encoder.encode(JSON.stringify(state) + '\n');
      const handle = await directory.getFileHandle('manifest.json', {
        create: true
      });
      let stream = null;
      try {
        stream = await handle.createWritable();
        await stream.write(bytes);
        await stream.close();
        stream = null;
        const stored = await getBytes('manifest.json');
        if (!stored || stored.length !== bytes.length ||
            stored.some((value, index) => value !== bytes[index])) {
          throw new Error('csc-writer-manifest-readback-mismatch');
        }
      } catch (error) {
        if (stream) await stream.abort().catch(() => {});
        throw error;
      }
    }
    /**
     * Validates the on-disk manifest against the exact namespace.
     * @param {Object} parsed - Untrusted disk JSON data.
     * @param {string} namespace - Selected logical recorder namespace.
     * @returns {void} Throws on any unexpected control-plane field.
     */
    function validate(parsed, namespace) {
      const names = Object.keys(parsed ?? {}).sort().join(',');
      if (names !== 'archives,logical_name,namespace,schema' &&
          names !== 'archives,logical_name,namespace,reset_pending,schema') {
        throw new Error('csc-writer-manifest-invalid');
      }
      if (parsed?.reset_pending !== undefined &&
          parsed.reset_pending !== true) {
        throw new Error('csc-writer-manifest-invalid');
      }
      if (
          parsed.schema !== schema || parsed.namespace !== namespace ||
          typeof parsed.logical_name !== 'string' ||
          !/^[A-Za-z0-9_. -]{1,160}\.comm\.jsonl$/.test(
            parsed.logical_name) ||
          !parsed.archives || typeof parsed.archives !== 'object' ||
          Array.isArray(parsed.archives)) {
        throw new Error('csc-writer-manifest-invalid');
      }
      for (const [name, hash] of Object.entries(parsed.archives)) {
        if (!/^fragment-\d{8}\.jsonl\.zst$/.test(name) ||
            !/^[a-f0-9]{64}$/.test(hash)) {
          throw new Error('csc-writer-manifest-invalid');
        }
      }
    }
    /**
     * Opens and checks every previously indexed archive hash.
     * @param {Object} handle - Existing private fragment directory.
     * @param {string} namespace - Stable logical name.
     * @returns {Promise<void>} Manifest ready, or explicit failure.
     */
    async function open(handle, namespace) {
      if (directory) throw new Error('csc-writer-manifest-already-open');
      directory = handle;
      const bytes = await getBytes('manifest.json');
      if (bytes === null) {
        let found = false;
        for await (const [name] of directory.entries()) {
          if (/^fragment-\d{8}\.jsonl(\.zst)?$/.test(name)) found = true;
        }
        if (found) throw new Error('csc-writer-manifest-missing-with-data');
        state = { schema, namespace,
          logical_name: namespace + '.comm.jsonl', archives: {} };
        await commit();
        return;
      }
      try { state = JSON.parse(new TextDecoder('utf-8',
        { fatal: true }).decode(bytes)); }
      catch { throw new Error('csc-writer-manifest-invalid'); }
      validate(state, namespace);
      if (state.reset_pending === true) {
        await finishReset();
        return;
      }
      for (const [name, expected] of Object.entries(state.archives)) {
        const stored = await getBytes(name);
        if (!stored || await digest(stored) !== expected) {
          throw new Error('csc-writer-manifest-archive-mismatch');
        }
      }
    }
    /**
     * Validates or durably registers one archive after byte verification.
     * @param {string} name - Immutable Zstd archive filename.
     * @param {Uint8Array} bytes - Physical compressed file contents.
     * @returns {Promise<void>} Hash persisted and verified.
     */
    async function record(name, bytes) {
      if (!state || !/^fragment-\d{8}\.jsonl\.zst$/.test(name)) {
        throw new Error('csc-writer-manifest-invalid');
      }
      const hash = await digest(bytes);
      if (state.archives[name] !== undefined) {
        if (state.archives[name] !== hash) {
          throw new Error('csc-writer-manifest-archive-mismatch');
        }
        return;
      }
      state.archives[name] = hash;
      try { await commit(); }
      catch (error) {
        delete state.archives[name];
        throw error;
      }
    }
    /**
     * Changes only the logical user-visible filename; physical fragments stay.
     * @param {string} filename - Validated COMM output basename.
     * @returns {Promise<string>} Committed logical filename.
     */
    async function rename(filename) {
      if (!state || typeof filename !== 'string' ||
          !/^[A-Za-z0-9_. -]{1,160}\.comm\.jsonl$/.test(filename)) {
        throw new Error('csc-writer-invalid-logical-name');
      }
      if (filename === state.logical_name) return filename;
      const previous = state.logical_name;
      state.logical_name = filename;
      try { await commit(); }
      catch (error) { state.logical_name = previous; throw error; }
      return filename;
    }
    /**
     * Returns immutable manifest metadata at a serialized snapshot boundary.
     * @returns {Object} Logical name and independent archive checksums.
     */
    function snapshot() {
      if (!state) throw new Error('csc-writer-manifest-unready');
      return {
        schema: state.schema,
        logical_name: state.logical_name,
        archives: Object.entries(state.archives).sort(([a], [b]) =>
          a.localeCompare(b)).map(([name, sha256]) => ({ name, sha256 }))
      };
    }
    /**
     * Completes an explicitly committed reset, including after a crash.
     * Only known private fragments are removed; unrelated names survive.
     * @returns {Promise<void>} Verified empty fragment inventory.
     */
    async function finishReset() {
      if (!state || state.reset_pending !== true) {
        throw new Error('csc-writer-reset-not-committed');
      }
      const remove = [];
      for await (const [name] of directory.entries()) {
        if (/^fragment-\d{8}\.jsonl(\.zst)?$/.test(name)) remove.push(name);
      }
      for (const name of remove) await directory.removeEntry(name);
      for await (const [name] of directory.entries()) {
        if (/^fragment-\d{8}\.jsonl(\.zst)?$/.test(name)) {
          throw new Error('csc-writer-reset-incomplete');
        }
      }
      state.archives = {};
      delete state.reset_pending;
      await commit();
    }
    /**
     * Persists the explicit reset intent before deleting any fragments.
     * @returns {Promise<void>} Complete verified reset.
     */
    async function reset() {
      if (!state) throw new Error('csc-writer-manifest-unready');
      state.reset_pending = true;
      await commit();
      await finishReset();
    }
    /**
     * Releases the current memory handle after owner reset/close.
     * @returns {void} Clears transient manifest state only.
     */
    function release() {
      directory = null;
      state = null;
    }
    return Object.freeze({
      open, record, rename, snapshot, reset, release,
      get logicalName() { return state?.logical_name ?? null; }
    });
  }
