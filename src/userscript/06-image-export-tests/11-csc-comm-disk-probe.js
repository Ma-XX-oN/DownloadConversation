
  /**
   * Runs only synthetic bytes through the actual Worker disk writer.
   * @returns {void} Registers the dedicated Worker diagnostic handler.
   */
  function cscCommDiskProbeEntrypoint() {
    self.addEventListener('message', event => {
      if (event.data?.type !== 'csc-writer-probe-run') return;
      void (async () => {
        const config = event.data;
        const writer = self.__cscDiskWriter;
        const encoding = new TextEncoder();
        const restart = config.key_restart;
        const capture = 'synthetic-writer-probe';
        const count = 11;
        const payload = 'x'.repeat(1024 * 1024);
        /**
         * Serializes a synthetic JSONL frame without private data.
         * @param {Object} item - Synthetic record.
         * @returns {Uint8Array} Encoded JSONL frame bytes.
         */
        const frame = item => encoding.encode(JSON.stringify(item) + '\n');
        const start = { kind: 'csc-comm-start', capture_id: capture,
          key_restart: restart };
        const end = { kind: 'csc-comm-end', capture_id: capture,
          status: 'completed', source_bytes: count * payload.length };
        await writer.write(frame(start));
        for (let i = 0; i < count; i += 1) {
          await writer.write(frame({ kind: 'csc-comm-body',
            capture_id: capture, encoding: 'utf8', data: payload }));
        }
        await writer.write(frame(end));
        await writer.close();
        const dir = await config.handle.getDirectoryHandle(
          'dc-comm-' + config.namespace);
        let fragments = 0;
        let bodyCount = 0;
        let bodyBytes = 0;
        let manifest = null;
        const archives = new Map();
        const dec = new TextDecoder('utf-8', { fatal: true });
        for await (const [fileName, entry] of dir.entries()) {
          const stored = new Uint8Array(await
            (await entry.getFile()).arrayBuffer());
          if (fileName === 'manifest.json') {
            manifest = JSON.parse(dec.decode(stored));
            continue;
          }
          if (!/^fragment-\d{8}\.jsonl\.zst$/.test(fileName)) {
            throw new Error('Unexpected Worker output ' + fileName);
          }
          const hash = new Uint8Array(await self.crypto.subtle.digest(
            'SHA-256', stored));
          archives.set(fileName, Array.from(hash,
            item => item.toString(16).padStart(2, '0')).join(''));
          const restored = self.__dcWorkerCompressorBridge.decompress(stored);
          const rows = dec.decode(restored).trimEnd().split('\n');
          const header = JSON.parse(rows.shift());
          if (header.version?.comm !== config.version ||
              header.key_restart !== restart) {
            throw new Error('Physical fragment header does not match producer');
          }
          for (const row of rows) {
            const item = JSON.parse(row);
            if (item.kind === 'csc-comm-body') {
              if (item.capture_id !== capture || item.data !== payload) {
                throw new Error('Physical body differs from synthetic source');
              }
              bodyCount += 1;
              bodyBytes += item.data.length;
            }
          }
          fragments += 1;
        }
        if (fragments < 2 || bodyCount !== count ||
            bodyBytes !== count * payload.length) {
          throw new Error('Fragment count or exact body readback mismatch');
        }
        if (manifest?.schema !== 'dc-csc-comm-segments/2' ||
            manifest.namespace !== config.namespace ||
            Object.keys(manifest.archives ?? {}).length !== fragments ||
            [...archives].some(([name, hash]) =>
              manifest.archives[name] !== hash)) {
          throw new Error('Physical manifest inventory or SHA256 mismatch');
        }
        self.postMessage({ type: 'csc-writer-probe-result',
          ok: true, fragments, bodyBytes });
      })().catch(error => self.postMessage({
        type: 'csc-writer-probe-result', ok: false,
        reason: String(error?.message ?? 'unknown').slice(0, 350)
      }));
    });
  }

  /**
   * Opt-in Chrome/Tampermonkey Worker disk test; never touches real archives.
   * Directory picker executes synchronously under the clicked Test row.
   * @returns {Promise<string>} Verified real Worker storage evidence.
   */
  async function testCscCommDiskWriter() {
    const realm = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    assert(typeof realm.showDirectoryPicker === 'function',
      'Directory picker unavailable in current page.');
    // Picker MUST be invoked before any await or transient gesture is lost.
    const picking = realm.showDirectoryPicker({ mode: 'readwrite' });
    const directory = await picking;
    const namespace = 'probe-' + crypto.randomUUID().replace(/-/g, '');
    const name = 'dc-comm-' + namespace;
    const version = VERSION;
    const restart = '2026-10-22T00:00:00.000Z';
    const bridge = globalThis['__dcCompressor'];
    assert(typeof bridge?.wasmGzipBase64 === 'string',
      'Bundled Zstd/WASM is unavailable.');
    // Do not ever reuse, reset or remove any preexisting directory.
    try {
      await directory.getDirectoryHandle(name, { create: false });
      throw new Error('Synthetic target directory already exists.');
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
    const source = cscCommDiskWorkerSource(false) + '\n(' +
      cscCommDiskProbeEntrypoint.toString() + ')();';
    const url = realm.URL.createObjectURL(new realm.Blob(
      [source], { type: 'text/javascript' }));
    let worker = null;
    let timer = null;

    try {
      worker = new realm.Worker(url);
      const result = await new Promise((resolve, reject) => {
        let started = false;
        worker.addEventListener('error', event => reject(new Error(
          event.message || 'Worker script failed to start')));
        worker.addEventListener('message', event => {
          const item = event.data;
          if (item?.type === 'csc-writer-error') {
            reject(new Error('Worker disk error: ' + item.reason));
          } else if (item?.type === 'csc-writer-ready' && !started) {
            started = true;
            // Namespace is caller-owned from the preflight absence check.
            worker.postMessage({ type: 'csc-writer-probe-run',
              handle: directory, namespace, version, key_restart: restart });
          } else if (item?.type === 'csc-writer-probe-result') {
            if (item.ok) resolve(item);
            else reject(new Error(item.reason));
          }
        });
        timer = setTimeout(() => reject(new Error(
          'Writer disk probe exceeded 90 seconds')), 90000);
        worker.postMessage({ type: 'csc-writer-open', handle: directory,
          namespace, version, key_restart: restart,
          wasm_gzip_base64: bridge.wasmGzipBase64 });
      });
      return 'PASS: physical Zstd Worker fragments=' + result.fragments +
        '; byte-exact synthetic readback=' + result.bodyBytes +
        '; version/key_restart headers; exclusive Web Lock';
    } finally {
      if (timer !== null) clearTimeout(timer);
      worker?.terminate();
      realm.URL.revokeObjectURL(url);
      // The absence check above established exclusive test-namespace
      // ownership before Worker startup; cleanup also covers early failure.
      try { await directory.removeEntry(name, { recursive: true }); }
      catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
    }
  }
