
  /**
   * Worker-owned COMM disk writer. No network interception or page DOM access.
   * Acknowledgements are durable only after close + exact physical readback.
   */
  /**
   * Performs cscCommDiskWriter in the isolated COMM writer.
   * @param {Object} scope - scope input.
   * @param {Object} codec - codec input.
   * @returns {any} cscCommDiskWriter result.
   */
  function cscCommDiskWriter(scope, codec) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const threshold = 10 * 1024 * 1024;
    const knownCycles = new Set();
    const committedCaptures = new Set();
    let recoveredCapture = null;
    const lease = scope.__cscWriterLease;
    let directory = null;
    let version = null;
    let keyRestart = null;
    let index = 0;
    let length = 0;
    let activeName = null;
    let activeCapture = null;
    let chain = Promise.resolve();
    let committed = 0;

    /**
     * Performs check in the isolated COMM writer.
     * @param {boolean} ok - ok input.
     * @param {string} message - message input.
     * @returns {any} check result.
     */
    function check(ok, message) {
      if (!ok) throw new Error(message);
    }
    /**
     * Validates the exact, canonical UTC timestamp from DC #313.
     * @param {string} value - Persisted producer key_restart value.
     * @returns {boolean} Whether value encodes a canonical UTC instant.
     */
    function validRestart(value) {
      if (typeof value !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
        return false;
      }
      const instant = Date.parse(value);
      return Number.isSafeInteger(instant) && instant > 0 &&
        new Date(instant).toISOString() === value;
    }
    /**
     * Performs name in the isolated COMM writer.
     * @param {number} n - n input.
     * @param {boolean} compressed - compressed input.
     * @returns {any} name result.
     */
    function name(n, compressed = false) {
      return 'fragment-' + String(n).padStart(8, '0') +
        (compressed ? '.jsonl.zst' : '.jsonl');
    }
    /**
     * Performs equal in the isolated COMM writer.
     * @param {Uint8Array} a - a input.
     * @param {Uint8Array} b - b input.
     * @returns {any} equal result.
     */
    function equal(a, b) {
      if (a.byteLength !== b.byteLength) return false;
      for (let n = 0; n < a.byteLength; n += 1) {
        if (a[n] !== b[n]) return false;
      }
      return true;
    }
    /**
     * Performs errorCode in the isolated COMM writer.
     * @param {Error} error - error input.
     * @returns {any} errorCode result.
     */
    function errorCode(error) {
      const message = String(error?.message ?? '');
      return /^csc-writer-[a-z-]+$/.test(message)
        ? message : 'csc-writer-io-failed';
    }
    /**
     * Performs message in the isolated COMM writer.
     * @param {string} type - type input.
     * @param {Object} payload - payload input.
     * @returns {any} message result.
     */
    function message(type, payload) {
      scope.postMessage({ type, ...payload });
    }
    /**
     * Performs file in the isolated COMM writer.
     * @param {string} nameValue - nameValue input.
     * @param {boolean} create - create input.
     * @returns {Promise<any>} file result.
     */
    async function file(nameValue, create = false) {
      check(directory !== null, 'csc-writer-not-open');
      return directory.getFileHandle(nameValue, { create });
    }
    /**
     * Performs exists in the isolated COMM writer.
     * @param {string} fileName - fileName input.
     * @returns {Promise<any>} exists result.
     */
    async function exists(fileName) {
      try { return await file(fileName, false); }
      catch (error) {
        if (error?.name === 'NotFoundError') return null;
        throw error;
      }
    }
    /**
     * Performs bytesFrom in the isolated COMM writer.
     * @param {Object} handle - handle input.
     * @returns {Promise<any>} bytesFrom result.
     */
    async function bytesFrom(handle) {
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    }
    /**
     * Performs writeNew in the isolated COMM writer.
     * @param {string} fileName - fileName input.
     * @param {Uint8Array} data - data input.
     * @returns {Promise<any>} writeNew result.
     */
    async function writeNew(fileName, data) {
      check(!(await exists(fileName)), 'csc-writer-name-collision');
      const handle = await file(fileName, true);
      let stream = null;
      try {
        stream = await handle.createWritable();
        await stream.write(data);
        await stream.close();
        stream = null;
        const read = await bytesFrom(handle);
        check(equal(data, read), 'csc-writer-readback-mismatch');
        return handle;
      } catch (error) {
        if (stream) await stream.abort().catch(() => {});
        throw error;
      }
    }
    /**
     * Performs header in the isolated COMM writer.
     * @param {number} restart - restart input.
     * @returns {any} header result.
     */
    function header(restart) {
      return encoder.encode(JSON.stringify({
        version: { comm: version, gen: version }, key_restart: restart
      }) + '\n');
    }
    /**
     * Performs parseLine in the isolated COMM writer.
     * @param {Uint8Array} raw - raw input.
     * @returns {any} parseLine result.
     */
    function parseLine(raw) {
      check(raw.byteLength > 0 && raw[raw.length - 1] === 10,
        'csc-writer-incomplete-frame');
      let value;
      try { value = JSON.parse(decoder.decode(raw.subarray(0, -1))); }
      catch { throw new Error('csc-writer-invalid-frame'); }
      check(value && typeof value === 'object' && !Array.isArray(value),
        'csc-writer-invalid-frame');
      return value;
    }
    /**
     * Performs parseFragment in the isolated COMM writer.
     * @param {Uint8Array} raw - raw input.
     * @returns {any} parseFragment result.
     */
    function parseFragment(raw) {
      let offset = 0;
      let first = true;
      let last = null;
      let fragmentVersion = null;
      let fragmentRestart = null;
      while (offset < raw.length) {
        const end = raw.indexOf(10, offset);
        check(end !== -1, 'csc-writer-torn-fragment');
        const item = parseLine(raw.subarray(offset, end + 1));
        if (first) {
          check(typeof item?.version?.comm === 'string' &&
            item.version.comm.length > 0 && validRestart(item.key_restart),
            'csc-writer-invalid-header');
          fragmentVersion = item.version.comm;
          fragmentRestart = item.key_restart;
          first = false;
        } else {
          if (item.kind === 'csc-comm-start') {
            check(recoveredCapture === null &&
              !committedCaptures.has(item.capture_id),
              'csc-writer-recovery-capture-order');
            recoveredCapture = item.capture_id;
          } else if (item.kind === 'csc-comm-body' ||
                     item.kind === 'csc-comm-end') {
            check(recoveredCapture === item.capture_id,
              'csc-writer-recovery-capture-order');
            if (item.kind === 'csc-comm-end') {
              committedCaptures.add(item.capture_id);
              recoveredCapture = null;
            }
          }
          if (item.kind === 'hmac-key-cycle') {
            check(typeof item.id === 'string', 'csc-writer-invalid-cycle');
            check(!knownCycles.has(item.id), 'csc-writer-duplicate-cycle');
            knownCycles.add(item.id);
          }
          last = item;
        }
        offset = end + 1;
      }
      check(!first, 'csc-writer-empty-fragment');
      return { last, fragmentVersion, fragmentRestart };
    }
    /**
     * Performs seal in the isolated COMM writer.
     * @returns {Promise<any>} seal result.
     */
    async function seal() {
      if (!length) return;
      const source = await file(activeName);
      const raw = await bytesFrom(source);
      check(raw.length === length, 'csc-writer-source-changed');
      const compressed = await codec.compress(raw);
      check(compressed instanceof Uint8Array, 'csc-writer-invalid-compressor');
      const archiveName = name(index, true);
      const existing = await exists(archiveName);
      if (existing) {
        const prior = await bytesFrom(existing);
        check(equal(await codec.decompress(prior), raw),
          'csc-writer-collision-mismatch');
      } else {
        await writeNew(archiveName, compressed);
        const onDisk = await bytesFrom(await file(archiveName));
        check(equal(await codec.decompress(onDisk), raw),
          'csc-writer-compression-mismatch');
      }
      await directory.removeEntry(activeName);
      length = 0;
      activeName = null;
      message('csc-writer-sealed', {
        fragment: index, source_bytes: raw.byteLength,
        archive_bytes: compressed.byteLength, durable: true
      });
    }
    /**
     * Performs createFragment in the isolated COMM writer.
     * @returns {Promise<any>} createFragment result.
     */
    async function createFragment() {
      index += 1;
      activeName = name(index);
      const contents = header(keyRestart);
      await writeNew(activeName, contents);
      length = contents.length;
    }
    /**
     * Performs appendRaw in the isolated COMM writer.
     * @param {Uint8Array} data - data input.
     * @returns {Promise<any>} appendRaw result.
     */
    async function appendRaw(data) {
      const handle = await file(activeName);
      const previous = await handle.getFile();
      check(previous.size === length, 'csc-writer-stale-file');
      let stream = null;
      try {
        stream = await handle.createWritable({ keepExistingData: true });
        await stream.seek(length);
        await stream.write(data);
        await stream.close();
        stream = null;
      } catch (error) {
        if (stream) await stream.abort().catch(() => {});
        throw error;
      }
      const saved = await handle.getFile();
      check(saved.size === length + data.length,
        'csc-writer-length-mismatch');
      const checkBytes = new Uint8Array(await saved.slice(length).arrayBuffer());
      check(equal(checkBytes, data), 'csc-writer-readback-mismatch');
      length += data.length;
      committed += data.length;
    }
    /**
     * Performs setRestart in the isolated COMM writer.
     * @param {number} restart - restart input.
     * @returns {Promise<any>} setRestart result.
     */
    async function setRestart(restart) {
      check(validRestart(restart),
        'csc-writer-invalid-restart');
      check(activeCapture === null, 'csc-writer-capture-in-progress');
      check(keyRestart === null || restart >= keyRestart,
        'csc-writer-stale-restart');
      if (restart === keyRestart) return;
      await seal();
      keyRestart = restart;
    }
    /**
     * Performs write in the isolated COMM writer.
     * @param {Uint8Array} bytes - bytes input.
     * @returns {Promise<any>} write result.
     */
    async function write(bytes) {
      check(directory && validRestart(keyRestart),
        'csc-writer-not-open');
      check(bytes instanceof Uint8Array, 'csc-writer-invalid-bytes');
      const record = parseLine(bytes);
      if (record.kind === 'hmac-key-cycle') {
        check(record.id === 'hmac-key-cycle:' + keyRestart &&
          record.key_restart === keyRestart &&
          Number.isSafeInteger(record.occurred_at_ms) &&
          record.occurred_at_ms === Date.parse(keyRestart),
          'csc-writer-cycle-boundary-mismatch');
        if (knownCycles.has(record.id)) {
          message('csc-writer-durable-cycle', {
            id: record.id, durable: true, duplicate: true
          });
          return;
        }
      }
      if (record.kind === 'csc-comm-start') {
        check(!committedCaptures.has(record.capture_id),
          'csc-writer-duplicate-capture');
        check(activeCapture === null, 'csc-writer-overlapping-capture');
        check(record.key_restart === keyRestart,
          'csc-writer-capture-restart-mismatch');
        activeCapture = record.capture_id;
      } else if (record.kind === 'csc-comm-body' ||
                 record.kind === 'csc-comm-end') {
        check(record.capture_id === activeCapture,
          'csc-writer-capture-order-mismatch');
      }
      if (!activeName) await createFragment();
      try {
        await appendRaw(bytes);
      } catch (error) {
        message('csc-writer-incomplete', {
          capture_id: record.capture_id ?? null,
          reason: errorCode(error), durable: false
        });
        throw error;
      }
      if (record.kind === 'csc-comm-end') {
        activeCapture = null;
        committedCaptures.add(record.capture_id);
        message('csc-writer-durable-capture', {
          capture_id: record.capture_id, durable: true
        });
      }
      if (record.kind === 'hmac-key-cycle') {
        knownCycles.add(record.id);
        message('csc-writer-durable-cycle', {
          id: record.id, durable: true, duplicate: false
        });
      }
      if (length >= threshold) await seal();
    }
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
        let max = 0;
      let rawIndex = 0;
      let oldFragment = false;
      const candidates = [];
      for await (const [fileName, entry] of directory.entries()) {
        if (entry.kind === 'file' &&
            /^fragment-\\d{8}\\.jsonl(\\.zst)?$/.test(fileName)) {
          candidates.push({ fileName, entry });
        }
      }
      candidates.sort((a, b) => a.fileName.localeCompare(b.fileName));
      for (const { fileName, entry } of candidates) {
        const number = Number(fileName.slice(9, 17));
        max = Math.max(max, number);
        const compressed = fileName.endsWith('.zst');
        const raw = await bytesFrom(entry);
        const unpacked = compressed ? await codec.decompress(raw) : raw;
        const found = parseFragment(unpacked);
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
        await lease.release();
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
      message('csc-writer-closed', { durable: true });
    }
    const api = Object.freeze({ open, write, setRestart, seal, close,
      get committedBytes() { return committed; },
      get queueBytes() { return 0; } });
    scope.cscCommWriteChunk = bytes => {
      const operation = chain.then(() => api.write(bytes));
      chain = operation.catch(() => {});
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

