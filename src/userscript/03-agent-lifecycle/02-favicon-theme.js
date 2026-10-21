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
    if (typeof faviconProvenanceThemeChanged === 'function') {
      faviconProvenanceThemeChanged(agentFaviconCurrentTheme());
    }
    ++agentFaviconRenderGeneration;
    agentFaviconRestoreStockCandidates();
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

  /**
   * Restores untouched stock link hrefs before switching or revoking PNGs.
   * @returns {void} All currently tracked links retain original provenance.
   */
  function agentFaviconRestoreStockCandidates() {
    for (const candidate of agentFaviconCurrentCandidates()) {
      if (candidate.link.href !== candidate.original_href) {
        const oldHref = candidate.link.href;
        candidate.link.href = candidate.original_href;
        if (typeof faviconProvenanceNoteWrite === 'function') {
          faviconProvenanceNoteWrite(candidate.link, oldHref,
            candidate.original_href, 'original', {
              original_url: candidate.original_href,
              theme: agentFaviconCurrentTheme(), state: 'original',
              progress_step: null
            });
        }
      }
      agentFaviconDisplayedHrefs.delete(candidate.link);
    }
  }

  /** Active timer request and its exact lifecycle/theme/source context. */
  let agentFaviconPulseUpdatePending = null;

  /**
   * Coalesces only equivalent slow reads, never suppressing a new context.
   * @returns {void} Does not return a value.
   */
  function agentFaviconPulseHeartbeat() {
    if (agentFaviconVisibleState === 'original' ||
        agentFaviconHeartbeatCadence() === null) return;
    const candidates = agentFaviconActiveCandidates(agentFaviconCurrentCandidates());
    const key = JSON.stringify([agentFaviconVisibleState,
      agentFaviconRingStep(), agentFaviconCurrentTheme(),
      candidates.map(candidate => [candidate.original_href, candidate.media])]);
    if (agentFaviconPulseUpdatePending?.key === key) return;
    const pending = { key };
    agentFaviconPulseUpdatePending = pending;
    /**
     * Releases only the matching periodic request after async completion.
     * @returns {void} No result is returned.
     */
    const complete = () => {
      if (agentFaviconPulseUpdatePending === pending) {
        agentFaviconPulseUpdatePending = null;
      }
    };
    void agentFaviconRenderState(agentFaviconVisibleState, true)
      .then(complete, complete);
  }

