
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
   * @returns {Promise<Uint8Array>} Complete 7z archive bytes.
   */
  async function create7zArchive(bytes, memberName) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Archive input must be Uint8Array.');
    if (!/^[\x20-\x7e]+$/.test(memberName)) {
      throw new Error('Archive member name must contain ASCII characters only.');
    }
    const module = await stream7zModule();
    const sourceId = stream7zNextSourceId++;
    const outputId = stream7zNextOutputId++;
    const output = { bytes: new Uint8Array(4096), size: 0 };
    stream7zSources.set(sourceId, { bytes, offset: 0 });
    stream7zOutputs.set(outputId, output);
    try {
      const create = module.cwrap('stream7z_create', 'number', ['number', 'number', 'string', 'number']);
      const result = create(sourceId, outputId, memberName, bytes.length);
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
