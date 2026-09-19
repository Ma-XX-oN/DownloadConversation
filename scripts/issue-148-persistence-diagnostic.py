from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
  global text
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'Expected exactly one match, found {count}: {old[:180]!r}')
  text = text.replace(old, new, 1)


replace_once(
  '// @version      1.5.0-issue.140.4',
  '// @version      1.5.0-issue.148.3'
)

replace_once(
  """  /** Original source href retained per stock favicon link before DownloadConversation recolors it. */
  const agentFaviconOriginalSources = new Map();
  /** Monotonic render generation preventing stale asynchronous favicon writes. */
  let agentFaviconRenderGeneration = 0;
  /** Whether processing has been observed in this loaded page and may transition to green. */
  let agentFaviconProcessingObserved = false;""",
  """  /** Original source href retained per stock favicon link before DownloadConversation recolors it. */
  const agentFaviconOriginalSources = new Map();
  /** Exact generated href most recently projected onto each favicon candidate. */
  const agentFaviconProjectedSources = new WeakMap();
  /** Monotonic render generation preventing stale asynchronous favicon writes. */
  let agentFaviconRenderGeneration = 0;
  /** Favicon state currently intended by the shared lifecycle consumer. */
  let agentFaviconDesiredState = 'original';
  /** Mutation observer auditing whether ChatGPT later overwrites projected favicon candidates. */
  let agentFaviconProjectionObserver = null;
  /** Last projection-overwrite diagnostic signature, preventing duplicate mutation noise. */
  let agentFaviconProjectionWarningKey = null;
  /** Whether processing has been observed in this loaded page and may transition to green. */
  let agentFaviconProcessingObserved = false;"""
)

# Track the exact generated href before changing the DOM link so an observer callback can
# distinguish our own writes from subsequent ChatGPT hydration writes.
replace_once(
  """          candidate.link.href = canvas.toDataURL('image/png');
          logDiagnostic('debug', 'agent-favicon-candidate-rendered', {""",
  """          const projectedHref = canvas.toDataURL('image/png');
          agentFaviconProjectedSources.set(candidate.link, projectedHref);
          candidate.link.href = projectedHref;
          logDiagnostic('debug', 'agent-favicon-candidate-rendered', {"""
)

functions = r'''
  /**
   * Audits whether every current favicon candidate still has the exact href projected by
   * DownloadConversation for the desired colored state.
   *
   * This function is diagnostic-only. It never reapplies a favicon or changes lifecycle state.
   *
   * @param {string} reason - Diagnostic trigger, such as `mutation` or `render-complete`.
   * @returns {boolean} True when projection is intact or the desired state is original.
   */
  function agentFaviconAuditProjection(reason) {
    if (agentFaviconDesiredState === 'original') {
      agentFaviconProjectionWarningKey = null;
      return true;
    }
    const links = [...document.querySelectorAll('link[rel~="icon"]')]
      .filter(link => typeof link?.href === 'string' && link.href);
    const unprojected = links.filter(link => {
      const expected = agentFaviconProjectedSources.get(link);
      return typeof expected !== 'string' || link.href !== expected;
    });
    if (!unprojected.length) {
      agentFaviconProjectionWarningKey = null;
      return true;
    }
    const warningKey = `${agentFaviconDesiredState}:${links.length}:${unprojected.length}`;
    if (warningKey !== agentFaviconProjectionWarningKey) {
      agentFaviconProjectionWarningKey = warningKey;
      logDiagnostic('warnings', 'agent-favicon-projection-overwritten', {
        state: agentFaviconDesiredState,
        reason,
        candidate_count: links.length,
        unprojected_candidate_count: unprojected.length
      });
    }
    return false;
  }

  /**
   * Installs one presentation-only observer that reports later favicon candidate replacement
   * or href mutation after DownloadConversation has projected a colored state.
   *
   * @returns {void} No value is returned.
   */
  function agentFaviconEnsureProjectionObserver() {
    if (agentFaviconProjectionObserver) return;
    const target = document.head || document.documentElement;
    if (!target || typeof MutationObserver !== 'function') return;
    agentFaviconProjectionObserver = new MutationObserver(() => {
      agentFaviconAuditProjection('mutation');
    });
    agentFaviconProjectionObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'rel', 'media', 'type', 'sizes']
    });
  }

'''
marker = "  /**\n   * Renders one Agent favicon state across every stock favicon candidate the browser may select."
if text.count(marker) != 1:
  raise SystemExit('Could not locate favicon state renderer marker.')
text = text.replace(marker, functions + marker, 1)

# Desired state is presentation state, not a second lifecycle detector.
replace_once(
  """  function agentFaviconRenderState(state) {
    const generation = ++agentFaviconRenderGeneration;
    const candidates = agentFaviconCurrentCandidates();""",
  """  function agentFaviconRenderState(state) {
    const generation = ++agentFaviconRenderGeneration;
    agentFaviconDesiredState = state;
    const candidates = agentFaviconCurrentCandidates();"""
)

replace_once(
  """    if (state === 'original') {
      for (const candidate of candidates) candidate.link.href = candidate.original_href;
      logDiagnostic('debug', 'agent-favicon-state-rendered', {""",
  """    if (state === 'original') {
      agentFaviconProjectionWarningKey = null;
      for (const candidate of candidates) {
        agentFaviconProjectedSources.delete(candidate.link);
        candidate.link.href = candidate.original_href;
      }
      logDiagnostic('debug', 'agent-favicon-state-rendered', {"""
)

replace_once(
  """      logDiagnostic(applied === candidates.length ? 'debug' : 'warnings', 'agent-favicon-state-rendered', {
        state,
        candidate_count: candidates.length,
        applied_candidate_count: applied,
        recolored_pixels: recoloredPixels
      });
      return applied === candidates.length;""",
  """      logDiagnostic(applied === candidates.length ? 'debug' : 'warnings', 'agent-favicon-state-rendered', {
        state,
        candidate_count: candidates.length,
        applied_candidate_count: applied,
        recolored_pixels: recoloredPixels
      });
      if (applied === candidates.length) {
        agentFaviconEnsureProjectionObserver();
        agentFaviconAuditProjection('render-complete');
      }
      return applied === candidates.length;"""
)

path.write_text(text, encoding='utf-8')
