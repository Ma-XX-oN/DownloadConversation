  /** Add a suffix/rate entry here; all matching titles use one scheduler. */
  const AGENT_FAVICON_TITLE_CADENCES = Object.freeze({
    '- ACTIVE': 1000,
    '- USER ACTION REQUIRED': 2000
  });
  /** Last resolved frame cadence; null is the static policy. */
  let agentFaviconTitleLastCadence = null;
  /** Whether DOM observer bindings currently exist. */
  let agentFaviconTitleMonitoring = false;
  /** Watches the actual HTML title element. */
  let agentFaviconTitleHeadObserver = null;
  /** Title node currently observed (head watches direct child replacement only). */
  let agentFaviconTitleObservedTitle = null;
  /** Watches only the current sidebar's title region. */
  let agentFaviconTitleSidebarObserver = null;
  /** Currently observed sidebar container. */
  let agentFaviconTitleSidebarRoot = null;

  /**
   * Looks up exact case-sensitive suffix and its frame interval.
   * @returns {number|null} Milliseconds per frame or null for static.
   */
  function agentFaviconHeartbeatCadence() {
    const title = conversationTitle();
    const dash = title.lastIndexOf('-');
    if (dash < 0) return null;
    const suffix = title.slice(dash).trimEnd();
    const ms = AGENT_FAVICON_TITLE_CADENCES[suffix];
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  /**
   * Adapts frame timing to the same unchanged two-frame cache selector.
   * @param {number} nowMs - Monotonic clock.
   * @returns {number} Existing selector offset; zero yields static frame 0.
   */
  function agentFaviconFrameTimeOffset(nowMs) {
    const cadence = agentFaviconHeartbeatCadence();
    return cadence === null ? 0 : Math.floor(nowMs / cadence) * 1000;
  }

  /**
   * Observes only the page title and active sidebar, not the transcript.
   * @returns {void} No result.
   */
  function agentFaviconTitleBindObservers() {
    if (!agentFaviconTitleMonitoring) return;
    const titleNode = document.head?.querySelector('title') ?? null;
    if (document.head && (!agentFaviconTitleHeadObserver ||
        titleNode !== agentFaviconTitleObservedTitle)) {
      agentFaviconTitleHeadObserver?.disconnect();
      agentFaviconTitleHeadObserver = new MutationObserver(agentFaviconTitleRefresh);
      agentFaviconTitleHeadObserver.observe(document.head, { childList: true });
      if (titleNode) agentFaviconTitleHeadObserver.observe(titleNode, {
        subtree: true, childList: true, characterData: true
      });
      agentFaviconTitleObservedTitle = titleNode;
    }
    const current = document.querySelector(
      'a[data-interactive-row-link][aria-current="page"][href]');
    const root = current?.closest('nav') ??
      document.querySelector('nav') ?? current ?? null;
    if (root === agentFaviconTitleSidebarRoot) return;
    agentFaviconTitleSidebarObserver?.disconnect();
    agentFaviconTitleSidebarRoot = root;
    agentFaviconTitleSidebarObserver = null;
    if (!root) return;
    agentFaviconTitleSidebarObserver = new MutationObserver(agentFaviconTitleRefresh);
    agentFaviconTitleSidebarObserver.observe(root, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['href', 'aria-label', 'aria-current']
    });
  }

  /**
   * Invalidates pending frames whenever title cadence changes.
   * @returns {void} No result.
   */
  function agentFaviconTitleRefresh() {
    agentFaviconTitleBindObservers();
    if (agentFaviconPageHidden) return;
    const cadence = agentFaviconHeartbeatCadence();
    if (cadence === agentFaviconTitleLastCadence) return;
    agentFaviconTitleLastCadence = cadence;
    ++agentFaviconRenderGeneration;
    agentFaviconPulseUpdatePending = null;
    agentFaviconStopPulse();
    if (agentFaviconVisibleState !== 'original') {
      void agentFaviconRenderState(agentFaviconVisibleState, true);
    }
  }

  /**
   * Disconnects scoped observers on pagehide, including BFCache.
   * @returns {void} No result.
   */
  function agentFaviconTitlePause() {
    agentFaviconTitleHeadObserver?.disconnect();
    agentFaviconTitleSidebarObserver?.disconnect();
    agentFaviconTitleHeadObserver = null;
    agentFaviconTitleObservedTitle = null;
    agentFaviconTitleSidebarObserver = null;
    agentFaviconTitleSidebarRoot = null;
    agentFaviconTitleLastCadence = null;
    agentFaviconTitleMonitoring = false;
  }

  /**
   * Installs one listener set; reattaches observers on page restoration.
   * @returns {void} No result.
   */
  function agentFaviconTitleMonitorStart() {
    if (agentFaviconTitleMonitoring) return;
    agentFaviconTitleMonitoring = true;
    agentFaviconTitleRefresh();
    agentFaviconTitleBindObservers();
    document.addEventListener('DOMContentLoaded', agentFaviconTitleRefresh,
      { once: true });
    if (!agentFaviconTitleMonitorStart.bound) {
      agentFaviconTitleMonitorStart.bound = true;
      window.addEventListener('popstate', agentFaviconTitleRefresh);
      window.addEventListener('focus', agentFaviconTitleRefresh);
      window.addEventListener('pageshow', agentFaviconTitleMonitorStart);
      window.addEventListener('pagehide', agentFaviconTitlePause);
      document.addEventListener('click', event => {
        if (!event.target?.closest?.('a[data-interactive-row-link]')) return;
        Promise.resolve().then(agentFaviconTitleRefresh);
      }, true);
      window.navigation?.addEventListener?.('navigatesuccess',
        agentFaviconTitleRefresh);
    }
  }
