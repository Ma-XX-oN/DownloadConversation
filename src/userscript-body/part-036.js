        const section = mountedTurnSection(record.id, 'user');
        const candidates = section instanceof HTMLElement ? mountedUserConversationImages(section) : [];
        if (section instanceof HTMLElement) logInternalImagePointerEvidence(record, section, candidates);
        for (let index = 0; index < expected; index += 1) {
          const partIndex = imagePartIndexes[index];
          const resource = canonicalResources.get(partIndex) ?? null;
          const sourcePointer = cgImagePointerSource(expectedParts[index]);
          const isSediment = internalImagePointerProtocol(sourcePointer) === 'sediment';
          const hasCanonicalTransport = typeof resource?.download_url === 'string' && resource.download_url.trim();
          const hasCanonicalData = typeof resource?.data_url === 'string' && resource.data_url.startsWith('data:image/');
          if (isSediment && !hasCanonicalTransport && !hasCanonicalData) {
            logDiagnostic('errors', 'conversation-image-core-resource-missing', {
              script_version: VERSION,
              message_id: record.id,
              image_ordinal: index + 1,
              part_index: partIndex,
              resource_present: Boolean(resource),
              source_scheme: 'sediment:'
            });
            throw new Error(
              `AIConversationCore did not provide a download_url or data_url for sediment image ${record.id}:${index + 1}.`
            );
          }
          if (hasCanonicalTransport || hasCanonicalData) {
            images[index] = await recoverOne(
              timing => cgResolveImagePointerMarkdown(expectedParts[index], resource, record.id, index + 1, timing),
              {
                image_number: recordImageBase + index + 1,
                message_id: record.id,
                image_ordinal: index + 1,
                path: hasCanonicalData ? 'core-data' : 'core-download'
              }
            );
            continue;
          }
          if (candidates[index] instanceof HTMLImageElement) {
            try {
              const dataUrl = await recoverOne(
                timing => imageElementDataUrl(candidates[index], timing),
                {
                  image_number: recordImageBase + index + 1,
                  message_id: record.id,
                  image_ordinal: index + 1,
                  path: 'dom'
                }
              );
              if (dataUrl) images[index] = `![image-${record.id}-${index + 1}](${dataUrl})`;
              continue;
            } catch (error) {
              const status = Number(error?.httpStatus);
              const source = candidates[index]?.currentSrc || candidates[index]?.getAttribute('src') ||
                cgImagePointerSource(expectedParts[index]);
              images[index] = cgImageFailureMarkdown(source, status);
              logDiagnostic('warnings', 'conversation-image-recovery-failure', {
                message_id: record.id,
                image_ordinal: index + 1,
                http_status: Number.isFinite(status) ? status : null,
                fallback: images[index],
                message: errorMessage(error)
              });
              continue;
            }
          }
          images[index] = await recoverOne(
            timing => cgResolveImagePointerMarkdown(expectedParts[index], resource, record.id, index + 1, timing),
            {
              image_number: recordImageBase + index + 1,
              message_id: record.id,
              image_ordinal: index + 1,
              path: 'pointer'
            }
          );
        }
        recovered.set(record.id, images);
        imageBase += expected;
        recoveredImages = Math.max(recoveredImages, imageBase);
        if (progressState) progressState.image_completed = recoveredImages;
        refreshStatus();
      }
      recoveryCompleted = true;
    } finally {
      scrollRoot.scrollTop = originalScrollTop;
      logDiagnostic('debug', 'conversation-image-recovery-complete', {
        script_version: VERSION,
        outcome: recoveryCompleted ? 'complete' : 'aborted',
        source_message_count: records.length,
        total_images: totalImages,
        completed_images: recoveredImages,
        failed_images: failedImages,
        unavailable_images: unavailableImages,
        blob_bytes: totalBlobBytes,
        data_url_chars: totalDataUrlChars,
        elapsed_ms: Math.round(performance.now() - recoveryStartedAt)
      });
    }
    return recovered;
  }

  /**
   * Acquires one Conversation API snapshot and generates every selected export from that same spine.
   *
   * @param {Array<'jsonl'|'md'>} kinds - Selected output formats; JSONL is generated before Markdown when both are selected.
   * @returns {Promise<void>} Resolves after selected exports finish or their failure is reported and export state is released.
   */
  async function runExport(kinds) {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    assert(Array.isArray(kinds) && kinds.length > 0, 'At least one export format must be selected.');
    /** Deduplicated output formats executed from one authoritative Conversation API snapshot. */
    const requestedKinds = [...new Set(kinds)];
    assert(requestedKinds.every(kind => kind === 'jsonl' || kind === 'md'), 'Unsupported export format selected.');
    /** Format currently being serialized, used by shared status and failure reporting. */
    let activeKind = requestedKinds[0];
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    scanLiveTailMarkers('export-freeze');
    /** Frozen high-water evidence for this export; later UI activity cannot change its oracle. */
    const frozenLiveTailMarkers = snapshotLiveTailMarkers();
    /** Tail-consistency warnings accumulated without changing the authoritative export source. */
    const tailConsistencyWarnings = [];
    exportInProgress = true;
    exportKind = activeKind;
    progressState = {
      started_at: performance.now(),
      stage: 'fetching',
      page_count: 0,
      raw_record_count: 0,
      record_number: 0,
      record_count: 0,
      render_started_at: 0
    };
    startStatusTimer();
    updateUi();
    await acquireWakeLock();
    try {
      /**
       * Fetches ed.
       */
      const fetched = await fetchConversationPages(conversationId, progress => {
        progressState.stage = 'fetching';
        progressState.page_count = progress.page_count;
        progressState.raw_record_count = progress.raw_record_count;
        progressState.fetch_page_number = progress.page_number;
        progressState.fetch_page_started_at = progress.page_started_at;
        refreshStatus();
      });
      const historySpine = conversationSpineFromPages(fetched.pages);
      const currentStreamCapture = streamTailCapture?.conversation_id === conversationId
        ? streamTailCapture
        : streamTailRestoreCapture(conversationId);
      const streamMerge = mergeStreamTailCaptureIntoSpine(
        historySpine, streamTailCaptureSnapshot(currentStreamCapture)
      );
      const spine = streamMerge.spine;
      logDiagnostic(streamMerge.merged ? 'debug' : 'verbose',
        'conversation-stream-tail-reconciliation', {
          reason: streamMerge.reason,
          merged: streamMerge.merged,
          appended_count: streamMerge.appended_count,
          replaced_count: streamMerge.replaced_count,
          anchor_message_id: streamMerge.anchor_message_id ?? null,
          history_record_count: historySpine.records.length,
          reconciled_record_count: spine.records.length
        });
      const liveApiTailComparison = compareLiveTailMarkersToSpine(frozenLiveTailMarkers, spine);
      logDiagnostic(liveApiTailComparison.warning ? 'warnings' : 'debug',
        'conversation-tail-live-api-consistency', liveApiTailComparison);
      const liveApiWarning = liveApiTailWarningText(liveApiTailComparison);
      if (liveApiWarning) tailConsistencyWarnings.push(liveApiWarning);
      if (requestedKinds.includes('jsonl')) {
        activeKind = 'jsonl';
        exportKind = activeKind;
        const filename = `${sanitizeFileName(conversationTitle())}.jsonl`;
        const jsonl = apiRecordsJsonl(spine, conversationId);
        const jsonlTailComparison = compareLiveTailMarkersToJsonl(frozenLiveTailMarkers, spine, jsonl);
        logDiagnostic(jsonlTailComparison.warning ? 'warnings' : 'debug',
          'conversation-tail-api-jsonl-consistency', jsonlTailComparison);
        const jsonlWarning = jsonlTailWarningText(jsonlTailComparison);
        if (jsonlWarning) tailConsistencyWarnings.push(jsonlWarning);
        downloadBlob(
          new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' }),
          filename
        );
        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);
      }
      if (requestedKinds.includes('md')) {
        activeKind = 'md';
        exportKind = activeKind;
        progressState.stage = 'recovering-images';
        const recoveredImageMap = await recoverUserImages(spine);
        progressState.stage = 'rendering';
        progressState.render_started_at = performance.now();
        progressState.record_number = 0;
        progressState.record_count = spine.records.length;
        refreshStatus();
        // Yield once so the completed image state is painted before synchronous rendering begins.
        await new Promise(resolve => setTimeout(resolve, 0));
        /**
         * Handles markdown.
         */
        /** Monotonic start time for synchronous Markdown rendering/final assembly. */
        const renderStartedAt = performance.now();
        logDiagnostic('debug', 'conversation-export-phase-start', {
          phase: 'markdown-render',
          source_record_count: spine.records.length
        });
        const markdown = renderConversationMarkdown(spine, progress => {
          progressState.stage = 'rendering';
          progressState.record_number = progress.record_number;
          progressState.record_count = progress.record_count;
          refreshStatus();
        }, recoveredImageMap);
        const filename = `${sanitizeFileName(conversationTitle())}.md`;
        logDiagnostic('debug', 'conversation-export-phase-complete', {
          phase: 'markdown-render',
          elapsed_ms: Math.round(performance.now() - renderStartedAt),
          markdown_length: markdown.length
        });
        if (diagnosticEnabled('debug')) {
          const sourceTail = spine.records.slice(-32).map(item => ({
            source_record_id: item?.message_id ?? item?.message?.id ?? null,
            source_role: item?.role ?? item?.message?.author?.role ?? null,
            source_channel: item?.channel ?? item?.message?.channel ?? null,
            source_content_type: item?.content_type ?? item?.message?.content?.content_type ?? null
          }));
          logDiagnostic('debug', 'conversation-export-markdown-ready', {
            filename,
            source_record_count: spine.records.length,
            source_tail: sourceTail,
            markdown_length: markdown.length
          });
        }
        const blobStartedAt = performance.now();
        logDiagnostic('debug', 'conversation-export-phase-start', {
          phase: 'blob-create',
          markdown_length: markdown.length
        });
        const markdownBlob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        logDiagnostic('debug', 'conversation-export-phase-complete', {
          phase: 'blob-create',
          elapsed_ms: Math.round(performance.now() - blobStartedAt),
          blob_size: markdownBlob.size
        });
        if (diagnosticEnabled('debug')) {
          logDiagnostic('debug', 'conversation-export-blob-created', {
            filename,
