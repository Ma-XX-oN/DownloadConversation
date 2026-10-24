  /** Promise for the one AICC-selected provider descriptor in this page realm. */
  let chatGPTPluginModulePromise = null;
  /** Provider-owned agent instance registered through AICC. */
  let chatGPTAgent = null;
  /** AICC-owned canonical session associated with that agent. */
  let chatGPTCanonicalSession = null;

  /**
   * Waits for the independently installed private CGP2 classic userscript.
   * The userscript is a separately installed Tampermonkey dependency, so no
   * Blob import or cross-world message copying is required.
   */
  async function importAgentPluginModule(descriptor) {
    if (!chatGPTPluginModulePromise) {
      chatGPTPluginModulePromise = (async () => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const plugin = globalThis.ChatGPTWebAgentPlugin;
          if (plugin) {
            assert(plugin.id === descriptor.id,
              'Loaded CGP2 plugin ID does not match the AICC descriptor.');
            assert(plugin.apiVersion === descriptor.apiVersion,
              'Loaded CGP2 plugin API does not match the AICC descriptor.');
            assert(typeof plugin.create === 'function'
              && typeof plugin.recognize === 'function',
              'Loaded CGP2 plugin interface is incomplete.');
            const check = plugin.create({ ref: descriptor.ref }).version();
            assert(check.version === descriptor.version,
              'Loaded CGP2 plugin version does not match the AICC descriptor.');
            return { default: plugin };
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('CGP2 Tampermonkey loader is unavailable after 30 seconds.');
      })();
    }
    try {
      return await chatGPTPluginModulePromise;
    } catch (error) {
      chatGPTPluginModulePromise = null;
      throw error;
    }
  }

  /**
   * Asks AICC to select, load, register and create the ChatGPT agent. DC supplies
   * only the generic browser artifact-transport callback.
   *
   * @returns {Promise<Object>} The validated ChatGPT agent instance.
   */
  async function ensureChatGPTCanonicalAgent() {
    if (chatGPTAgent) return chatGPTAgent;
    const core = canonicalCore();
    assert(typeof core.loadAgent === 'function',
      'AIConversationCore agent loader is unavailable.');
    const loaded = await core.loadAgent('chatgpt-web', {
      loadModule: importAgentPluginModule,
      context: {
        conversationId: typeof currentConversationId === 'function'
          ? currentConversationId()
          : null
      }
    });
    chatGPTAgent = loaded?.agent ?? null;
    chatGPTCanonicalSession = loaded?.session ?? null;
    assert(chatGPTAgent && chatGPTCanonicalSession,
      'AIConversationCore did not create the ChatGPT agent and canonical session.');
    const identity = chatGPTAgent.version();
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
