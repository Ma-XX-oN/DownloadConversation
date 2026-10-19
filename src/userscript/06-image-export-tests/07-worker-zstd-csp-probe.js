
  /**
   * Worker-side synthetic verification using the same vendored compressor bridge.
   * Only the generated test bytes enter the Worker; no page network data is read.
   *
   * @returns {void} Installs the one-shot Worker message handler.
   */
  function workerCompressorProbeEntrypoint() {
    self.onmessage = async event => {
      const started = performance.now();
      try {
        const b64 = event.data.wasm_gzip_base64;
        const compressed = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
        const stream = new Blob([compressed]).stream()
          .pipeThrough(new DecompressionStream('gzip'));
        const wasm = new Uint8Array(await new Response(stream).arrayBuffer());
        const engine = self['__dcWorkerCompressorBridge'];
        await engine.init(wasm);

        const bytes = new Uint8Array(10 * 1024 * 1024);
        for (let i = 0; i < bytes.length; i += 1) {
          bytes[i] = (Math.imul(i, 37) ^ (i >>> 9)) & 255;
        }
        const chunks = [];
        let length = 0;
        const writer = new engine.Encoder(event.data.level);
        try {
          for (let pos = 0; pos < bytes.length; pos += 512 * 1024) {
            const part = writer.write(bytes.subarray(pos, pos + 512 * 1024));
            if (part.length) { chunks.push(part); length += part.length; }
          }
          const tail = writer.finish();
          if (tail.length) { chunks.push(tail); length += tail.length; }
        } finally {
          writer.free();
        }
        const archive = new Uint8Array(length);
        let written = 0;
        for (const part of chunks) {
          archive.set(part, written);
          written += part.length;
        }
        const restored = engine.decompress(archive);
        if (restored.length !== bytes.length) {
          throw new Error('Zstd round-trip length mismatch.');
        }
        for (let i = 0; i < bytes.length; i += 1) {
          if (restored[i] !== bytes[i]) {
            throw new Error('Zstd round-trip byte mismatch at ' + i + '.');
          }
        }
        // Force measurable Worker CPU work while the page's timers continue.
        const until = performance.now() + 250;
        let iterations = 0;
        while (performance.now() < until) iterations += 1;
        self.postMessage({
          ok: true,
          bytes: bytes.length,
          archive_bytes: archive.length,
          elapsed_ms: Math.round(performance.now() - started),
          worker_cross_origin_isolated: self.crossOriginIsolated === true,
          iterations
        });
      } catch (error) {
        self.postMessage({
          ok: false,
          message: String(error?.message ?? error).slice(0, 350)
        });
      }
    };
  }

  /**
   * Probes one Worker realm with timeout and unconditional cleanup.
   *
   * @param {Window} realm - Page window or userscript window.
   * @param {string} script - Worker script from the pinned built compressor.
   * @param {Object} descriptor - Vendored bridge descriptor.
   * @returns {Promise<Object>} Synthetic Worker test result and page tick count.
   */
  async function workerCompressorProbeRealm(realm, script, descriptor) {
    assert(typeof realm.Worker === 'function', 'Worker constructor unavailable.');
    const url = realm.URL.createObjectURL(new realm.Blob(
      [script], { type: 'text/javascript' }
    ));
    let worker = null;
    let heartbeat = null;
    let timeout = null;
    let ticks = 0;
    try {
      worker = new realm.Worker(url);
      const result = await new Promise((resolve, reject) => {
        /**
         * Completes one Worker reply.
         *
         * @param {Object} value - Worker completion or failure.
         * @returns {void} No value is returned.
         */
        const finish = value => {
          if (value?.ok) resolve(value);
          else reject(new Error(value?.message || 'Worker returned no result.'));
        };
        worker.addEventListener('message', event => finish(event.data), { once: true });
        worker.addEventListener('error', event => {
          reject(new Error(event.message || 'Worker startup or script error.'));
        }, { once: true });
        timeout = setTimeout(() => reject(new Error('Worker timed out (30s).')), 30000);
        heartbeat = setInterval(() => { ticks += 1; }, 20);
        worker.postMessage({
          wasm_gzip_base64: descriptor.wasmGzipBase64,
          level: descriptor._compression_level
        });
      });
      return { ...result, page_ticks: ticks };
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      if (heartbeat !== null) clearInterval(heartbeat);
      worker?.terminate();
      realm.URL.revokeObjectURL(url);
    }
  }

  /**
   * Runs the real DC Zstd/WASM bridge in a classic dedicated Worker.
   *
   * @returns {Promise<string>} Short, visible browser capability evidence.
   */
  async function testWorkerZstdCsp() {
    const bridge = globalThis['__dcCompressor'];
    assert(typeof bridge?.init === 'function'
      && typeof bridge?.Encoder === 'function'
      && typeof bridge?.decompress === 'function'
      && typeof bridge?.wasmGzipBase64 === 'string',
    'Exact bundled Zstd compressor bridge is unavailable.');
    const source = [
      "'use strict';",
      'let __dcCompressorModule = null;',
      'function __dcCompressorViews(module) {',
      '  return { bytes: new Uint8Array(module.memory.buffer),',
      '    words: new Uint32Array(module.memory.buffer) };',
      '}',
      bridge.init.toString(),
      bridge.Encoder.toString(),
      bridge.decompress.toString(),
      "self['__dcWorkerCompressorBridge'] = {",
      '  init: __dcCompressorInit, Encoder: CompressorEncoder,',
      '  decompress: __dcCompressorDecompress',
      '};',
      '(' + workerCompressorProbeEntrypoint.toString() + ')();'
    ].join('\n');
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const contexts = [
      ['page', page],
      ['userscript', window]
    ];
    const failures = [];
    for (const [label, realm] of contexts) {
      if (label === 'userscript' && realm === page) continue;
      try {
        const result = await workerCompressorProbeRealm(realm, source, bridge);
        assert(result.bytes === 10 * 1024 * 1024, 'Incorrect test payload size.');
        const detail = [
          label + ' Worker',
          '10 MiB Zstd exact-byte PASS',
          result.elapsed_ms + 'ms',
          result.page_ticks + ' page ticks',
          'isolated=' + (page.crossOriginIsolated === true)
        ].join('; ');
        logDiagnostic('lifecycle', 'worker-zstd-csp-test-pass', {
          realm: label,
          bytes: result.bytes,
          archive_bytes: result.archive_bytes,
          worker_ms: result.elapsed_ms,
          page_ticks: result.page_ticks,
          cross_origin_isolated: page.crossOriginIsolated === true
        });
        return detail;
      } catch (error) {
        failures.push(label + ': ' + errorMessage(error));
      }
    }
    const reason = failures.join(' | ');
    logDiagnostic('warnings', 'worker-zstd-csp-test-fail', {
      cross_origin_isolated: page.crossOriginIsolated === true,
      errors: reason.slice(0, 700)
    });
    throw new Error(reason);
  }
