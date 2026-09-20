          }
          if (canonicalSegmentEligible) {
            logDiagnostic('debug', 'conversation-markdown-segment-render-request', {
              source_record_ids: segmentRecords.map(item => item?.id ?? null),
              final_source_record_id: record?.id ?? null,
              event_kinds: segmentEvents.map(event => event?.kind ?? null),
              output_index_before_append: output.length
            });
            const renderedSegment = canonicalAssistantSegmentBlock(segmentRecords, segmentEvents);
            output.push(renderedSegment);
            if (diagnosticEnabled('debug')) {
              logDiagnostic('debug', 'conversation-markdown-block-appended', {
                route: 'canonical-assistant-segment',
                output_index: output.length - 1,
                source_record_ids: segmentRecords.map(item => item?.id ?? null),
                final_source_record_id: record?.id ?? null,
                block_length: renderedSegment.length
              });
            }
            pendingThoughts = [];
            continue;
          }
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length === 0) {
          output.push(canonicalRecordBlock(record, canonicalEvent));
          continue;
        }
      }

      if (canonicalEvent && canonicalThoughtRecordEligible(record, canonicalEvent)) {
        pendingThoughts.push(record);
        continue;
      }

      const userText = cgVisibleUserText(record, fileRefIndex, recoveredImages);
      if (userText) {
        flushPendingAssistant();
        output.push(`${transcriptHeading(record, canonicalEvent)}\n\n${quoteMarkdown(userText)}`);
        continue;
      }
      const assistantText = cgVisibleAssistantMarkdown(record, fileRefIndex, recoveredImages);
      if (assistantText) {
        flushAssistantBlock(assistantText, record);
        continue;
      }
      const fallbackThought = cgRenderThoughtItem(record, fileRefIndex);
      if (fallbackThought) {
        pendingThoughts.push(record);
        continue;
      }
      if (diagnosticEnabled('debug') && i >= Math.max(0, records.length - 32)) {
        logDiagnostic('debug', 'conversation-markdown-record-excluded', {
          source_index: i,
          source_record_id: record?.id ?? null,
          source_role: record?.author?.role ?? null,
          source_recipient: record?.recipient ?? null,
          source_channel: record?.channel ?? null,
          source_content_type: record?.content?.content_type ?? null,
          event_kind: canonicalEvent?.kind ?? null,
          event_visibility: canonicalEvent?.visibility ?? null,
          reason: 'no-canonical-or-fallback-renderer-produced-output'
        });
      }
    }
    flushPendingAssistant();
    const markdown = `${output.join('\n\n')}\n`;
    if (diagnosticEnabled('debug')) {
      logDiagnostic('debug', 'conversation-markdown-assembled', {
        source_record_count: records.length,
        output_block_count: output.length,
        markdown_length: markdown.length,
        source_tail: records.slice(-32).map((record, offset) => ({
          source_index: records.length - Math.min(32, records.length) + offset,
          source_record_id: record?.id ?? null,
          source_role: record?.author?.role ?? null,
          source_recipient: record?.recipient ?? null,
          source_channel: record?.channel ?? null,
          source_content_type: record?.content?.content_type ?? null
        }))
      });
    }
    return markdown;
  }

  /**
   * Builds the DownloadConversation metadata record prepended to a JSONL export.
   *
   * @param {string} conversationId - The Conversation API conversation identifier.
   * @returns {Object} The Object value produced by `conversationMetadataJsonlRecord`.
   */
  function conversationMetadataJsonlRecord(conversationId) {
    assert(typeof conversationId === 'string' && conversationId.trim(), 'Conversation ID is required for JSONL export metadata.');
    return {
      record_type: 'chatgpt_conversation_metadata',
      schema_version: 1,
      conversation_id: conversationId.trim()
    };
  }

  /**
   * Handles api records jsonl.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @param {string} conversationId - The Conversation API conversation identifier.
   * @returns {string} The string produced by `apiRecordsJsonl`.
   */
  function apiRecordsJsonl(spine, conversationId = currentConversationId()) {
    const metadata = conversationMetadataJsonlRecord(conversationId);
    /**
     * Handles records.
     */
    const records = [metadata, ...spine.records.map(record => record.message)];
    return `${records.map(record => JSON.stringify(record)).join('\n')}\n`;
  }

  /**
   * Handles progress status.
   *
   * @param {Object} prefix - The status text prefix.
   * @returns {string} The string produced by `progressStatus`.
   */
  function progressStatus(prefix) {
    if (!progressState) return statusText;
    const now = performance.now();
    const elapsed = now - progressState.started_at;
    const stage = progressState.stage;

    if (stage === 'fetching') {
      const pageNumber = Number(progressState.fetch_page_number) || (Number(progressState.page_count) || 0) + 1;
      const pageElapsed = progressState.fetch_page_started_at > 0
        ? Math.max(0, now - progressState.fetch_page_started_at)
        : 0;
      return `${prefix}: fetching API page ${pageNumber}…\
Completed: ${progressState.page_count} page(s), ${progressState.raw_record_count} raw record(s)\
Page elapsed: ${formatDuration(pageElapsed)} — Total elapsed: ${formatDuration(elapsed)}`;
    }
    if (stage === 'recovering-images') {
      const imageCount = Number(progressState.image_count) || 0;
      const imageNumber = Number(progressState.image_number) || 0;
      const imageCompleted = Number(progressState.image_completed) || 0;
      const imageElapsed = progressState.image_started_at > 0
        ? Math.max(0, now - progressState.image_started_at)
        : 0;
      const path = progressState.image_path ? ` (${progressState.image_path})` : '';
      return `${prefix}: recovering image ${imageNumber}/${imageCount}${path}…\
Image elapsed: ${formatDuration(imageElapsed)} — Completed: ${imageCompleted}/${imageCount} — Total elapsed: ${formatDuration(elapsed)}`;
    }
    if (stage === 'rendering') {
      let eta = 'calculating…';
      if (progressState.record_number > 0 && progressState.record_count > progressState.record_number) {
        const renderElapsed = Math.max(0, now - progressState.render_started_at);
        eta = formatDuration(
          (renderElapsed / progressState.record_number) *
          (progressState.record_count - progressState.record_number)
        );
      } else if (progressState.record_number === progressState.record_count) {
        eta = '0s';
      }
      return `${prefix}: rendering API record ${progressState.record_number}/${progressState.record_count}…\nElapsed: ${formatDuration(elapsed)} — ETA: ${eta}`;
    }
    return statusText;
  }

  /**
   * Returns the communication-log controls from the static recorder panel DOM.
   *
   * @param {Element|null} panel - Recorder panel root, or null to look it up by stable id.
   * @returns {Object} Current filename viewport/text and file-action button elements.
   */
  function communicationLogPanelControls(panel = document.getElementById(PANEL_ID)) {
    const root = panel instanceof Element ? panel : null;
    return {
      communicationLogNameViewport: root?.querySelector('[data-role="communication-log-name-viewport"]') ?? null,
      communicationLogNameText: root?.querySelector('[data-role="communication-log-name"]') ?? null,
      renameCommunicationLogButton: root?.querySelector('[data-role="rename-communication-log"]') ?? null,
      duplicateCommunicationLogButton: root?.querySelector('[data-role="duplicate-communication-log"]') ?? null,
      resetCommunicationLogButton: root?.querySelector('[data-role="reset-communication-log"]') ?? null
    };
  }

  /**
   * Runs one communication-log panel action with shared busy, accessibility, and failure handling.
   *
   * @param {HTMLButtonElement|null} button - Action button that owns busy presentation.
   * @param {Object} options - Labels, operation callback, success callback, and failure prefix.
   * @returns {Promise<void>} Resolves after the action and shared UI state are complete.
   */
  async function runCommunicationLogPanelAction(button, options) {
    if (!(button instanceof HTMLButtonElement) || button.disabled || communicationLogUiActionInProgress) return;
    communicationLogUiActionInProgress = true;
    button.setAttribute('aria-label', options.busyLabel);
    button.title = options.busyTitle;
    refreshStatus();
    try {
      const result = await options.operation();
      if (typeof options.onSuccess === 'function') await options.onSuccess(result);
    } catch (error) {
      setStatus(`⚠ ${options.failurePrefix}: ${errorMessage(error)}`);
    } finally {
      communicationLogUiActionInProgress = false;
      button.setAttribute('aria-label', options.idleLabel);
      button.title = options.idleTitle ?? options.idleLabel;
      refreshStatus();
    }
  }

  /**
   * Measures the active communication-log filename and sets its hover-scroll distance.
   *
   * @returns {void} No value is returned.
   */
  function refreshCommunicationLogNameOverflow() {
    const { communicationLogNameViewport, communicationLogNameText } = communicationLogPanelControls();
    if (!communicationLogNameViewport || !communicationLogNameText) return;
    const overflow = Math.max(0, communicationLogNameText.scrollWidth - communicationLogNameViewport.clientWidth);
    communicationLogNameText.style.setProperty('--tm-log-name-overflow', `${overflow}px`);
    communicationLogNameText.style.setProperty('--tm-log-name-duration', overflow > 0 ? `${Math.max(1.5, overflow / 40)}s` : '0s');
  }

  /**
   * Refreshes status.
   *
   * @returns {void} No value is returned.
   */
  function refreshStatus() {
    const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
    if (!status) return;
    const {
      communicationLogNameViewport,
      communicationLogNameText,
      renameCommunicationLogButton,
      duplicateCommunicationLogButton,
      resetCommunicationLogButton
    } = communicationLogPanelControls();
    const communicationLogAvailable = Boolean(communicationLogReady && communicationLogFileName);
    const communicationLogDisplayName = communicationLogAvailable ? communicationLogFileName : 'Not configured';
    if (communicationLogNameText) communicationLogNameText.textContent = communicationLogDisplayName;
    if (communicationLogNameViewport) {
      communicationLogNameViewport.title = communicationLogDisplayName;
      communicationLogNameViewport.setAttribute(
        'aria-label',
        communicationLogAvailable
          ? `Current communication log filename: ${communicationLogFileName}`
          : 'Current communication log filename: not configured'
      );