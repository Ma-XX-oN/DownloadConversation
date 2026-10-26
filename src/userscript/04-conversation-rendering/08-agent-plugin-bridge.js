  /** Provider agent obtained from the authoritative AICC registration inventory. */
  let chatGPTAgent = null;
  /** Core-owned canonical session associated with the selected agent. */
  let chatGPTCanonicalSession = null;
  /** Private provider-owned subject host leased through the registered agent. */
  let chatGPTSubjectHost = null;

  /**
   * Recognizes the current source through AICC and creates its registered agent.
   * Missing registration fails immediately; a later operation can retry normally.
   * @returns {Promise<Object>} Validated agent with its Core-owned session retained.
   */
  async function ensureChatGPTCanonicalAgent() {
    if (chatGPTAgent) {
      if (typeof aicc127AttachAgentEarly === 'function') aicc127AttachAgentEarly(chatGPTAgent);
      reconnectChatGPTSubjectHost();
      return chatGPTAgent;
    }
    const core = canonicalCore();
    assert(typeof core.recognizeAgentPlugin === 'function'
      && typeof core.createAgent === 'function',
    'AIConversationCore registration API is unavailable.');
    const descriptor = core.recognizeAgentPlugin({
      provider: 'chatgpt',
      url: typeof location === 'object' ? location.href : ''
    });
    assert(descriptor, 'No AICC-registered provider recognizes this conversation.');
    const loaded = core.createAgent(descriptor.id, {
      conversationId: typeof currentConversationId === 'function'
        ? currentConversationId() : null
    });
    assert(loaded?.agent && loaded?.session,
      'AIConversationCore did not create the provider agent and canonical session.');
    const identity = loaded.agent.version();
    chatGPTAgent = loaded.agent;
    chatGPTCanonicalSession = loaded.session;
    // #297's observer must be armed BEFORE the #310 backlog attaches/drains.
    if (typeof aicc127AttachAgentEarly === 'function') aicc127AttachAgentEarly(chatGPTAgent);
    reconnectChatGPTSubjectHost();
    logDiagnostic('debug', 'agent-plugin-ready', {
      plugin_id: identity?.plugin ?? 'unknown',
      ref: identity?.ref ?? 'unknown',
      version: identity?.version ?? 'unknown',
      api_version: identity?.apiVersion ?? null
    });
    return chatGPTAgent;
  }

  /**
   * Connect one existing CSC backlog to the private host on the actual
   * AICC-registered ChatGPT agent; never import private code from public DC.
   * @returns {void} No value is returned.
   */
  function reconnectChatGPTSubjectHost() {
    if (chatGPTSubjectHost || !chatGPTAgent) return;
    if (typeof chatGPTAgent.connectChatGPTSubjectHost !== 'function') {
      logDiagnostic('warnings', 'agent-plugin-navigation-interface-unavailable', {
        reason: 'Registered provider does not expose subject host'
      });
      return;
    }
    const host = chatGPTAgent.connectChatGPTSubjectHost({
      origin: agentPluginPageWindow.location.origin,
      conversationId: null
    });
    if (!host || ['navigation', 'request', 'response', 'dispose'].some(
      name => typeof host[name] !== 'function')) {
      host?.dispose?.();
      throw new TypeError('Registered provider returned invalid subject host');
    }
    try {
      cscEnsureEarlyNavigationIngress();
      cscPluginQueueConnect(host);
    } catch (error) {
      cscPluginQueueDisconnect(host);
      host.dispose();
      throw error;
    }
    chatGPTSubjectHost = host;
  }

  /**
   * Detach the queue before disposal, invalidating pending asynchronous drain.
   * @returns {void} No value is returned.
   */
  function disconnectChatGPTSubjectHost() {
    cscDisposeEarlyNavigationIngress();
    if (chatGPTSubjectHost) {
      cscPluginQueueDisconnect(chatGPTSubjectHost);
      chatGPTSubjectHost.dispose();
    }
    chatGPTSubjectHost = null;
  }

  /**
   * Publishes one complete persisted ChatGPT record inventory through the registered
   * provider agent and returns Core-owned canonical events.
   *
   * @param {Array<Object>} records - Complete provider/source record inventory.
   * @returns {Array<Object>} Core-owned canonical events.
   */
  function canonicalEventsFromChatGPTAgent(records) {
    assert(chatGPTAgent && chatGPTCanonicalSession,
      'ChatGPT agent plugin must be ready before canonical record projection.');
    chatGPTAgent.commTraffic({ type: 'persisted_records', records });
    const events = chatGPTCanonicalSession.events;
    assert(Array.isArray(events), 'AIConversationCore canonical session did not expose canonical events.');
    return events;
  }

  /**
   * Production canonicalization strategy for DownloadConversation ChatGPT records.
   *
   * @param {Array<Object>} records - Ordered provider/source records.
   * @param {Map<unknown, unknown>} recoveredImageMap - Recovered images keyed by source record id.
   * @returns {Map<unknown, unknown>} Canonical events keyed by source record id.
   */
  canonicalEventsBySourceRecord = function canonicalEventsBySourceRecordViaAgent(
    records, recoveredImageMap = new Map()
  ) {
    const conversationId = typeof currentConversationId === 'function' ? currentConversationId() : null;
    const hasMetadata = records.some(record => record?.record_type === 'chatgpt_conversation_metadata');
    const providerRecords = conversationId && !hasMetadata
      ? [{
          record_type: 'chatgpt_conversation_metadata',
          schema_version: 1,
          conversation_id: conversationId
        }, ...records]
      : records;
    const events = canonicalEventsFromChatGPTAgent(providerRecords);
    const bySourceRecord = new Map();
    for (const event of events) {
      const sourceIndex = event?.source_index;
      const sourceRecordId = event?.source_record_id;
      if (!Number.isInteger(sourceIndex) || typeof sourceRecordId !== 'string' || !sourceRecordId) continue;
      const original = providerRecords[sourceIndex];
      if (!original) continue;
      assert(original?.id === sourceRecordId,
        `ChatGPT plugin source record mismatch at JSONL index ${sourceIndex}.`);
      assert(event?.source?.record_id === sourceRecordId,
        `AIConversationCore did not preserve source record ID ${sourceRecordId}.`);
      assert(event?.source?.record_index === sourceIndex,
        `AIConversationCore did not preserve source record index ${sourceIndex}.`);
      assert(event?.source?.turn_id === sourceRecordId,
        `AIConversationCore source turn identity differs from record ${sourceRecordId}.`);
      assert(event?.source?.create_time === (original?.create_time ?? null),
        `AIConversationCore did not preserve create_time for ${sourceRecordId}.`);
      assert(event?.source?.update_time === (original?.update_time ?? null),
        `AIConversationCore did not preserve update_time for ${sourceRecordId}.`);
      bySourceRecord.set(sourceRecordId, canonicalEnrichRecoveredImages(
        event, recoveredImageMap.get(sourceRecordId) ?? []));
    }
    return bySourceRecord;
  };

  /**
   * Production canonical image-resource lookup through the same registered agent/session.
   *
   * @param {Array<Object>} records - Exact ordered provider/source record set.
   * @returns {Map<string, Map<number, Object>>} Canonical image resources by record and part index.
   */
  canonicalImageResourcesByRecordAndPart = function canonicalImageResourcesViaAgent(records) {
    assert(Array.isArray(records), 'Canonical image-resource lookup requires the ordered source record set.');
    const events = canonicalEventsFromChatGPTAgent(records);
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
  };
