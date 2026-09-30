let __dcCompressorModule = null;

async function __dcCompressorInit(wasmBytes) {
  const instantiated = await WebAssembly.instantiate(wasmBytes, {
    env: { emscripten_notify_memory_growth() {} }
  });
  __dcCompressorModule = instantiated.instance.exports;
}

function __dcCompressorViews(module) {
  return {
    bytes: new Uint8Array(module.memory.buffer),
    words: new Uint32Array(module.memory.buffer)
  };
}

class CompressorEncoder {
  constructor(level) {
    const module = __dcCompressorModule;
    if (!module) throw new Error('Compressor is not initialized.');
    this.module = module;
    this.handle = module.compressor_encoder_new(level);
    this.finished = false;
    if (!this.handle) throw new Error('Compressor encoder initialization failed.');
  }

  write(bytes) {
    if (this.finished) throw new Error('Compressor encoder is already finished.');
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Archive input must be Uint8Array.');
    if (!bytes.byteLength) return new Uint8Array();
    const module = this.module;
    const input = module.compressor_malloc(bytes.byteLength);
    const outputPointer = module.compressor_malloc(4);
    const outputLength = module.compressor_malloc(4);
    let compressedPointer = 0;
    try {
      let views = __dcCompressorViews(module);
      views.bytes.set(bytes, input);
      if (module.compressor_encoder_write(
        this.handle,
        input,
        bytes.byteLength,
        outputPointer,
        outputLength
      ) !== 1) throw new Error('Compressor encoder write failed.');
      views = __dcCompressorViews(module);
      compressedPointer = views.words[outputPointer >>> 2] >>> 0;
      const length = views.words[outputLength >>> 2] >>> 0;
      return views.bytes.slice(compressedPointer, compressedPointer + length);
    } finally {
      if (compressedPointer) module.compressor_buffer_free(compressedPointer);
      module.compressor_free(input);
      module.compressor_free(outputPointer);
      module.compressor_free(outputLength);
    }
  }

  finish() {
    if (this.finished) throw new Error('Compressor encoder is already finished.');
    this.finished = true;
    const module = this.module;
    const outputPointer = module.compressor_malloc(4);
    const outputLength = module.compressor_malloc(4);
    let compressedPointer = 0;
    try {
      if (module.compressor_encoder_finish(
        this.handle,
        outputPointer,
        outputLength
      ) !== 1) throw new Error('Compressor encoder finish failed.');
      const views = __dcCompressorViews(module);
      compressedPointer = views.words[outputPointer >>> 2] >>> 0;
      const length = views.words[outputLength >>> 2] >>> 0;
      return views.bytes.slice(compressedPointer, compressedPointer + length);
    } finally {
      if (compressedPointer) module.compressor_buffer_free(compressedPointer);
      module.compressor_free(outputPointer);
      module.compressor_free(outputLength);
    }
  }

  free() {
    if (!this.handle) return;
    this.module.compressor_encoder_free(this.handle);
    this.handle = 0;
  }
}

function __dcCompressorDecompress(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Archive input must be Uint8Array.');
  const module = __dcCompressorModule;
  if (!module) throw new Error('Compressor is not initialized.');
  const input = module.compressor_malloc(Math.max(bytes.byteLength, 1));
  const outputPointer = module.compressor_malloc(4);
  const outputLength = module.compressor_malloc(4);
  let decodedPointer = 0;
  try {
    let views = __dcCompressorViews(module);
    if (bytes.byteLength) views.bytes.set(bytes, input);
    if (module.compressor_decompress(
      input,
      bytes.byteLength,
      outputPointer,
      outputLength
    ) !== 1) throw new Error('Archive decompression failed.');
    views = __dcCompressorViews(module);
    decodedPointer = views.words[outputPointer >>> 2] >>> 0;
    const length = views.words[outputLength >>> 2] >>> 0;
    return views.bytes.slice(decodedPointer, decodedPointer + length);
  } finally {
    if (decodedPointer) module.compressor_buffer_free(decodedPointer);
    module.compressor_free(input);
    module.compressor_free(outputPointer);
    module.compressor_free(outputLength);
  }
}

globalThis.__dcCompressor = {
  init: __dcCompressorInit,
  Encoder: CompressorEncoder,
  decompress: __dcCompressorDecompress,
  wasmGzipBase64: '__DC_COMPRESSOR_WASM_GZIP_BASE64__',
  _extension: '__DC_COMPRESSOR_EXTENSION__',
  _mime_type: '__DC_COMPRESSOR_MIME_TYPE__',
  _compression_level: __DC_COMPRESSOR_LEVEL__
};
