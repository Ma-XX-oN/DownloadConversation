    const dash = clean.indexOf('—');
    if (dash >= 0) {
      const head = clean.slice(0, dash).trim().replace(/^[- ]+|[- ]+$/g, '');
      const tail = clean.slice(dash + 1).trim();
      if (tail && (
        head.toLowerCase().startsWith('by ') ||
        head.toLowerCase().includes('cited by') ||
        /^[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}$/.test(head)
      )) {
        meta = head;
        body = tail;
      }
    }
    body = body.replace(/\s*[•·]\s*/g, ' • ');
    const blocks = [];
    if (meta) blocks.push(cgWrapTooltipBlock(meta, 78, 180));
    const wrappedBody = cgWrapTooltipBlock(body, 78, 520);
    if (wrappedBody) blocks.push(wrappedBody);
    return blocks;
  }

  /**
   * Handles fallback citation tooltip.
   *
   * @param {Node} node - The node to process.
   * @param {Object} urlInfo - The urlInfo value required by this function.
   * @param {string} fallback - The fallback value required by this function.
   * @returns {string} The string produced by `cgCitationTooltip`.
   */
  function cgCitationTooltip(node, urlInfo = {}, fallback = '') {
    let title = typeof node?.title === 'string' ? node.title.trim() : '';
    if (!title) title = typeof urlInfo?.title === 'string' ? urlInfo.title.trim() : '';
    let snippet = typeof node?.snippet === 'string' ? node.snippet.trim() : '';
    if (!snippet) snippet = typeof urlInfo?.snippet === 'string' ? urlInfo.snippet.trim() : '';
    const parts = [];
    if (title) {
      const wrapped = cgWrapTooltipBlock(title, 78, 220);
      if (wrapped) parts.push(wrapped);
    }
    if (snippet) {
      for (const block of cgCleanCitationBlurb(snippet)) {
        if (block && !parts.includes(block)) parts.push(block);
      }
    }
    if (parts.length) return parts.join('\n\n');
    return cgWrapTooltipBlock(fallback, 78, 220);
  }

  /**
   * Handles fallback citation favicon.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgCitationFavicon`.
   */
  function cgCitationFavicon(url) {
    const root = cgCitationRoot(url);
    return root ? `https://www.google.com/s2/favicons?domain=${root}&sz=32` : '';
  }

  /**
   * Handles fallback collect web citation sources.
   *
   * @param {Object} reference - The provider reference object to process.
   * @param {Map<unknown, unknown>} urlIndex - The zero-based url index.
   * @returns {Array<unknown>} The ordered values produced by `cgCollectWebCitationSources`.
   */
  function cgCollectWebCitationSources(reference, urlIndex = new Map()) {
    const sources = [];
    const seen = new Set();
    /**
     * Handles append.
     *
     * @param {string} url - The URL to process.
     * @param {string} label - The label value required by this function.
     * @param {Object} tooltip - The tooltip value required by this function.
     * @returns {void} No value is returned.
     */
    const append = (url, label, tooltip) => {
      if (typeof url !== 'string' || !url.trim() || seen.has(url.trim())) return;
      const clean = url.trim();
      seen.add(clean);
      const shown = typeof label === 'string' && label.trim()
        ? label.trim()
        : (cgCitationHostname(clean) || 'source');
      sources.push({
        url: clean,
        label: shown,
        tooltip: typeof tooltip === 'string' ? tooltip.trim() : ''
      });
    };
    /**
     * Handles visit.
     *
     * @param {Node} node - The node to process.
     * @param {string} inheritedTooltip - The inheritedTooltip value required by this function.
     * @returns {void} No value is returned.
     */
    const visit = (node, inheritedTooltip = '') => {
      if (!node || typeof node !== 'object') return;
      const url = node.url;
      if (typeof url === 'string' && url.trim()) {
        const urlInfo = urlIndex.get(cgNormalizeCitationUrl(url)) ?? {};
        let label = typeof node.attribution === 'string' ? node.attribution.trim() : '';
        if (!label && typeof urlInfo.attribution === 'string') label = urlInfo.attribution.trim();
        if (!label) label = cgCitationHostname(url);
        const tooltip = cgCitationTooltip(node, urlInfo, inheritedTooltip || label);
        append(url, label, tooltip);
        inheritedTooltip = tooltip;
      }
      for (const key of ['items', 'supporting_websites', 'webpages', 'sources']) {
        if (Array.isArray(node[key])) {
          for (const item of node[key]) visit(item, inheritedTooltip);
        }
      }
    };
    visit(reference);
    if (!sources.length && Array.isArray(reference?.safe_urls)) {
      for (const url of reference.safe_urls) append(url, cgCitationHostname(url), '');
    }
    return sources;
  }

  /**
   * Handles fallback render web citation.
   *
   * @param {Object} reference - The provider reference object to process.
   * @param {Map<unknown, unknown>} urlIndex - The zero-based url index.
   * @returns {string} The string produced by `cgRenderWebCitation`.
   */
  function cgRenderWebCitation(reference, urlIndex = new Map()) {
    const links = [];
    for (const source of cgCollectWebCitationSources(reference, urlIndex)) {
      const titleAttribute = source.tooltip
        ? ` title="${escapeHtmlAttribute(source.tooltip).replace(/\n/g, '&#10;')}"`
        : '';
      const favicon = cgCitationFavicon(source.url);
      const icon = favicon
        ? `<img alt="" src="${escapeHtmlAttribute(favicon)}" width="15" height="15"${titleAttribute} style="width:0.97em;height:0.97em;vertical-align:-0.13em;margin-right:0.22em;border-radius:2px;">`
        : '';
      links.push(
        `<a href="${escapeHtmlAttribute(source.url)}"${titleAttribute} style="display:inline-block;white-space:nowrap;">${icon}${escapeHtmlText(source.label)}</a>`
      );
    }
    return links.length ? `**(cite: ${links.join(', ')})**` : '';
  }

  /** Private-use marker that begins a fallback inline-reference token. */
  const CG_INLINE_TOKEN_START = '\ue200';
  /** Private-use marker that terminates a fallback inline-reference token. */
  const CG_INLINE_TOKEN_END = '\ue201';
  /** Private-use separator between fields inside a fallback inline-reference token. */
  const CG_INLINE_TOKEN_SEP = '\ue202';
  /** Matcher for complete fallback inline-reference tokens embedded in source text. */
  const CG_INLINE_TOKEN_RX = /\ue200[^\ue201]*\ue201/g;

  /**
   * Handles fallback inline token segments.
   *
   * @param {Object} token - The inline token to parse or render.
   * @returns {Array<unknown>} The ordered values produced by `cgInlineTokenSegments`.
   */
  function cgInlineTokenSegments(token) {
    if (typeof token !== 'string' ||
        !token.startsWith(CG_INLINE_TOKEN_START) ||
        !token.endsWith(CG_INLINE_TOKEN_END)) return [];
    return token.slice(1, -1).split(CG_INLINE_TOKEN_SEP);
  }

  /**
   * Handles fallback strip inline tokens.
   *
   * @param {string} text - The text to process.
   * @returns {string} The string produced by `cgStripInlineTokens`.
   */
  function cgStripInlineTokens(text) {
    return typeof text === 'string' ? text.replace(CG_INLINE_TOKEN_RX, '') : '';
  }

  /**
   * Handles fallback file token spec.
   *
   * @param {Object} token - The inline token to parse or render.
   * @returns {Object} The Object value produced by `cgFileTokenSpec`.
   */
  function cgFileTokenSpec(token) {
    const segments = cgInlineTokenSegments(token);
    if (segments.length < 2 || segments[0] !== 'filecite') return { key: null, lineRef: '' };
    const match = /^turn(\d+)file(\d+)$/.exec(segments[1]);
    if (!match) return { key: null, lineRef: '' };
    return {
      key: `${Number(match[1])}:${Number(match[2])}`,
      lineRef: segments.length > 2 ? segments[2].trim() : ''
    };
  }

  /**
   * Handles fallback register file reference.
   *
   * @param {number} index - The zero-based index to process.
   * @param {Object} record - The provider/source record to process.
   * @returns {void} No value is returned.
   */
  function cgRegisterFileReference(index, record) {
    if (!(index instanceof Map) || !record?.metadata || typeof record.metadata !== 'object') return;
    const metadata = record.metadata;
    const citation = metadata.citation_metadata;
    if (!citation || typeof citation !== 'object') return;
    const turnNumber = Number(metadata.retrieval_turn_number);
    const fileIndex = Number(metadata.retrieval_file_index);
    if (!Number.isInteger(turnNumber) || !Number.isInteger(fileIndex)) return;
    const title = typeof citation.title === 'string' ? citation.title.trim() : '';
    const url = typeof citation.url === 'string' ? citation.url.trim() : '';
    if (!title && !url) return;
    index.set(`${turnNumber}:${fileIndex}`, citation);
  }

  /**
   * Handles fallback build file reference index.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @returns {Map<unknown, unknown>} The lookup map produced by `cgBuildFileReferenceIndex`.
   */
  function cgBuildFileReferenceIndex(records) {
    const index = new Map();
    for (const record of records ?? []) cgRegisterFileReference(index, record);
    return index;
  }

  /**
   * Handles fallback collect memory citation sources.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {Array<unknown>} The ordered values produced by `cgCollectMemoryCitationSources`.
   */
  function cgCollectMemoryCitationSources(record) {
    const entries = Array.isArray(record?.metadata?.conversation_context_citation_metadata)
      ? record.metadata.conversation_context_citation_metadata
      : [];
    const sources = [];
    const seen = new Set();
    for (const entry of entries) {
      const citation = entry?.citation;
      if (!citation || typeof citation !== 'object') continue;
      const url = typeof citation.url === 'string' ? citation.url.trim() : '';
      let label = typeof citation.title === 'string' ? citation.title.trim() : '';
