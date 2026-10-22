  /** One table of exact terminal suffixes and frame intervals in ms. */
  const AGENT_FAVICON_TITLE_CADENCES = Object.freeze({
    '- ACTIVE': 1000,
    '- USER ACTION REQUIRED': 2000
  });
  let agentFaviconIdentityName = null;
  let agentFaviconTitleUnsubscribe = null;

  /**
   * TEMPORARY DC #356: swap only this provider to the real AICC agent from
   * DC #270. Remove interm_agent when umbrella DC #272 "Independently
   * certify DC subject-identification integration and retire identity
   * fallbacks" (AICC #123) is complete. Consumer callback stays unchanged.
   */
  const agentFaviconIdentitySource = interm_agent;

  /** @returns {number|null} Milliseconds per frame or null for static. */
  function agentFaviconHeartbeatCadence() {
    const title = agentFaviconIdentityName ?? '';
    const dash = title.lastIndexOf('-');
    if (dash < 0) return null;
    const suffix = title.slice(dash).trimEnd();
    const ms = AGENT_FAVICON_TITLE_CADENCES[suffix];
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  /**
   * Adapt source frame clock to desired per-title interval.
   * @param {number} nowMs - Monotonic milliseconds.
   * @returns {number} Existing selector offset.
   */
  function agentFaviconFrameTimeOffset(nowMs) {
    const cadence = agentFaviconHeartbeatCadence();
    return cadence === null ? 0 : Math.floor(nowMs / cadence) * 1000;
  }

  /**
   * Consume one AICC-compatible subject-identification snapshot.
   * @param {Object} snapshot - Complete identity state.
   * @returns {void} No result.
   */
  function agentFaviconTitleIdentityChanged(snapshot) {
    if (snapshot?.subject !== 'subject-identification') return;
    const name = typeof snapshot.conversation?.name === 'string'
      ? snapshot.conversation.name : null;
    if (name === agentFaviconIdentityName) return;
    agentFaviconIdentityName = name;
    if (agentFaviconPageHidden) return;
    ++agentFaviconRenderGeneration;
    agentFaviconPulseUpdatePending = null;
    agentFaviconStopPulse();
    if (agentFaviconVisibleState !== 'original') {
      void agentFaviconRenderState(agentFaviconVisibleState, true);
    }
  }

  /** @returns {void} Start exactly one identity subscription. */
  function agentFaviconTitleMonitorStart() {
    if (agentFaviconTitleUnsubscribe) return;
    agentFaviconTitleUnsubscribe = agentFaviconIdentitySource.observeState(
      snapshot => agentFaviconTitleIdentityChanged(snapshot),
      'subject-identification'
    );
    if (!agentFaviconTitleMonitorStart.bound) {
      agentFaviconTitleMonitorStart.bound = true;
      window.addEventListener('pagehide', agentFaviconTitlePause);
      window.addEventListener('pageshow', agentFaviconTitleMonitorStart);
    }
  }

  /** @returns {void} Stop subscription on pagehide. */
  function agentFaviconTitlePause() {
    agentFaviconTitleUnsubscribe?.();
    agentFaviconTitleUnsubscribe = null;
    agentFaviconIdentityName = null;
    agentFaviconStopPulse();
  }

