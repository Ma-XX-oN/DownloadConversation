  // The frozen V1 format and resource limits prevent unbounded cache imports.
  const FAVICON_CACHE_TTL_MS = 600000;
  const FAVICON_CACHE_MAX_PACK_BYTES = 128 * 1024 * 1024;
  const FAVICON_CACHE_MAX_HEADER_BYTES = 2 * 1024 * 1024;
  const FAVICON_CACHE_MAX_VARIANTS = 16;
  const FAVICON_CACHE_PACK_MAGIC = 'DCFC0001';

  /**
   * Parses the numeric version triplet without interpreting any suffix.
   * @param {string} value - DownloadConversation version or catalogue boundary.
   * @returns {number[]|null} Safe [major, minor, patch] values or null.
   */
  function faviconCacheTriplet(value) {
    if (typeof value !== 'string') return null;
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[A-Za-z0-9.-]+)?$/.exec(value);
    if (!match) return null;
    const parts = match.slice(1, 4).map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
  }

  /**
   * Orders two numeric version triplets without suffix influence.
   * @param {number[]} a - First version components.
   * @param {number[]} b - Second version components.
   * @returns {number} Negative, zero or positive comparison.
   */
  function faviconCacheCompare(a, b) {
    for (let index = 0; index < 3; index++) {
      if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
    }
    return 0;
  }

  /**
   * Parses and validates exactly the frozen V1 catalogue model.
   * @param {string} json - UTF-8 catalogue response text.
   * @returns {Map<string, Object>} Validated immutable dataset descriptors.
   */
  function faviconCacheParseCatalogue(json) {
    if (typeof json !== 'string' || json.length > 131072) throw Error('catalogue-size');
    const source = JSON.parse(json);
    if (source?.schema !== 'dc-favicon-catalogue-v1'
      || !Array.isArray(source.datasets) || !source.datasets.length
      || source.datasets.length > 128
      || Object.keys(source).sort().join(',') !== 'datasets,schema') {
      throw Error('catalogue-schema');
    }
    const entries = new Map();
    for (const candidate of source.datasets) {
      const triplet = faviconCacheTriplet(candidate.version);
      const boundary = triplet?.join('.');
      const asset = candidate.favicons;
      if (!triplet || entries.has(boundary)
        || Object.keys(candidate).sort().join(',') !== 'favicons,update_every_ms,version'
        || !Number.isSafeInteger(candidate.update_every_ms) || candidate.update_every_ms <= 0
        || !asset || Object.keys(asset).sort().join(',') !== 'bytes,commit,path,sha256'
        || !/^[0-9a-f]{40}$/.test(asset.commit)
        || !/^assets\/favicons\/[A-Za-z0-9_./-]+\.dcfav$/.test(asset.path)
        || asset.path.split('/').includes('..')
        || !/^[0-9a-f]{64}$/.test(asset.sha256)
        || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 12
        || asset.bytes > FAVICON_CACHE_MAX_PACK_BYTES) {
        throw Error('catalogue-entry');
      }
      entries.set(boundary, { version: boundary, triplet, update_every_ms: candidate.update_every_ms,
        favicons: { ...asset } });
    }
    return entries;
  }

  /**
   * Returns a recursively key-sorted JSON-compatible representation.
   * @param {unknown} value - Parsed manifest JSON value.
   * @returns {unknown} Canonically ordered JSON value.
   */
  function faviconCacheCanonical(value) {
    if (Array.isArray(value)) return value.map(faviconCacheCanonical);
    if (value !== null && typeof value === 'object') {
      const sorted = {};
      for (const key of Object.keys(value).sort()) sorted[key] = faviconCacheCanonical(value[key]);
      return sorted;
    }
    return value;
  }

  /**
   * Calculates the PNG chunk's IEEE CRC-32 for integrity validation.
   * @param {Uint8Array} data - Chunk type and data bytes.
   * @returns {number} Unsigned CRC-32 value.
   */
  function faviconCacheCrc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Verifies PNG signature, dimensions, chunk boundaries and CRCs.
   * @param {Uint8Array} png - One indexed PNG's original binary bytes.
   * @param {number} width - Declared source width.
   * @param {number} height - Declared source height.
   * @returns {boolean} Whether PNG structure matches the manifest.
   */
  function faviconCacheCheckPng(png, width, height) {
    if (png.byteLength < 57) return false;
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((byte, i) => png[i] === byte)) return false;
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let pos = 8;
    let chunks = 0;
    let sawIdat = false;
    while (pos + 12 <= png.length && chunks++ < 8192) {
      const size = view.getUint32(pos);
      if (size > png.length - pos - 12) return false;
      const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
      if (faviconCacheCrc32(png.subarray(pos + 4, pos + 8 + size))
        !== view.getUint32(pos + 8 + size)) return false;
      if (chunks === 1) {
        if (type !== 'IHDR' || size !== 13
          || view.getUint32(pos + 8) !== width || view.getUint32(pos + 12) !== height) return false;
      }
      if (type === 'IDAT') sawIdat = true;
      pos += size + 12;
      if (type === 'IEND') return size === 0 && sawIdat && pos === png.length;
    }
    return false;
  }

  /**
   * Checks the complete immutable pack before exposing any PNG spans.
   * @param {ArrayBuffer} binary - Binary .dcfav response bytes.
   * @param {Object} descriptor - Validated V1 catalogue dataset entry.
   * @returns {Promise<Object>} Verified manifest and binary payload metadata.
   */
  async function faviconCacheValidatePack(binary, descriptor) {
    if (!(binary instanceof ArrayBuffer)
      || binary.byteLength !== descriptor.favicons.bytes
      || binary.byteLength > FAVICON_CACHE_MAX_PACK_BYTES) throw Error('pack-length');
    const digest = await crypto.subtle.digest('SHA-256', binary);
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== descriptor.favicons.sha256) throw Error('pack-hash');
    const data = new Uint8Array(binary);
    if (String.fromCharCode(...data.subarray(0, 8)) !== FAVICON_CACHE_PACK_MAGIC) throw Error('pack-magic');
    const headerSize = new DataView(binary).getUint32(8, true);
    if (!headerSize || headerSize > FAVICON_CACHE_MAX_HEADER_BYTES
      || headerSize > data.length - 12) throw Error('pack-header-bounds');
    const header = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(12, 12 + headerSize));
    const manifest = JSON.parse(header);
    if (header !== JSON.stringify(faviconCacheCanonical(manifest))
      || manifest?.schema !== 'dc-favicon-pack-v1'
      || Object.keys(manifest).sort().join(',') !== 'schema,variants'
      || !Array.isArray(manifest.variants) || manifest.variants.length < 1
      || manifest.variants.length > FAVICON_CACHE_MAX_VARIANTS) throw Error('pack-manifest');
    const payloadStart = 12 + headerSize;
    const payloadSize = data.length - payloadStart;
    const spans = [];
    const variants = [];
    const ids = new Set();
    const sources = new Set();
    for (const variant of manifest.variants) {
      if (Object.keys(variant).sort().join(',') !== 'height,id,images,source_sha256,width'
        || typeof variant.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(variant.id)
        || ids.has(variant.id)
        || !/^[0-9a-f]{64}$/.test(variant.source_sha256)
        || sources.has(variant.source_sha256)
        || !Number.isSafeInteger(variant.width) || variant.width < 1 || variant.width > 1024
        || !Number.isSafeInteger(variant.height) || variant.height < 1 || variant.height > 1024
        || !Array.isArray(variant.images) || variant.images.length !== 4) throw Error('pack-variant');
      ids.add(variant.id);
      sources.add(variant.source_sha256);
      variants.push({ id: variant.id, source_sha256: variant.source_sha256 });
      for (let base = 0; base < 4; base++) {
        if (!Array.isArray(variant.images[base]) || variant.images[base].length !== 7) throw Error('pack-pies');
        for (let pie = 0; pie < 7; pie++) {
          const frames = variant.images[base][pie];
          if (!Array.isArray(frames) || frames.length !== 21) throw Error('pack-pulses');
          for (let pulse = 0; pulse < 21; pulse++) {
            const span = frames[pulse];
            if (!span || Object.keys(span).sort().join(',') !== 'bytes,offset'
              || !Number.isSafeInteger(span.offset) || span.offset < 0
              || !Number.isSafeInteger(span.bytes) || span.bytes < 57
              || span.offset + span.bytes > payloadSize) throw Error('pack-span');
            const png = data.subarray(payloadStart + span.offset, payloadStart + span.offset + span.bytes);
            if (!faviconCacheCheckPng(png, variant.width, variant.height)) throw Error('pack-png');
            spans.push({ version: descriptor.version, variant_id: variant.id,
              base_type: base, completion_time: pie, pulse_index: pulse,
              offset: payloadStart + span.offset, bytes: span.bytes,
              width: variant.width, height: variant.height });
          }
        }
      }
    }
    spans.sort((a, b) => a.offset - b.offset);
    let end = payloadStart;
    for (const span of spans) {
      if (span.offset !== end) throw Error('pack-payload-coverage');
      end += span.bytes;
    }
    if (end !== data.length) throw Error('pack-tail');
    // CRC and IHDR checks cannot prove IDAT data is actually decodable.
    // Decode every frame before publishing any image as a ready collection.
    if (typeof createImageBitmap !== 'function') throw Error('png-decoder-unavailable');
    for (const span of spans) {
      let bitmap;
      try {
        bitmap = await createImageBitmap(new Blob([
          data.subarray(span.offset, span.offset + span.bytes)
        ], { type: 'image/png' }));
        if (bitmap.width !== span.width || bitmap.height !== span.height) {
          throw Error('decoded-png-dimensions');
        }
      } catch (error) {
        throw Error('pack-png-decode', { cause: error });
      } finally {
        bitmap?.close();
      }
    }
    return { data, spans, variants };
  }