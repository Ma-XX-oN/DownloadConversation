from pathlib import Path


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


userscript_path = Path('chatgpt-conversation-markdown-export.user.js')
text = userscript_path.read_text(encoding='utf-8')

text = replace_once(
  text,
  '// @version      1.5.0-issue.148.1',
  '// @version      1.5.0-issue.148.2',
  'version'
)

text = replace_once(
  text,
  "  /** DOM id of the userscript-owned favicon override link. */\n"
  "  const AGENT_FAVICON_OVERRIDE_ID = 'tm-agent-state-favicon';\n"
  "  /** Yellow RGB used while Agent processing is observed. */\n"
  "  const AGENT_FAVICON_PROCESSING_RGB = Object.freeze([255, 255, 0]);\n"
  "  /** Light-green RGB used after a current-page successful completion. */\n"
  "  const AGENT_FAVICON_COMPLETED_RGB = Object.freeze([144, 238, 144]);",
  "  /** Yellow RGB used while Agent processing is observed. */\n"
  "  const AGENT_FAVICON_PROCESSING_RGB = Object.freeze([255, 255, 0]);\n"
  "  /** Light-green RGB used after a current-page successful completion. */\n"
  "  const AGENT_FAVICON_COMPLETED_RGB = Object.freeze([144, 238, 144]);\n"
  "  /** Red RGB used after a normalized Agent terminal error. */\n"
  "  const AGENT_FAVICON_ERROR_RGB = Object.freeze([255, 0, 0]);",
  'favicon constants'
)

text = replace_once(
  text,
  "  /** Original stock favicon href captured before any userscript override is rendered. */\n"
  "  let agentFaviconOriginalHref = null;",
  "  /** Original source href retained per stock favicon link before DownloadConversation recolors it. */\n"
  "  const agentFaviconOriginalSources = new Map();",
  'favicon source state'
)

start = text.index("  /**\n   * Returns and memoizes the stock favicon source before any userscript override.")
end = text.index("  /**\n   * Recolors visible near-white favicon pixels", start)
replacement = r'''  /**
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

'''
text = text[:start] + replacement + text[end:]

start = text.index("  /**\n   * Renders one Agent favicon state from the memoized original stock favicon.")
end = text.index("  /**\n   * Records that Agent processing was observed in this page", start)
replacement = r'''  /**
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
          });
          resolve({ applied: true, recolored_pixels: changed, width, height });
        } catch (error) {
          logDiagnostic('warnings', 'agent-favicon-render-failed', {
            state,
            candidate_ordinal: ordinal,
            candidate_count: total,
            message: errorMessage(error)
          });
          resolve({ applied: false, recolored_pixels: 0, width: null, height: null });
        }
      };
      image.onerror = () => {
        logDiagnostic('warnings', 'agent-favicon-image-load-failed', {
          state,
          candidate_ordinal: ordinal,
          candidate_count: total,
          original_href: candidate.original_href
        });
        resolve({ applied: false, recolored_pixels: 0, width: null, height: null });
      };
      image.src = candidate.original_href;
    });
  }

  /**
   * Renders one Agent favicon state across every stock favicon candidate the browser may select.
   *
   * @param {string} state - `processing`, `completed`, `error`, or `original`.
   * @returns {Promise<boolean>} True only when the requested state is applied to every current candidate.
   */
  function agentFaviconRenderState(state) {
    const generation = ++agentFaviconRenderGeneration;
    const candidates = agentFaviconCurrentCandidates();
    if (!candidates.length) {
      logDiagnostic('warnings', 'agent-favicon-original-missing', { state });
      return Promise.resolve(false);
    }
    if (state === 'original') {
      for (const candidate of candidates) candidate.link.href = candidate.original_href;
      logDiagnostic('debug', 'agent-favicon-state-rendered', {
        state,
        candidate_count: candidates.length,
        applied_candidate_count: candidates.length,
        recolored_pixels: 0
      });
      return Promise.resolve(true);
    }
    const targetRgb = state === 'processing'
      ? AGENT_FAVICON_PROCESSING_RGB
      : state === 'completed'
        ? AGENT_FAVICON_COMPLETED_RGB
        : state === 'error'
          ? AGENT_FAVICON_ERROR_RGB
          : null;
    if (!targetRgb) return Promise.resolve(false);
    return Promise.all(candidates.map((candidate, index) =>
      agentFaviconRenderCandidate(
        candidate,
        targetRgb,
        state,
        generation,
        index + 1,
        candidates.length
      )
    )).then(results => {
      if (generation !== agentFaviconRenderGeneration) return false;
      const applied = results.filter(result => result.applied).length;
      const recoloredPixels = results.reduce(
        (total, result) => total + (Number(result.recolored_pixels) || 0),
        0
      );
      logDiagnostic(applied === candidates.length ? 'debug' : 'warnings', 'agent-favicon-state-rendered', {
        state,
        candidate_count: candidates.length,
        applied_candidate_count: applied,
        recolored_pixels: recoloredPixels
      });
      return applied === candidates.length;
    });
  }

'''
text = text[:start] + replacement + text[end:]

