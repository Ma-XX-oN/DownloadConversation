
  /** Lazily initializes the embedded direct XZ codec. */
  let directXzReady = false;

  async function directXzModule() {
    if (directXzReady) return;
    const binary = atob(DIRECT_XZ_WASM_GZIP_BASE64);
    const compressed = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      compressed[index] = binary.charCodeAt(index);
    }
    const stream = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const wasmBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    initSync({ module: wasmBytes });
    directXzReady = true;
  }

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

  async function extractXzArchive(archiveBytes) {
    if (!(archiveBytes instanceof Uint8Array)) throw new TypeError('XZ input must be Uint8Array.');
    await directXzModule();
    return decompress_xz(archiveBytes);
  }

  async function streamingXzWriterBegin() {
    await directXzModule();
    return { encoder: new XzEncoder(9), chunks: [], size: 0, finished: false };
  }

  function streamingXzWriterAppendBytes(writer, bytes) {
    if (!bytes.byteLength) return;
    const output = writer.encoder.write(bytes);
    if (output.byteLength) {
      writer.chunks.push(output);
      writer.size += output.byteLength;
    }
  }

  function streamingXzWriterAppendArchive(writer, archiveBytes) {
    const raw = decompress_xz(archiveBytes);
    streamingXzWriterAppendBytes(writer, raw);
  }

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
