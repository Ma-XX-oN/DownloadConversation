  // DC #297 test-only witness: keep only scalar capture provenance.
  /** #297-only aicc127EarlyEvents state; no private payload is persisted. */
  const aicc127EarlyEvents = [];
  /** #297-only aicc127EarlyRequests state; no private payload is persisted. */
  const aicc127EarlyRequests = new Map();
  /** #297-only aicc127WitnessSink state; no private payload is persisted. */
  let aicc127WitnessSink = null;
  /** #297-only aicc127EarlyRoute state; no private payload is persisted. */
  let aicc127EarlyRoute = null;

  /**
   * aicc127Route Identity for the #297 test-only observer.
   * @param {string} url - Input to this read-only witness operation.
   * @returns {string|null} Observer operation result.
   */
  function aicc127RouteIdentity(url) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin) return null;
      const parts = parsed.pathname.split('/').filter(Boolean);
      const c = parts.lastIndexOf('c');
      return c >= 0 && typeof parts[c + 1] === 'string'
        ? parts[c + 1] : null;
    } catch { return null; }
  }

  /**
   * aicc127Endpoint Kind for the #297 test-only observer.
   * @param {string} url - Input to this read-only witness operation.
   * @param {string} method - Input to this read-only witness operation.
   * @returns {string|null} Observer operation result.
   */
  function aicc127EndpointKind(url, method) {
    if (method !== 'GET') return null;
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin) return null;
      if (/^\/backend-api\/conversations?\/[^/]+\/?$/.test(parsed.pathname))
        return 'conversation';
      if (/^\/backend-api\/gizmos\/g-p-[^/]+\/?$/.test(parsed.pathname))
        return 'project';
    } catch {}
    return null;
  }

  /**
   * aicc127Witness Captured for the #297 test-only observer.
   * @param {Object} envelope - Input to this read-only witness operation.
   * @returns {void} Observer operation result.
   */
  function aicc127WitnessCaptured(envelope) {
    const navigation = envelope.transport === 'navigation';
    if (navigation) aicc127EarlyRoute = aicc127RouteIdentity(envelope.url);
    let request = null;
    let kind = null;
    if (!navigation && envelope.direction === 'request') {
      kind = aicc127EndpointKind(envelope.request_url ?? envelope.url, envelope.method ?? 'GET');
      if (kind) aicc127EarlyRequests.set(envelope.connection_id, {
        kind, route: aicc127EarlyRoute, sequence: envelope.network_sequence
      });
    } else if (!navigation && envelope.direction === 'response') {
      request = aicc127EarlyRequests.get(envelope.connection_id);
      kind = request?.kind ?? null;
    }
    if (!navigation && !kind) return;
    const record = Object.freeze({
      direction: navigation ? 'navigation' : envelope.direction,
      kind: navigation ? 'navigation' : kind,
      route: navigation ? aicc127EarlyRoute : request?.route ?? aicc127EarlyRoute,
      network_sequence: envelope.network_sequence,
      request_sequence: request?.sequence ?? null,
      connection_id: envelope.connection_id,
      capture_order: envelope.capture_order,
      captured_at_epoch_ms: envelope.captured_at_epoch_ms,
      captured_at_mono_ms: envelope.captured_at_mono_ms,
      page_instance_id: envelope.page_instance_id
    });
    aicc127EarlyEvents.push(record);
    if (aicc127EarlyEvents.length > 300) aicc127EarlyEvents.shift();
    aicc127WitnessSink?.(record);
    if (!navigation && envelope.direction === 'response')
      aicc127EarlyRequests.delete(envelope.connection_id);
  }
