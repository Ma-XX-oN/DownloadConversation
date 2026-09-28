
  /** True after the embedded direct XZ Wasm codec has been initialized. */
  let directXzReady = false;

  /**
   * Initializes the embedded direct XZ codec once.
   *
   * @returns {Promise<void>} Resolves when the codec is ready.
   */
  async function directXzModule() {
    if (directXzReady) return;
    const bridge = globalThis['__dcDirectXz'];
    if (!bridge) throw new Error('Direct XZ runtime bridge is unavailable.');
    const binary = atob(bridge.wasmGzipBase64);
    const compressed = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      compressed[index] = binary.charCodeAt(index);
    }
    const stream = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const wasmBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    bridge.initSync({ module: wasmBytes });
    directXzReady = true;
  }

  /**
   * Compresses exact bytes as one XZ stream at preset 9.
   *
   * @param {Uint8Array} bytes - Exact source bytes.
   * @returns {Promise<Uint8Array>} Complete XZ stream.
   */
  async function createXzArchive(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('XZ input must be Uint8Array.');
    const writer = await streamingXzWriterBegin();
    try {
      streamingXzWriterAppendBytes(writer, bytes);
      return streamingXzWriterFinish(writer);
    } catch (error) {
      if (!writer.finished) {
        try { streamingXzWriterFinish(writer); } catch {}
      }
      throw error;
    }
  }

  /**
   * Decompresses one or more concatenated XZ streams.
   *
   * @param {Uint8Array} archiveBytes - Complete XZ bytes.
   * @returns {Promise<Uint8Array>} Exact decompressed bytes.
   */
  async function extractXzArchive(archiveBytes) {
    if (!(archiveBytes instanceof Uint8Array)) throw new TypeError('XZ input must be Uint8Array.');
    await directXzModule();
    return globalThis['__dcDirectXz'].decompress_xz(archiveBytes);
  }

  /**
   * Begins one continuously open preset-9 XZ encoder.
   *
   * @returns {Promise<Object>} Mutable writer state.
   */
  async function streamingXzWriterBegin() {
    await directXzModule();
    const Encoder = globalThis['__dcDirectXz'].XzEncoder;
    return { encoder: new Encoder(9), chunks: [], size: 0, finished: false };
  }

  /**
   * Appends exact uncompressed bytes without resetting the XZ dictionary.
   *
   * @param {Object} writer - Open writer state.
   * @param {Uint8Array} bytes - Exact bytes to append.
   * @returns {void}
   */
  function streamingXzWriterAppendBytes(writer, bytes) {
    if (!bytes.byteLength) return;
    const output = writer.encoder.write(bytes);
    if (output.byteLength) {
      writer.chunks.push(output);
      writer.size += output.byteLength;
    }
  }

  /**
   * Decompresses a historical XZ stream into the continuously open writer.
   *
   * @param {Object} writer - Open writer state.
   * @param {Uint8Array} archiveBytes - Historical XZ bytes.
   * @returns {void}
   */
  function streamingXzWriterAppendArchive(writer, archiveBytes) {
    const raw = globalThis['__dcDirectXz'].decompress_xz(archiveBytes);
    streamingXzWriterAppendBytes(writer, raw);
  }

  /**
   * Finalizes one XZ stream and returns all compressed bytes.
   *
   * @param {Object} writer - Open writer state.
   * @returns {Uint8Array} Complete XZ stream.
   */
  function streamingXzWriterFinish(writer) {
    if (writer.finished) throw new Error('Streaming XZ writer is already finished.');
    writer.finished = true;
    const tail = writer.encoder.finish();
    if (tail.byteLength) {
      writer.chunks.push(tail);
      writer.size += tail.byteLength;
    }
    writer.encoder.free();
    const result = new Uint8Array(writer.size);
    let offset = 0;
    for (const chunk of writer.chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
