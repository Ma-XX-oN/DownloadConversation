  /**
   * TEMPORARY DC #356 subject adapter: DOM titles are provisional.
   * REMOVE/MOVE when umbrella DC #272 "Independently certify DC
   * subject-identification integration and retire identity fallbacks"
   * completes (parent AICC #123 "Epic: Subject-identification observer and
   * authoritative identity delivery"). DC #270 will bind the real agent.
   * NEVER use provisional identities for persisted filenames or metadata.
   */
  const interm_agent = (() => {
    const observers = new Set();
    let active = false;
    let titleObserver = null, headObserver = null, observedNode = null;
    let route = null, name = null, revision = 0;

    /** @returns {Object} Deep-frozen AICC V1-shaped unresolved snapshot. */
    function snapshot() {
      return Object.freeze({
        subject: 'subject-identification', revision, readiness: 'unresolved',
        project: Object.freeze({status: 'unresolved', id: null, name: null}),
        conversation: Object.freeze({status: 'unresolved', id: null, name})
      });
    }

    /** @returns {string|null} Provisional title (not backend verified). */
    function readTitle() {
      const title = String(document.title ?? '')
        .replace(/\s*[-–—]\s*ChatGPT\s*$/i, '').trim();
      return title && !/^ChatGPT(?: conversation)?$/i.test(title) ? title : null;
    }

    /**
     * Publish a complete current snapshot only when the title changes.
     * @param {string|null} next - Provisional title.
     * @returns {void} No result.
     */
    function publish(next) {
      if (next === name) return;
      name = next;
      ++revision;
      const current = snapshot();
      for (const callback of [...observers]) {
        if (!observers.has(callback)) continue;
        try { callback(current); }
        catch (error) {
          console.error('[DC interm_agent] identity callback failed', error);
        }
      }
    }

    /** @returns {void} Watch current title and title-element replacement. */
    function bind() {
      if (!active || !document.head) return;
      if (!headObserver) {
        headObserver = new MutationObserver(refresh);
        headObserver.observe(document.head, {childList: true});
      }
      const node = document.head.querySelector('title');
      if (node === observedNode) return;
      titleObserver?.disconnect();
      titleObserver = null;
      observedNode = node;
      if (node) {
        titleObserver = new MutationObserver(refresh);
        titleObserver.observe(node, {
          childList: true, characterData: true, subtree: true
        });
      }
    }

    /** @returns {void} Reconcile mutations/navigation without polling. */
    function refresh() {
      bind();
      const currentRoute = location.pathname + location.search;
      const next = readTitle();
      const stale = route !== null && route !== currentRoute && next === name;
      route = currentRoute;
      publish(stale ? null : next);
    }

    /** @returns {void} Start event-driven observation. */
    function start() {
      if (active) return;
      active = true;
      window.addEventListener('popstate', refresh);
      window.addEventListener('focus', refresh);
      window.addEventListener('pageshow', refresh);
      window.navigation?.addEventListener?.('navigatesuccess', refresh);
      document.addEventListener('DOMContentLoaded', refresh);
      refresh();
    }

    /** @returns {void} Disconnect when last subscriber leaves. */
    function stop() {
      if (!active) return;
      active = false;
      headObserver?.disconnect();
      titleObserver?.disconnect();
      headObserver = null;
      titleObserver = null;
      observedNode = null;
      window.removeEventListener('popstate', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.navigation?.removeEventListener?.('navigatesuccess', refresh);
      document.removeEventListener('DOMContentLoaded', refresh);
    }

    return Object.freeze({
      /**
       * AICC-compatible identity subject subscription, with synchronous
       * initial complete snapshot and idempotent unsubscribe.
       * @param {Function} callback - Identity snapshot consumer.
       * @param {string} subject - subject-identification only.
       * @returns {Function} Unsubscribe.
       */
      observeState(callback, subject) {
        if (typeof callback !== 'function') throw new TypeError('callback');
        if (subject !== 'subject-identification') {
          throw new TypeError('Unsupported observation subject');
        }
        if (!active) start();
        observers.add(callback);
        try { callback(snapshot()); }
        catch (error) {
          observers.delete(callback);
          if (!observers.size) stop();
          throw error;
        }
        return () => {
          observers.delete(callback);
          if (!observers.size) stop();
        };
      }
    });
  })();

