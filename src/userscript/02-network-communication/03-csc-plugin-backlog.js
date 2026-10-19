  // BEGIN #310 independent same-page plugin backlog.
  /** Original plugin-owned events, never derived from sanitized COMM records. */
  const cscPluginBacklog = [];
  /** Accepted request identities while awaiting their correlated response. */
  const cscPluginRequests = new Map();
  /** Exclusively attached provider host from #306, or null before readiness. */
  let cscPluginHost = null;
  /** Invalidates async completions when their host is disconnected. */
  let cscPluginGeneration = 0;
  /** Exactly one asynchronous drain per page execution context. */
  let cscPluginDraining = false;
  /** Successful host acknowledgements. */
  let cscPluginAccepted = 0;
  /** Unsupported or explicitly rejected events. */
  let cscPluginRejected = 0;
  /** Retriable delivery exceptions. */
  let cscPluginFailures = 0;
  /** Highest acknowledged or queued canonical capture order in this page. */
  let cscPluginLastEnqueuedOrder = 0;
  /** Duplicate or stale ingress notifications discarded without redelivery. */
  let cscPluginIgnoredStale = 0;
  /** Consecutive delivery failures used only for bounded retry pacing. */
  let cscPluginRetryFailuresInRow = 0;
  /** Exactly one outstanding retry timer per queue generation. */
  let cscPluginRetryTimer = null;

  /**
   * Retain the #309 plugin-owned native clone and earliest capture envelope.
   * @param {Object} event - Canonical capture identity and plugin-owned source.
   * @returns {void} No value is returned.
   */
  function cscPluginQueuePublish(event) {
    assert(Number.isSafeInteger(event?.envelope?.network_sequence),
      'CSC plugin event needs canonical network_sequence.');
    assert(typeof event?.envelope?.capture_id === 'string',
      'CSC plugin event needs original capture identity.');
    const order = event.envelope.capture_order;
    assert(Number.isSafeInteger(order) && order > 0,
      'CSC plugin event needs positive capture_order.');
    if (order <= cscPluginLastEnqueuedOrder) {
      cscPluginIgnoredStale++;
      logDiagnostic('warnings', 'csc-plugin-duplicate-or-stale', {
        capture_id: event.envelope.capture_id,
        capture_order: order
      });
      // Do not cancel an alias still owned by an outstanding queue item.
      if (event.source && !cscPluginBacklog.some(item =>
        item.event.source === event.source)) {
        cscPluginQueueReleaseItem({ event, body: null });
      }
      return;
    }
    cscPluginLastEnqueuedOrder = order;
    cscPluginBacklog.push({ event, parsed: false, body: null });
    if (cscPluginHost) void cscPluginQueueDrain();
  }

  /**
   * Accept generic navigation from #306's page observer without route inference.
   * @param {string} url - Absolute page URL.
   * @returns {void} No value is returned.
   */
  function cscPluginQueueNavigation(url) {
    const stamp = cscCaptureNow('navigation', 'event');
    cscPluginQueuePublish({
      envelope: Object.freeze({ ...stamp, url }),
      source: null, source_available: false, source_incomplete: false
    });
  }

  /**
   * Release only the plugin branch. Never touch stock or COMM-owned bodies.
   * @param {Object} item - Terminal queue item.
   * @returns {void} No value is returned.
   */
  function cscPluginQueueReleaseItem(item) {
    const body = item.event?.source?.body;
    if (body && !body.locked) void cancelReadableBodyQuietly(body);
    item.event = null;
    item.body = null;
  }

  /**
   * Parse the independent plugin body once and retain it across host turnover.
   * @param {Object} item - Correlated response item.
   * @returns {Promise<Object|null>} JSON body if one is accessible.
   */
  async function cscPluginQueueJson(item) {
    if (item.parsed) return item.body;
    const source = item.event.source;
    let body = null;
    if (source && typeof source.json === 'function') {
      try { body = await source.json(); } catch { body = null; }
    } else if (source && typeof source === 'object'
        && Object.prototype.toString.call(source) === '[object Object]') {
      body = source;
    } else if (typeof source === 'string') {
      try { body = JSON.parse(source); } catch { body = null; }
    }
    item.parsed = true;
    item.body = body;
    return body;
  }

  /**
   * Dispatch via the existing provider-owned host, never directly to AICC.
   * @param {Object} item - Oldest queued event.
   * @param {Object} host - Active provider host.
   * @param {number} generation - Lease invalidation generation.
   * @returns {Promise<string>} accepted, rejected or awaiting.
   */
  async function cscPluginQueueDispatch(item, host, generation) {
    const { envelope: e, source_incomplete: incomplete } = item.event;
    if (e.transport === 'navigation') {
      return host.navigation({ url: e.url }) ? 'accepted' : 'rejected';
    }
    if ((e.transport === 'fetch' || e.transport === 'xhr')
        && e.direction === 'request') {
      const result = host.request({
        network_sequence: e.network_sequence,
        method: e.method ?? 'GET',
        request_url: e.request_url ?? e.url
      });
      if (result) {
        cscPluginRequests.set(e.connection_id, {
          network_sequence: e.network_sequence,
          method: e.method ?? 'GET',
          request_url: e.request_url ?? e.url,
          connection_id: e.connection_id,
          envelope: e,
          generation
        });
      }
      return result ? 'accepted' : 'rejected';
    }
    if ((e.transport === 'fetch' || e.transport === 'xhr')
        && e.direction === 'response') {
      const request = cscPluginRequests.get(e.connection_id);
      if (!request || request.generation !== generation) return 'rejected';
      if (incomplete || !item.event.source_available || e.status !== 200) {
        cscPluginRequests.delete(e.connection_id);
        return 'rejected';
      }
      const body = await cscPluginQueueJson(item);
      if (generation !== cscPluginGeneration || host !== cscPluginHost) {
        return 'awaiting';
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        cscPluginRequests.delete(e.connection_id);
        return 'rejected';
      }
      // #306 host.response is void on successful delivery. An exception is a
      // retryable failure; explicit false is rejection, undefined is an ACK.
      const result = host.response({
        network_sequence: request.network_sequence, status: e.status, body
      });
      cscPluginRequests.delete(e.connection_id);
      return result === false ? 'rejected' : 'accepted';
    }
    if (e.direction === 'error' || e.event === 'abort' || e.event === 'close') {
      cscPluginRequests.delete(e.connection_id);
    }
    // No invented WebSocket host method: unsupported frames are explicit.
    return 'rejected';
  }

  /**
   * Schedule one finite-delay retry; repeated faults back off without
   * consuming the queue, sending network requests or blocking the page.
   * @returns {void} No value is returned.
   */
  function cscPluginQueueScheduleRetry() {
    if (cscPluginRetryTimer !== null || !cscPluginHost) return;
    const delay = Math.min(30000,
      100 * 2 ** Math.min(10, Math.max(0, cscPluginRetryFailuresInRow - 1)));
    cscPluginRetryTimer = setTimeout(() => {
      cscPluginRetryTimer = null;
      if (cscPluginHost) void cscPluginQueueDrain();
    }, delay);
  }

  /**
   * Acknowledge only successful host calls; keep the entire tail on exception.
   * @returns {Promise<void>} Resolves after this ordered processing pass.
   */
  async function cscPluginQueueDrain() {
    if (cscPluginDraining || !cscPluginHost || cscPluginRetryTimer !== null) return;
    cscPluginDraining = true;
    const host = cscPluginHost;
    const generation = cscPluginGeneration;
    try {
      while (cscPluginBacklog.length && host === cscPluginHost
          && generation === cscPluginGeneration) {
        const item = cscPluginBacklog[0];
        let result;
        try {
          result = await cscPluginQueueDispatch(item, host, generation);
        } catch (error) {
          cscPluginFailures++;
          cscPluginRetryFailuresInRow++;
          logDiagnostic('warnings', 'csc-plugin-delivery-failed', {
            capture_id: item.event.envelope.capture_id,
            network_sequence: item.event.envelope.network_sequence,
            failure_kind: 'provider-handler-exception'
          });
          if (generation === cscPluginGeneration && host === cscPluginHost) {
            cscPluginQueueScheduleRetry();
          }
          break;
        }
        if (generation !== cscPluginGeneration || host !== cscPluginHost
            || result === 'awaiting') break;
        if (result === 'accepted') cscPluginAccepted++;
        else cscPluginRejected++;
        cscPluginRetryFailuresInRow = 0;
        cscPluginBacklog.shift();
        cscPluginQueueReleaseItem(item);
      }
    } finally {
      cscPluginDraining = false;
      if (cscPluginHost && cscPluginHost !== host && cscPluginBacklog.length) {
        void cscPluginQueueDrain();
      }
    }
  }

  /**
   * Bind one existing #306 host; queue never owns provider disposal.
   * @param {Object} host - Provider navigation/request/response host.
   * @returns {void} No value is returned.
   */
  function cscPluginQueueConnect(host) {
    assert(host && typeof host.request === 'function'
      && typeof host.response === 'function'
      && typeof host.navigation === 'function',
    'CSC plugin requires the existing provider navigation/request/response interface.');
    assert(!cscPluginHost || cscPluginHost === host,
      'CSC plugin queue already has an active consumer.');
    if (cscPluginHost === host) return;
    cscPluginHost = host;
    cscPluginGeneration++;
    // Re-establish in-flight correlation before newer requests on a new host.
    const pending = [...cscPluginRequests.values()]
      .sort((a, b) => a.network_sequence - b.network_sequence);
    cscPluginRequests.clear();
    for (let i = pending.length - 1; i >= 0; i--) {
      const req = pending[i];
      cscPluginBacklog.unshift({
        event: {
          // Reuse the original immutable capture stamp, including transport,
          // clock domain, wall/monotonic time and canonical capture ID.
          envelope: req.envelope,
          source: null, source_available: false, source_incomplete: false
        },
        parsed: false, body: null
      });
    }
    void cscPluginQueueDrain();
  }

  /**
   * Invalidate a disposed host without touching its provider-owned resources.
   * @param {Object} host - Host ending its current lease.
   * @returns {void} No value is returned.
   */
  function cscPluginQueueDisconnect(host) {
    if (cscPluginHost !== host) return;
    cscPluginHost = null;
    cscPluginGeneration++;
    cscPluginRetryFailuresInRow = 0;
    if (cscPluginRetryTimer !== null) clearTimeout(cscPluginRetryTimer);
    cscPluginRetryTimer = null;
  }

  /**
   * Retry a temporarily failing head; never discard events to make progress.
   * @returns {void} No value is returned.
   */
  function cscPluginQueueRetry() {
    if (cscPluginRetryTimer !== null) clearTimeout(cscPluginRetryTimer);
    cscPluginRetryTimer = null;
    if (cscPluginHost) void cscPluginQueueDrain();
  }

  /**
   * Return only counts and lag timestamps, never raw queued secret content.
   * @returns {Object} Immutable queue-health snapshot.
   */
  function cscPluginQueueSnapshot() {
    return Object.freeze({
      generation: cscPluginGeneration,
      connected: Boolean(cscPluginHost),
      queued: cscPluginBacklog.length,
      accepted: cscPluginAccepted,
      rejected: cscPluginRejected,
      failures: cscPluginFailures,
      duplicates: cscPluginIgnoredStale,
      oldest_capture_at_epoch_ms:
        cscPluginBacklog[0]?.event?.envelope?.captured_at_epoch_ms ?? null
    });
  }

  // Runs before network interception at document-start; no page COMM queue.
  cscBindPluginIngress(cscPluginQueuePublish);
  // END #310 independent same-page plugin backlog.
