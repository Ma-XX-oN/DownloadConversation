  /** Animation V2 is a two-second blink with one frame per second. */
  const AGENT_FAVICON_PULSE_PERIOD_MS = 2000;
  /** Pulse timer starts after session readiness. */
  let agentFaviconPulseTimer = null;
  /** Existing lifecycle's presented favicon colour. */
  let agentFaviconVisibleState = 'original';
  /** V2 dataset session owned by #334. */
  let agentFaviconDatasetSession = null;
  /** In-flight shared cache session. */
  let agentFaviconSessionPending = null;
  /** Independent animation dataset version, never inferred from the DC build. */
  let agentFaviconVersionPending = null;
  /** Browser theme query for scheme-dependent SVGs. */
  let agentFaviconThemeQuery = null;
  /** LRU PNG URLs. */
  const agentFaviconObjectUrls = new Map();
  /** URLs currently assigned to original stock links. */
  const agentFaviconDisplayedHrefs = new Map();
  /** Tab-local URL limit. */
  const AGENT_FAVICON_URL_LIMIT = 84;
  /** Progress-step state for the existing shared stopwatch observer. */
  let agentFaviconRingRenderedStep = 0;
  /** Last successfully displayed 5-minute progress step. */
  let agentFaviconPresentedStep = null;
  /** Invalidated after pagehide. */
  let agentFaviconPageHidden = false;
  /** Navigation epoch rejects stale reads. */
  let agentFaviconPageEpoch = 0;

  /**
   * Selects one of the two blink frames from monotonic time.
   * @param {number} time_offset - Monotonic offset in milliseconds.
   * @returns {number|null} Blink frame 0 or 1, or null for invalid input.
   */
  function agentFaviconPulseIndex(time_offset) {
    if (!Number.isFinite(time_offset)) return null;
    const phase = ((time_offset % AGENT_FAVICON_PULSE_PERIOD_MS) +
      AGENT_FAVICON_PULSE_PERIOD_MS) % AGENT_FAVICON_PULSE_PERIOD_MS;
    return Math.floor(phase / 1000);
  }

  /**
   * Captures all stock link candidates, without changing media/type/sizes.
   * @returns {Array<Object>} Links and their original unmodified hrefs.
   */
  function agentFaviconCurrentCandidates() {
    return [...document.querySelectorAll('link[rel~="icon"]')]
      .filter(link => typeof link?.href === 'string' && link.href)
      .map(link => {
        const previous = agentFaviconOriginalSources.get(link);
        const assigned = agentFaviconDisplayedHrefs.get(link);
        if (!previous || (link.href !== previous && link.href !== assigned)) {
          agentFaviconOriginalSources.set(link, link.href);
          agentFaviconDisplayedHrefs.delete(link);
        }
        return {
          link,
          original_href: agentFaviconOriginalSources.get(link),
          media: typeof link.media === 'string' ? link.media : '',
          type: typeof link.type === 'string' ? link.type : '',
          sizes: typeof link.sizes?.value === 'string' ? link.sizes.value : ''
        };
      });
  }

  /**
   * Resolves and memoizes the provider's minimum compatible numeric version.
   * @returns {Promise<string|null>} Selected numeric version boundary or null.
   */
  async function agentFaviconCompatibleVersion() {
    if (typeof get_compatible_version_key !== 'function') return null;
    if (!agentFaviconVersionPending) {
      agentFaviconVersionPending = Promise.resolve()
        .then(() => get_compatible_version_key(FAVICON_ANIMATION_VERSION))
        .then(key => typeof key === 'string' ? key : null)
        .catch(() => null);
    }
    const key = await agentFaviconVersionPending;
    if (key === null) agentFaviconVersionPending = null;
    return key;
  }

  /**
   * Open the shared cache dataset.
   * @param {string} version_key - Animation version.
   * @returns {Promise<Object|null>} Session or null.
   */
  async function agentFaviconOpenSession(version_key) {
    if (agentFaviconPageHidden) return null;
    if (agentFaviconDatasetSession?.version === version_key) {
      return agentFaviconDatasetSession;
    }
    if (typeof open_favicon_dataset !== 'function') return null;
    if (!agentFaviconSessionPending) {
      const epoch = agentFaviconPageEpoch;
      agentFaviconSessionPending = Promise.resolve()
        .then(() => open_favicon_dataset(version_key, faviconV2RenderSequenceAdapter))
        .then(async session => {
          if (epoch !== agentFaviconPageEpoch || agentFaviconPageHidden) {
            if (session && typeof session.close === 'function') await session.close();
            return null;
          }
          if (!session || session.version !== version_key ||
              !Number.isSafeInteger(session.update_every_ms) ||
              session.update_every_ms <= 0 ||
              typeof session.read_png !== 'function' ||
              typeof session.close !== 'function') {
            if (session?.close) void session.close();
            return null;
          }
          agentFaviconDatasetSession = session;
          return session;
        }).catch(() => null).finally(() => {
          agentFaviconSessionPending = null;
        });
    }
    return agentFaviconSessionPending;
  }

  /**
   * Read one cached PNG as a reusable object URL.
   * @param {Object} session - Provider.
   * @param {string} originalUrl - SVG source.
   * @param {string} theme - Browser theme.
   * @param {number} base - Colour.
   * @param {number} step - Progress.
   * @param {number} frame - Frame index.
   * @returns {Promise<string|null>} Object URL or null.
   */
  async function agentFaviconFrameUrl(session, originalUrl, theme, base, step, frame) {
    if (agentFaviconPageHidden) return null;
    const epoch = agentFaviconPageEpoch;
    const key = JSON.stringify([session.version, originalUrl, theme, base, step, frame]);
    if (agentFaviconObjectUrls.has(key)) {
      const url = agentFaviconObjectUrls.get(key);
      agentFaviconObjectUrls.delete(key);
      agentFaviconObjectUrls.set(key, url);
      return url;
    }
    if (typeof faviconProvenanceCacheEvent === 'function')
      faviconProvenanceCacheEvent(session.version, originalUrl, theme, base, step, false);
    const blob = await session.read_png(originalUrl, theme, base, step, frame);
    if (epoch !== agentFaviconPageEpoch || agentFaviconPageHidden) return null;
    if (!(blob instanceof Blob) || blob.type !== 'image/png' || !blob.size) return null;
    // Concurrent heartbeats can request one frame while its IDB read is pending.
    if (agentFaviconObjectUrls.has(key)) return agentFaviconObjectUrls.get(key);
    const url = URL.createObjectURL(blob);
    agentFaviconObjectUrls.set(key, url);
    return url;
  }

  /**
   * Prefer the theme's SVG artwork for all browser icon links.
   * @param {Array<Object>} candidates - Eligible stock links.
   * @param {string} theme - Browser scheme.
   * @returns {string|null} Source URL.
   */
  function agentFaviconPreferredSource(candidates, theme) {
    const svgs = candidates.filter(candidate =>
      candidate.type.toLowerCase() === 'image/svg+xml' ||
      /\.svg(?:[?#]|$)/i.test(candidate.original_href));
    const themed = svgs.find(candidate =>
      /favicon-dark[.\-_]/i.test(candidate.original_href) === (theme === 'dark'));
    return (themed ?? svgs[0] ?? candidates[0])?.original_href ?? null;
  }

  /**
   * Select a versioned animation frame without leaking layout to callers.
   * @param {string} version_key - Animation version.
   * @param {number} base_type - Colour.
   * @param {number} completion_time - Progress step.
   * @param {number} time_offset - Monotonic milliseconds.
   * @returns {Promise<Array<Object>|null>} Icon URL assignments.
   */
  async function get_favicon(version_key, base_type, completion_time, time_offset) {
    if (agentFaviconPageHidden) return null;
    const frame = agentFaviconPulseIndex(time_offset);
    if (frame === null || ![0, 1, 2, 3].includes(base_type) ||
        !Number.isInteger(completion_time) || completion_time < 0 ||
        completion_time > 6 || typeof version_key !== 'string') return null;
    const theme = agentFaviconCurrentTheme();
    if (theme === null) return null;
    const session = await agentFaviconOpenSession(version_key);
    if (!session) return null;
    const candidates = agentFaviconActiveCandidates(agentFaviconCurrentCandidates());
    const source = agentFaviconPreferredSource(candidates, theme);
    if (!source) return null;
    const href = await agentFaviconFrameUrl(
      session, source, theme, base_type, completion_time, frame);
    if (agentFaviconCurrentTheme() !== theme || agentFaviconPageHidden) return null;
    return href ? candidates.map(candidate => ({ link: candidate.link, href })) : null;
  }

  /**
   * Revokes only object URLs no longer displayed by a stock favicon link.
   * @param {boolean} all - Dispose every URL during page navigation.
   * @returns {void} No value is returned.
   */
  function agentFaviconTrimObjectUrls(all = false) {
    const displayed = new Set(agentFaviconDisplayedHrefs.values());
    for (const [key, url] of agentFaviconObjectUrls) {
      if (!all && agentFaviconObjectUrls.size <= AGENT_FAVICON_URL_LIMIT) break;
      if (!all && displayed.has(url)) continue;
      agentFaviconObjectUrls.delete(key);
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Derives progress solely from the authoritative stopwatch state.
   * @param {number} nowMs - Monotonic current time.
   * @returns {number} Saturated five-minute progress step 0..6.
   */
  function agentFaviconRingStep(nowMs = performance.now()) {
    if (!agentStopwatchState || !Number.isFinite(agentStopwatchState.started_at_ms)) return 0;
    const elapsed = agentStopwatchState.active
      ? Math.max(0, nowMs - agentStopwatchState.started_at_ms)
      : Math.max(0, agentStopwatchState.total_ms ?? 0);
    return Math.min(6, Math.floor(elapsed / (5 * 60 * 1000)));
  }

  /**
   * Starts scheduled reads at the provider-specified update interval.
   * @returns {Promise<void>} Resolves after attempting a dataset session.
   */
  async function agentFaviconStartPulse() {
    if (agentFaviconPageHidden || agentFaviconPulseTimer !== null) return;
    const key = await agentFaviconCompatibleVersion();
    if (!key) return;
    const session = await agentFaviconOpenSession(key);
    if (!session || agentFaviconVisibleState === 'original' ||
        agentFaviconPulseTimer !== null) return;
    agentFaviconPulseTimer = setInterval(
      agentFaviconPulseHeartbeat, session.update_every_ms
    );
  }

  /**
   * Stops scheduled favicon work; next lifecycle event may restart it.
   * @returns {void} No value is returned.
   */
  function agentFaviconStopPulse() {
    if (agentFaviconPulseTimer === null) return;
    clearInterval(agentFaviconPulseTimer);
    agentFaviconPulseTimer = null;
  }

  /**
   * Projects lifecycle state through pending-safe provisional V2 lookup.
   * @param {string} state - Original, processing, completed, error or acknowledged.
   * @param {boolean} heartbeat - True only for scheduled pulse refresh.
   * @returns {Promise<boolean>} True if all recognized favicon links updated safely.
   */
  async function agentFaviconRenderState(state, heartbeat = false) {
    if (agentFaviconPageHidden) return false;
    const previousState = agentFaviconVisibleState;
    const nextStep = state === 'original' ? null
      : state === 'error' ? 0 : agentFaviconRingStep();
    agentFaviconVisibleState = state;
    if (previousState !== state || nextStep !== agentFaviconPresentedStep) {
      agentFaviconRestoreStockCandidates();
    }
    if (state === 'original') agentFaviconStopPulse();
    else void agentFaviconStartPulse();
    const generation = ++agentFaviconRenderGeneration;
    const transitionId = typeof agentLifecycleTransitionId === 'undefined'
      ? null : agentLifecycleTransitionId;
    if (!heartbeat && typeof agentLifecycleAction === 'function') {
      agentLifecycleAction('favicon', 'requested', { state }, transitionId);
    }
    const candidates = agentFaviconCurrentCandidates();
    if (!candidates.length) return false;
    const requestedTheme = state === 'original' ? null : agentFaviconCurrentTheme();
    let requestedStep = null;
    let pairs = null;
    if (state !== 'original') {
      const base = { processing: 0, completed: 1, error: 2, acknowledged: 3 }[state];
      if (base === undefined) return false;
      requestedStep = nextStep;
      try {
        const key = await agentFaviconCompatibleVersion();
        if (key) pairs = await get_favicon(key, base, requestedStep, performance.now());
      } catch (error) {
        if (!heartbeat) logDiagnostic('warnings', 'agent-favicon-cache-unavailable', {
          state, message: errorMessage(error)
        });
      }
    }
    const candidatesNow = agentFaviconCurrentCandidates();
    const sameOriginals = candidates.length === candidatesNow.length &&
      candidates.every(candidate => candidatesNow.some(current =>
        current.link === candidate.link &&
        current.original_href === candidate.original_href));
    const sameTheme = state === 'original' ||
      requestedTheme === agentFaviconCurrentTheme();
    const sameStep = state === 'original' || requestedStep ===
      (state === 'error' ? 0 : agentFaviconRingStep());
    if (generation !== agentFaviconRenderGeneration ||
        !sameOriginals || !sameTheme || !sameStep || agentFaviconPageHidden) {
      if (!heartbeat && typeof agentLifecycleAction === 'function') {
        agentLifecycleAction('favicon', 'superseded', { state }, transitionId);
      }
      return false;
    }
    const matched = new Map((pairs ?? []).map(pair => [pair.link, pair.href]));
    for (const candidate of candidates) {
      const desired = matched.get(candidate.link) ?? candidate.original_href;
      if (candidate.link.href !== desired) candidate.link.href = desired;
      if (matched.has(candidate.link)) agentFaviconDisplayedHrefs.set(candidate.link, desired);
      else agentFaviconDisplayedHrefs.delete(candidate.link);
    }
    agentFaviconTrimObjectUrls();
    agentFaviconPresentedStep = state === 'original' || pairs === null
      ? null : requestedStep;
    const eligible = agentFaviconActiveCandidates(candidates).length;
    const applied = state === 'original' || (pairs !== null &&
      pairs.length === eligible);
    if (!heartbeat && typeof agentLifecycleAction === 'function') {
      agentLifecycleAction('favicon', applied ? 'applied' : 'failed', {
        state, candidate_count: candidates.length, applied_candidate_count: pairs?.length ?? 0
      }, transitionId);
    }
    if (!heartbeat && !applied) logDiagnostic('warnings', 'agent-favicon-cache-unavailable', {
      state, candidate_count: candidates.length, matched: pairs?.length ?? 0
    });
    return applied;
  }

  /**
   * Releases tab-local PNG URLs and provider reader lease on navigation.
   * @returns {void} No value is returned.
   */
  function agentFaviconDispose() {
    agentFaviconPageHidden = true;
    ++agentFaviconPageEpoch;
    ++agentFaviconRenderGeneration;
    agentFaviconVisibleState = 'original';
    agentFaviconStopPulse();
    // A bfcache page retains its DOM links after pagehide.
    agentFaviconRestoreStockCandidates();
    agentFaviconPresentedStep = null;
    agentFaviconDisplayedHrefs.clear();
    agentFaviconTrimObjectUrls(true);
    const session = agentFaviconDatasetSession;
    agentFaviconDatasetSession = null;
    if (session) void session.close().catch(() => {});
  }

  /**
   * Acknowledges completion only when its own browser tab is focused.
   * @returns {void} No result is returned.
   */
  function agentFaviconAcknowledgeCompletion() {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    if (agentFaviconVisibleState !== 'completed') return;
    void agentFaviconRenderState('acknowledged');
  }

  /**
   * Allows page-restored tabs to acquire a fresh provider session.
   * @param {PageTransitionEvent} event - Page restoration lifecycle event.
   * @returns {void} No result is returned.
   */
  function agentFaviconHandlePageShow(event) {
    if (event.persisted) agentFaviconPageHidden = false;
  }

  /** Browser focus, visibility and page-lifetime notifications. */
  document.addEventListener('visibilitychange', agentFaviconAcknowledgeCompletion);
  window.addEventListener('focus', agentFaviconAcknowledgeCompletion);
  window.addEventListener('pagehide', agentFaviconDispose);
  window.addEventListener('pageshow', agentFaviconHandlePageShow);
