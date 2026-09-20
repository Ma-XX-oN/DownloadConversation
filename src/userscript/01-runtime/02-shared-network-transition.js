   * @param {unknown} error - Thrown value to describe.
   * @returns {string} Readable error text.
   */
  function errorMessage(error) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
    return String(error);
  }

  /**
   * Clones one Request/Response-like object without allowing a clone failure to escape.
   *
   * @param {Object|null} value - Cloneable object, when available.
   * @returns {Object|null} Independent clone, or null when cloning is unavailable or fails.
   */
  function cloneSafely(value) {
    try {
      return typeof value?.clone === 'function' ? value.clone() : null;
    } catch {
      return null;
    }
  }

  /**
   * Releases one stream-reader lock without allowing cleanup failure to replace the primary outcome.
   *
   * @param {Object|null} reader - Reader whose lock should be released.
   * @returns {void} No value is returned.
   */
  function releaseReaderLockQuietly(reader) {
    try { reader?.releaseLock?.(); } catch {}
  }

  /**
   * Aborts one writable stream without allowing cleanup failure to replace the primary outcome.
   *
   * @param {Object|null} writable - Writable stream to abort when present.
   * @returns {Promise<void>} Resolves after best-effort abort cleanup.
   */
  async function abortWritableQuietly(writable) {
    try { await writable?.abort?.(); } catch {}
  }

  /**
   * Cancels one readable body without allowing cleanup failure to replace the primary outcome.
   *
   * @param {Object|null} body - Readable stream body to cancel when present.
   * @returns {Promise<void>} Resolves after best-effort cancellation.
   */
  async function cancelReadableBodyQuietly(body) {
    try { await body?.cancel?.(); } catch {}
  }

  /**
   * Formats duration.
   *
   * @param {Object} milliseconds - The duration in milliseconds.
   * @returns {string} The string produced by `formatDuration`.
   */
  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  /**
   * Handles escape HTML text.
   *
   * @param {string} text - The text to process.
   * @returns {string} The string produced by `escapeHtmlText`.
   */
  function escapeHtmlText(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Handles escape HTML attribute.
   *
   * @param {string} text - The text to process.
   * @returns {string} The string produced by `escapeHtmlAttribute`.
   */
  function escapeHtmlAttribute(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Quotes literal message text as the transcript blockquote representation while preserving line order.
   *
   * @param {string} markdown - The Markdown text to process.
   * @returns {string} The string produced by `quoteMarkdown`.
   */
  function quoteMarkdown(markdown) {
    const text = String(markdown ?? '').replace(/\s+$/, '');
    if (!text) return '>';
    return text.split('\n').map(line => line.length ? `> ${line}` : '>').join('\n');
  }

  /**
   * Handles conversation title.
   *
   * @returns {string} The string produced by `conversationTitle`.
   */
  function conversationTitle() {
    const heading = document.querySelector('h1')?.textContent?.trim();
    const title = heading || document.title || 'ChatGPT conversation';
    return title.replace(/\s*[-–—]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT conversation';
  }

  /**
   * Sanitizes file name.
   *
   * @param {string} name - The name to process.
   * @returns {string} The string produced by `sanitizeFileName`.
   */
  function sanitizeFileName(name) {
    return String(name || 'ChatGPT conversation')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim() || 'ChatGPT conversation';
  }

  /**
   * Handles current conversation ID.
   *
   * @returns {null} The value produced by `currentConversationId`, or `null` when unavailable.
   */
  function currentConversationId() {
    return location.pathname.match(/\/c\/([^/?#]+)/)?.[1] ?? null;
  }

  /**
   * Checks whether conversation API URL.
   *
   * @param {string} url - The URL to process.
   * @returns {boolean} `true` when `isConversationApiUrl` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function isConversationApiUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin) return false;
      return /^\/backend-api\/conversations\/[^/]+(?:\/messages)?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  /**
   * Handles raw headers to object.
   *
   * @param {Object} headers - The HTTP header values to inspect.
   * @returns {Object} The Object value produced by `rawHeadersToObject`.
   */
  function rawHeadersToObject(headers) {
    const result = {};
    /**
     * Handles put.
     *
     * @param {string} name - The name to process.
     * @param {string} value - The value to process.
     * @returns {void} No value is returned.
     */
    const put = (name, value) => {
      if (name == null || value == null) return;
      const key = String(name).toLowerCase();
      result[key] = result[key] ? `${result[key]}, ${value}` : String(value);
    };
    try {
      if (typeof headers?.forEach === 'function') {
        headers.forEach((value, key) => put(key, value));
      } else if (Array.isArray(headers)) {
        for (const entry of headers) {
          if (Array.isArray(entry) && entry.length >= 2) put(entry[0], entry[1]);
        }
      } else if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) put(key, value);
      }
    } catch {}
    return result;
  }

  // BEGIN Issue #123 stock network diagnostics
  /**
   * Produces a bounded URL safe for stock-network diagnostics.
   *
   * Same-origin ChatGPT URLs retain routing query parameters while known secret
   * values are redacted. Cross-origin URLs retain only origin and path.
   *
   * @param {string} value - Request or response URL to sanitize.
   * @returns {string} Sanitized diagnostic URL.
   */
  function stockNetworkSafeUrl(value) {
    try {
      const parsed = new URL(String(value ?? ''), location.href);
      if (parsed.origin !== location.origin) return `${parsed.origin}${parsed.pathname}`;
      const relative = `${parsed.pathname}${parsed.search}`;
      return boundedDiagnosticText(
        redactDiagnosticSignedTokens(relative)
          .replace(/([?&](?:access_token|token|key|secret|auth|session|jwt)=)[^&#\s]*/gi, '$1[redacted]'),
        4000
      );
    } catch {
      return boundedDiagnosticText(String(value ?? ''), 4000);
    }
  }

  /**
   * Extracts only explicitly safe cache/correlation response headers.
   *
   * @param {Object} headers - Headers-like object exposing get(name).
   * @returns {Object} Safe response-header diagnostic projection.
   */
  function stockNetworkSafeResponseHeaders(headers) {
    const result = {};
    const allowed = [
      ['date', 'date'],
      ['age', 'age'],
      ['cache-control', 'cache_control'],
      ['etag', 'etag'],
      ['last-modified', 'last_modified'],
      ['expires', 'expires'],
      ['pragma', 'pragma'],
      ['vary', 'vary'],
      ['cf-cache-status', 'cf_cache_status'],
      ['x-cache', 'x_cache'],
      ['x-cache-hits', 'x_cache_hits'],
      ['x-served-by', 'x_served_by'],
      ['x-timer', 'x_timer'],
      ['server-timing', 'server_timing'],
      ['x-request-id', 'x_request_id'],
      ['x-openai-request-id', 'x_openai_request_id'],
      ['cf-ray', 'cf_ray']
    ];
    for (const [headerName, outputName] of allowed) {
