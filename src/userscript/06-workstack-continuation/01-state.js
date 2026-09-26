  // BEGIN Issue #163 WorkStack continuation state
  /** DOM id of the floating WorkStack continuation control. */
  const WORKSTACK_CONTROL_ID = 'tm-workstack-continuation';
  /** Delay before retrying lane recovery while authenticated API context is unavailable. */
  const WORKSTACK_RECOVERY_RETRY_MS = 750;
  /** Maximum time a CONTINUE action waits for an active Agent turn to settle. */
  const WORKSTACK_SETTLE_WAIT_MS = 15000;
  /** Authoritative WorkStack lane and handoff state for the current conversation. */
  const workStackState = {
    conversation_id: null,
    status: 'fetching',
    lane: null,
    detail: '',
    recovery_promise: null,
    handoff_in_progress: false
  };
  /** Pending lane recovery retry timer, or null when no retry is scheduled. */
  let workStackRecoveryTimer = null;

  /**
   * Extracts one explicit WorkStack lane token from the supplied first-User text.
   *
   * @param {string} text - Text of the first User turn only.
   * @returns {string|null} Lane identifier without the `WS:` prefix, or null when absent.
   */
  function workStackLaneFromUserText(text) {
    const match = String(text ?? '').match(
      /^\s*(?:Continue\s+)?WS:([A-Za-z0-9][A-Za-z0-9._-]*)(?=$|[^A-Za-z0-9._-])/
    );
    return match?.[1] ?? null;
  }

  /**
   * Extracts visible text parts from one Conversation API message.
   *
   * @param {Object|null} message - Conversation API message whose visible parts are inspected.
   * @returns {string} Normalized visible text assembled in source order.
   */
  function workStackVisibleMessageText(message) {
    const parts = Array.isArray(message?.content?.parts) ? message.content.parts : [];
    return parts.map(part => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return '';
    }).join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Resolves WorkStack lane state from a complete chronological Conversation API spine.
   *
   * @param {Object} spine - Chronological conversation spine containing source records.
   * @returns {Object} Object with `status` (`fetching`, `bound`, or `unbound`) and lane value.
   */
  function workStackResolveLaneFromSpine(spine) {
    const visibleUsers = (spine?.records ?? []).filter(record =>
      record?.role === 'user' &&
      record?.message?.metadata?.is_visually_hidden_from_conversation !== true
    );
    if (!visibleUsers.length) return { status: 'fetching', lane: null };
    for (const record of visibleUsers) {
      const lane = workStackLaneFromUserText(workStackVisibleMessageText(record.message));
      if (lane) return { status: 'bound', lane };
    }
    return { status: 'unbound', lane: null };
  }

  /**
   * Reports whether one DOM-only marker is merely a transient lifecycle/error placeholder.
   *
   * @param {Object} marker - Live-tail marker being considered for continuation recovery.
   * @returns {boolean} True only for short known thinking/retry/timeout placeholder text.
   */
  function workStackLifecycleOnlyMarker(marker) {
    if (marker?.message_id) return false;
    const text = String(marker?.comparison_text ?? '').trim();
    if (!text || text.length > 300) return false;
    return /^thinking(?:…|\.\.\.|\s*)$/i.test(text) ||
      /message delivery timed out|timed out\. please try again/i.test(text) ||
      /something went wrong|please try again|\bretry\b|connection interrupted/i.test(text);
  }

  /**
   * Reports whether a persisted Assistant record explicitly carries a failed terminal status.
   *
   * @param {Object} record - Chronological Assistant source record from the reconciled spine.
   * @returns {boolean} True when status metadata explicitly denotes failure/interruption.
   */
  function workStackAssistantRecordFailed(record) {
    const status = String(record?.message?.status ?? '').toLowerCase();
    const finishType = String(record?.message?.metadata?.finish_details?.type ?? '').toLowerCase();
    return /error|fail|cancel|timeout|interrupt/.test(status) ||
      /error|fail|cancel|timeout|interrupt/.test(finishType);
  }

  /**
   * Selects recent Assistant live-tail markers whose normal persisted API content is missing or stale.
   *
   * @param {Array<Object>} markers - Frozen chronological live-tail markers, bounded by the ten-marker high-water limit.
   * @param {Object} spine - Reconciled chronological Conversation API spine.
   * @returns {Array<Object>} Missing/incomplete Assistant markers in original oldest-to-youngest order.
   */
  function workStackMissingAssistantMarkers(markers, spine) {
    const records = Array.isArray(spine?.records) ? spine.records : [];
    const result = [];
    for (const marker of Array.isArray(markers) ? markers : []) {
      if (marker?.role !== 'assistant' || workStackLifecycleOnlyMarker(marker)) continue;
      if (!marker.message_id) {
        result.push(marker);
        continue;
      }
      const record = records.find(item =>
        item?.role === 'assistant' && item?.message_id === marker.message_id
      ) ?? null;
      if (!record || workStackAssistantRecordFailed(record)) {
        result.push(marker);
        continue;
      }
      const apiText = workStackVisibleMessageText(record.message);
      const liveText = String(marker.comparison_text ?? '').replace(/\s+/g, ' ').trim();
      if (liveText && !apiText) {
        result.push(marker);
        continue;
      }
      if (apiText && liveText.startsWith(apiText) && liveText.length > apiText.length + 16) {
        result.push(marker);
      }
    }
    return result;
  }

  /**
   * Chooses DOM recovery markers after first checking the persisted tail for actual failures.
   *
   * Missing/stale turns win. When persistence is complete, the newest usable Assistant
   * marker is retained so the original #163 direct-last-reply handoff remains available.
   *
   * @param {Array<Object>} markers - Frozen chronological live-tail markers.
   * @param {Object} spine - Reconciled chronological Conversation API spine.
   * @returns {Array<Object>} Recovery markers in conversation chronology.
   */
  function workStackRecoveryAssistantMarkers(markers, spine) {
    const missing = workStackMissingAssistantMarkers(markers, spine);
    if (missing.length) return missing;
    const assistants = (Array.isArray(markers) ? markers : [])
      .filter(marker => marker?.role === 'assistant' && !workStackLifecycleOnlyMarker(marker));
    return assistants.length ? [assistants.at(-1)] : [];
  }

  /**
   * Correlates failed/missing live-tail markers to frozen mounted DOM candidates by strongest exact identity.
   *
   * @param {Array<Object>} missingMarkers - Chronological failed/missing Assistant markers.
   * @param {Array<Object>} candidates - Frozen mounted Assistant DOM candidate descriptors.
   * @returns {Array<Object>} Exactly one correlated candidate per marker, preserving marker chronology.
   */
  function workStackCorrelateTailCandidates(missingMarkers, candidates) {
    const pool = Array.isArray(candidates) ? candidates : [];
    return (Array.isArray(missingMarkers) ? missingMarkers : []).map(marker => {
      let matches = [];
      let identity = 'none';
      if (marker?.message_id) {
        identity = 'message_id';
        matches = pool.filter(candidate => candidate?.message_id === marker.message_id);
      } else if (marker?.dom_turn_id) {
        identity = 'dom_turn_id';
        matches = pool.filter(candidate => candidate?.dom_turn_id === marker.dom_turn_id);
      } else if (marker?.container_id) {
        identity = 'container_id';
        matches = pool.filter(candidate => candidate?.container_id === marker.container_id);
      } else if (marker?.content_fingerprint) {
        identity = 'content_fingerprint';
        matches = pool.filter(candidate => candidate?.content_fingerprint === marker.content_fingerprint);
      }
      const value = marker?.message_id ?? marker?.dom_turn_id ?? marker?.container_id ?? 'unknown';
      if (matches.length === 0) {
        throw new Error(`WorkStack handoff correlation failed for ${identity} ${value}.`);
      }
      if (matches.length !== 1) {
        throw new Error(`WorkStack handoff correlation is ambiguous for ${identity} ${value}.`);
      }
      return matches[0];
    });
  }

  /**
   * Builds the exact clipboard fragment used to seed the continuation conversation.
   *
   * @param {string} lane - Already-bound WorkStack lane identifier.
   * @param {Array<string>} recoveredBlocks - Recovered Assistant Markdown blocks in chronological order.
   * @returns {string} Clipboard fragment ending with the required trailing separator and blank line.
   */
  function workStackContinuationPacket(lane, recoveredBlocks) {
    const blocks = (Array.isArray(recoveredBlocks) ? recoveredBlocks : [])
      .filter(block => typeof block === 'string' && block.trim())
      .map(block => block.trim());
    return `Continue WS:${lane}\n\n---\n\n${blocks.join('\n\n')}\n\n---\n\n`;
  }

  /**
   * Builds the browser URL for a lane's WorkStack continuation file.
   *
   * @param {string} lane - Already-bound WorkStack lane identifier.
   * @returns {string} GitHub URL opened with the user's existing browser authentication.
   */
  function workStackLaneContinueUrl(lane) {
    return `https://github.com/Ma-XX-oN/WorkStack/blob/main/parallel/lanes/${encodeURIComponent(lane)}/CONTINUE.md`;
  }

  /**
   * Resolves the same-Project ChatGPT landing URL from the current conversation URL.
   *
   * @param {string} href - Current ChatGPT URL.
   * @returns {string|null} Same-Project landing URL, or null when the current chat is not in a recognized Project.
   */
  function workStackProjectNewChatUrl(href) {
    try {
      const parsed = new URL(href);
      const match = parsed.pathname.match(/^\/g\/(g-p-[^/]+)(?:\/project|\/c\/[^/]+)(?:\/|$)/);
      return match ? `${parsed.origin}/g/${match[1]}/project` : null;
    } catch {
      return null;
    }
  }

  /**
   * Schedules another lane recovery attempt without allowing duplicate retry timers.
   *
   * @param {number} delayMs - Delay in milliseconds before the retry.
   * @returns {void} No value is returned.
   */
  function workStackScheduleRecovery(delayMs = WORKSTACK_RECOVERY_RETRY_MS) {
    if (workStackRecoveryTimer !== null) return;
    workStackRecoveryTimer = setTimeout(() => {
      workStackRecoveryTimer = null;
      void recoverWorkStackLane();
    }, delayMs);
  }

  /**
   * Resets lane state when SPA navigation changes the active conversation identity.
   *
   * @param {string|null} conversationId - Current conversation identifier.
   * @returns {void} No value is returned.
   */
  function workStackObserveConversation(conversationId) {
    const normalized = typeof conversationId === 'string' && conversationId ? conversationId : null;
    if (workStackState.conversation_id === normalized) return;
    workStackState.conversation_id = normalized;
    workStackState.status = 'fetching';
    workStackState.lane = null;
    workStackState.detail = '';
    workStackState.recovery_promise = null;
    if (workStackRecoveryTimer !== null) {
      clearTimeout(workStackRecoveryTimer);
      workStackRecoveryTimer = null;
    }
    workStackRender();
  }

  /**
   * Recovers the WorkStack lane from complete Conversation API history and updates authoritative lane state.
   *
   * @returns {Promise<void>} Resolves after the current recovery attempt completes or is deferred.
   */
  async function recoverWorkStackLane() {
    const conversationId = currentConversationId();
    workStackObserveConversation(conversationId);
    if (!conversationId) return;
    if (workStackState.status === 'bound' || workStackState.status === 'unbound') return;
    if (workStackState.recovery_promise) return workStackState.recovery_promise;
    if (apiRequestContext?.conversation_id !== conversationId) {
      workStackScheduleRecovery();
      return;
    }
    workStackState.recovery_promise = (async () => {
      try {
        const fetched = await fetchConversationPages(conversationId);
        if (currentConversationId() !== conversationId) return;
        const resolved = workStackResolveLaneFromSpine(conversationSpineFromPages(fetched.pages));
        workStackState.status = resolved.status;
        workStackState.lane = resolved.lane;
        workStackState.detail = '';
        if (resolved.status === 'fetching') workStackScheduleRecovery();
      } catch (error) {
        workStackState.status = 'fetching';
        workStackState.detail = `Lane recovery waiting: ${errorMessage(error)}`;
        workStackScheduleRecovery(1500);
      } finally {
        workStackState.recovery_promise = null;
        workStackRender();
      }
    })();
    return workStackState.recovery_promise;
  }
  // END Issue #163 WorkStack continuation state
