
  /** Current document's early provider-neutral URL observer; queue outlives host. */
  let cscEarlyNavigationDisconnect = null;

  /**
   * Capture initial route before asynchronous Core/plugin readiness and
   * preserve subsequent SPA transitions while the provider is disconnected.
   * The #310 backlog owns ordering and delivers each captured URL once.
   * @returns {void} No value is returned.
   */
  function cscEnsureEarlyNavigationIngress() {
    if (cscEarlyNavigationDisconnect) return;
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    cscEarlyNavigationDisconnect = observeGenericBrowserNavigation(page,
      event => cscPluginQueueNavigation(event.url));
  }

  /**
   * Release browser hooks on pagehide without touching queued captures.
   * @returns {void} No value is returned.
   */
  function cscDisposeEarlyNavigationIngress() {
    const dispose = cscEarlyNavigationDisconnect;
    cscEarlyNavigationDisconnect = null;
    dispose?.();
  }

  // Document-start and before the plugin host is acquired. Unlike the old
  // provider-ready observer, this records A/B/A during late host readiness.
  cscEnsureEarlyNavigationIngress();
