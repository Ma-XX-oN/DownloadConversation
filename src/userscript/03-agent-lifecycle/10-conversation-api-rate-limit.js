  // BEGIN Issue #183 Conversation API rate-limit coordination
  /** Initial backoff after a Conversation API HTTP 429 when no longer delay is required. */
  const CONVERSATION_API_BACKOFF_INITIAL_MS = 5000;
  /** Maximum exponential-backoff component for repeated Conversation API HTTP 429 responses. */
  const CONVERSATION_API_BACKOFF_MAX_MS = 60000;
  /** Fractional randomization applied around the exponential Conversation API backoff. */
  const CONVERSATION_API_BACKOFF_JITTER = 0.25;
  /** Original direct Conversation API fetch implementation wrapped by the rate-limit coordinator. */
  const apiFetchUncoordinated = apiFetch;
  /** Exact-page requests currently owned by the shared Conversation API coordinator. */
  const conversationApiInFlight = new Map();
  /** Promise tail serializing physical Conversation API requests across independent consumers. */
  let conversationApiRequestTail = Promise.resolve();
  /** Earliest wall-clock time at which another physical Conversation API request may begin. */
  let conversationApiCooldownUntil = 0;
  /** Number of consecutive Conversation API HTTP 429 responses since the most recent success. */
  let conversationApiConsecutive429 = 0;

  /**
   * Parses a Retry-After response header into a non-negative delay.
   *
   * @param {Response} response - Conversation API HTTP response carrying an optional Retry-After header.
   * @param {number} nowMs - Current wall-clock time in milliseconds since the Unix epoch.
   * @returns {number|null} Retry delay in milliseconds, or null when Retry-After is absent or invalid.
   */
  function conversationApiRetryAfterMs(response, nowMs = Date.now()) {
    const raw = response?.headers?.get?.('retry-after');
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const text = String(raw).trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Number(text) * 1000);
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : null;
  }

  /**
   * Computes bounded exponential backoff with symmetric jitter for a consecutive 429 count.
   *
   * @param {number} consecutive429 - One-based count of consecutive HTTP 429 responses.
   * @returns {number} Backoff delay in milliseconds.
   */
  function conversationApiBackoffMs(consecutive429) {
    const exponent = Math.max(0, Math.min(30, Number(consecutive429) - 1));
    const bounded = Math.min(
      CONVERSATION_API_BACKOFF_MAX_MS,
      CONVERSATION_API_BACKOFF_INITIAL_MS * (2 ** exponent)
    );
    const jitterScale = 1 - CONVERSATION_API_BACKOFF_JITTER +
      (Math.random() * CONVERSATION_API_BACKOFF_JITTER * 2);
    return Math.max(1, Math.round(bounded * jitterScale));
  }

  /**
   * Waits for a requested delay.
   *
   * @param {number} delayMs - Delay in milliseconds.
   * @returns {Promise<void>} Promise resolved after the requested delay.
   */
  function conversationApiDelay(delayMs) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, delayMs)));
  }

  /**
   * Asserts that a queued/retrying request still belongs to the active conversation.
   *
   * @param {string|null} conversationId - Conversation identity captured when the request was queued.
   * @returns {void} No value is returned.
   */
  function conversationApiAssertCurrent(conversationId) {
    if (currentConversationId() !== conversationId) {
      throw new Error('Conversation API request cancelled because the active conversation changed.');
    }
  }

  /**
   * Waits until the shared Conversation API cooldown expires while cancelling stale navigation work.
   *
   * @param {string|null} conversationId - Conversation identity captured when the request was queued.
   * @returns {Promise<void>} Promise resolved when a new physical request is allowed.
   */
  async function conversationApiWaitForCooldown(conversationId) {
    for (;;) {
      conversationApiAssertCurrent(conversationId);
      const remaining = conversationApiCooldownUntil - Date.now();
      if (remaining <= 0) return;
      await conversationApiDelay(remaining);
    }
  }

  /**
   * Runs one serialized physical Conversation API request, retrying HTTP 429 only after shared backoff.
   *
   * @param {string} url - Exact Conversation API page URL.
   * @param {string|null} conversationId - Conversation identity captured when the request was queued.
   * @returns {Promise<Response>} Promise resolving to the first non-429 HTTP response.
   */
  async function conversationApiPhysicalFetch(url, conversationId) {
    for (;;) {
      await conversationApiWaitForCooldown(conversationId);
      conversationApiAssertCurrent(conversationId);
      const response = await apiFetchUncoordinated(url);
      if (response.status !== 429) {
        if (response.ok) {
          conversationApiConsecutive429 = 0;
          conversationApiCooldownUntil = 0;
        }
        return response;
      }

      conversationApiConsecutive429 += 1;
      const nowMs = Date.now();
      const retryAfterMs = conversationApiRetryAfterMs(response, nowMs);
      const backoffMs = conversationApiBackoffMs(conversationApiConsecutive429);
      const delayMs = Math.max(retryAfterMs ?? 0, backoffMs);
      conversationApiCooldownUntil = Math.max(conversationApiCooldownUntil, nowMs + delayMs);
      logDiagnostic('errors', 'conversation-api-rate-limited', {
        request_path: diagnosticRequestPath(url),
        consecutive_429: conversationApiConsecutive429,
        retry_after_ms: retryAfterMs,
        backoff_ms: backoffMs,
        delay_ms: delayMs
      });
    }
  }

  /**
   * Appends one unique physical request to the global Conversation API request queue.
   *
   * @param {string} url - Exact Conversation API page URL.
   * @param {string|null} conversationId - Conversation identity captured when the request was queued.
   * @returns {Promise<Response>} Promise resolving to the serialized physical response.
   */
  function conversationApiEnqueue(url, conversationId) {
    const run = conversationApiRequestTail.then(
      () => conversationApiPhysicalFetch(url, conversationId),
      () => conversationApiPhysicalFetch(url, conversationId)
    );
    conversationApiRequestTail = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Coordinates direct Conversation API fetches across consumers, coalescing identical in-flight pages.
   *
   * @param {string} url - Exact Conversation API page URL.
   * @returns {Promise<Response>} Promise resolving to an independent clone of the shared response.
   */
  async function conversationApiCoordinatedFetch(url) {
    const key = String(url);
    const existing = conversationApiInFlight.get(key);
    if (existing) {
      logDiagnostic('debug', 'conversation-api-request-coalesced', {
        request_path: diagnosticRequestPath(key)
      });
      return (await existing).clone();
    }

    const conversationId = currentConversationId();
    const requestPromise = conversationApiEnqueue(key, conversationId);
    conversationApiInFlight.set(key, requestPromise);
    try {
      return (await requestPromise).clone();
    } finally {
      if (conversationApiInFlight.get(key) === requestPromise) {
        conversationApiInFlight.delete(key);
      }
    }
  }

  apiFetch = conversationApiCoordinatedFetch;
  // END Issue #183 Conversation API rate-limit coordination
