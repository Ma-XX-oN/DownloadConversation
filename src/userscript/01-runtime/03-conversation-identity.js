
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
