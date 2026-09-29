
  /**
   * Resolves the containing ChatGPT project name for a project conversation.
   *
   * The project route segment supplies stable identity while the matching project
   * navigation link supplies the user-visible name. A document-title split is a
   * secondary source when ChatGPT has not mounted that navigation link yet.
   *
   * @returns {string|null} Visible project name, or null for standalone/unresolved chats.
   */
  function conversationProjectName() {
    const projectSegment = location.pathname.match(/^\/g\/([^/]+)(?:\/|$)/)?.[1] ?? null;
    if (!projectSegment) return null;
    const projectPath = `/g/${projectSegment}/project`;
    for (const anchor of document.querySelectorAll('a[href]')) {
      try {
        const target = new URL(anchor.href, location.href);
        if (target.origin !== location.origin || target.pathname !== projectPath) continue;
        const visibleName = anchor.textContent?.trim();
        if (visibleName) return visibleName;
      } catch {}
    }

    const heading = document.querySelector('h1')?.textContent?.trim();
    const pageTitle = String(document.title ?? '')
      .replace(/\s*[-–—]\s*ChatGPT\s*$/i, '')
      .trim();
    if (!heading || !pageTitle || pageTitle === heading) return null;
    for (const separator of [' - ', ' – ', ' — ']) {
      if (pageTitle.endsWith(`${separator}${heading}`)) {
        return pageTitle.slice(0, -(`${separator}${heading}`).length).trim() || null;
      }
      if (pageTitle.startsWith(`${heading}${separator}`)) {
        return pageTitle.slice(`${heading}${separator}`.length).trim() || null;
      }
    }
    return null;
  }

  /**
   * Builds the canonical user-facing filename base for the current conversation.
   *
   * @returns {string} Sanitized `project - conversation` or conversation-only base.
   */
  function conversationFileBaseName() {
    const conversationName = sanitizeFileName(conversationTitle());
    const projectName = conversationProjectName();
    return projectName
      ? `${sanitizeFileName(projectName)} - ${conversationName}`
      : conversationName;
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
    const identity = project
      ? `${sanitizeFileName(project)} - ${chatName}`
      : chatName;
    const start = canonicalFilenameTimestamp(timestampRange.start_timestamp);
    const end = canonicalFilenameTimestamp(timestampRange.end_timestamp);
    return `DownloadConversation_${identity}_${start}-${end}`;
  }

  /**
   * Returns the exact content time range represented by a conversation spine.
   *
   * @param {Object} spine - Canonical Conversation API spine.
   * @returns {Object|null} ISO start/end timestamps, or null when unavailable.
   */
  function conversationSpineTimestampRange(spine) {
    let startMs = null;
    let endMs = null;
    for (const record of spine?.records ?? []) {
      const message = record?.message ?? record;
      const createSeconds = Number(message?.create_time);
      const updateSeconds = Number(message?.update_time);
      if (Number.isFinite(createSeconds)) {
        const createMs = createSeconds * 1000;
        startMs = startMs === null ? createMs : Math.min(startMs, createMs);
        endMs = endMs === null ? createMs : Math.max(endMs, createMs);
      }
      if (Number.isFinite(updateSeconds)) {
        const updateMs = updateSeconds * 1000;
        startMs = startMs === null ? updateMs : Math.min(startMs, updateMs);
        endMs = endMs === null ? updateMs : Math.max(endMs, updateMs);
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
