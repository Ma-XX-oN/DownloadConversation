  /**
   * Reads the actual browser colour scheme, without guessing from source bytes.
   * @returns {string|null} Active light/dark theme or null if unobservable.
   */
  function agentFaviconCurrentTheme() {
    if (!agentFaviconThemeQuery) {
      if (typeof window.matchMedia !== 'function') return null;
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      if (!query || typeof query.matches !== 'boolean' ||
          typeof query.addEventListener !== 'function') return null;
      query.addEventListener('change', agentFaviconHandleThemeChange);
      agentFaviconThemeQuery = query;
    }
    return agentFaviconThemeQuery.matches ? 'dark' : 'light';
  }

  /**
   * On an actual theme flip, discard displayed frames before async lookup.
   * @returns {void} Does not return a value.
   */
  function agentFaviconHandleThemeChange() {
    ++agentFaviconRenderGeneration;
    for (const candidate of agentFaviconCurrentCandidates()) {
      if (candidate.link.href !== candidate.original_href) {
        candidate.link.href = candidate.original_href;
      }
      agentFaviconDisplayedHrefs.delete(candidate.link);
    }
    agentFaviconTrimObjectUrls();
    if (!agentFaviconPageHidden && agentFaviconVisibleState !== 'original') {
      void agentFaviconRenderState(agentFaviconVisibleState);
    }
  }

  /**
   * Keeps only favicon links eligible for the current browser media context.
   * @param {Array<Object>} candidates - Original stock link descriptors.
   * @returns {Array<Object>} Descriptors allowed by active media queries.
   */
  function agentFaviconActiveCandidates(candidates) {
    return candidates.filter(candidate => !candidate.media ||
      window.matchMedia(candidate.media).matches);
  }