old_terminal = r'''  function agentFaviconHandleTerminal(terminal) {
    if (terminal?.kind !== 'success' || !agentFaviconProcessingObserved) return;
    agentFaviconProcessingObserved = false;
    void agentFaviconRenderState('completed');
  }'''
new_terminal = r'''  function agentFaviconHandleTerminal(terminal) {
    if (terminal?.kind === 'error') {
      agentFaviconProcessingObserved = false;
      void agentFaviconRenderState('error');
      return;
    }
    if (terminal?.kind !== 'success' || !agentFaviconProcessingObserved) return;
    agentFaviconProcessingObserved = false;
    void agentFaviconRenderState('completed');
  }'''
text = replace_once(text, old_terminal, new_terminal, 'favicon terminal consumer')
userscript_path.write_text(text, encoding='utf-8')


# Update the existing renderer harness to the all-stock-candidate implementation.
state_test = Path('tests/agent-favicon-state.test.mjs')
test_text = state_test.read_text(encoding='utf-8')
test_text = test_text.replace(
  "    const AGENT_FAVICON_OVERRIDE_ID = 'tm-agent-state-favicon';\n",
  ''
)
test_text = replace_once(
  test_text,
  "    let agentFaviconOriginalHref = null;\n",
  "    const agentFaviconOriginalSources = new Map();\n",
  'state test source map'
)
test_text = replace_once(
  test_text,
  "    ${productionFunctionSource('agentFaviconOriginalSource')}\n"
  "    ${productionFunctionSource('ensureAgentFaviconOverrideLink')}\n"
  "    ${productionFunctionSource('agentFaviconRecolorPixels')}\n"
  "    ${productionFunctionSource('agentFaviconRenderState')}\n",
  "    ${productionFunctionSource('agentFaviconCurrentCandidates')}\n"
  "    ${productionFunctionSource('agentFaviconRecolorPixels')}\n"
  "    ${productionFunctionSource('agentFaviconRenderCandidate')}\n"
  "    ${productionFunctionSource('agentFaviconRenderState')}\n",
  'state test production functions'
)
test_text = replace_once(
  test_text,
  "      source: agentFaviconOriginalSource,\n"
  "      override: () => document.getElementById(AGENT_FAVICON_OVERRIDE_ID)\n",
  "      href: () => stockLink.href\n",
  'state test api'
)
test_text = test_text.replace('context.api.override().href', 'context.api.href()')
state_test.write_text(test_text, encoding='utf-8')


