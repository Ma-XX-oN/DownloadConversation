  // Stable numeric cache colour index to renderer semantic colour.
  const faviconV2NumericBases = Object.freeze([
    'processing', 'completed', 'error', 'acknowledged'
  ]);

  /**
   * Adapt the numeric cache tuple to the true browser-local PNG renderer.
   * @param {Object} request - Complete cache tuple, including version, stock URL, theme, colour and step.
   * @param {AbortSignal} signal - Exclusive generation's abort signal.
   * @returns {Promise<Blob[]>} Exactly two complete PNG Blob frames.
   */
  async function faviconV2RenderSequenceAdapter(request, signal) {
    const base = faviconV2NumericBases[request.base_type];
    if (!base || typeof request.original_favicon_url !== 'string' ||
        !['light', 'dark'].includes(request.theme) ||
        !Number.isInteger(request.progress_step) ||
        request.progress_step < 0 || request.progress_step > 6) {
      throw new TypeError('Invalid favicon V2 adapter request');
    }
    const rendered = await faviconV2RenderSource.renderFaviconPulseSequence({
      originalUrl: request.original_favicon_url,
      theme: request.theme,
      base,
      progressStep: request.progress_step,
      signal
    });
    if (rendered.originalUrl !== request.original_favicon_url ||
        rendered.theme !== request.theme || rendered.base !== base ||
        rendered.progressStep !== request.progress_step ||
        !Array.isArray(rendered.frames) || rendered.frames.length !== 2) {
      throw new Error('Favicon V2 renderer returned mismatched sequence');
    }
    return rendered.frames;
  }

  // Independent ring-only animation; retain historical 1.11.8 and 2.0.0 datasets.
  const FAVICON_ANIMATION_VERSION = '2.1.0';
  faviconCacheV2Configure([{version: FAVICON_ANIMATION_VERSION, update_every_ms: 1000}]);
