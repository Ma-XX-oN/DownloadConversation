  /**
   * Keeps ChatGPT's startup dark appearance stable without covering its UI.
   * Stops suppressing theme changes after a bounded startup window.
   */
  function installStartupDarkThemeGuard() {
    if (!window.matchMedia('(prefers-color-scheme: dark)').matches) return;
    const root = document.documentElement;
    if (!root) return;
    const nativeSet = Element.prototype.setAttribute;
    const nativeRemove = Element.prototype.removeAttribute;
    let seenDark = root.getAttribute('data-theme') === 'dark';
    let active = true;
    /**
     * Restores normal theme writes at the end of startup.
     * @returns {void} No value is returned.
     */
    const stop = () => {
      active = false;
      observer.disconnect();
      if (Element.prototype.setAttribute === setGuard) Element.prototype.setAttribute = nativeSet;
      if (Element.prototype.removeAttribute === removeGuard) Element.prototype.removeAttribute = nativeRemove;
      clearTimeout(deadline);
      window.removeEventListener('pagehide', stop);
    };
    /**
     * Logs attempts to replace dark mode with light mode.
     * @param {string} method - Intercepted method.
     * @returns {void} No value is returned.
     */
    const prevented = method => {
      logDiagnostic('debug', 'theme-startup-light-prevented', {
        method, elapsed_ms: Math.round(performance.now())
      });
    };
    /**
     * Intercepts only transient light writes to the document root.
     * @param {string} name - Attribute name.
     * @param {string} value - Requested attribute value.
     * @returns {void} Preserves native setAttribute behaviour otherwise.
     */
    const setGuard = function(name, value) {
      if (this === root && name === 'data-theme') {
        if (value === 'dark') seenDark = true;
        if (active && seenDark && value === 'light') {
          prevented('setAttribute');
          return;
        }
      }
      return Reflect.apply(nativeSet, this, [name, value]);
    };
    /**
     * Preserves dark mode through removal/reassignment during startup.
     * @param {string} name - Attribute name.
     * @returns {void} Preserves native removeAttribute behaviour otherwise.
     */
    const removeGuard = function(name) {
      if (this === root && name === 'data-theme' && active && seenDark) {
        prevented('removeAttribute');
        return;
      }
      return Reflect.apply(nativeRemove, this, [name]);
    };
    /** Restores dark mode if a dataset/property write bypasses the method hooks. */
    const observer = new MutationObserver(() => {
      const theme = root.getAttribute('data-theme');
      if (theme === 'dark') seenDark = true;
      if (active && seenDark && theme === 'light') {
        Reflect.apply(nativeSet, root, ['data-theme', 'dark']);
        prevented('attribute-observer');
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    Element.prototype.setAttribute = setGuard;
    Element.prototype.removeAttribute = removeGuard;
    const deadline = setTimeout(stop, 15000);
    window.addEventListener('pagehide', stop, { once: true });
  }

  installStartupDarkThemeGuard();
