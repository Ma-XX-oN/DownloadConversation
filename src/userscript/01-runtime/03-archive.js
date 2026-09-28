
  // Lazily initialized singleton for the build-materialized direct 7-Zip module.
  let stream7zModulePromise = null;
  // Monotonic source handle used to correlate Wasm reads with one archive operation.
  let stream7zNextSourceId = 1;
  // Monotonic output handle used to correlate random-access Wasm writes.
  let stream7zNextOutputId = 1;
  // Active exact-byte archive inputs keyed by their Wasm source handles.
  const stream7zSources = new Map();
  // Active growable archive outputs keyed by their Wasm output handles.
  const stream7zOutputs = new Map();

  /**
   * Decodes the build-materialized 7-Zip 26.03 Wasm payload.
   *
   * @returns {Uint8Array} Wasm bytes.
   */
  async function stream7zWasmBytes() {
    const binary = atob(STREAM7Z_WASM_GZIP_BASE64);
    const compressed = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      compressed[index] = binary.charCodeAt(index);
    }
    const stream = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * Returns the singleton direct 7-Zip module.
   *
   * @returns {Promise<Object>} Initialized module.
   */
  function stream7zModule() {
    if (!stream7zModulePromise) {
      stream7zModulePromise = stream7zWasmBytes().then(wasmBinary => Stream7zModule({
        wasmBinary,
        stream7zRead(id, target) {
          const source = stream7zSources.get(id);
          if (!source) return -1;
          const count = Math.min(target.length, source.bytes.length - source.offset);
          if (count <= 0) return 0;
          target.set(source.bytes.subarray(source.offset, source.offset + count));
          source.offset += count;
          return count;
        },
        stream7zReadAt(id, position, target) {
          const source = stream7zSources.get(id);
          if (!source || !Number.isSafeInteger(position) || position < 0) return -1;
          const count = Math.min(target.length, source.bytes.length - position);
          if (count <= 0) return 0;
          target.set(source.bytes.subarray(position, position + count));
          return count;
        },
        stream7zWriteAt(id, position, bytes) {
          const output = stream7zOutputs.get(id);
          if (!output || !Number.isSafeInteger(position) || position < 0) return -1;
          const required = position + bytes.length;
          if (required > output.bytes.length) {
            const grown = new Uint8Array(Math.max(required, output.bytes.length * 2, 4096));
            grown.set(output.bytes);
            output.bytes = grown;
          }
          output.bytes.set(bytes, position);
          output.size = Math.max(output.size, required);
          return bytes.length;
        },
        stream7zSetSize(id, size) {
          const output = stream7zOutputs.get(id);
          if (!output || !Number.isSafeInteger(size) || size < 0) return -1;
          if (size > output.bytes.length) {
            const grown = new Uint8Array(size);
            grown.set(output.bytes.subarray(0, output.size));
            output.bytes = grown;
          }
          output.size = size;
          return 0;
        }
      }));
    }
    return stream7zModulePromise;
  }

  /**
   * Creates one stock-compatible 7z archive containing one member.
   *
   * @param {Uint8Array} bytes - Exact member bytes.
   * @param {string} memberName - Archive member name.
   * @param {number|null} memberMTimeMs - Optional Unix modification time in milliseconds.
   * @returns {Promise<Uint8Array>} Complete 7z archive bytes.
   */
  async function create7zArchive(bytes, memberName, memberMTimeMs = null) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Archive input must be Uint8Array.');
    if (!/^[\x20-\x7e]+$/.test(memberName)) {
      throw new Error('Archive member name must contain ASCII characters only.');
    }
    if (memberMTimeMs !== null &&
        (!Number.isSafeInteger(memberMTimeMs) || memberMTimeMs < 0)) {
      throw new Error('Archive member modification time must be a non-negative integer.');
    }
    const module = await stream7zModule();
    const sourceId = stream7zNextSourceId++;
    const outputId = stream7zNextOutputId++;
    const output = { bytes: new Uint8Array(4096), size: 0 };
    stream7zSources.set(sourceId, { bytes, offset: 0 });
    stream7zOutputs.set(outputId, output);
    try {
      const hasMTime = memberMTimeMs !== null;
      const create = module.cwrap(
        hasMTime ? 'stream7z_create_mtime' : 'stream7z_create',
        'number',
        hasMTime
          ? ['number', 'number', 'string', 'number', 'number']
          : ['number', 'number', 'string', 'number']
      );
      const args = [sourceId, outputId, memberName, bytes.length];
      if (hasMTime) args.push(memberMTimeMs);
      const result = create(...args);
      if (result !== 0) {
        const lastError = module.cwrap('stream7z_last_error', 'string', [])();
        throw new Error(`7-Zip archive creation failed: ${lastError || result}`);
      }
      return output.bytes.slice(0, output.size);
    } finally {
      stream7zSources.delete(sourceId);
      stream7zOutputs.delete(outputId);
    }
  }


  /**
   * Extracts the single member from one stock-compatible 7z archive.
   *
   * @param {Uint8Array} archiveBytes - Complete 7z archive bytes.
   * @returns {Promise<Uint8Array>} Exact extracted member bytes.
   */
  async function extract7zArchive(archiveBytes) {
    if (!(archiveBytes instanceof Uint8Array)) {
      throw new TypeError('Archive input must be Uint8Array.');
    }
    const module = await stream7zModule();
    const sourceId = stream7zNextSourceId++;
    const outputId = stream7zNextOutputId++;
    const output = { bytes: new Uint8Array(4096), size: 0 };
    stream7zSources.set(sourceId, { bytes: archiveBytes, offset: 0 });
    stream7zOutputs.set(outputId, output);
    try {
      const extract = module.cwrap(
        'stream7z_extract',
        'number',
        ['number', 'number', 'number']
      );
      const result = extract(sourceId, archiveBytes.length, outputId);
      if (result !== 0) {
        const lastError = module.cwrap('stream7z_last_error', 'string', [])();
        throw new Error(`7-Zip archive extraction failed: ${lastError || result}`);
      }
      return output.bytes.slice(0, output.size);
    } finally {
      stream7zSources.delete(sourceId);
      stream7zOutputs.delete(outputId);
    }
  }


  // Streaming 7z bridge used by communication Duplicate.  Historical archives
  // are decompressed and fed into one continuously open output compressor.
  /** Lazily initialized singleton for the streaming libarchive Wasm module. */
  let streaming7zModulePromise = null;
  /** Monotonic source handle for one streaming Wasm input. */
  let streaming7zNextSourceId = 1;
  /** Monotonic output handle for one streaming Wasm archive output. */
  let streaming7zNextOutputId = 1;
  /** Active streaming source byte ranges keyed by Wasm source handle. */
  const streaming7zSources = new Map();
  /** Active streaming output chunk collectors keyed by Wasm output handle. */
  const streaming7zOutputs = new Map();

  /**
   * Decodes the verified streaming libarchive Wasm payload.
   *
   * @returns {Promise<Uint8Array>} Wasm bytes.
   */
  async function streaming7zWasmBytes() {
    const binary = atob(STREAMING7Z_WASM_GZIP_BASE64);
    const compressed = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      compressed[index] = binary.charCodeAt(index);
    }
    const stream = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * Returns the singleton streaming 7z module.
   *
   * @returns {Promise<Object>} Initialized module.
   */
  function streaming7zModule() {
    if (!streaming7zModulePromise) {
      streaming7zModulePromise = streaming7zWasmBytes().then(wasmBinary =>
        Streaming7zModule({
          wasmBinary,
          stream7zRead(id, target) {
            const source = streaming7zSources.get(id);
            if (!source) return -1;
            const count = Math.min(
              target.length,
              source.bytes.length - source.offset
            );
            if (count <= 0) return 0;
            target.set(source.bytes.subarray(
              source.offset,
              source.offset + count
            ));
            source.offset += count;
            return count;
          },
          stream7zSeek(id, offset, whence) {
            const source = streaming7zSources.get(id);
            if (!source) return -1;
            let position = offset;
            if (whence === 1) position = source.offset + offset;
            else if (whence === 2) position = source.bytes.length + offset;
            if (!Number.isSafeInteger(position)
                || position < 0
                || position > source.bytes.length) return -1;
            source.offset = position;
            return position;
          },
          stream7zWrite(id, bytes) {
            const output = streaming7zOutputs.get(id);
            if (!output) return -1;
            output.chunks.push(bytes.slice());
            output.size += bytes.length;
            return bytes.length;
          }
        })
      );
    }
    return streaming7zModulePromise;
  }

  /**
   * Registers one bounded in-memory source for synchronous Wasm callbacks.
   *
   * @param {Uint8Array} bytes - Exact source bytes.
   * @returns {number} Source identifier.
   */
  function streaming7zRegisterSource(bytes) {
    const id = streaming7zNextSourceId++;
    streaming7zSources.set(id, { bytes, offset: 0 });
    return id;
  }

  /**
   * Begins one continuously open streaming 7z member.
   *
   * @param {string} memberName - Archive member name.
   * @param {number} expectedBytes - Exact uncompressed byte count.
   * @returns {Promise<Object>} Writer state.
   */
  async function streaming7zWriterBegin(memberName, expectedBytes) {
    const module = await streaming7zModule();
    const outputId = streaming7zNextOutputId++;
    const output = { chunks: [], size: 0 };
    streaming7zOutputs.set(outputId, output);
    const begin = module.cwrap(
      'stream7z_writer_begin',
      'number',
      ['number', 'string', 'number']
    );
    const pointer = begin(outputId, memberName, expectedBytes);
    if (!pointer) {
      streaming7zOutputs.delete(outputId);
      const lastError = module.cwrap('stream7z_last_error', 'string', [])();
      throw new Error(`Streaming 7-Zip writer start failed: ${lastError}`);
    }
    return { module, pointer, outputId, output, finished: false };
  }

  /**
   * Appends exact uncompressed bytes to an open streaming writer.
   *
   * @param {Object} writer - Open writer state.
   * @param {Uint8Array} bytes - Exact bytes to append.
   * @returns {void}
   */
  function streaming7zWriterAppendBytes(writer, bytes) {
    if (!bytes.byteLength) return;
    const sourceId = streaming7zRegisterSource(bytes);
    try {
      const append = writer.module.cwrap(
        'stream7z_writer_append_source',
        'number',
        ['number', 'number', 'number']
      );
      if (append(writer.pointer, sourceId, bytes.byteLength) !== 0) {
        const lastError = writer.module.cwrap(
          'stream7z_last_error',
          'string',
          []
        )();
        throw new Error(`Streaming 7-Zip append failed: ${lastError}`);
      }
    } finally {
      streaming7zSources.delete(sourceId);
    }
  }

  /**
   * Decompresses one historical 7z member directly into an open writer.
   *
   * @param {Object} writer - Open writer state.
   * @param {Uint8Array} archiveBytes - One complete historical archive.
   * @returns {void}
   */
  function streaming7zWriterAppendArchive(writer, archiveBytes) {
    const sourceId = streaming7zRegisterSource(archiveBytes);
    let reader = 0;
    try {
      const open = writer.module.cwrap(
        'stream7z_reader_open',
        'number',
        ['number']
      );
      reader = open(sourceId);
      if (!reader) {
        const lastError = writer.module.cwrap(
          'stream7z_last_error',
          'string',
          []
        )();
        throw new Error(`Streaming 7-Zip reader open failed: ${lastError}`);
      }
      const pipe = writer.module.cwrap(
        'stream7z_pipe_reader_to_writer',
        'number',
        ['number', 'number']
      );
      if (pipe(reader, writer.pointer) !== 0) {
        const lastError = writer.module.cwrap(
          'stream7z_last_error',
          'string',
          []
        )();
        throw new Error(`Streaming 7-Zip pipe failed: ${lastError}`);
      }
    } finally {
      if (reader) {
        writer.module.cwrap(
          'stream7z_reader_close',
          'number',
          ['number']
        )(reader);
      }
      streaming7zSources.delete(sourceId);
    }
  }

  /**
   * Finalizes an open streaming writer and returns the compressed archive.
   *
   * @param {Object} writer - Open writer state.
   * @returns {Uint8Array} Complete 7z archive.
   */
  function streaming7zWriterFinish(writer) {
    if (writer.finished) throw new Error('Streaming 7-Zip writer is already finished.');
    writer.finished = true;
    const finish = writer.module.cwrap(
      'stream7z_writer_finish',
      'number',
      ['number']
    );
    if (finish(writer.pointer) !== 0) {
      const lastError = writer.module.cwrap(
        'stream7z_last_error',
        'string',
        []
      )();
      streaming7zOutputs.delete(writer.outputId);
      throw new Error(`Streaming 7-Zip finalization failed: ${lastError}`);
    }
    const result = new Uint8Array(writer.output.size);
    let offset = 0;
    for (const chunk of writer.output.chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    streaming7zOutputs.delete(writer.outputId);
    return result;
  }
