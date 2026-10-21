  /** Event-driven favicon provenance, separate from lifecycle/cache behaviour. */
  const faviconProvenanceSeen = new Map();
  const faviconProvenanceOwnWrites = new WeakMap();
  const faviconProvenanceDisplayContext = new WeakMap();
  const faviconProvenanceCacheStates = new Map();
  let faviconProvenanceLastTheme = null;
  let faviconProvenanceObserver = null;

  /** Build a diagnostic-only URL identity without leaking query values. */
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

  /** Only emit Debug entries, never a 250-ms heartbeat-sized stream. */
  function faviconProvenanceLog(event, fields) {
    if (typeof logDiagnostic !== 'function' ||
        (typeof diagnosticEnabled === 'function' && !diagnosticEnabled('debug'))) return;
    logDiagnostic('debug', 'agent-favicon-' + event, fields);
  }

  /** Record the stock link, including changes detected by periodic inspection. */
  function faviconProvenanceTrackCandidate(candidate) {
    const link = candidate.link;
    const current = link.href;
    const stock = candidate.original_href;
    const meta = [candidate.media, candidate.type, candidate.sizes].join('|');
    const before = faviconProvenanceSeen.get(link);
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

  /** Log only when DC changes display context, not when it advances a frame. */
  function faviconProvenanceNoteWrite(link, before, after, kind, details = {}) {
    faviconProvenanceOwnWrites.set(link, after);
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

  /** Log once per logical sequence, not once per pulse frame read. */
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

  /** Theme changes are browser preference changes, not proven app-theme changes. */
  function faviconProvenanceThemeChanged(theme) {
    if (!theme || theme === faviconProvenanceLastTheme) return;
    const previous = faviconProvenanceLastTheme;
    faviconProvenanceLastTheme = theme;
    const links = [...document.querySelectorAll('link[rel~="icon"]')];
    faviconProvenanceLog('browser-theme-changed', {
      previous, current: theme, source: 'prefers-color-scheme',
      app_theme: 'unobserved',
      candidates: links.map(link => ({
        original_url: faviconProvenanceUrl(agentFaviconOriginalSources.get(link) || link.href),
        media: link.media || '',
        media_matches: !link.media || window.matchMedia(link.media).matches
      }))
    });
  }

  /** Observe DOM link changes without patching any ChatGPT or browser setter. */
  function faviconProvenanceObserveDom(records) {
    const relevant = records.some(record => {
      if (record.type === 'attributes') {
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
    agentFaviconCurrentCandidates();
  }

  /** Install once; missing MutationObserver leaves the existing polling intact. */
  function faviconProvenanceStart() {
    // @run-at document-start may precede creation of document.head.
    // Observing Document also catches subsequent <head> and icon insertion.
    agentFaviconCurrentCandidates();
    if (typeof window.matchMedia === 'function') {
      faviconProvenanceThemeChanged(
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      );
    }
    if (typeof MutationObserver !== 'function') return;
    faviconProvenanceObserver = new MutationObserver(faviconProvenanceObserveDom);
    faviconProvenanceObserver.observe(document, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['href', 'rel', 'media', 'type', 'sizes']
    });
    window.addEventListener('pagehide', () => faviconProvenanceObserver?.disconnect());
  }
  faviconProvenanceStart();
