  /** Provider agent obtained from the authoritative AICC registration inventory. */
  let chatGPTAgent = null;
  /** Core-owned canonical session associated with the selected agent. */
  let chatGPTCanonicalSession = null;

  /**
   * Recognizes the current source through AICC and creates its registered agent.
   * Missing registration fails immediately; a later operation can retry normally.
   * @returns {Promise<Object>} Validated agent with its Core-owned session retained.
   */
  async function ensureChatGPTCanonicalAgent() {
    if (chatGPTAgent) return chatGPTAgent;
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
    if (typeof nativeReceiptFlush === 'function') nativeReceiptFlush();
    // The new registered-agent API exposes activity directly on public Core.
    if (typeof core.activityState === 'function' &&
        typeof core.observeActivity === 'function') {
      agentTimingBindActivityObserver(core, chatGPTAgent);
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pagehide', agentTimingUnbindActivityObserver, { once: true });
      }
    } else {
      logDiagnostic('warnings', 'aicc-last-activity-v1-unavailable', {
        reason: 'registered Core retained activity API unavailable'
      });
    }
    logDiagnostic('debug', 'agent-plugin-ready', {
      plugin_id: identity?.plugin ?? 'unknown',
      ref: identity?.ref ?? 'unknown',
      version: identity?.version ?? 'unknown',
      api_version: identity?.apiVersion ?? null
    });
    return chatGPTAgent;
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

  /** Unsubscribe from provider registration notifications at page retirement. */
  let chatGPTRegistrationUnsubscribe = null;
  /** Prevent stale event callbacks from reattaching after page disposal. */
  let chatGPTStartupDisposed = false;

  /**
   * Starts a provider only after it recognises this page, without polling.
   * The public AICC inventory observer handles registrations after DOM ready.
   * @returns {void} Starts the asynchronous agent initialization, if ready.
   */
  function chatGPTTryBindRegisteredAgent() {
    if (chatGPTStartupDisposed || chatGPTAgent) return;
    const core = canonicalCore();
    if (!core || typeof core.recognizeAgentPlugin !== 'function') return;
    const descriptor = core.recognizeAgentPlugin({
      provider: 'chatgpt', url: typeof location === 'object' ? location.href : ''
    });
    if (!descriptor) return;
    void ensureChatGPTCanonicalAgent().catch(error => {
      logDiagnostic('warnings', 'last-registration-startup-unavailable', {
        reason: String(error?.message ?? error)
      });
    });
  }

  /**
   * Retires the Core registration subscription without changing provider state.
   * @returns {void} Idempotent page-lifetime cleanup.
   */
  function chatGPTStopRegistrationObserver() {
    chatGPTStartupDisposed = true;
    chatGPTRegistrationUnsubscribe?.();
    chatGPTRegistrationUnsubscribe = null;
  }

  // Public provider-neutral registration events close the late-install race.
  // No DOM observer, private capture, 15-second wait or periodic polling.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const core = canonicalCore();
    assert(typeof core.observeAgentPluginRegistrations === 'function',
      'AIConversationCore registration observation API is unavailable.');
    chatGPTRegistrationUnsubscribe = core.observeAgentPluginRegistrations(() => {
      if (typeof document === 'object' && document.readyState !== 'loading') {
        chatGPTTryBindRegisteredAgent();
      }
    });
    window.addEventListener('pagehide', chatGPTStopRegistrationObserver, { once: true });
    if (typeof document === 'object' && document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', chatGPTTryBindRegisteredAgent, { once: true });
    } else if (typeof document === 'object') {
      chatGPTTryBindRegisteredAgent();
    }
  }
