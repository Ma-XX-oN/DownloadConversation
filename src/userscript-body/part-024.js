      if (!label && typeof citation.attribution === 'string') label = citation.attribution.trim();
      if (!label) label = cgCitationHostname(url) || 'memory';
      if (!url && !label) continue;
      const dedupe = `${url}\u0000${label}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      sources.push({ url, label, tooltip: cgCitationTooltip(citation, {}, label) });
    }
    return sources;
  }

  /**
   * Handles fallback render source citation.
   *
   * @param {Object} kind - The export kind to execute.
   * @param {Object} sources - The sources value required by this function.
   * @returns {string} The string produced by `cgRenderSourceCitation`.
   */
  function cgRenderSourceCitation(kind, sources) {
    const links = [];
    for (const source of sources ?? []) {
      const titleAttribute = source.tooltip
        ? ` title="${escapeHtmlAttribute(source.tooltip).replace(/\n/g, '&#10;')}"`
        : '';
      const favicon = source.url ? cgCitationFavicon(source.url) : '';
      const icon = favicon
        ? `<img alt="" src="${escapeHtmlAttribute(favicon)}" width="15" height="15"${titleAttribute} style="width:0.97em;height:0.97em;vertical-align:-0.13em;margin-right:0.22em;border-radius:2px;">`
        : '';
      if (source.url) {
        links.push(`<a href="${escapeHtmlAttribute(source.url)}"${titleAttribute} style="display:inline-block;white-space:nowrap;">${icon}${escapeHtmlText(source.label)}</a>`);
      } else {
        links.push(`<span${titleAttribute} style="display:inline-block;white-space:nowrap;">${icon}${escapeHtmlText(source.label)}</span>`);
      }
    }
    return links.length ? `**(${kind}: ${links.join(', ')})**` : '';
  }

  /**
   * Handles fallback render memory citation.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {string} The string produced by `cgRenderMemoryCitation`.
   */
  function cgRenderMemoryCitation(record) {
    const sources = cgCollectMemoryCitationSources(record);
    return sources.length ? cgRenderSourceCitation('memory', sources) : '**(memory context)**';
  }

  /**
   * Handles fallback display file URL.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgDisplayFileUrl`.
   */
  function cgDisplayFileUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';
    const cleaned = url.trim();
    try {
      const parsed = new URL(cleaned);
      if (parsed.hostname.toLowerCase() !== 'api.github.com') return cleaned;
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 4 || segments[0] !== 'repos' || segments[3] !== 'contents') return cleaned;
      const owner = segments[1];
      const repo = segments[2];
      const relative = segments.slice(4).map(decodeURIComponent);
      const ref = parsed.searchParams.get('ref') || 'main';
      if (!relative.length) return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(ref)}`;
      const target = relative[relative.length - 1].includes('.') ? 'blob' : 'tree';
      /**
       * Handles rel.
       */
      const rel = relative.map(segment => encodeURIComponent(segment)).join('/');
      return `https://github.com/${owner}/${repo}/${target}/${encodeURIComponent(ref)}/${rel}`;
    } catch {
      return cleaned;
    }
  }

  /**
   * Handles fallback display file label.
   *
   * @param {string} name - The name to process.
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgDisplayFileLabel`.
   */
  function cgDisplayFileLabel(name, url) {
    let shown = typeof name === 'string' ? name.trim().replace(/`/g, '') : '';
    const displayUrl = cgDisplayFileUrl(url);
    let parsed = null;
    try { parsed = displayUrl ? new URL(displayUrl) : null; } catch {}
    const segments = parsed ? parsed.pathname.split('/').filter(Boolean) : [];
    const generic = new Set(['', 'file', 'content', 'contents']);
    if (generic.has(shown.toLowerCase())) {
      if (parsed?.hostname.toLowerCase() === 'github.com') {
        if (segments.length >= 4 && segments[2] === 'tree' && segments.length === 4) {
          shown = `${segments[1]} contents`;
        } else if (segments.length >= 5 && ['blob', 'tree'].includes(segments[2])) {
          shown = decodeURIComponent(segments[segments.length - 1] || '');
        } else if (segments.length) shown = decodeURIComponent(segments[segments.length - 1]);
      } else if (segments.length) shown = decodeURIComponent(segments[segments.length - 1]);
    }
    return shown || 'file';
  }

  /**
   * Handles fallback render named file reference.
   *
   * @param {string} name - The name to process.
   * @param {string} matchedText - The matchedText value required by this function.
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgRenderNamedFileReference`.
   */
  function cgRenderNamedFileReference(name, matchedText = '', url = '') {
    const shown = cgDisplayFileLabel(name, url);
    const { lineRef } = cgFileTokenSpec(matchedText);
    const label = `${shown}${lineRef ? ` ${lineRef}` : ''}`;
    const displayUrl = cgDisplayFileUrl(url);
    if (displayUrl) return `<a href="${escapeHtmlAttribute(displayUrl)}">${escapeHtmlText(label)}</a>`;
    return lineRef ? `\`${shown}\` ${lineRef}` : `\`${shown}\``;
  }

  /**
   * Handles fallback hidden file reference.
   *
   * @param {Object} reference - The provider reference object to process.
   * @param {Object} record - The provider/source record to process.
   * @param {number} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgHiddenFileReference`.
   */
  function cgHiddenFileReference(reference, record, fileRefIndex) {
    const token = reference?.matched_text ?? '';
    const { key } = cgFileTokenSpec(token);
    if (!key) return '';
    let citation = null;
    const metadata = record?.metadata;
    if (metadata && typeof metadata === 'object') {
      const currentTurn = Number(metadata.retrieval_turn_number);
      const currentFile = Number(metadata.retrieval_file_index);
      if (Number.isInteger(currentTurn) && Number.isInteger(currentFile) &&
          `${currentTurn}:${currentFile}` === key && metadata.citation_metadata &&
          typeof metadata.citation_metadata === 'object') citation = metadata.citation_metadata;
    }
    if (!citation && fileRefIndex instanceof Map) citation = fileRefIndex.get(key) ?? null;
    return cgRenderNamedFileReference(citation?.title ?? '', token, citation?.url ?? '');
  }

  /**
   * Renders one provider-native inline content reference on the legacy/fallback Markdown path.
   *
   * Source -> output transformation: grouped web, alt-text, file, memory, and retrieved-file references are converted to their established visible Markdown/HTML representation; unsupported reference kinds render no replacement.
   *
   * @param {Object} reference - The provider reference object to process.
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} urlIndex - The zero-based url index.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderInlineReference`.
   */
  function cgRenderInlineReference(reference, record, urlIndex = new Map(), fileRefIndex = new Map()) {
    if (reference?.type === 'grouped_webpages') return cgRenderWebCitation(reference, urlIndex);
    if (reference?.type === 'alt_text') {
      for (const key of ['alt', 'prompt_text']) {
        const value = reference[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    }
    if (reference?.type === 'file') {
      return cgRenderNamedFileReference(reference.name ?? '', reference.matched_text ?? '', reference.url ?? '');
    }
    if (reference?.type === 'hidden') {
      const segments = cgInlineTokenSegments(reference.matched_text ?? '');
      if (!segments.length) return '';
      if (segments[0] === 'memcite') return cgRenderMemoryCitation(record);
      if (segments[0] === 'filecite') return cgHiddenFileReference(reference, record, fileRefIndex);
    }
    return '';
  }

  /**
   * Handles fallback render unstructured inline token.
   *
   * @param {Object} token - The inline token to parse or render.
   * @param {Object} record - The provider/source record to process.
   * @param {number} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderUnstructuredInlineToken`.
   */
  function cgRenderUnstructuredInlineToken(token, record, fileRefIndex) {
    const segments = cgInlineTokenSegments(token);
    if (!segments.length) return '';
    if (segments[0] === 'memcite') return cgRenderMemoryCitation(record);
    if (segments[0] === 'filecite') return cgHiddenFileReference({ type: 'hidden', matched_text: token }, record, fileRefIndex);
    return '';
  }

  /**
   * Handles fallback generated sandbox download URL.
   *
   * @param {Object} source - The source value to inspect.
   * @param {Object} record - The provider/source record to process.
   * @returns {string|null} The string produced by `cgGeneratedSandboxDownloadUrl`, or `null` when no value is available.
   */
  function cgGeneratedSandboxDownloadUrl(source, record) {
    if (record?.author?.role !== 'assistant') return null;
    const value = String(source ?? '').trim();
    const match = value.match(/^sandbox:(\/\/)?(\/mnt\/data\/.*)$/i);
    if (!match) return null;
    const conversationId = currentConversationId();
    const messageId = record?.id;
    if (!conversationId || !messageId) return null;
    const sandboxPath = match[2];
    return `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationId)}` +
      `/interpreter/download?message_id=${encodeURIComponent(messageId)}` +
      `&sandbox_path=${encodeURIComponent(sandboxPath)}&download_intent=true`;
  }

  /**
   * Handles fallback rewrite generated sandbox links.
   *
   * @param {string} text - The text to process.
   * @param {Object} record - The provider/source record to process.
   * @returns {string} The string produced by `cgRewriteGeneratedSandboxLinks`.
   */
  function cgRewriteGeneratedSandboxLinks(text, record) {
    if (!text || record?.author?.role !== 'assistant') return text;
    const value = String(text);
    // Accumulates rewritten Markdown while cursor tracks the next unread source character.
    let rendered = '';
    // Offset of the next source character not yet copied into the rewritten Markdown.
    let cursor = 0;
    while (cursor < value.length) {
      const destinationPrefix = value.indexOf('](', cursor);
      if (destinationPrefix < 0) break;
      const sourceStart = destinationPrefix + 2;
      const remainder = value.slice(sourceStart);
      const sandboxPrefix = remainder.match(/^sandbox:(?:\/\/)?\/mnt\/data\//i)?.[0];
      if (!sandboxPrefix) {
        rendered += value.slice(cursor, sourceStart);
        cursor = sourceStart;
        continue;
      }

      // Tracks parentheses nested inside the Markdown link destination being scanned.
      let nestedParentheses = 0;
      // Index of the closing parenthesis for the current sandbox link destination.
      let sourceEnd = -1;
