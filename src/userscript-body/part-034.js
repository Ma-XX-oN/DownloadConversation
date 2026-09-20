      setStatus('No User/Assistant turn ID or UAP index was entered.');
      return;
    }
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    markLiveTailHistoricalNavigation('downloadconversation-jump');
    logDiagnostic('debug', 'conversation-jump-request', {
      raw_requested_identifier: boundedDiagnosticText(requested, 500),
      identifier,
      conversation_id: conversationId
    });
    jumpInProgress = true;
    updateUi();
    let resolvedTarget = null;
    try {
      setStatus('Resolving Jump target…');
      const fetched = await fetchConversationPages(conversationId);
      const spine = conversationSpineFromPages(fetched.pages);
      const target = resolveJumpIdentifier(spine, identifier);
      resolvedTarget = {
        uap_index: target.uap_index,
        role: target.role,
        message_id: target.message_id
      };
      logDiagnostic('debug', 'conversation-jump-target-resolved', {
        identifier,
        ...resolvedTarget
      });
      target.spine = spine;
      setStatus(`Jumping to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn…`);
      const section = await jumpToResolvedTarget(target);
      if (target.role === 'user') {
        /**
         * Handles target record.
         */
        const targetRecord = spine.records.find(item => item?.message_id === target.message_id)?.message;
        if (targetRecord && userImagePointerCount(targetRecord) > 0) {
          logInternalImagePointerEvidence(targetRecord, section, mountedUserConversationImages(section));
        }
      }
      logDiagnostic('debug', 'conversation-jump-success', {
        identifier,
        ...resolvedTarget
      });
      setStatus(`Jumped to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn ${target.message_id}.`);
    } catch (error) {
      const message = errorMessage(error);
      logDiagnostic('warnings', 'conversation-jump-failure', {
        raw_requested_identifier: boundedDiagnosticText(requested, 500),
        identifier,
        conversation_id: conversationId,
        resolved_target: resolvedTarget,
        message
      });
      setStatus(`Jump failed: ${message}`);
    } finally {
      jumpInProgress = false;
      updateUi();
    }
  }

  /**
   * Handles user image pointer count.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {number} The numeric value produced by `userImagePointerCount`.
   */
  function userImagePointerCount(record) {
    if (record?.author?.role !== 'user' || !Array.isArray(record?.content?.parts)) return 0;
    return record.content.parts.filter(part =>
      part && typeof part === 'object' && part.content_type === 'image_asset_pointer'
    ).length;
  }

  /**
   * Returns mounted user conversation images.
   *
   * @param {HTMLElement} section - The mounted conversation-turn section.
   * @returns {Array<unknown>} The ordered values produced by `mountedUserConversationImages`.
   */
  function mountedUserConversationImages(section) {
    if (!(section instanceof HTMLElement) || section.getAttribute('data-turn') !== 'user') return [];
    const images = [];
    const seen = new Set();
    for (const image of section.querySelectorAll(
      'button[aria-label^="Open image:"] img, [class~="group/message-image"] img'
    )) {
      if (!(image instanceof HTMLImageElement) || seen.has(image)) continue;
      const src = image.currentSrc || image.getAttribute('src') || '';
      if (!src) continue;
      seen.add(image);
      images.push(image);
    }
    return images;
  }

  /**
   * Handles internal image pointer protocol.
   *
   * @param {Object} source - The source value to inspect.
   * @returns {string|null} The string produced by `internalImagePointerProtocol`, or `null` when no value is available.
   */
  function internalImagePointerProtocol(source) {
    const value = String(source ?? '').trim().toLowerCase();
    if (value.startsWith('sandbox://')) return 'sandbox';
    if (value.startsWith('sediment://')) return 'sediment';
    return null;
  }

  /**
   * Handles internal image pointer asset key.
   *
   * @param {Object} source - The source value to inspect.
   * @returns {string} The string produced by `internalImagePointerAssetKey`.
   */
  function internalImagePointerAssetKey(source) {
    const value = String(source ?? '').trim();
    const protocol = internalImagePointerProtocol(value);
    if (!protocol) return '';
    return value
      .replace(/^[a-z]+:\/\//i, '')
      .split(/[?#]/, 1)[0]
      .split('/')
      .filter(Boolean)
      .pop() ?? '';
  }

  /**
   * Handles image pointer DOM candidate.
   *
   * @param {Object} image - The image element to inspect.
   * @param {number} ordinal - The ordinal position to process.
   * @returns {Object|null} The value produced by `imagePointerDomCandidate`, or `null` when no value is available.
   */
  function imagePointerDomCandidate(image, ordinal) {
    if (!(image instanceof HTMLImageElement)) return null;
    const button = image.closest('button');
    const anchor = image.closest('a[href]');
    return {
      ordinal,
      src: image.getAttribute('src') || null,
      current_src: image.currentSrc || null,
      alt: image.getAttribute('alt') || null,
      title: image.getAttribute('title') || null,
      button_aria_label: button?.getAttribute('aria-label') || null,
      anchor_href: anchor?.getAttribute('href') || null
    };
  }

  /**
   * Handles image pointer resource evidence.
   *
   * @param {Object} source - The source value to inspect.
   * @param {Object} domCandidate - The domCandidate value required by this function.
   * @returns {Object} The Object value produced by `imagePointerResourceEvidence`.
   */
  function imagePointerResourceEvidence(source, domCandidate) {
    const assetKey = internalImagePointerAssetKey(source);
    // DOM-derived URLs are exact evidence candidates before broader resource heuristics are tried.
    const exactUrls = new Set([
      domCandidate?.src,
      domCandidate?.current_src,
      domCandidate?.anchor_href
    ].filter(Boolean));
    const exact = [];
    const heuristic = [];
    const entries = performance.getEntriesByType('resource').slice(-500);
    for (const entry of entries) {
      if (!(entry instanceof PerformanceResourceTiming)) continue;
      const name = String(entry.name || '');
      const record = {
        url: name,
        initiator_type: entry.initiatorType || null,
        response_status: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
        transfer_size: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
        decoded_body_size: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null
      };
      if (exactUrls.has(name)) {
        exact.push({ ...record, basis: 'dom-url-match' });
        continue;
      }
      if (assetKey && (name.includes(assetKey) || name.includes(encodeURIComponent(assetKey)))) {
        exact.push({ ...record, basis: 'asset-token-match' });
        continue;
      }
      if (['img', 'fetch', 'xmlhttprequest'].includes(entry.initiatorType) && /(?:image|file|asset|download|backend-api)/i.test(name)) {
        heuristic.push({ ...record, basis: 'recent-image-like-resource' });
      }
    }
    return {
      asset_key: assetKey || null,
      exact: exact.slice(-20),
      heuristic: heuristic.slice(-30)
    };
  }

  /**
   * Logs internal image pointer evidence.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {HTMLElement} section - The mounted conversation-turn section.
   * @param {boolean} candidates - Whether candidates is enabled.
   * @returns {void} No value is returned.
   */
  function logInternalImagePointerEvidence(record, section, candidates) {
    const parts = Array.isArray(record?.content?.parts) ? record.content.parts : [];
    let imageOrdinal = 0;
    for (const part of parts) {
      if (!part || typeof part !== 'object' || part.content_type !== 'image_asset_pointer') continue;
      imageOrdinal += 1;
      const source = cgImagePointerSource(part);
      const protocol = internalImagePointerProtocol(source);
      if (!protocol) continue;
      const image = candidates[imageOrdinal - 1] ?? null;
      const domCandidate = imagePointerDomCandidate(image, imageOrdinal);
      logDiagnostic('debug', 'conversation-image-pointer-resolution-evidence', {
        message_id: record.id ?? null,
        turn_id: section?.getAttribute?.('data-turn-id') ?? null,
        image_ordinal: imageOrdinal,
        pointer_protocol: protocol,
        pointer_source: source,
        dom_match_basis: domCandidate ? 'same-turn-image-ordinal' : null,
        dom_candidate: domCandidate,
        mounted_image_count: candidates.length,
        resource_candidates: imagePointerResourceEvidence(source, domCandidate)
      });
    }
  }

  /**
   * Fetches one conversational image source and converts its bytes to a data URL.
   *
   * @param {string} source - Browser-resolvable image source URL or existing data URL.
   * @param {Object|null} timing - Mutable timing/result object populated without storing image payload data.
   * @returns {Promise<string>} A promise resolving to the image data URL.
   */
  async function fetchImageDataUrl(source, timing = null) {
    const startedAt = performance.now();
    const src = String(source ?? '');
    assert(src, 'Conversational image has no source URL.');
    if (timing) {
      timing.stage = 'source';
      timing.outcome = null;
      timing.source_scheme = null;
      timing.http_status = null;