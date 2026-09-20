      for (let index = sourceStart; index < value.length; index += 1) {
        const character = value[index];
        if (character === '\\') {
          index += 1;
          continue;
        }
        if (character === '(') {
          nestedParentheses += 1;
          continue;
        }
        if (character !== ')') continue;
        if (nestedParentheses > 0) {
          nestedParentheses -= 1;
          continue;
        }
        sourceEnd = index;
        break;
      }
      if (sourceEnd < 0) break;

      const source = value.slice(sourceStart, sourceEnd);
      const url = cgGeneratedSandboxDownloadUrl(source, record);
      if (!url) {
        rendered += value.slice(cursor, sourceEnd + 1);
        cursor = sourceEnd + 1;
        continue;
      }
      rendered += `${value.slice(cursor, sourceStart)}${url})`;
      cursor = sourceEnd + 1;
    }
    return rendered + value.slice(cursor);
  }

  /**
   * Handles fallback render inline references.
   *
   * @param {string} text - The text to process.
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderInlineReferences`.
   */
  function cgRenderInlineReferences(text, record, fileRefIndex = new Map()) {
    if (!text) return text;
    const references = Array.isArray(record?.metadata?.content_references)
      ? record.metadata.content_references
      : [];
    const urlIndex = cgSearchResultUrlIndex(record);
    let rendered = text;
    for (const reference of references) {
      const matched = reference?.matched_text;
      if (typeof matched !== 'string' || !matched || !rendered.includes(matched)) continue;
      const replacement = cgRenderInlineReference(reference, record, urlIndex, fileRefIndex);
      if (replacement) rendered = rendered.split(matched).join(replacement);
    }
    for (const token of rendered.match(CG_INLINE_TOKEN_RX) ?? []) {
      const fallback = cgRenderUnstructuredInlineToken(token, record, fileRefIndex);
      if (fallback) rendered = rendered.split(token).join(fallback);
    }
    return rendered;
  }

  /**
   * Handles fallback image pointer source.
   *
   * @param {Object} part - The provider content part to process.
   * @returns {string} The string produced by `cgImagePointerSource`.
   */
  function cgImagePointerSource(part) {
    if (!part || typeof part !== 'object') return '';
    const metadata = part.metadata && typeof part.metadata === 'object' ? part.metadata : {};
    for (const value of [metadata.asset_pointer_link, part.asset_pointer_link, part.asset_pointer]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  /**
   * Handles fallback image unavailable Markdown.
   *
   * @param {Object} source - The source value to inspect.
   * @returns {string} The string produced by `cgImageUnavailableMarkdown`.
   */
  function cgImageUnavailableMarkdown(source) {
    const clean = typeof source === 'string' ? source.trim() : '';
    return clean ? `[image not available](${clean})` : '[image not available]';
  }

  /**
   * Handles fallback image failure Markdown.
   *
   * @param {Object} source - The source value to inspect.
   * @param {Object|null} httpStatus - The httpStatus value required by this function.
   * @returns {string} The string produced by `cgImageFailureMarkdown`.
   */
  function cgImageFailureMarkdown(source, httpStatus = null) {
    if (httpStatus === 404 || httpStatus === 410) return '[image missing]';
    return cgImageUnavailableMarkdown(source);
  }

  /**
   * Returns canonical conversation-image resources for one source record keyed by provider part index.
   *
   * Provider/source -> canonical transformation is delegated to the pinned AIConversationCore adapter; DownloadConversation does not reconstruct provider pointer mappings itself.
   *
   * @param {Object} record - The provider/source record containing image parts.
   * @returns {Map<number, Object>} Canonical conversation-image resources keyed by original source part index.
   */
  function canonicalImageResourcesByRecordAndPart(records) {
    assert(Array.isArray(records), 'Canonical image-resource lookup requires the ordered source record set.');
    const events = canonicalCore().adaptChatGPTRecords(records);
    const byRecord = new Map();
    for (const event of events) {
      const recordId = event?.source_record_id;
      if (typeof recordId !== 'string' || !recordId) continue;
      const resources = Array.isArray(event?.resources) ? event.resources : [];
      let byPart = byRecord.get(recordId);
      for (const resource of resources) {
        if (resource?.type !== 'image' || resource?.resource_kind !== 'conversation_image') continue;
        const partIndex = resource?.source?.part_index;
        if (!Number.isInteger(partIndex)) continue;
        if (!byPart) {
          byPart = new Map();
          byRecord.set(recordId, byPart);
        }
        assert(!byPart.has(partIndex), `Duplicate canonical image resource for ${recordId}:${partIndex}.`);
        byPart.set(partIndex, resource);
      }
    }
    return byRecord;
  }

  /**
   * Fetches image bytes through a canonical Core-supplied authenticated transport URL.
   *
   * The first request resolves provider identity to transient access data. The returned signed URL is used only for the immediate image fetch and is never persisted in diagnostics or canonical state.
   *
   * @param {string} resolverUrl - Deterministic authenticated transport URL supplied by AIConversationCore.
   * @param {Object|null} timing - Mutable timing/result object populated without retaining signed URLs or image payload data.
   * @returns {Promise<string>} A promise resolving to the fetched image as a data URL.
   */
  async function fetchCanonicalResolvedImageDataUrl(resolverUrl, timing = null) {
    const startedAt = performance.now();
    try {
      if (timing) {
        timing.stage = 'resolver';
        timing.source_scheme = 'core-resolver';
        timing.resolver_status = null;
        timing.resolver_ms = null;
      }
      const resolverResponse = await apiFetch(resolverUrl);
      const resolverAt = performance.now();
      if (timing) {
        timing.resolver_status = resolverResponse.status;
        timing.resolver_ms = Math.round(resolverAt - startedAt);
      }
      if (!resolverResponse.ok) {
        const error = new Error(`Conversational image resolver returned HTTP ${resolverResponse.status}.`);
        error.httpStatus = resolverResponse.status;
        if (timing) timing.outcome = 'resolver-http-error';
        throw error;
      }
      const resolverPayload = await resolverResponse.json();
      const resolvedSource = typeof resolverPayload?.download_url === 'string'
        ? resolverPayload.download_url.trim()
        : '';
      if (!resolvedSource) {
        if (timing) timing.outcome = 'resolver-response-error';
        throw new Error('Conversational image resolver response did not contain download_url.');
      }
      const dataUrl = await fetchImageDataUrl(resolvedSource, timing);
      if (timing) {
        timing.resolver_status = resolverResponse.status;
        timing.resolver_ms = Math.round(resolverAt - startedAt);
        timing.total_ms = Math.round(performance.now() - startedAt);
      }
      return dataUrl;
    } catch (error) {
      if (timing) {
        timing.total_ms = Math.round(performance.now() - startedAt);
        if (!timing.outcome) timing.outcome = `${timing.stage || 'resolver'}-error`;
      }
      throw error;
    }
  }

  /**
   * Resolves one provider image pointer into Markdown while optionally recording timing metrics.
   *
   * AIConversationCore owns provider-pointer interpretation. DownloadConversation consumes canonical `data_url` or `download_url` fields and performs only the credential-bound browser retrieval step.
   *
   * @param {Object} part - The provider content part to process.
   * @param {Object|null} resource - Canonical conversation-image resource for this source part.
   * @param {string} recordId - The provider/source record identifier.
   * @param {number} imageOrdinal - The one-based image ordinal within the source record.
   * @param {Object|null} timing - Mutable timing/result object populated without retaining image payload data.
   * @returns {Promise<string>} A promise that resolves to image Markdown or the established unavailable-image fallback.
   */
  async function cgResolveImagePointerMarkdown(part, resource, recordId, imageOrdinal, timing = null) {
    const startedAt = performance.now();
    const source = typeof resource?.source_pointer === 'string' && resource.source_pointer.trim()
      ? resource.source_pointer.trim()
      : cgImagePointerSource(part);
    if (!source) {
      if (timing) {
        timing.stage = 'complete';
        timing.outcome = 'missing-pointer';
        timing.source_scheme = null;
        timing.total_ms = Math.round(performance.now() - startedAt);
      }
      return '[image missing]';
    }
    try {
      let dataUrl = '';
      if (typeof resource?.data_url === 'string' && resource.data_url.startsWith('data:image/')) {
        dataUrl = resource.data_url;
        if (timing) {
          timing.stage = 'complete';
          timing.outcome = 'data-url';
          timing.source_scheme = 'canonical-data-url';
          timing.fetch_ms = 0;
          timing.body_ms = 0;
          timing.encode_ms = 0;
          timing.data_url_chars = dataUrl.length;
          timing.total_ms = Math.round(performance.now() - startedAt);
        }
      } else if (typeof resource?.download_url === 'string' && resource.download_url.trim()) {
        dataUrl = await fetchCanonicalResolvedImageDataUrl(resource.download_url.trim(), timing);
      } else {
        let parsed = null;
        try { parsed = new URL(source, location.href); } catch {}
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
          if (timing) {
            timing.stage = 'complete';
            timing.outcome = 'unresolved-pointer';
            timing.source_scheme = parsed?.protocol ?? null;
            timing.total_ms = Math.round(performance.now() - startedAt);
          }
          return cgImageUnavailableMarkdown(source);
        }
        dataUrl = await fetchImageDataUrl(source, timing);
      }
      return dataUrl ? `![image-${recordId}-${imageOrdinal}](${dataUrl})` : cgImageUnavailableMarkdown(source);
    } catch (error) {
      const status = Number(error?.httpStatus);
      return cgImageFailureMarkdown(source, Number.isFinite(status) ? status : null);
