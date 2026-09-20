      timing.fetch_ms = null;
      timing.body_ms = null;
      timing.encode_ms = null;
      timing.blob_bytes = null;
      timing.data_url_chars = null;
      timing.total_ms = null;
      try { timing.source_scheme = new URL(src, location.href).protocol; } catch {}
    }
    if (src.startsWith('data:')) {
      if (timing) {
        timing.stage = 'complete';
        timing.outcome = 'data-url';
        timing.fetch_ms = 0;
        timing.body_ms = 0;
        timing.encode_ms = 0;
        timing.data_url_chars = src.length;
        timing.total_ms = Math.round(performance.now() - startedAt);
      }
      return src;
    }
    try {
      if (timing) timing.stage = 'fetch';
      const response = await fetch(src, { credentials: 'include' });
      const headersAt = performance.now();
      if (timing) {
        timing.fetch_ms = Math.round(headersAt - startedAt);
        timing.http_status = response.status;
      }
      if (!response.ok) {
        const error = new Error(`Conversational image request returned HTTP ${response.status}.`);
        error.httpStatus = response.status;
        if (timing) timing.outcome = 'http-error';
        throw error;
      }
      if (timing) timing.stage = 'body';
      const blob = await response.blob();
      const bodyAt = performance.now();
      if (timing) {
        timing.body_ms = Math.round(bodyAt - headersAt);
        timing.blob_bytes = blob.size;
        timing.stage = 'encode';
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read conversational image blob.'));
        reader.readAsDataURL(blob);
      });
      const finishedAt = performance.now();
      if (timing) {
        timing.encode_ms = Math.round(finishedAt - bodyAt);
        timing.data_url_chars = dataUrl.length;
        timing.total_ms = Math.round(finishedAt - startedAt);
        timing.outcome = 'success';
        timing.stage = 'complete';
      }
      return dataUrl;
    } catch (error) {
      if (timing) {
        timing.total_ms = Math.round(performance.now() - startedAt);
        if (!timing.outcome) timing.outcome = `${timing.stage || 'unknown'}-error`;
      }
      throw error;
    }
  }

  /**
   * Converts a mounted conversation image element to a data URL while optionally recording timing metrics.
   *
   * @param {HTMLImageElement} image - Mounted conversation image element whose current source is recovered.
   * @param {Object|null} timing - Mutable timing/result object populated by `fetchImageDataUrl`.
   * @returns {Promise<string>} A promise resolving to the image data URL.
   */
  async function imageElementDataUrl(image, timing = null) {
    const src = image.currentSrc || image.getAttribute('src') || '';
    return fetchImageDataUrl(src, timing);
  }

  /**
   * Recovers user images while exposing compact per-image and whole-phase timing diagnostics.
   *
   * Existing recovery order and fallback behavior are preserved: images are still
   * recovered serially, mounted DOM candidates are preferred, and provider pointers
   * are used only where the established path already used them.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @returns {Promise<Map<unknown, unknown>>} A promise resolving to recovered image Markdown keyed by source message id.
   */
  async function recoverUserImages(spine) {
    // Recovered image Markdown is keyed by source message id for later canonical enrichment.
    const recovered = new Map();
    const scrollRoot = conversationScrollRoot();
    // Preserve the caller scroll position so image recovery can restore the page exactly.
    const originalScrollTop = scrollRoot.scrollTop;
    /** Exact ordered Conversation API message set used as the single Core adaptation input. */
    const sourceRecords = (spine?.records ?? []).map(item => item?.message).filter(Boolean);
    /** Canonical Core image resources keyed by source record identity and original part index. */
    const canonicalResourcesByRecord = canonicalImageResourcesByRecordAndPart(sourceRecords);
    /** Ordered source records that contain one or more user image pointers. */
    const records = (spine?.records ?? []).filter(record => userImagePointerCount(record?.message) > 0);
    /** Total unique image pointers expected across the source records. */
    const totalImages = records.reduce((total, item) => total + userImagePointerCount(item?.message), 0);
    /** Highest unique image ordinal completed during this recovery phase. */
    let recoveredImages = 0;
    /** Number of mounted-image recovery operations that threw an error. */
    let failedImages = 0;
    /** Number of pointer resolutions that completed with an unavailable/missing outcome. */
    let unavailableImages = 0;
    /** Sum of downloaded Blob byte sizes observed by timed image operations. */
    let totalBlobBytes = 0;
    /** Sum of resulting data-URL character lengths observed by timed image operations. */
    let totalDataUrlChars = 0;
    /** Zero-based count of unique image pointers preceding the current source record. */
    let imageBase = 0;
    /** Monotonic start time for the complete image-recovery phase. */
    const recoveryStartedAt = performance.now();
    /** Whether the whole recovery phase reached the normal loop completion point. */
    let recoveryCompleted = false;

    if (progressState) {
      progressState.stage = 'recovering-images';
      progressState.image_number = 0;
      progressState.image_count = totalImages;
      progressState.image_completed = 0;
      progressState.image_path = null;
      progressState.image_started_at = 0;
    }
    logDiagnostic('debug', 'conversation-image-recovery-start', {
      script_version: VERSION,
      source_message_count: records.length,
      total_images: totalImages,
      diagnostic_log_capacity: MAX_DIAGNOSTIC_LOG_ITEMS
    });
    refreshStatus();

    /**
     * Runs one existing image-recovery operation while recording compact timing/progress state.
     *
     * @param {Function} loader - Async image loader that accepts one mutable timing object.
     * @param {Object} context - Stable source/image correlation fields for the operation.
     * @returns {Promise<string>} A promise resolving to the existing image recovery result.
     */
    const recoverOne = async (loader, context) => {
      /** Mutable timing fields populated by the underlying image loader. */
      const timing = {};
      /** Monotonic start time for this one image recovery operation. */
      const startedAt = performance.now();
      if (progressState) {
        progressState.stage = 'recovering-images';
        progressState.image_number = context.image_number;
        progressState.image_count = totalImages;
        progressState.image_path = context.path;
        progressState.image_started_at = startedAt;
        progressState.image_message_id = context.message_id;
        progressState.image_ordinal = context.image_ordinal;
      }
      refreshStatus();
      logDiagnostic('debug', 'conversation-image-recovery-item-start', {
        script_version: VERSION,
        image_number: context.image_number,
        total_images: totalImages,
        message_id: context.message_id,
        image_ordinal: context.image_ordinal,
        path: context.path
      });
      try {
        const value = await loader(timing);
        const outcome = timing.outcome ?? 'success';
        if (!['success', 'data-url'].includes(outcome)) unavailableImages += 1;
        logDiagnostic('debug', 'conversation-image-recovery-item-complete', {
          script_version: VERSION,
          image_number: context.image_number,
          total_images: totalImages,
          message_id: context.message_id,
          image_ordinal: context.image_ordinal,
          path: context.path,
          outcome,
          source_scheme: timing.source_scheme ?? null,
          resolver_status: timing.resolver_status ?? null,
          resolver_ms: timing.resolver_ms ?? null,
          http_status: timing.http_status ?? null,
          fetch_ms: timing.fetch_ms ?? null,
          body_ms: timing.body_ms ?? null,
          encode_ms: timing.encode_ms ?? null,
          blob_bytes: timing.blob_bytes ?? null,
          data_url_chars: timing.data_url_chars ?? null,
          elapsed_ms: timing.total_ms ?? Math.round(performance.now() - startedAt)
        });
        return value;
      } catch (error) {
        failedImages += 1;
        logDiagnostic('debug', 'conversation-image-recovery-item-failure', {
          script_version: VERSION,
          image_number: context.image_number,
          total_images: totalImages,
          message_id: context.message_id,
          image_ordinal: context.image_ordinal,
          path: context.path,
          outcome: timing.outcome ?? 'error',
          last_stage: timing.stage ?? null,
          source_scheme: timing.source_scheme ?? null,
          resolver_status: timing.resolver_status ?? null,
          resolver_ms: timing.resolver_ms ?? null,
          http_status: (timing.http_status ?? Number(error?.httpStatus)) || null,
          fetch_ms: timing.fetch_ms ?? null,
          body_ms: timing.body_ms ?? null,
          encode_ms: timing.encode_ms ?? null,
          blob_bytes: timing.blob_bytes ?? null,
          data_url_chars: timing.data_url_chars ?? null,
          elapsed_ms: timing.total_ms ?? Math.round(performance.now() - startedAt),
          message: errorMessage(error)
        });
        throw error;
      } finally {
        if (Number.isFinite(timing.blob_bytes)) totalBlobBytes += timing.blob_bytes;
        if (Number.isFinite(timing.data_url_chars)) totalDataUrlChars += timing.data_url_chars;
        recoveredImages = Math.max(recoveredImages, context.image_number);
        if (progressState) {
          progressState.image_completed = recoveredImages;
          progressState.image_started_at = 0;
        }
        refreshStatus();
      }
    };

    try {
      for (const item of records) {
        const record = item.message;
        /** Provider image-pointer parts expected for this source record. */
        const expectedParts = record.content.parts.filter(part =>
          part && typeof part === 'object' && part.content_type === 'image_asset_pointer'
        );
        /** Number of expected image pointers in this source record. */
        const expected = expectedParts.length;
        /** Existing fallback Markdown for each expected image pointer. */
        const images = expectedParts.map(part => cgImagePointerFallback(part));
        /** Canonical Core image resources keyed by their original provider part index. */
        const canonicalResources = canonicalResourcesByRecord.get(record.id) ?? new Map();
        /** Original provider part index for each image ordinal in this source record. */
        const imagePartIndexes = record.content.parts
          .map((part, partIndex) => ({ part, partIndex }))
          .filter(item => item.part && typeof item.part === 'object' && item.part.content_type === 'image_asset_pointer')
          .map(item => item.partIndex);
        /** Global image-number offset for this source record. */
        const recordImageBase = imageBase;
