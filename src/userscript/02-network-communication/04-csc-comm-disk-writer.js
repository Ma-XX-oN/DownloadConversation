
  /**
   * Worker-owned COMM disk writer. No network interception or page DOM access.
   * Acknowledgements are durable only after close + exact physical readback.
   */
  function cscCommDiskWriter(scope, codec) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const threshold = 10 * 1024 * 1024;
    const knownCycles = new Set();
    let directory = null;
    let version = null;
    let keyRestart = null;
    let index = 0;
    let length = 0;
    let activeName = null;
    let activeCapture = null;
    let chain = Promise.resolve();
    let committed = 0;

    function check(ok, message) {
      if (!ok) throw new Error(message);
    }
    function name(n, compressed = false) {
      return 'fragment-' + String(n).padStart(8, '0') +
        (compressed ? '.jsonl.zst' : '.jsonl');
    }
    function equal(a, b) {
      if (a.byteLength !== b.byteLength) return false;
      for (let n = 0; n < a.byteLength; n += 1) {
        if (a[n] !== b[n]) return false;
      }
      return true;
    }
    function errorCode(error) {
      const message = String(error?.message ?? '');
      return /^csc-writer-[a-z-]+$/.test(message)
        ? message : 'csc-writer-io-failed';
    }
    function message(type, payload) {
      scope.postMessage({ type, ...payload });
    }
    async function file(nameValue, create = false) {
      check(directory !== null, 'csc-writer-not-open');
      return directory.getFileHandle(nameValue, { create });
    }
    async function exists(fileName) {
      try { return await file(fileName, false); }
      catch (error) {
        if (error?.name === 'NotFoundError') return null;
        throw error;
      }
    }
    async function bytesFrom(handle) {
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    }
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
    function header(restart) {
      return encoder.encode(JSON.stringify({
        version: { comm: version, gen: version }, key_restart: restart
      }) + '\n');
    }
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
    function parseFragment(raw) {
      let offset = 0;
      let first = true;
      let last = null;
      while (offset < raw.length) {
        const end = raw.indexOf(10, offset);
        check(end !== -1, 'csc-writer-torn-fragment');
        const item = parseLine(raw.subarray(offset, end + 1));
        if (first) {
          check(item?.version?.comm === version &&
            Number.isSafeInteger(item.key_restart) &&
            item.key_restart > 0, 'csc-writer-invalid-header');
          first = false;
        } else {
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
      return last;
    }
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
    async function createFragment() {
      index += 1;
      activeName = name(index);
      const contents = header(keyRestart);
      await writeNew(activeName, contents);
      length = contents.length;
    }
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
    async function setRestart(restart) {
      check(Number.isSafeInteger(restart) && restart > 0,
        'csc-writer-invalid-restart');
      check(activeCapture === null, 'csc-writer-capture-in-progress');
      check(keyRestart === null || restart >= keyRestart,
        'csc-writer-stale-restart');
      if (restart === keyRestart) return;
      await seal();
      keyRestart = restart;
    }
    async function write(bytes) {
      check(directory && Number.isSafeInteger(keyRestart),
        'csc-writer-not-open');
      check(bytes instanceof Uint8Array, 'csc-writer-invalid-bytes');
      const record = parseLine(bytes);
      if (record.kind === 'hmac-key-cycle') {
        check(typeof record.id === 'string' &&
          Number.isSafeInteger(record.occurred_at_ms) &&
          record.occurred_at_ms === keyRestart,
          'csc-writer-cycle-boundary-mismatch');
        if (knownCycles.has(record.id)) {
          message('csc-writer-durable-cycle', {
            id: record.id, durable: true, duplicate: true
          });
          return;
        }
      }
      if (record.kind === 'csc-comm-start') {
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
      if (length >= threshold && activeCapture === null) await seal();
    }
    async function open(options) {
      check(!directory, 'csc-writer-already-open');
      check(options?.handle &&
        typeof options.handle.getDirectoryHandle === 'function' &&
        /^[A-Za-z0-9._-]{1,100}$/.test(options.namespace) &&
        typeof options.version === 'string' && options.version.length > 0,
        'csc-writer-invalid-config');
      version = options.version;
      keyRestart = options.key_restart;
      check(Number.isSafeInteger(keyRestart) && keyRestart > 0,
        'csc-writer-invalid-restart');
      if (typeof options.handle.queryPermission === 'function') {
        check(await options.handle.queryPermission({ mode: 'readwrite' }) ===
          'granted', 'csc-writer-permission-denied');
      }
      directory = await options.handle.getDirectoryHandle(
        'dc-comm-' + options.namespace, { create: true });
      let max = 0;
      for await (const [fileName, entry] of directory.entries()) {
        if (entry.kind !== 'file') continue;
        const match = /^fragment-(\d{8})\.jsonl(\.zst)?$/.exec(fileName);
        if (!match) continue;
        const number = Number(match[1]);
        max = Math.max(max, number);
        const raw = await bytesFrom(entry);
        const unpacked = match[2] ? await codec.decompress(raw) : raw;
        parseFragment(unpacked);
        if (!match[2]) {
          check(number === max && !activeName,
            'csc-writer-ambiguous-raw-fragment');
          activeName = fileName;
          length = raw.length;
          const firstEnd = raw.indexOf(10);
          const original = parseLine(raw.subarray(0, firstEnd + 1));
          check(original.key_restart === keyRestart,
            'csc-writer-open-restart-mismatch');
        }
      }
      index = max;
      message('csc-writer-ready', {
        durable: true, fragment: index, committed_bytes: committed,
        key_restart: keyRestart
      });
    }
    async function close() {
      check(!activeCapture, 'csc-writer-capture-in-progress');
      await seal();
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
      });
      chain = operation.catch(error => message('csc-writer-error', {
        operation: value.type, reason: errorCode(error), durable: false
      }));
    });
    return api;
  }
