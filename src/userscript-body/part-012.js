   * Retains one terminal sound-event identity in a bounded insertion-ordered set.
   *
   * @param {string} key - Stable terminal sound-event key.
   * @returns {void} No value is returned.
   */
  function agentSoundRememberTerminalKey(key) {
    if (!key || agentSoundTerminalKeys.has(key)) return;
    while (agentSoundTerminalKeys.size >= AGENT_SOUND_TERMINAL_KEY_LIMIT) {
      const oldest = agentSoundTerminalKeys.values().next().value;
      if (oldest === undefined) break;
      agentSoundTerminalKeys.delete(oldest);
    }
    agentSoundTerminalKeys.add(key);
  }

  /**
   * Returns whether one normalized client terminal event is the evidenced polling timeout.
   *
   * @param {Object|null} event - Normalized client terminal event.
   * @returns {boolean} True only for the exact structured polling-timeout state.
   */
  function agentTerminalIsPollingTimeout(event) {
    return event?.type === 'client_terminal_error' &&
      event?.code === 'network_error' &&
      event?.source === 'completion_stream_polling_fallback' &&
      event?.reason === 'polling_timeout';
  }

  /**
   * Normalizes the exact stock ChatGPT stats counter emitted for polling timeout.
   *
   * @param {Object|null} payload - Parsed `/ces/statsc/flush` request payload.
   * @returns {Object|null} Normalized terminal event, or null for unrelated stats.
   */
  function agentTerminalFailureFromStatsPayload(payload) {
    const counters = Array.isArray(payload?.counters) ? payload.counters : [];
    const matched = counters.find(counter =>
      counter?.namespace === 'default' &&
      counter?.metric === 'chatgpt_web_message_delivery_failure_shown' &&
      counter?.tags?.source === 'completion_stream_polling_fallback' &&
      counter?.tags?.error_code === 'network_error' &&
      counter?.tags?.failure_reason === 'polling_timeout' &&
      Number(counter?.value) > 0
    );
    if (!matched) return null;
    return {
      type: 'client_terminal_error',
      code: 'network_error',
      source: 'completion_stream_polling_fallback',
      reason: 'polling_timeout'
    };
  }

  /**
   * Returns whether a URL is the exact same-origin ChatGPT stats-flush endpoint.
   *
   * @param {string} url - Candidate request URL.
   * @returns {boolean} True only for `/ces/statsc/flush` on the current origin.
   */
  function isAgentTerminalStatsUrl(url) {
    try {
      const parsed = new URL(String(url ?? ''), location.href);
      return parsed.origin === location.origin && parsed.pathname === '/ces/statsc/flush';
    } catch {
      return false;
    }
  }

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
        conversation_id: capture?.conversation_id ?? null,
        terminal_key: agentSoundTerminalKey(capture)
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
