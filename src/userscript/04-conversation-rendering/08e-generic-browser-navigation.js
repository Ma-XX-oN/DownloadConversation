
  /**
   * Observes browser route changes without interpreting provider-specific URLs.
   * The caller owns the listener's lifetime and decides how to use each URL.
   *
   * @param {Window} browser - Browser page realm whose history is observed.
   * @param {Function} publish - Generic URL consumer.
   * @returns {() => void} Restores history methods and unregisters listeners.
   */
  function observeGenericBrowserNavigation(browser, publish) {
    assert(browser && typeof publish === 'function',
      'Navigation observer requires a browser and a URL receiver.');
    /** Last route delivered to this observer, including the initial snapshot. */
    let lastUrl = null;
    /** Whether teardown has permanently disabled event delivery. */
    let disposed = false;
    /** History object whose methods are wrapped during this connection. */
    const history = browser.history;
    /** Original pushState implementation for exact teardown restoration. */
    const pushState = history.pushState;
    /** Original replaceState implementation for exact teardown restoration. */
    const replaceState = history.replaceState;

    /**
     * Delivers a changed absolute URL without guessing a provider identity.
     * @returns {void} No value is returned.
     */
    function publishCurrentUrl() {
      if (disposed) return;
      const url = String(browser.location.href);
      if (url === lastUrl) return;
      lastUrl = url;
      publish({ url });
    }

    /**
     * Wraps a history mutation while preserving its native return/exception.
     * @param {Function} original - Unmodified native history method.
     * @returns {Function} History wrapper for the current observer.
     */
    function wrapHistory(original) {
      return function(...args) {
        const result = Reflect.apply(original, this, args);
        publishCurrentUrl();
        return result;
      };
    }

    /** Observer-owned history wrappers, removed only if still installed. */
    const wrappedPush = wrapHistory(pushState);
    const wrappedReplace = wrapHistory(replaceState);
    /** Whether the History API popstate listener was successfully registered. */
    let popstateInstalled = false;
    /** Whether the Navigation API listener was successfully registered. */
    let navigationInstalled = false;
    /**
     * Restores only observer-owned browser hooks after dispose or failed setup.
     * @returns {void} No value is returned.
     */
    function disconnect() {
      if (disposed) return;
      disposed = true;
      try {
        if (navigationInstalled) {
          browser.navigation?.removeEventListener?.('currententrychange', publishCurrentUrl);
        }
      } finally {
        try {
          if (popstateInstalled) {
            browser.removeEventListener('popstate', publishCurrentUrl);
          }
        } finally {
          if (history.pushState === wrappedPush) history.pushState = pushState;
          if (history.replaceState === wrappedReplace) history.replaceState = replaceState;
        }
      }
    }
    try {
      history.pushState = wrappedPush;
      history.replaceState = wrappedReplace;
      browser.addEventListener('popstate', publishCurrentUrl);
      popstateInstalled = true;
      if (typeof browser.navigation?.addEventListener === 'function') {
        browser.navigation.addEventListener('currententrychange', publishCurrentUrl);
        navigationInstalled = true;
      }
      publishCurrentUrl();
    } catch (error) {
      disconnect();
      throw error;
    }
    return disconnect;
  }
