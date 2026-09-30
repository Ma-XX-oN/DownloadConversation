
  /** True after the embedded compressor has been initialized. */
  let compressorReady = false;

  /**
   * Initializes the embedded compressor once.
   *
   * @returns {Promise<void>} Resolves when the compressor is ready.
   */
  async function compressorModule() {
    if (compressorReady) return;
    const bridge = globalThis['__dcCompressor'];
    if (!bridge) throw new Error('Compressor runtime bridge is unavailable.');
    const binary = atob(bridge.wasmGzipBase64);
    const compressed = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      compressed[index] = binary.charCodeAt(index);
    }
    const stream = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const wasmBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    await bridge.init(wasmBytes);
    compressorReady = true;
  }

  /**
   * Returns the selected compressor's filename extension.
   *
   * @returns {string} Extension including the leading dot.
   */
  function compressorExtension() {
    return globalThis['__dcCompressor']._extension;
  }

  /**
   * Returns the selected compressor's MIME type.
   *
   * @returns {string} Archive MIME type.
   */
  function compressorMimeType() {
    return globalThis['__dcCompressor']._mime_type;
  }

  /**
   * Compresses exact bytes as one archive stream.
   *
   * @param {Uint8Array} bytes - Exact source bytes.
   * @returns {Promise<Uint8Array>} Complete archive stream.
   */
  async function createArchive(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('Archive input must be Uint8Array.');
    }
    const writer = await streamingArchiveWriterBegin();
    try {
      streamingArchiveWriterAppendBytes(writer, bytes);
      return streamingArchiveWriterFinish(writer);
    } catch (error) {
      if (!writer.finished) {
        try { streamingArchiveWriterFinish(writer); } catch {}
      }
      throw error;
    }
  }

  /**
   * Decompresses one or more archive streams.
   *
   * @param {Uint8Array} archiveBytes - Complete archive bytes.
   * @returns {Promise<Uint8Array>} Exact decompressed bytes.
   */
  async function extractArchive(archiveBytes) {
    if (!(archiveBytes instanceof Uint8Array)) {
      throw new TypeError('Archive input must be Uint8Array.');
    }
    await compressorModule();
    return globalThis['__dcCompressor'].decompress(archiveBytes);
  }

  /**
   * Begins one continuously open archive encoder.
   *
   * @returns {Promise<Object>} Mutable writer state.
   */
  async function streamingArchiveWriterBegin() {
    await compressorModule();
    const compressor = globalThis['__dcCompressor'];
    return {
      encoder: new compressor.Encoder(compressor._compression_level),
      chunks: [],
      size: 0,
      finished: false
    };
  }

  /**
   * Appends exact uncompressed bytes without resetting the compressor dictionary.
   *
   * @param {Object} writer - Open writer state.
   * @param {Uint8Array} bytes - Exact bytes to append.
   * @returns {void}
   */
  function streamingArchiveWriterAppendBytes(writer, bytes) {
    if (!bytes.byteLength) return;
    const output = writer.encoder.write(bytes);
    if (output.byteLength) {
      writer.chunks.push(output);
      writer.size += output.byteLength;
    }
  }

  /**
   * Decompresses a historical archive stream into the continuously open writer.
   *
   * @param {Object} writer - Open writer state.
   * @param {Uint8Array} archiveBytes - Historical archive bytes.
   * @returns {number} Exact number of decompressed bytes appended.
   */
  function streamingArchiveWriterAppendArchive(writer, archiveBytes) {
    const raw = globalThis['__dcCompressor'].decompress(archiveBytes);
    streamingArchiveWriterAppendBytes(writer, raw);
    return raw.byteLength;
  }

  /**
   * Finalizes one archive stream and returns all compressed bytes.
   *
   * @param {Object} writer - Open writer state.
   * @returns {Uint8Array} Complete archive stream.
   */
  function streamingArchiveWriterFinish(writer) {
    if (writer.finished) throw new Error('Streaming archive writer is already finished.');
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
