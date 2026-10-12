
  /**
   * Provides a readable project name from a route UUID suffix as a fallback.
   *
   * @param {string|null} projectSegment - Full project route identifier.
   * @returns {string|null} Capitalized slug, or null if the route has no slug.
   */
  function projectNameFromRouteSlug(projectSegment) {
    const slug = projectSegment?.match(/^g-p-[0-9a-f]{32}-(.+)$/i)?.[1];
    return slug ? slug.split('-').filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : null;
  }

  /**
   * Resolves the active project by its stable route ID, using the breadcrumb
   * visible in the saved ChatGPT DOM. Project routes may include or omit
   * the human-readable slug while referring to the same project.
   *
   * @returns {string|null} Current project name or null outside a project.
   */
  function conversationProjectName() {
    const route = location.pathname.match(/^\\/g\\/(g-p-[0-9a-f]{32})(?:-[^/]+)?(?:\\/|$)/i);
    if (!route) return null;
    const projectId = route[1].toLowerCase();
    const namesByRoute = conversationProjectName.byRoute ??= new Map();
    for (const anchor of document.querySelectorAll(
      'nav[aria-label="Breadcrumb"] a[href]'
    )) {
      try {
        const url = new URL(anchor.href, location.href);
        const match = url.pathname.match(
          /^\\/g\\/(g-p-[0-9a-f]{32})(?:-[^/]+)?\\/project\\/?$/i
        );
        if (url.origin !== location.origin || !match
            || match[1].toLowerCase() !== projectId) continue;
        const name = anchor.textContent?.trim();
        if (name) {
          namesByRoute.set(projectId, name);
          return name;
        }
      } catch {}
    }
    return namesByRoute.get(projectId)
      ?? projectNameFromRouteSlug(location.pathname.split('/')[2]) ?? null;
  }

  /**
   * Returns one conversation-scoped manual filename override across reloads.
   *
   * @returns {string|null} Explicit basename or null for automatic naming.
   */
  function conversationFilenameOverride() {
    const id = currentConversationId();
    if (!id) return null;
    try {
      const value = localStorage.getItem('tm-recorder-filename-override:' + id);
      return value ? sanitizeFileName(value) : null;
    } catch { return null; }
  }

  /**
   * Stores or resets an explicit filename base for the current conversation.
   *
   * @param {string|null} value - Manual basename or null to restore automatic naming.
   * @returns {void} No value is returned.
   */
  function conversationFilenameSetOverride(value) {
    const id = currentConversationId();
    if (!id) throw new Error('Conversation identity is unavailable.');
    const key = 'tm-recorder-filename-override:' + id;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, sanitizeFileName(value));
  }

  /**
   * Builds the canonical user-facing filename base for the current conversation.
   *
   * @returns {string} Sanitized `project - conversation` or conversation-only base.
   */
  function conversationFileBaseName() {
    const conversationName = sanitizeFileName(conversationTitle());
    const manual = conversationFilenameOverride();
    if (manual) return manual;
    const projectName = conversationProjectName();
    return `${projectName ? sanitizeFileName(projectName).replace(/\s+/g, '-') : 'Unknown'}__${conversationName}`;
  }


  /**
   * Formats one trustworthy timestamp for a user-facing filename.
   *
   * @param {string|number} timestamp - ISO timestamp or epoch seconds.
   * @returns {string} Filesystem-safe local calendar/time value.
   */
  function canonicalFilenameTimestamp(timestamp) {
    const numeric = typeof timestamp === 'number' ? timestamp * 1000 : timestamp;
    const date = new Date(numeric);
    if (!Number.isFinite(date.getTime())) {
      throw new Error('Filename timestamp is not trustworthy.');
    }
    /**
     * Pads one local date/time field to two digits.
     *
     * @param {number} value - Local calendar/time field.
     * @returns {string} Two-digit field.
     */
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()},${pad(date.getMonth() + 1)},${pad(date.getDate())};`
      + `${pad(date.getHours())},${pad(date.getMinutes())},${pad(date.getSeconds())}`;
  }

  /**
   * Builds the deterministic user-facing filename prefix.
   *
   * @param {string|null} project - Visible project name, or null.
   * @param {string} chat - Visible conversation name.
   * @param {Object} timestampRange - Trustworthy start/end timestamps.
   * @returns {string} Project/chat/timestamp filename prefix without extension.
   */
  function canonicalFilename(project, chat, timestampRange) {
    if (!timestampRange?.start_timestamp || !timestampRange?.end_timestamp) {
      throw new Error('Filename content has no trustworthy timestamp range.');
    }
    const chatName = sanitizeFileName(chat);
    const manual = conversationFilenameOverride();
    const identity = manual || `${project ? sanitizeFileName(project).replace(/\s+/g, '-') : 'Unknown'}__${chatName}`;
    const start = canonicalFilenameTimestamp(timestampRange.start_timestamp);
    const end = canonicalFilenameTimestamp(timestampRange.end_timestamp);
    return `${identity}_${start}-${end}`;
  }

  /**
   * Returns the exact content time range represented by exported JSONL records.
   *
   * Metadata and absent/null/zero record times are not content timestamps.
   *
   * @param {string} jsonl - Exact JSONL database text being exported.
   * @returns {Object|null} ISO start/end timestamps, or null when unavailable.
   */
  function conversationJsonlTimestampRange(jsonl) {
    let startMs = null;
    let endMs = null;
    for (const line of String(jsonl).split('\n')) {
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      for (const field of ['create_time', 'update_time']) {
        const value = record?.[field];
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        const timestampMs = value * 1000;
        startMs = startMs === null ? timestampMs : Math.min(startMs, timestampMs);
        endMs = endMs === null ? timestampMs : Math.max(endMs, timestampMs);
      }
    }
    return startMs === null || endMs === null
      ? null
      : {
          start_timestamp: new Date(startMs).toISOString(),
          end_timestamp: new Date(endMs).toISOString()
        };
  }

  /**
   * Finds the lowest unused filename for one destination/prefix/extension.
   *
   * @param {Object} destination - File System Access directory handle.
   * @param {string} filenamePrefix - Complete filename prefix without extension.
   * @param {string} ext - Caller-owned complete extension, including leading dot.
   * @returns {Promise<string>} Lowest unused filename.
   */
  async function unusedFilename(destination, filenamePrefix, ext) {
    if (!destination || typeof destination.getFileHandle !== 'function') {
      throw new TypeError('Filename destination must support getFileHandle().');
    }
    if (typeof ext !== 'string' || !ext.startsWith('.')) {
      throw new TypeError('Filename extension must start with a dot.');
    }
    for (let collision = 0; ; collision += 1) {
      const suffix = collision > 0 ? `(${collision})` : '';
      const candidate = `${filenamePrefix}${suffix}${ext}`;
      try {
        await destination.getFileHandle(candidate, { create: false });
      } catch (error) {
        if (error?.name === 'NotFoundError') return candidate;
        throw error;
      }
    }
  }
