  /** Event-driven favicon provenance, separate from lifecycle/cache behaviour. */
  const faviconProvenanceSeen = new Map();
  /** Last href assigned by DC for each observed favicon element. */
  const faviconProvenanceOwnWrites = new WeakMap();
  /** Last logged DC display context per favicon element. */
  const faviconProvenanceDisplayContext = new WeakMap();
  /** Bounded record of logical sequence requests and readiness. */
  const faviconProvenanceCacheStates = new Map();
  /** Last observed browser preferred colour scheme. */
  let faviconProvenanceLastTheme = null;
  /** Last observed ChatGPT data-theme value, if present. */
  let faviconProvenanceLastAppTheme = 'unobserved';
  /** DOM favicon observer; disconnected on pagehide. */
  let faviconProvenanceObserver = null;

  /**
   * Build a diagnostic-only URL identity without leaking query values.
   *
   * @param {string|null|undefined} value - Candidate URL or Blob href to summarize.
   * @returns {string|null} - Redacted URL identity or null.
   */
  function faviconProvenanceUrl(value) {
    if (!value) return null;
    const href = String(value);
    let hash = 2166136261;
    for (let i = 0; i < href.length; i++) {
      hash ^= href.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const id = (hash >>> 0).toString(16).padStart(8, '0');
    if (href.startsWith('blob:')) return 'blob:[redacted]#' + id;
    if (href.startsWith('data:')) {
      return 'data:' + href.slice(5).split(/[;,]/, 1)[0].slice(0, 40) + '#' + id;
    }
    try {
      const url = new URL(href, document.baseURI);
      return (url.origin + url.pathname).slice(0, 220) +
        (url.search ? '?[query-hidden]' : '') + '#' + id;
    } catch {
      return '[unparseable-url]#' + id;
    }
  }

  /**
   * Only emit Debug entries, never a 250-ms heartbeat-sized stream.
   *
   * @param {string} event - Semantic favicon event name.
   * @param {Object} fields - Compact event fields.
   * @returns {void} - Emits an event only when Debug is enabled.
   */
  function faviconProvenanceLog(event, fields) {
    if (typeof logDiagnostic !== 'function' ||
        (typeof diagnosticEnabled === 'function' && !diagnosticEnabled('debug'))) return;
    logDiagnostic('debug', 'agent-favicon-' + event, fields);
  }

  /**
   * Record the stock link, including changes detected by periodic inspection.
   *
   * @param {Object} candidate - Observed original favicon link descriptor.
   * @returns {void} - Updates the provenance record and logs changes.
   */
  function faviconProvenanceTrackCandidate(candidate) {
    const link = candidate.link;
    const current = link.href;
    const stock = candidate.original_href;
    const meta = [candidate.media, candidate.type, candidate.sizes].join('|');
    const before = faviconProvenanceSeen.get(link);
    const dcHref = agentFaviconDisplayedHrefs.get(link);
    if (dcHref === current && (!before || before.observed !== current)) {
      const previousContext = faviconProvenanceDisplayContext.get(link);
      faviconProvenanceNoteWrite(link, before?.observed || stock, current,
        'generated', {
          original_url: stock,
          theme: typeof agentFaviconCurrentTheme === 'function'
            ? agentFaviconCurrentTheme() : faviconProvenanceLastTheme,
          state: agentFaviconVisibleState,
          progress_step: agentFaviconRingStep()
        });
      if (previousContext !== faviconProvenanceDisplayContext.get(link)) {
        faviconProvenanceLog('cache-frame-available', {
          original_url: faviconProvenanceUrl(stock),
          note: 'first display of this generated sequence context'
        });
      }
    }
    const own = faviconProvenanceOwnWrites.get(link);
    const wasOurs = own === current;
    if (wasOurs) faviconProvenanceOwnWrites.delete(link);
    const next = { original: stock, observed: current, meta };
    faviconProvenanceSeen.set(link, next);
    if (!before || before.original !== stock || before.meta !== meta ||
        (before.observed !== current && !wasOurs)) {
      const mediaMatches = !candidate.media || typeof window.matchMedia !== 'function'
        ? !candidate.media : window.matchMedia(candidate.media).matches;
      const event = !before ? 'stock-link-observed'
        : before.original !== stock ? 'stock-source-changed'
        : before.meta !== meta ? 'stock-attributes-changed'
        : 'stock-href-overwritten';
      faviconProvenanceLog(event, {
        origin: 'observed-dom-not-attributed-to-chatgpt',
        previous_original: faviconProvenanceUrl(before?.original),
        original_url: faviconProvenanceUrl(stock),
        previous_href: faviconProvenanceUrl(before?.observed),
        current_href: faviconProvenanceUrl(current),
        media: candidate.media, media_matches: mediaMatches,
        type: candidate.type, sizes: candidate.sizes,
        theme: faviconProvenanceLastTheme
      });
    }
  }

  /**
   * Log only when DC changes display context, not when it advances a frame.
   *
   * @param {HTMLLinkElement} link - Favicon element updated by DC.
   * @param {string} before - Previous displayed href.
   * @param {string} after - Successfully assigned href.
   * @param {string} kind - Generated or original display.
   * @param {Object} details - Lifecycle and cache-context fields.
   * @returns {void} - Records a distinct DC display-context transition.
   */
  function faviconProvenanceNoteWrite(link, before, after, kind, details = {}) {
    faviconProvenanceOwnWrites.set(link, after);
    const observed = faviconProvenanceSeen.get(link);
    if (observed) faviconProvenanceSeen.set(link, {
      ...observed, observed: after
    });
    const context = JSON.stringify([kind, details.original_url, details.theme,
      details.state, details.progress_step]);
    if (faviconProvenanceDisplayContext.get(link) === context) return;
    faviconProvenanceDisplayContext.set(link, context);
    faviconProvenanceLog(kind === 'original' ? 'dc-restored' : 'dc-assigned', {
      origin: 'dc', previous_href: faviconProvenanceUrl(before),
      assigned_href: faviconProvenanceUrl(after),
      original_url: faviconProvenanceUrl(details.original_url),
      theme: details.theme ?? faviconProvenanceLastTheme,
      state: details.state ?? 'original',
      progress_step: details.progress_step ?? null,
      media: link.media || '', media_matches: !link.media ||
        (typeof window.matchMedia === 'function' && window.matchMedia(link.media).matches)
    });
  }

  /**
   * Log once per logical sequence, not once per pulse frame read.
   *
   * @param {string} version - Compatible dataset version.
   * @param {string} url - Original favicon URL.
   * @param {string} theme - Actual rendering theme.
   * @param {number} base - Base colour identifier.
   * @param {number} step - Progress step.
   * @param {boolean} ready - Whether a valid frame was returned.
   * @returns {void} - Records bounded cache request/available transitions.
   */
  function faviconProvenanceCacheEvent(version, url, theme, base, step, ready) {
    const key = JSON.stringify([version, url, theme, base, step]);
    const old = faviconProvenanceCacheStates.get(key);
    if (old === 'ready' || (old === 'requested' && !ready)) return;
    faviconProvenanceCacheStates.delete(key);
    faviconProvenanceCacheStates.set(key, ready ? 'ready' : 'requested');
    while (faviconProvenanceCacheStates.size > 128) {
      faviconProvenanceCacheStates.delete(faviconProvenanceCacheStates.keys().next().value);
    }
    faviconProvenanceLog(ready ? 'cache-frame-available' : 'cache-frame-requested', {
      version, original_url: faviconProvenanceUrl(url), theme,
      base_type: base, progress_step: step,
      note: ready ? 'frame returned; cache-hit status is not exposed'
        : 'frame lookup; not proof of a cache miss'
    });
  }

  /**
   * Read the application's observed data-theme without treating it as media preference.
   *
   * @returns {string} - Observed ChatGPT data-theme or unobserved.
   */
  function faviconProvenanceAppTheme() {
    const value = document.documentElement?.getAttribute?.('data-theme');
    return value === 'dark' || value === 'light' ? value : 'unobserved';
  }

  /**
   * Theme changes are browser preference changes, not proven app-theme changes.
   *
   * @param {string} theme - Observed browser preferred colour scheme.
   * @returns {void} - Logs an actual browser preference transition.
   */
  function faviconProvenanceThemeChanged(theme) {
    if (!theme || theme === faviconProvenanceLastTheme) return;
    const previous = faviconProvenanceLastTheme;
    faviconProvenanceLastTheme = theme;
    const links = [...document.querySelectorAll('link[rel~="icon"]')];
    faviconProvenanceLog('browser-theme-changed', {
      previous, current: theme, source: 'prefers-color-scheme',
      app_theme: faviconProvenanceAppTheme(),
      candidates: links.map(link => ({
        original_url: faviconProvenanceUrl(agentFaviconOriginalSources.get(link) || link.href),
        media: link.media || '',
        media_matches: !link.media || window.matchMedia(link.media).matches
      }))
    });
  }

  /**
   * Observe DOM link changes without patching any ChatGPT or browser setter.
   *
   * @param {Array<MutationRecord>} records - Favicon-related DOM mutation batch.
   * @returns {void} - Records relevant changes without modifying favicon selection.
   */
  function faviconProvenanceObserveDom(records) {
    const relevant = records.some(record => {
      if (record.type === 'attributes') {
        if (record.target === document.documentElement &&
            record.attributeName === 'data-theme') {
          const appTheme = faviconProvenanceAppTheme();
          if (appTheme !== faviconProvenanceLastAppTheme) {
            faviconProvenanceLog('app-theme-changed', {
              previous: faviconProvenanceLastAppTheme, current: appTheme,
              browser_theme: faviconProvenanceLastTheme,
              source: 'observed-data-theme'
            });
            faviconProvenanceLastAppTheme = appTheme;
          }
          return false;
        }
        const link = record.target;
        if (!link || String(link.tagName).toLowerCase() !== 'link') return false;
        if (record.attributeName === 'href' &&
            faviconProvenanceOwnWrites.get(link) === link.href) return false;
        return link.rel?.split(/\s+/).includes('icon') || faviconProvenanceSeen.has(link);
      }
      return [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && (node.matches?.('link[rel~="icon"]') ||
          node.querySelector?.('link[rel~="icon"]')));
    });
    if (!relevant) return;
    const current = new Set(document.querySelectorAll('link[rel~="icon"]'));
    for (const [link, previous] of faviconProvenanceSeen) {
      if (current.has(link)) continue;
      faviconProvenanceSeen.delete(link);
      faviconProvenanceLog('stock-link-removed', {
        origin: 'observed-dom-not-attributed-to-chatgpt',
        original_url: faviconProvenanceUrl(previous.original),
        media_type_sizes: previous.meta
      });
    }
    for (const candidate of agentFaviconCurrentCandidates()) {
      faviconProvenanceTrackCandidate(candidate);
    }
  }

  /**
   * Install once; missing MutationObserver leaves the existing polling intact.
   *
   * @returns {void} - Installs event-driven favicon provenance tracking.
   */
  function faviconProvenanceStart() {
    // @run-at document-start may precede creation of document.head.
    // Observing Document also catches subsequent <head> and icon insertion.
    faviconProvenanceLastAppTheme = faviconProvenanceAppTheme();
    for (const candidate of agentFaviconCurrentCandidates()) {
      faviconProvenanceTrackCandidate(candidate);
    }
    if (typeof window.matchMedia === 'function') {
      faviconProvenanceThemeChanged(
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      );
    }
    if (typeof MutationObserver !== 'function') return;
    faviconProvenanceObserver = new MutationObserver(faviconProvenanceObserveDom);
    faviconProvenanceObserver.observe(document, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['href', 'rel', 'media', 'type', 'sizes', 'data-theme']
    });
    window.addEventListener('pagehide', () => faviconProvenanceObserver?.disconnect());
  }
  // Provenance startup is deferred until the recorder capture state is initialized.