browser_test = Path('tests/agent-favicon-browser-selection.test.mjs')
browser_text = browser_test.read_text(encoding='utf-8')
browser_text = browser_text.replace(
  "    const AGENT_FAVICON_OVERRIDE_ID = 'tm-agent-state-favicon';\n",
  ''
)
browser_text = replace_once(
  browser_text,
  "    let agentFaviconOriginalHref = null;\n",
  "    const agentFaviconOriginalSources = new Map();\n",
  'browser test source map'
)
browser_text = replace_once(
  browser_text,
  "    ${productionFunctionSource('agentFaviconOriginalSource')}\n"
  "    ${productionFunctionSource('ensureAgentFaviconOverrideLink')}\n"
  "    ${productionFunctionSource('agentFaviconRecolorPixels')}\n"
  "    ${productionFunctionSource('agentFaviconRenderState')}\n",
  "    ${productionFunctionSource('agentFaviconCurrentCandidates')}\n"
  "    ${productionFunctionSource('agentFaviconRecolorPixels')}\n"
  "    ${productionFunctionSource('agentFaviconRenderCandidate')}\n"
  "    ${productionFunctionSource('agentFaviconRenderState')}\n",
  'browser test production functions'
)
browser_test.write_text(browser_text, encoding='utf-8')


# Strengthen DESIGN.md: make the watcher/consumer architecture and documentation duty explicit,
# then update favicon behaviour to include terminal-error red and multi-candidate browser selection.
design_path = Path('DESIGN.md')
design = design_path.read_text(encoding='utf-8')
principle_anchor = """### One canonical semantic boundary

AIConversationCore owns canonical transcript semantics.  DownloadConversation supplies host data and presentation options but must not maintain a parallel parser/renderer for the same canonical meaning.

"""
principle_insert = principle_anchor + """### Observe once, normalize once, fan out

Cross-cutting ChatGPT lifecycle state follows a watcher/consumer design pattern. Authoritative structured evidence is observed once at the provider/browser boundary, normalized once into stable project state, and then fanned out to independent consumers. Sound, stopwatch, favicon, and future Agent-state features must attach to that shared watcher rather than duplicating network interception, terminal classification, exchange identity, or reload polling.

If a consumer needs a fact the watcher does not yet expose, extend the shared watcher at the evidenced structured boundary first. Do not solve the gap by creating a consumer-specific detector. The current provider/browser contracts and the evidence behind them are maintained in `CHATGPT-WEB-INTEGRATION.md`.

### Documentation is part of the implementation

When live evidence changes what is known about ChatGPT APIs, stream shapes, UI virtualization, browser integration, lifecycle ordering, or project invariants, the issue, regression coverage, and durable project documentation must be updated with the code. `DESIGN.md` records architectural ownership and invariants; `CHATGPT-WEB-INTEGRATION.md` records concrete ChatGPT/browser integration contracts. Future related work should consult these documents before reverse-engineering the same behaviour again.

"""
design = replace_once(design, principle_anchor, principle_insert, 'design principles')

