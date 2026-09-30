  /** Promise for the one ChatGPT plugin module import in this page realm. */
  let chatGPTPluginModulePromise = null;
  /** Core-owned registry for the ChatGPT agent plugin in this page realm. */
  let chatGPTPluginRegistry = null;
  /** Provider-owned ChatGPT agent instance created by Core. */
  let chatGPTAgent = null;
  /** Core-owned canonical session associated with `chatGPTAgent`. */
  let chatGPTCanonicalSession = null;

  /**
   * Decodes one build-embedded base64 module payload without reinterpreting it.
   *
   * @param {string} base64 - Base64-encoded UTF-8 module bytes.
   * @returns {Uint8Array} Exact decoded module bytes.
   */
  function decodeEmbeddedModule(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  /**
   * Imports and registers the exact ChatGPT plugin artifact pinned by the userscript build.
   *
   * The source bytes remain the plugin repository's self-contained ESM artifact. DC
   * supplies transport/lifetime only; Core validates the descriptor and owns the
   * canonical session.
   *
   * @returns {Promise<Object>} The validated ChatGPT agent instance.
   */
  async function ensureChatGPTCanonicalAgent() {
    if (chatGPTAgent) return chatGPTAgent;
    if (!chatGPTPluginModulePromise) {
      const artifact = DC_AGENT_PLUGIN_ARTIFACTS?.['chatgpt-web'];
      assert(artifact && artifact.source_base64,
        'Pinned ChatGPT agent plugin artifact is unavailable.');
      chatGPTPluginModulePromise = (async () => {
        const bytes = decodeEmbeddedModule(artifact.source_base64);
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
        try {
          return await import(blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      })();
    }

    const module = await chatGPTPluginModulePromise;
    const core = canonicalCore();
    assert(typeof core.AgentPluginRegistry === 'function',
      'AIConversationCore agent plugin registry is unavailable.');
    const artifact = DC_AGENT_PLUGIN_ARTIFACTS['chatgpt-web'];
    chatGPTPluginRegistry = new core.AgentPluginRegistry({ apiVersion: artifact.api_version });
    chatGPTPluginRegistry.registerModule(module);
    chatGPTAgent = chatGPTPluginRegistry.create('chatgpt-web', { ref: artifact.ref });
    chatGPTCanonicalSession = chatGPTPluginRegistry.session(chatGPTAgent);
    assert(chatGPTCanonicalSession,
      'AIConversationCore did not create a canonical session for the ChatGPT agent.');
    const identity = chatGPTAgent.version();
    assert(identity?.plugin === 'chatgpt-web', 'Loaded ChatGPT plugin identity is incorrect.');
    assert(identity?.version === artifact.version,
      `Loaded ChatGPT plugin version ${identity?.version ?? 'unknown'} differs from pinned ${artifact.version}.`);
    assert(identity?.ref === artifact.ref,
      `Loaded ChatGPT plugin ref ${identity?.ref ?? 'unknown'} differs from pinned ${artifact.ref}.`);
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
   * This assignment intentionally replaces the legacy adapter-backed implementation
   * declared earlier in the preserved Phase 5 module. The old implementation remains
   * available only in repository history/tests as a differential oracle; runtime calls
   * use the registered provider agent and Core-owned canonical session.
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
