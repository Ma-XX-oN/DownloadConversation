  /** A favicon pulse has forty 250-ms slots and 21 unique symmetric frames. */
  const AGENT_FAVICON_PULSE_PERIOD_MS = 10000;
  /** Periodic pulse timer, started only after the dataset session is ready. */
  let agentFaviconPulseTimer = null;
  /** Current colour/attention projection of the shared Agent lifecycle. */
  let agentFaviconVisibleState = 'original';
  /** Provisional V2 dataset session; #334 owns atomic sequence generation. */
  let agentFaviconDatasetSession = null;
  /** In-flight provisional V2 cache session, shared by presentation calls. */
  let agentFaviconSessionPending = null;
  /** Resolved minimum compatible version for this installed DC version. */
  let agentFaviconVersionPending = null;
  /** Observed browser colour-scheme query; the same SVG URL can differ by theme. */
  let agentFaviconThemeQuery = null;
  /** Only the PNG object URLs requested by this tab, in LRU order. */
  const agentFaviconObjectUrls = new Map();
  /** URL last assigned by DC to each original stock link. */
  const agentFaviconDisplayedHrefs = new Map();
  /** Hard bound on retained non-displayed frame URLs. */
  const AGENT_FAVICON_URL_LIMIT = 84;
  /** Progress-step state for the existing shared stopwatch observer. */
  let agentFaviconRingRenderedStep = 0;
  /** Whether pagehide has invalidated active and pending cache reads. */
  let agentFaviconPageHidden = false;
  /** Incremented at navigation to reject late reads across bfcache restoration. */
  let agentFaviconPageEpoch = 0;

  /**
   * Selects one of 21 full-composite PNG pulse frames from monotonic time.
   * @param {number} time_offset - Monotonic offset in milliseconds.
   * @returns {number|null} Symmetric frame index 0..20, or null for invalid input.
   */
  function agentFaviconPulseIndex(time_offset) {
    if (!Number.isFinite(time_offset)) return null;
    const phase = ((time_offset % AGENT_FAVICON_PULSE_PERIOD_MS) +
      AGENT_FAVICON_PULSE_PERIOD_MS) % AGENT_FAVICON_PULSE_PERIOD_MS;
    const slot = Math.floor(phase / 250);
    return Math.min(slot, 40 - slot);
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
   * Resolves and memoizes the provider's minimum compatible numeric version.
   * @returns {Promise<string|null>} Selected numeric version boundary or null.
   */
  async function agentFaviconCompatibleVersion() {
    if (typeof get_compatible_version_key !== 'function') return null;
    if (!agentFaviconVersionPending) {
      agentFaviconVersionPending = Promise.resolve()
        .then(() => get_compatible_version_key(VERSION))
        .then(key => typeof key === 'string' ? key : null)
        .catch(() => null);
    }
    const key = await agentFaviconVersionPending;
    if (key === null) agentFaviconVersionPending = null;
    return key;
  }

  /**
   * Opens one provisional V2 cache session without guessed provider data.
   * @param {string} version_key - Exact normalized compatible dataset boundary.
   * @returns {Promise<Object|null>} Shared session or null when unavailable.
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
        .then(() => open_favicon_dataset(version_key))
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
   * Reads only the requested PNG blob, reusing tab-local object URLs on hits.
   * @param {Object} session - Open provisional V2 provider session.
   * @param {string} originalUrl - Captured untouched source favicon URL.
   * @param {string} theme - Current browser light/dark colour scheme.
   * @param {number} base - Base state 0 yellow, 1 green, 2 red, 3 white.
   * @param {number} step - Saturated five-minute progress index 0..6.
   * @param {number} frame - Symmetric ten-second pulse index 0..20.
   * @returns {Promise<string|null>} Stable PNG Blob URL or null.
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
   * Looks up only requested frames of complete, ready V2 cache sequences.
   * @param {string} version_key - Normalized numeric version boundary.
   * @param {0|1|2|3} base_type - Yellow/green/red/white index.
   * @param {0|1|2|3|4|5|6} completion_time - Five-minute progress step.
   * @param {number} time_offset - Monotonic milliseconds, not a pulse index.
   * @returns {Promise<Array<Object>|null>} Matched link and PNG URL pairs or null.
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
    const matches = [];
    for (const candidate of agentFaviconCurrentCandidates()) {
      const href = await agentFaviconFrameUrl(
        session, candidate.original_href, theme, base_type, completion_time, frame
      );
      if (agentFaviconCurrentTheme() !== theme || agentFaviconPageHidden) return null;
      if (href) matches.push({ link: candidate.link, href });
    }
    return matches.length ? matches : null;
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
    agentFaviconPulseTimer = setInterval(() => {
      if (agentFaviconVisibleState !== 'original') {
        void agentFaviconRenderState(agentFaviconVisibleState, true);
      }
    }, session.update_every_ms);
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
    agentFaviconVisibleState = state;
    if (previousState !== state) {
      for (const candidate of agentFaviconCurrentCandidates()) {
        if (candidate.link.href !== candidate.original_href) {
          candidate.link.href = candidate.original_href;
        }
        agentFaviconDisplayedHrefs.delete(candidate.link);
      }
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
      requestedStep = state === 'error' ? 0 : agentFaviconRingStep();
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
    const applied = state === 'original' || (pairs !== null &&
      pairs.length === candidates.length);
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
    // A bfcache page retains its DOM links after pagehide; restore hrefs first.
    for (const candidate of agentFaviconCurrentCandidates()) {
      if (candidate.link.href !== candidate.original_href) {
        candidate.link.href = candidate.original_href;
      }
    }
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
