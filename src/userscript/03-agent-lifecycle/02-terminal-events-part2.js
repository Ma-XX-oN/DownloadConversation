

  /**
   * Observes one stock stats-flush request for the exact structured polling-timeout terminal state.
   *
   * @param {Request} request - Original page request; only a clone is consumed.
   * @param {string} requestUrl - Resolved request URL.
   * @param {string} requestMethod - Uppercase HTTP method.
   * @returns {Promise<void>} Resolves after relevant structured terminal evidence is handled.
   */
  async function agentTerminalObserveStatsRequest(request, requestUrl, requestMethod) {
    if (requestMethod !== 'POST' || !isAgentTerminalStatsUrl(requestUrl)) return;
    const cloned = cloneSafely(request);
    if (!cloned) return;
    try {
      const payload = JSON.parse(await cloned.text());
      const event = agentTerminalFailureFromStatsPayload(payload);
      if (!event) return;
      const capture = streamTailCapture;
      if (!capture) {
        logDiagnostic('warnings', 'agent-terminal-polling-timeout-without-capture', {});
        return;
      }
      logDiagnostic('debug', 'agent-terminal-polling-timeout-observed', {
        conversation_id: capture?.conversation_id ?? null
      });
      agentTerminalObserve(capture, event);
    } catch (error) {
      logDiagnostic('debug', 'agent-terminal-stats-request-parse-failed', {
        error: boundedDiagnosticText(errorMessage(error), 1000)
      });
    }
  }

  /**
   * Classifies one structured agent terminal observation without deriving consumer-specific state.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} event - Most recently parsed structured SSE/v1 event, when any.
   * @returns {string|null} `success`, `error`, or null when the turn is not terminal.
   */
  function agentTerminalClassifyKind(capture, event) {
    const structured = [];
    if (event && typeof event === 'object' && !Array.isArray(event)) structured.push(event);
    if (event?.v && typeof event.v === 'object' && !Array.isArray(event.v)) structured.push(event.v);
    for (const candidate of structured) {
      if (agentTerminalIsPollingTimeout(candidate)) return 'error';
      const providerCode = candidate.error_code ?? candidate.code ?? candidate?.error?.code ?? null;
      if (providerCode === 'conversation_too_large' &&
          (candidate.type === 'error' || candidate.error_code === 'conversation_too_large')) return 'error';
      if (candidate.result === 'error' &&
          candidate?.error?.reason === 'request_failed' &&
          Number(candidate?.error?.status_code) >= 400) {
        return 'error';
      }
      if (agentTerminalIsConversationTurnComplete(capture, candidate)) return 'success';
    }
    return agentTerminalSuccessfulFinal(capture) ? 'success' : null;
  }


  /**
   * Returns current stock favicon candidates and captures each candidate's original source once.
   *
   * The browser may choose among multiple rel=icon links using media/type/sizes.
   * DownloadConversation therefore projects one state onto every current stock candidate.
   *
   * @returns {Array<Object>} Current favicon candidates paired with their original source hrefs.
   */
  function agentFaviconCurrentCandidates() {
    const links = [...document.querySelectorAll('link[rel~="icon"]')]
      .filter(link => typeof link?.href === 'string' && link.href);
    return links.map(link => {
      if (!agentFaviconOriginalSources.has(link)) {
        agentFaviconOriginalSources.set(link, link.href);
      }
      return {
        link,
        original_href: agentFaviconOriginalSources.get(link),
        media: typeof link.media === 'string' ? link.media : '',
        type: typeof link.type === 'string' ? link.type : '',
        sizes: typeof link.sizes?.value === 'string' ? link.sizes.value : ''
      };
    });
  }

  /**
   * Recolors visible near-white favicon pixels while preserving all other pixels and alpha values.
   *
   * @param {Uint8ClampedArray} data - Mutable RGBA pixel buffer.
   * @param {Array<number>} targetRgb - Three target RGB channel values.
   * @returns {number} Number of recolored visible pixels.
   */
  function agentFaviconRecolorPixels(data, targetRgb) {
    if (!data || typeof data.length !== 'number') {
      throw new TypeError('Agent favicon recoloring requires an RGBA pixel buffer.');
    }
    if (!Array.isArray(targetRgb) || targetRgb.length !== 3) {
      throw new TypeError('Agent favicon recoloring requires three target RGB channels.');
    }
    let changed = 0;
    for (let index = 0; index + 3 < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      if (alpha === 0) continue;
      const minimum = Math.min(red, green, blue);
      const maximum = Math.max(red, green, blue);
      if (minimum < 240 || maximum - minimum > 16) continue;
      const intensity = (red + green + blue) / (3 * 255);
      data[index] = Math.round(targetRgb[0] * intensity);
      data[index + 1] = Math.round(targetRgb[1] * intensity);
      data[index + 2] = Math.round(targetRgb[2] * intensity);
      changed += 1;
    }
    return changed;
  }

  /**
   * Renders one colored state for one stock favicon candidate from its captured original source.
   *
   * @param {Object} candidate - Current stock favicon link and its captured original source.
   * @param {Array<number>} targetRgb - Three target RGB channel values.
   * @param {string} state - Agent favicon state being rendered.
   * @param {number} generation - Monotonic favicon render generation.
   * @param {number} ordinal - One-based candidate ordinal for diagnostics.
   * @param {number} total - Total current favicon candidate count.
   * @returns {Promise<Object>} Candidate render result for aggregate state diagnostics.
   */
  function agentFaviconRenderCandidate(candidate, targetRgb, state, generation, ordinal, total) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const width = image.naturalWidth;
          const height = image.naturalHeight;
          if (!width || !height) {
            logDiagnostic('warnings', 'agent-favicon-image-empty', {
              state,
              candidate_ordinal: ordinal,
              candidate_count: total,
              original_href: candidate.original_href
            });
            resolve({ applied: false, recolored_pixels: 0, width, height });
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) {
            logDiagnostic('warnings', 'agent-favicon-canvas-unavailable', {
              state,
              candidate_ordinal: ordinal,
              candidate_count: total
            });
            resolve({ applied: false, recolored_pixels: 0, width, height });
            return;
          }
          context.drawImage(image, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height);
          const changed = agentFaviconRecolorPixels(pixels.data, targetRgb);
          context.putImageData(pixels, 0, 0);
          const ringStep = state === 'processing' || state === 'completed' ||
            state === 'acknowledged'
            ? agentFaviconRingStep() : 0;
          if (ringStep > 0) {
            context.globalCompositeOperation = 'destination-over';
            try {
              agentFaviconDrawPieSlice(context, width, height, ringStep);
            } finally {
              context.globalCompositeOperation = 'source-over';
            }
            agentFaviconDrawRing(context, width, height, ringStep);
          }
          // Pulse the fully composed icon: coloured logo, underlay and ring.
          const composite = context.getImageData(0, 0, width, height);
          agentFaviconApplyOpacity(composite.data, agentFaviconPulseOpacity());
          context.putImageData(composite, 0, 0);
          if (generation !== agentFaviconRenderGeneration) {
            resolve({ applied: false, stale: true, recolored_pixels: changed, width, height });
            return;
          }
          candidate.link.href = canvas.toDataURL('image/png');
          logDiagnostic('debug', 'agent-favicon-candidate-rendered', {
            state,
            candidate_ordinal: ordinal,
            candidate_count: total,
            recolored_pixels: changed,
            width,
            height,
            media: candidate.media || null,
            type: candidate.type || null,
            sizes: candidate.sizes || null