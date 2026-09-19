from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old, new):
  global text
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'Expected exactly one match, found {count}: {old[:120]!r}')
  text = text.replace(old, new, 1)


replace_once(
  '// @version      1.5.0-issue.135.2',
  '// @version      1.5.0-issue.148.1'
)

replace_once(
  "  /** DOM id of the fixed agent-turn stopwatch display. */\n"
  "  const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';",
  "  /** DOM id of the userscript-owned favicon override link. */\n"
  "  const AGENT_FAVICON_OVERRIDE_ID = 'tm-agent-state-favicon';\n"
  "  /** Yellow RGB used while Agent processing is observed. */\n"
  "  const AGENT_FAVICON_PROCESSING_RGB = Object.freeze([255, 255, 0]);\n"
  "  /** Light-green RGB used after a current-page successful completion. */\n"
  "  const AGENT_FAVICON_COMPLETED_RGB = Object.freeze([144, 238, 144]);\n"
  "  /** DOM id of the fixed agent-turn stopwatch display. */\n"
  "  const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';"
)

replace_once(
  "  /** Current agent-turn stopwatch session, including completed lap durations. */\n"
  "  let agentStopwatchState = null;",
  "  /** Original stock favicon href captured before any userscript override is rendered. */\n"
  "  let agentFaviconOriginalHref = null;\n"
  "  /** Monotonic render generation preventing stale asynchronous favicon writes. */\n"
  "  let agentFaviconRenderGeneration = 0;\n"
  "  /** Whether processing has been observed in this loaded page and may transition to green. */\n"
  "  let agentFaviconProcessingObserved = false;\n"
  "  /** Current agent-turn stopwatch session, including completed lap durations. */\n"
  "  let agentStopwatchState = null;"
)

