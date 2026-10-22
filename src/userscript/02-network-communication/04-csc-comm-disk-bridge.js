
  /**
   * Adapter for the exact DC vendored Zstd/WASM engine, initialized in Worker.
   */
  /**
   * Performs cscCommWorkerZstdCodec in the isolated COMM writer.
   * @returns {any} cscCommWorkerZstdCodec result.
   */
  function cscCommWorkerZstdCodec() {
    let ready = false;
    const engine = self.__dcWorkerCompressorBridge;
    return Object.freeze({
      async init(b64) {
        if (ready) return;
        if (typeof b64 !== 'string' || b64.length < 16) {
          throw new Error('csc-writer-invalid-wasm');
        }
        const zipped = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const stream = new Blob([zipped]).stream()
          .pipeThrough(new DecompressionStream('gzip'));
        const wasm = new Uint8Array(await new Response(stream).arrayBuffer());
        await engine.init(wasm);
        ready = true;
      },
      async compress(raw) {
        if (!ready) throw new Error('csc-writer-compressor-not-ready');
        const encoder = new engine.Encoder(3);
        const chunks = [];
        let total = 0;
        try {
          for (let i = 0; i < raw.length; i += 512 * 1024) {
            const chunk = encoder.write(raw.subarray(i, i + 512 * 1024));
            if (chunk.length) { chunks.push(chunk); total += chunk.length; }
          }
          const tail = encoder.finish();
          if (tail.length) { chunks.push(tail); total += tail.length; }
        } finally {
          encoder.free();
        }
        const output = new Uint8Array(total);
        let offset = 0;
        for (const item of chunks) {
          output.set(item, offset);
          offset += item.length;
        }
        return output;
      },
      async decompress(zstd) {
        if (!ready) throw new Error('csc-writer-compressor-not-ready');
        return engine.decompress(zstd);
      }
    });
  }

  /**
   * Bootstraps the writer and #311 processor in the SAME dedicated Worker.
   * The calling page passes ONLY the granted handle and WASM codec bytes.
   */
  /**
   * Performs cscCommDiskWorkerSource in the isolated COMM writer.
   * @returns {any} cscCommDiskWorkerSource result.
   */
  function cscCommDiskWorkerSource() {
    const bridge = globalThis['__dcCompressor'];
    assert(typeof bridge?.init === 'function' &&
      typeof bridge?.Encoder === 'function' &&
      typeof bridge?.decompress === 'function' &&
      typeof bridge?.wasmGzipBase64 === 'string',
    'Bundled DC Zstd/WASM compressor is not available.');
    return [
      "'use strict';",
      'let __dcCompressorModule = null;',
      'function __dcCompressorViews(module) {',
      '  return { bytes: new Uint8Array(module.memory.buffer),',
      '    words: new Uint32Array(module.memory.buffer) };',
      '}',
      bridge.init.toString(),
      bridge.Encoder.toString(),
      bridge.decompress.toString(),
      'self.__dcWorkerCompressorBridge = {',
      '  init: __dcCompressorInit, Encoder: CompressorEncoder,',
      '  decompress: __dcCompressorDecompress',
      '};',
      'self.__cscWriterLease = (' + cscCommWriterLease.toString() + ')(self);',
      'self.__cscWriterManifest = (' + cscCommDiskManifest.toString() + ')(self);',
      'self.__cscWriterCopy = (' + cscCommDiskCopy.toString() + ')();',
      'self.__cscDiskWriter = (' + cscCommDiskWriter.toString() +
        ')(self, (' + cscCommWorkerZstdCodec.toString() + ')());',
      cscCommProcessingWorkerSource()
    ].join('\n');
  }
