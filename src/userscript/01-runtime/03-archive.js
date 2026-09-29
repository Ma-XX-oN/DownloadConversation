
  /** True after the embedded archive codec has been initialized. */
  let archiveCodecReady = false;

  /**
   * Initializes the embedded archive codec once.
   *
   * @returns {Promise<void>} Resolves when the codec is ready.
   */
  async function archiveCodecModule() {
    if (archiveCodecReady) return;
    const bridge = globalThis['__dcArchiveCodec'];
    if (!bridge) throw new Error('Archive codec runtime bridge is unavailable.');
    const binary = atob(bridge.wasmGzipBase64);
    const compressed = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      compressed[index] = binary.charCodeAt(index);
    }
    const stream = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const wasmBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    await bridge.init(wasmBytes);
    archiveCodecReady = true;
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
   * Decompresses one or more concatenated archive streams.
   *
   * @param {Uint8Array} archiveBytes - Complete archive bytes.
   * @returns {Promise<Uint8Array>} Exact decompressed bytes.
   */
  async function extractArchive(archiveBytes) {
    if (!(archiveBytes instanceof Uint8Array)) {
      throw new TypeError('Archive input must be Uint8Array.');
    }
    await archiveCodecModule();
    return globalThis['__dcArchiveCodec'].decompress(archiveBytes);
  }

  /**
   * Begins one continuously open archive encoder.
   *
   * @returns {Promise<Object>} Mutable writer state.
   */
  async function streamingArchiveWriterBegin() {
    await archiveCodecModule();
    const Encoder = globalThis['__dcArchiveCodec'].Encoder;
    return { encoder: new Encoder(9), chunks: [], size: 0, finished: false };
  }

  /**
   * Appends exact uncompressed bytes without resetting the codec dictionary.
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
    const raw = globalThis['__dcArchiveCodec'].decompress(archiveBytes);
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