old_shared = """## Shared agent lifecycle observation and terminal dispatch

Agent lifecycle state is observed once and projected to independent consumers. Current-page processing begins at the existing structured `POST /backend-api/f/conversation` request boundary; the stopwatch and favicon consume that same observed generation start rather than installing separate prompt detectors. On reload, the single structured `/backend-api/conversation/<id>/stream_status` result already fetched for stopwatch restoration is also projected to the favicon consumer; no second status request or alternate state detector is introduced.

Structured terminal state is normalized exactly once before any terminal side effect. The normalizer determines terminal kind, conversation identity, exchange identity, terminal de-duplication key, and one monotonic completion timestamp. Successful-final exchange identity prefers the final Assistant message metadata; structured capture/request identity is used only by the same shared normalizer when needed. The normalized immutable terminal object is then dispatched to the sound, stopwatch, and favicon handlers. None of those consumers independently classifies terminal state or reconstructs terminal identity. The stopwatch still rejects a normalized terminal whose exchange identity does not match the active stopwatch session. Sound de-duplication distinguishes terminal kind as well as terminal identity so a successful completion followed by a structured same-exchange terminal error can emit one ding and one buzz without duplicate replay. Rendered text and DOM error strings are not terminal detectors.

## Agent favicon processing/completion state

The favicon is a presentation-only consumer of the shared lifecycle observer. When a current-page generation request is observed, or reload restoration reports structured `IS_STREAMING`, the userscript recolors only the near-white portion of the original stock ChatGPT favicon to yellow. A successful normalized terminal event changes that favicon to light green only when processing was observed in the current loaded page. A successful terminal arriving without such page-lifetime processing evidence does not infer green. A later terminal error, including `conversation_too_large` after a successful final response, does not replace the completed green state. A subsequent current-page prompt returns the favicon to yellow.

A reload whose structured stream status is not active leaves the stock favicon untouched; `NOT_STREAMING` is not treated as evidence that this page observed completion. The colored icon is rendered through a separate userscript-owned favicon link. The source href is captured from the stock favicon before the override and memoized, and every yellow or green render reloads that original source rather than recoloring a previously generated icon. Visible near-white pixels are recolored while alpha and non-white pixels are preserved. Image/canvas failure is diagnostic-only; there is no DOM-text, local-storage, alternate-network, or other fallback state path.
"""
new_shared = """## Shared agent lifecycle observation and terminal dispatch

Agent lifecycle state is observed once and projected to independent consumers. Current-page processing begins at the existing structured `POST /backend-api/f/conversation` request boundary; the stopwatch and favicon consume that same observed generation start rather than installing separate prompt detectors. On reload, the single structured `/backend-api/conversation/<id>/stream_status` result already fetched for stopwatch restoration is also projected to the favicon consumer; no second status request or alternate state detector is introduced.

Structured terminal state is normalized exactly once before any terminal side effect. The normalizer determines terminal kind, conversation identity, exchange identity, terminal de-duplication key, and one monotonic completion timestamp. Successful-final exchange identity prefers the final Assistant message metadata; structured capture/request identity is used only by the same shared normalizer when needed. The normalized immutable terminal object is then dispatched to the sound, stopwatch, and favicon handlers. None of those consumers independently classifies terminal state or reconstructs terminal identity. The stopwatch still rejects a normalized terminal whose exchange identity does not match the active stopwatch session. Sound de-duplication distinguishes terminal kind as well as terminal identity so a successful completion followed by a structured same-exchange terminal error can emit one ding and one buzz without duplicate replay. Rendered text and DOM error strings are not terminal detectors.

This is a project-wide watcher/consumer design pattern, not an implementation detail of issues #135/#136/#148. New Agent-state consumers must reuse this path. Concrete ChatGPT endpoint, stream-shape, reload, terminal-ordering, and browser-integration evidence is maintained in `CHATGPT-WEB-INTEGRATION.md`.

## Agent favicon processing/completion/error state

The favicon is a presentation-only consumer of the shared lifecycle observer. When a current-page generation request is observed, or reload restoration reports structured `IS_STREAMING`, the userscript recolors only the near-white portion of the original stock ChatGPT favicon to yellow. A successful normalized terminal event changes that favicon to light green only when processing was observed in the current loaded page. A successful terminal arriving without such page-lifetime processing evidence does not infer green. A normalized terminal error changes the favicon to red. If ChatGPT emits a successful final and then a same-exchange terminal error such as `conversation_too_large`, the visible sequence is yellow → light green → red. A subsequent current-page prompt returns green or red to yellow.

A reload whose structured stream status is not active leaves the stock favicon untouched; `NOT_STREAMING` is not treated as evidence that this page observed completion. Browsers may choose among multiple `link[rel~="icon"]` candidates according to media/type/sizes, so DownloadConversation does not rely on one appended generic icon link. On each colored render it enumerates the current stock favicon candidates, captures each candidate's original source once, generates that candidate's yellow/green/red image from its own original source, and updates the existing candidate. Every later state is regenerated from the captured original rather than from a previously recolored image. An explicit original state restores the captured hrefs. Visible near-white pixels are recolored while alpha and non-white pixels are preserved. Image/canvas failure is diagnostic-only; there is no DOM-text, local-storage, alternate-network, or other fallback state path.
"""
design = replace_once(design, old_shared, new_shared, 'shared watcher/favicon design')
design_path.write_text(design, encoding='utf-8')
