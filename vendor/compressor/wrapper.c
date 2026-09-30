#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <zstd.h>

typedef struct {
  ZSTD_CCtx* context;
} CompressorEncoder;

void* compressor_malloc(size_t size) {
  return malloc(size ? size : 1);
}

void compressor_free(void* pointer) {
  free(pointer);
}

void compressor_buffer_free(void* pointer) {
  free(pointer);
}

static int compressor_grow(uint8_t** buffer, size_t* capacity, size_t required) {
  if (required <= *capacity) return 1;
  size_t next = *capacity ? *capacity : ZSTD_CStreamOutSize();
  while (next < required) {
    if (next > SIZE_MAX / 2) return 0;
    next *= 2;
  }
  uint8_t* grown = (uint8_t*)realloc(*buffer, next);
  if (!grown) return 0;
  *buffer = grown;
  *capacity = next;
  return 1;
}

void* compressor_encoder_new(int level) {
  CompressorEncoder* encoder = (CompressorEncoder*)malloc(sizeof(CompressorEncoder));
  if (!encoder) return NULL;
  encoder->context = ZSTD_createCCtx();
  if (!encoder->context) {
    free(encoder);
    return NULL;
  }
  size_t result = ZSTD_CCtx_setParameter(
    encoder->context,
    ZSTD_c_compressionLevel,
    level
  );
  if (ZSTD_isError(result)) {
    ZSTD_freeCCtx(encoder->context);
    free(encoder);
    return NULL;
  }
  return encoder;
}

int compressor_encoder_write(
  void* handle,
  const uint8_t* input,
  size_t input_size,
  uint8_t** output,
  size_t* output_size
) {
  if (!handle || !output || !output_size || (!input && input_size)) return 0;
  *output = NULL;
  *output_size = 0;
  if (!input_size) return 1;

  CompressorEncoder* encoder = (CompressorEncoder*)handle;
  size_t capacity = ZSTD_compressBound(input_size) + ZSTD_CStreamOutSize();
  uint8_t* buffer = (uint8_t*)malloc(capacity ? capacity : 1);
  if (!buffer) return 0;

  ZSTD_inBuffer in = { input, input_size, 0 };
  size_t used = 0;
  while (in.pos < in.size) {
    if (!compressor_grow(&buffer, &capacity, used + ZSTD_CStreamOutSize())) {
      free(buffer);
      return 0;
    }
    ZSTD_outBuffer out = { buffer + used, capacity - used, 0 };
    size_t result = ZSTD_compressStream2(
      encoder->context,
      &out,
      &in,
      ZSTD_e_continue
    );
    if (ZSTD_isError(result)) {
      free(buffer);
      return 0;
    }
    used += out.pos;
  }

  if (!used) {
    free(buffer);
    return 1;
  }
  *output = buffer;
  *output_size = used;
  return 1;
}

int compressor_encoder_finish(
  void* handle,
  uint8_t** output,
  size_t* output_size
) {
  if (!handle || !output || !output_size) return 0;
  *output = NULL;
  *output_size = 0;

  CompressorEncoder* encoder = (CompressorEncoder*)handle;
  size_t capacity = ZSTD_CStreamOutSize();
  uint8_t* buffer = (uint8_t*)malloc(capacity ? capacity : 1);
  if (!buffer) return 0;

  ZSTD_inBuffer in = { NULL, 0, 0 };
  size_t used = 0;
  for (;;) {
    if (!compressor_grow(&buffer, &capacity, used + ZSTD_CStreamOutSize())) {
      free(buffer);
      return 0;
    }
    ZSTD_outBuffer out = { buffer + used, capacity - used, 0 };
    size_t remaining = ZSTD_compressStream2(
      encoder->context,
      &out,
      &in,
      ZSTD_e_end
    );
    if (ZSTD_isError(remaining)) {
      free(buffer);
      return 0;
    }
    used += out.pos;
    if (remaining == 0) break;
  }

  if (!used) {
    free(buffer);
    return 1;
  }
  *output = buffer;
  *output_size = used;
  return 1;
}

void compressor_encoder_free(void* handle) {
  CompressorEncoder* encoder = (CompressorEncoder*)handle;
  if (!encoder) return;
  ZSTD_freeCCtx(encoder->context);
  free(encoder);
}

int compressor_decompress(
  const uint8_t* input,
  size_t input_size,
  uint8_t** output,
  size_t* output_size
) {
  if (!output || !output_size || (!input && input_size)) return 0;
  *output = NULL;
  *output_size = 0;
  if (!input_size) return 1;

  ZSTD_DCtx* context = ZSTD_createDCtx();
  if (!context) return 0;

  size_t capacity = ZSTD_DStreamOutSize();
  uint8_t* buffer = (uint8_t*)malloc(capacity ? capacity : 1);
  if (!buffer) {
    ZSTD_freeDCtx(context);
    return 0;
  }

  ZSTD_inBuffer in = { input, input_size, 0 };
  size_t used = 0;
  size_t remaining = 1;
  while (in.pos < in.size) {
    if (!compressor_grow(&buffer, &capacity, used + ZSTD_DStreamOutSize())) {
      free(buffer);
      ZSTD_freeDCtx(context);
      return 0;
    }
    ZSTD_outBuffer out = { buffer + used, capacity - used, 0 };
    remaining = ZSTD_decompressStream(context, &out, &in);
    if (ZSTD_isError(remaining)) {
      free(buffer);
      ZSTD_freeDCtx(context);
      return 0;
    }
    used += out.pos;
  }

  ZSTD_freeDCtx(context);
  if (remaining != 0) {
    free(buffer);
    return 0;
  }
  if (!used) {
    free(buffer);
    return 1;
  }
  *output = buffer;
  *output_size = used;
  return 1;
}