favicon_functions = r'''
  /**
   * Returns and memoizes the stock favicon source before any userscript override.
   *
   * @returns {string|null} Original favicon href, or null when no stock icon is available.
   */
  function agentFaviconOriginalSource() {
    if (agentFaviconOriginalHref) return agentFaviconOriginalHref;
    const links = [...document.querySelectorAll('link[rel~="icon"]')]
      .filter(link => link?.id !== AGENT_FAVICON_OVERRIDE_ID && typeof link?.href === 'string' && link.href);
    const source = links.at(-1)?.href ?? null;
    if (source) agentFaviconOriginalHref = source;
    return agentFaviconOriginalHref;
  }

  /**
   * Returns the userscript-owned favicon override link, creating it after stock icon links when needed.
   *
   * @returns {HTMLLinkElement} Existing or newly created favicon override link.
   */
  function ensureAgentFaviconOverrideLink() {
    let link = document.getElementById(AGENT_FAVICON_OVERRIDE_ID);
    if (link) return link;
    link = document.createElement('link');
    link.id = AGENT_FAVICON_OVERRIDE_ID;
    link.rel = 'icon';
    (document.head || document.documentElement).append(link);
    return link;
  }

  /**
   * Recolors visible near-white favicon pixels while preserving all other pixels and alpha values.
   *
   * @param {Uint8ClampedArray} data - Mutable RGBA pixel buffer.
   * @param {Array<number>} targetRgb - Three target RGB channel values.
   * @returns {number} Number of recolored visible pixels.
   */
  function agentFaviconRecolorPixels(data, targetRgb) {
    assert(data instanceof Uint8ClampedArray,
      'Agent favicon recoloring requires a Uint8ClampedArray pixel buffer.');
    assert(Array.isArray(targetRgb) && targetRgb.length === 3,
      'Agent favicon recoloring requires three target RGB channels.');
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
   * Renders one Agent favicon state from the memoized original stock favicon.
   *
   * @param {string} state - `processing`, `completed`, or `original`.
   * @returns {Promise<boolean>} True when the requested favicon state was applied.
   */
  function agentFaviconRenderState(state) {
    const generation = ++agentFaviconRenderGeneration;
    if (state === 'original') {
      document.getElementById(AGENT_FAVICON_OVERRIDE_ID)?.remove();
      return Promise.resolve(true);
    }
    const targetRgb = state === 'processing'
      ? AGENT_FAVICON_PROCESSING_RGB
      : state === 'completed'
        ? AGENT_FAVICON_COMPLETED_RGB
        : null;
    if (!targetRgb) return Promise.resolve(false);
    const originalHref = agentFaviconOriginalSource();
    if (!originalHref) {
      logDiagnostic('warnings', 'agent-favicon-original-missing', { state });
      return Promise.resolve(false);
    }
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const width = image.naturalWidth;
          const height = image.naturalHeight;
          if (!width || !height) {
            logDiagnostic('warnings', 'agent-favicon-image-empty', { state, original_href: originalHref });
            resolve(false);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) {
            logDiagnostic('warnings', 'agent-favicon-canvas-unavailable', { state });
            resolve(false);
            return;
          }
          context.drawImage(image, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height);
          const changed = agentFaviconRecolorPixels(pixels.data, targetRgb);
          context.putImageData(pixels, 0, 0);
          if (generation !== agentFaviconRenderGeneration) {
            resolve(false);
            return;
          }
          ensureAgentFaviconOverrideLink().href = canvas.toDataURL('image/png');
          logDiagnostic('debug', 'agent-favicon-state-rendered', {
            state,
            recolored_pixels: changed,
            width,
            height
          });
          resolve(true);
        } catch (error) {
          logDiagnostic('warnings', 'agent-favicon-render-failed', {
            state,
            message: errorMessage(error)
          });
          resolve(false);
        }
      };
      image.onerror = () => {
        logDiagnostic('warnings', 'agent-favicon-image-load-failed', {
          state,
          original_href: originalHref
        });
        resolve(false);
      };
      image.src = originalHref;
    });
  }

  /**
   * Records that Agent processing was observed in this page and renders the yellow favicon.
   *
   * @returns {void} No value is returned.
   */
  function agentFaviconObserveProcessing() {
    agentFaviconProcessingObserved = true;
    void agentFaviconRenderState('processing');
  }

  /**
   * Projects the already-fetched reload stream status into favicon processing state.
   *
   * @param {Object|null} streamStatus - Structured provider stream-status payload.
   * @returns {void} No value is returned.
   */
  function agentFaviconObserveStreamStatus(streamStatus) {
    if (agentStopwatchStreamIsActive(streamStatus)) agentFaviconObserveProcessing();
  }

  /**
   * Handles one shared normalized terminal event for favicon completion state.
   *
   * @param {Object} terminal - Shared normalized terminal event.
   * @returns {void} No value is returned.
   */
  function agentFaviconHandleTerminal(terminal) {
    if (terminal?.kind !== 'success' || !agentFaviconProcessingObserved) return;
    agentFaviconProcessingObserved = false;
    void agentFaviconRenderState('completed');
  }

'''

marker = "  /**\n   * Handles one already-normalized terminal event for browser audio only."
if text.count(marker) != 1:
  raise SystemExit('Could not locate sound terminal handler insertion point.')
text = text.replace(marker, favicon_functions + marker, 1)

replace_once(
  "  const agentTerminalHandlers = Object.freeze([\n"
  "    agentSoundHandleTerminal,\n"
  "    agentStopwatchHandleTerminal\n"
  "  ]);",
  "  const agentTerminalHandlers = Object.freeze([\n"
  "    agentSoundHandleTerminal,\n"
  "    agentStopwatchHandleTerminal,\n"
  "    agentFaviconHandleTerminal\n"
  "  ]);"
)

replace_once(
  "    const streamStatus = await agentStopwatchFetchStreamStatus(conversationId);\n"
  "    if (agentStopwatchState) return;",
  "    const streamStatus = await agentStopwatchFetchStreamStatus(conversationId);\n"
  "    agentFaviconObserveStreamStatus(streamStatus);\n"
  "    if (agentStopwatchState) return;"
)

replace_once(
  "        const generationSubmittedAtMs = generationRequest ? performance.now() : null;\n"
  "        if (steerTurnRequest) agentStopwatchObserveSteerTurn(performance.now());",
  "        const generationSubmittedAtMs = generationRequest ? performance.now() : null;\n"
  "        if (generationRequest) agentFaviconObserveProcessing();\n"
  "        if (steerTurnRequest) agentStopwatchObserveSteerTurn(performance.now());"
)

path.write_text(text, encoding='utf-8')
