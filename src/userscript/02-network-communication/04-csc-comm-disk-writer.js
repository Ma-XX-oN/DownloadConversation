
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
    const manifest = scope.__cscWriterManifest;
    let directory = null;
    let version = null;
    let keyRestart = null;
    let index = 0;
    let length = 0;
    let activeName = null;
    let activeCapture = null;
    let chain = Promise.resolve();
    let committed = 0;
    let poisoned = false;

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
      const storedArchive = await bytesFrom(await file(archiveName));
      await manifest.record(archiveName, storedArchive);
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
      check(!poisoned, 'csc-writer-poisoned');
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
      check(!poisoned, 'csc-writer-poisoned');
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
      try {
        if (!activeName) await createFragment();
        await appendRaw(bytes);
      } catch (error) {
        poisoned = true;
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
