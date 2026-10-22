    /**
     * Performs open in the isolated COMM writer.
     * @param {Object} options - options input.
     * @returns {Promise<any>} open result.
     */
    async function open(options) {
      check(!directory, 'csc-writer-already-open');
      check(options?.handle &&
        typeof options.handle.getDirectoryHandle === 'function' &&
        /^[A-Za-z0-9._-]{1,100}$/.test(options.namespace) &&
        typeof options.version === 'string' && options.version.length > 0,
        'csc-writer-invalid-config');
      version = options.version;
      keyRestart = options.key_restart;
      check(validRestart(keyRestart),
        'csc-writer-invalid-restart');
      if (typeof codec.init === 'function') await codec.init(options.wasm_gzip_base64);
      if (typeof options.handle.queryPermission === 'function') {
        check(await options.handle.queryPermission({ mode: 'readwrite' }) ===
          'granted', 'csc-writer-permission-denied');
      }
      check(lease && typeof lease.acquire === 'function',
        'csc-writer-lock-unavailable');
      await lease.acquire(options.namespace);
      try {
        directory = await options.handle.getDirectoryHandle(
          'dc-comm-' + options.namespace, { create: true });
        await manifest.open(directory, options.namespace);
        let max = 0;
      let rawIndex = 0;
      let oldFragment = false;
      const candidates = [];
      for await (const [fileName, entry] of directory.entries()) {
        if (entry.kind === 'file' &&
            /^fragment-\d{8}\.jsonl(\.zst)?$/.test(fileName)) {
          candidates.push({ fileName, entry });
        }
      }
      candidates.sort((a, b) => a.fileName.localeCompare(b.fileName));
      // A crash after an archive write can leave an identical raw twin.
      // Compare independent physical bytes before retiring the raw copy.
      const byNumber = new Map();
      for (const candidate of candidates) {
        const id = candidate.fileName.slice(9, 17);
        const pair = byNumber.get(id) || {};
        if (candidate.fileName.endsWith('.zst')) pair.archive = candidate;
        else pair.raw = candidate;
        byNumber.set(id, pair);
      }
      const canonical = [];
      for (const pair of byNumber.values()) {
        if (pair.archive && pair.raw) {
          const sourceBytes = await bytesFrom(pair.raw.entry);
          const archiveBytes = await codec.decompress(
            await bytesFrom(pair.archive.entry));
          check(equal(sourceBytes, archiveBytes),
            'csc-writer-interrupted-archive-mismatch');
          await directory.removeEntry(pair.raw.fileName);
        }
        canonical.push(pair.archive || pair.raw);
      }
      for (const { fileName, entry } of canonical) {
        const number = Number(fileName.slice(9, 17));
        max = Math.max(max, number);
        const compressed = fileName.endsWith('.zst');
        const raw = await bytesFrom(entry);
        const unpacked = compressed ? await codec.decompress(raw) : raw;
        const found = parseFragment(unpacked);
        if (compressed) await manifest.record(fileName, raw);
        if (!compressed) {
          check(!activeName, 'csc-writer-ambiguous-raw-fragment');
          activeName = fileName;
          rawIndex = number;
          length = raw.length;
          oldFragment = found.fragmentVersion !== version ||
            found.fragmentRestart !== keyRestart;
          check(found.last?.kind !== 'csc-comm-start' &&
            found.last?.kind !== 'csc-comm-body',
            'csc-writer-unresolved-old-capture');
        }
      }
      check(!activeName || rawIndex === max,
        'csc-writer-unsealed-historical-fragment');
      index = max;
      check(recoveredCapture === null,
        'csc-writer-unresolved-capture');
      if (oldFragment) await seal();
        message('csc-writer-ready', {
          durable: true, fragment: index, committed_bytes: committed,
          key_restart: keyRestart
        });
      } catch (error) {
        directory = null;
        manifest.release();
        await lease.release();
        throw error;
      }
    }
    /**
     * Commits a user-visible name without renaming private live fragments.
     * @param {string} logicalName - Validated COMM output filename.
     * @returns {Promise<string>} Durable logical basename.
     */
    async function renameLogical(logicalName) {
      check(directory !== null && !poisoned,
        'csc-writer-not-open');
      const result = await manifest.rename(logicalName);
      message('csc-writer-renamed', { logical_name: result, durable: true });
      return result;
    }
    /**
     * Closes a durable snapshot boundary, preserving historical fragments.
     * @returns {Promise<Object>} Exact-file hash inventory.
     */
    async function snapshot() {
      check(directory !== null && !poisoned,
        'csc-writer-not-open');
      check(activeCapture === null, 'csc-writer-capture-in-progress');
      await seal();
      const inventory = manifest.snapshot();
      message('csc-writer-snapshot-ready', {
        ...inventory, durable: true
      });
      return inventory;
    }
    /**
     * Copies the complete frozen COMM fragment set to an authorized new
     * directory; the existing source remains immutable.
     * @param {Object} destination - Separately authorized parent directory.
     * @param {string} id - Unique output identity.
     * @returns {Promise<Object>} Verified duplicate metadata.
     */
    async function duplicate(destination, id) {
      const inventory = await snapshot();
      const result = await copy.duplicate(directory, destination, id, inventory);
      message('csc-writer-duplicate-ready', { ...result, durable: true });
      return result;
    }
    /**
     * Applies an explicit, previously confirmed logical log reset.
     * Incomplete deletion is reconciled from the durable reset journal.
     * @param {boolean} confirmed - Exact user confirmation.
     * @returns {Promise<void>} Empty durable segment inventory.
     */
    async function reset(confirmed) {
      if (confirmed !== true) throw new Error('csc-writer-reset-unconfirmed');
      check(directory !== null && !poisoned,
        'csc-writer-not-open');
      check(activeCapture === null, 'csc-writer-capture-in-progress');
      try {
        await seal();
        await manifest.reset();
        index = 0;
        length = 0;
        activeName = null;
        committed = 0;
        knownCycles.clear();
        committedCaptures.clear();
        message('csc-writer-reset-complete', { durable: true });
      } catch (error) {
        poisoned = true;
        throw error;
      }
    }
    /**
     * Performs close in the isolated COMM writer.
     * @returns {Promise<any>} close result.
     */
    async function close() {
      check(!activeCapture, 'csc-writer-capture-in-progress');
      await seal();
      await lease.release();
      manifest.release();
      message('csc-writer-closed', { durable: true });
    }
    const api = Object.freeze({ open, write, setRestart, seal, close,
      snapshot, renameLogical, duplicate, reset,
      get committedBytes() { return committed; },
      get queueBytes() { return queuedBytes; },
      get queueLength() { return queuedRecords; } });
    scope.cscCommWriteChunk = bytes => {
      if (!(bytes instanceof Uint8Array)) {
        return Promise.reject(new Error('csc-writer-invalid-bytes'));
      }
      queuedRecords += 1;
      queuedBytes += bytes.byteLength;
      const operation = chain.then(() => api.write(bytes));
      chain = operation.catch(() => undefined).then(() => {
        queuedRecords -= 1;
        queuedBytes -= bytes.byteLength;
      });
      return operation;
    };
    scope.addEventListener('message', event => {
      const value = event.data;
      if (!value || !/^csc-writer-/.test(value.type ?? '')) return;
      const operation = chain.then(async () => {
        if (value.type === 'csc-writer-open') await open(value);
        else if (value.type === 'csc-writer-key-restart') {
          await setRestart(value.key_restart);
        } else if (value.type === 'csc-writer-close') await close();
        else if (value.type === 'csc-writer-rename') {
          await renameLogical(value.logical_name);
        } else if (value.type === 'csc-writer-snapshot') {
          await snapshot();
        } else if (value.type === 'csc-writer-duplicate') {
          await duplicate(value.destination, value.output_id);
        } else if (value.type === 'csc-writer-reset') {
          await reset(value.confirmed === true);
        }
        else if (value.type === 'csc-writer-query-capture') {
          const durable = committedCaptures.has(value.capture_id);
          message('csc-writer-capture-status', {
            capture_id: String(value.capture_id ?? ''), durable
          });
        }
      });
      chain = operation.catch(error => message('csc-writer-error', {
        operation: value.type, reason: errorCode(error), durable: false
      }));
    });
    return api;
  }

