   * @returns {Object} The Object value produced by `apiConversationUapFinalGrouping`.
   */
  function apiConversationUapFinalGrouping(spine) {
    const primary = apiConversationUapGrouping(spine);
    const linkage = apiUnresolvedUapLinkageAnalysis(spine, primary);
    // Indexes unresolved-linkage analysis by source ordinal for the refinement pass.
    const linkageByOrdinal = new Map(
      linkage.unresolved.map(item => [item.record_ordinal, item])
    );
    const records = spine?.records ?? [];
    /**
     * Handles groups.
     */
    const groups = (spine?.uap_anchors ?? []).map(anchor => ({
      ordinal: anchor.ordinal,
      user_message_id: anchor.user_message_id,
      record_ordinals: []
    }));
    // Stores one association classification for every source record in spine order.
    const classifications = [];
    const counts = { exact: 0, linked: 0, bounded: 0, global: 0, conflict: 0, unresolved: 0 };

    for (const item of primary.classifications) {
      const record = records[item.record_ordinal];
      let classification = item.classification;
      let uapOrdinal = item.uap_ordinal;
      let basis = item.basis;
      if (classification === 'fallback' || classification === 'ungrouped') {
        const evidence = linkageByOrdinal.get(item.record_ordinal);
        const refs = evidence?.referenced_uap_ordinals ?? [];
        const boundedOrdinal = evidence?.same_uap_bounded
          ? evidence.bounded_uap_ordinal
          : null;
        if (refs.length > 1 ||
            (refs.length === 1 && boundedOrdinal !== null && refs[0] !== boundedOrdinal)) {
          classification = 'conflict';
          uapOrdinal = null;
          basis = 'unresolved-evidence-conflict';
        } else if (refs.length === 1) {
          classification = 'linked';
          uapOrdinal = refs[0];
          basis = 'identifier-linkage';
        } else if (boundedOrdinal !== null && record?.role !== 'system') {
          classification = 'bounded';
          uapOrdinal = boundedOrdinal;
          basis = 'exact-neighbour-containment';
        } else if (record?.role === 'system' &&
                   record?.message?.metadata?.is_visually_hidden_from_conversation === true) {
          classification = 'global';
          uapOrdinal = null;
          basis = 'hidden-system-outside-exchange';
        } else {
          classification = 'unresolved';
          uapOrdinal = null;
          basis = 'insufficient-evidence';
        }
      }
      if (classification === 'conflict') uapOrdinal = null;
      counts[classification] = (counts[classification] ?? 0) + 1;
      if (uapOrdinal !== null && groups[uapOrdinal]) {
        groups[uapOrdinal].record_ordinals.push(item.record_ordinal);
      }
      classifications.push({ ...item, classification, uap_ordinal: uapOrdinal, basis });
    }

    return {
      groups,
      classifications,
      exact_record_count: counts.exact,
      linked_record_count: counts.linked,
      bounded_record_count: counts.bounded,
      global_record_count: counts.global,
      conflicting_record_count: counts.conflict,
      unresolved_record_count: counts.unresolved
    };
  }

  /**
   * Handles fallback is hidden.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {boolean} `true` when `cgIsHidden` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function cgIsHidden(record) {
    return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
  }

  /**
   * Handles fallback text parts.
   *
   * @param {Array<unknown>} parts - The ordered parts values to process.
   * @returns {Array<unknown>} The ordered values produced by `cgTextParts`.
   */
  function cgTextParts(parts) {
    const texts = [];
    if (!Array.isArray(parts)) return texts;
    for (const part of parts) {
      if (typeof part === 'string') {
        if (part.trim()) texts.push(part);
      } else if (part && typeof part === 'object') {
        for (const key of ['text', 'content']) {
          const value = part[key];
          if (typeof value === 'string' && value.trim()) texts.push(value);
        }
      }
    }
    return texts;
  }

  /**
   * Handles fallback citation root.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgCitationRoot`.
   */
  function cgCitationRoot(url) {
    try {
      const parsed = new URL(url);
      return parsed.host ? `${parsed.protocol}//${parsed.host}` : '';
    } catch {
      return '';
    }
  }

  /**
   * Handles fallback citation hostname.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgCitationHostname`.
   */
  function cgCitationHostname(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /**
   * Handles fallback normalize citation URL.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgNormalizeCitationUrl`.
   */
  function cgNormalizeCitationUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';
    const raw = url.trim();
    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      parsed.protocol = parsed.protocol.toLowerCase();
      parsed.hostname = parsed.hostname.toLowerCase();
      parsed.searchParams.delete('utm_source');
      return parsed.toString();
    } catch {
      return raw;
    }
  }

  /**
   * Handles fallback search result URL index.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {Map<unknown, unknown>} The lookup map produced by `cgSearchResultUrlIndex`.
   */
  function cgSearchResultUrlIndex(record) {
    const metadata = record?.metadata;
    const groups = metadata && typeof metadata === 'object' ? metadata.search_result_groups : null;
    if (!Array.isArray(groups)) return new Map();
    const result = new Map();
    for (const group of groups) {
      if (!group || typeof group !== 'object' || !Array.isArray(group.entries)) continue;
      for (const entry of group.entries) {
        if (!entry || typeof entry !== 'object') continue;
        const key = cgNormalizeCitationUrl(entry.url);
        if (!key) continue;
        const merged = result.get(key) ?? { title: '', snippet: '', attribution: '' };
        for (const field of ['title', 'snippet', 'attribution']) {
          const value = entry[field];
          if (!merged[field] && typeof value === 'string' && value.trim()) {
            merged[field] = value.trim();
          }
        }
        result.set(key, merged);
      }
    }
    return result;
  }

  /**
   * Handles fallback shorten inline text.
   *
   * @param {string} text - The text to process.
   * @param {number} maxChars - The maximum number of characters to retain.
   * @returns {string} The string produced by `cgShortenInlineText`.
   */
  function cgShortenInlineText(text, maxChars = 200) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxChars) return clean;
    let clipped = clean.slice(0, maxChars - 1).trimEnd();
    if (clipped.includes(' ')) clipped = clipped.slice(0, clipped.lastIndexOf(' '));
    return `${clipped.replace(/[ ,;:-]+$/g, '')}…`;
  }

  /**
   * Handles fallback wrap tooltip block.
   *
   * @param {string} text - The text to process.
   * @param {number} width - The maximum wrapped line width in characters.
   * @param {number} maxChars - The maximum number of characters to retain.
   * @returns {string} The string produced by `cgWrapTooltipBlock`.
   */
  function cgWrapTooltipBlock(text, width = 78, maxChars = 520) {
    const shortened = cgShortenInlineText(text, maxChars);
    if (!shortened) return '';
    const words = shortened.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }

  /**
   * Handles fallback clean citation blurb.
   *
   * @param {string} text - The text to process.
   * @returns {Array<unknown>} The ordered values produced by `cgCleanCitationBlurb`.
   */
  function cgCleanCitationBlurb(text) {
    if (typeof text !== 'string' || !text.trim()) return [];
    const clean = text.replace(/\s+/g, ' ').trim()
      .replace(/\s*Read more\.?$/i, '')
      .replace(/^Abstract\b[:.]?\s*/i, '')
      .replace(/\.\s*\./g, '.')
      .replace(/\s+\./g, '.');
    let meta = '';
    let body = clean;
