  /** Shared request key used by the browser plugin broker. */
  const AGENT_PLUGIN_REQUEST_KEY = 'downloadconversation:agent-plugin-request';
  /** Shared response prefix used by the browser plugin broker. */
  const AGENT_PLUGIN_RESPONSE_PREFIX = 'downloadconversation:agent-plugin-response:';
  /** Shared verified-source cache prefix. */
  const AGENT_PLUGIN_CACHE_PREFIX = 'downloadconversation:agent-plugin-cache:';
  /** Maximum wait for one broker response. */
  const AGENT_PLUGIN_BROKER_TIMEOUT_MS = 120000;

  /** Promise for the one ChatGPT plugin module import in this page realm. */
  let chatGPTPluginModulePromise = null;
  /** Core-owned registry for the ChatGPT agent plugin in this page realm. */
  let chatGPTPluginRegistry = null;
  /** Provider-owned ChatGPT agent instance created by Core. */
  let chatGPTAgent = null;
  /** Core-owned canonical session associated with `chatGPTAgent`. */
  let chatGPTCanonicalSession = null;

  /**
   * Converts bytes to lowercase hexadecimal text.
   *
   * @param {Uint8Array} bytes - Bytes to format.
   * @returns {string} Lowercase hexadecimal text.
   */
  function agentPluginHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Verifies plugin source against the configured Git object identity.
   *
   * @param {Object} descriptor - Plugin selector and integrity metadata.
   * @param {string} source - Retrieved self-contained ESM source.
   * @returns {Promise<Uint8Array>} Exact verified UTF-8 source bytes.
   */
  async function verifyAgentPluginSource(descriptor, source) {
    const bytes = new TextEncoder().encode(source);
    assert(bytes.byteLength === descriptor.byte_length,
      `Plugin byte length ${bytes.byteLength} differs from configured ${descriptor.byte_length}.`);
    const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
    const gitObject = new Uint8Array(header.byteLength + bytes.byteLength);
    gitObject.set(header, 0);
    gitObject.set(bytes, header.byteLength);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', gitObject));
    assert(agentPluginHex(digest) === descriptor.git_blob_sha1,
      'Plugin Git blob integrity check failed.');
    return bytes;
  }

  /**
   * Returns the shared cache key for one exact plugin artifact.
   *
   * @param {Object} descriptor - Plugin descriptor.
   * @returns {string} Shared userscript-storage key.
   */
  function agentPluginCacheKey(descriptor) {
    return `${AGENT_PLUGIN_CACHE_PREFIX}${descriptor.id}:${descriptor.git_blob_sha1}`;
  }

  /**
   * Extracts plugin source from one successful broker response.
   *
   * @param {Object} value - Broker response value.
   * @returns {string} Plugin source text.
   */
  function agentPluginSourceFromResponse(value) {
    assert(
      value?.ok === true,
      `Plugin unavailable: ${value?.reason ?? 'UNKNOWN'}.`
    );
    assert(
      typeof value.source === 'string',
      'Plugin response did not contain source text.'
    );
    return value.source;
  }

  /**
   * Loads a previously verified artifact from shared userscript storage.
   * Integrity is rechecked before execution.
   *
   * @param {Object} descriptor - Plugin descriptor.
   * @returns {Promise<string|null>} Verified ESM source, or null when unavailable.
   */
  async function cachedAgentPluginSource(descriptor) {
    const cached = GM_getValue(agentPluginCacheKey(descriptor), null);
    if (!cached || cached.ref !== descriptor.ref || cached.version !== descriptor.version
        || typeof cached.source !== 'string') return null;
    try {
      await verifyAgentPluginSource(descriptor, cached.source);
      return cached.source;
    } catch {
      GM_setValue(agentPluginCacheKey(descriptor), null);
      return null;
    }
  }

  /**
   * Requests the configured artifact from the GitHub-side broker.
   *
   * @param {Object} descriptor - Plugin descriptor.
   * @returns {Promise<string>} Retrieved ESM source.
   */
  function requestAgentPluginFromGitHub(descriptor) {
    const requestId = crypto.randomUUID();
    const responseKey = `${AGENT_PLUGIN_RESPONSE_PREFIX}${requestId}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      let listenerId = null;
      let timer = null;
      const finish = (error, source = null) => {
        if (settled) return;
        settled = true;
        if (listenerId !== null) GM_removeValueChangeListener(listenerId);
        if (timer !== null) clearTimeout(timer);
        GM_setValue(responseKey, null);
        GM_setValue(AGENT_PLUGIN_REQUEST_KEY, null);
        if (error) reject(error);
        else resolve(source);
      };
      listenerId = GM_addValueChangeListener(
        responseKey,
        (_name, _oldValue, value) => {
          if (!value || value.request_id !== requestId) return;
          try {
            finish(null, agentPluginSourceFromResponse(value));
          } catch (error) {
            finish(error);
          }
        }
      );
      timer = setTimeout(() => {
        finish(new Error('Timed out waiting for the GitHub plugin broker.'));
      }, AGENT_PLUGIN_BROKER_TIMEOUT_MS);
      GM_setValue(AGENT_PLUGIN_REQUEST_KEY, {
        request_id: requestId,
        plugin_id: descriptor.id,
        repository: descriptor.repository,
        ref: descriptor.ref,
        path: descriptor.path,
        version: descriptor.version,
        api_version: descriptor.api_version,
        git_blob_sha1: descriptor.git_blob_sha1,
        byte_length: descriptor.byte_length,
        requested_at: Date.now()
      });
      const brokerUrl = `https://github.com/${descriptor.repository}#downloadconversation-agent-plugin-broker=${requestId}`;
      const brokerWindow = window.open(
        brokerUrl,
        'downloadconversation-agent-plugin-broker',
        'popup,width=960,height=720'
      );
      if (!brokerWindow) finish(new Error('Browser blocked the GitHub plugin window.'));
    });
  }

  /**
   * Retrieves, verifies and caches the configured plugin source.
   *
   * @param {Object} descriptor - Plugin descriptor.
   * @returns {Promise<Uint8Array>} Verified module bytes.
   */
  async function loadAgentPlugin(descriptor) {
    let source = await cachedAgentPluginSource(descriptor);
    if (!source) {
      source = await requestAgentPluginFromGitHub(descriptor);
      await verifyAgentPluginSource(descriptor, source);
      GM_setValue(agentPluginCacheKey(descriptor), {
        ref: descriptor.ref,
        version: descriptor.version,
        source,
        verified_at: Date.now()
      });
    }
    return verifyAgentPluginSource(descriptor, source);
  }

  /**
   * Imports and registers the configured ChatGPT plugin.
   *
   * @returns {Promise<Object>} The validated ChatGPT agent instance.
   */
  async function ensureChatGPTCanonicalAgent() {
    if (chatGPTAgent) return chatGPTAgent;
    const descriptor = DC_AGENT_PLUGIN_DESCRIPTORS?.['chatgpt-web'];
    assert(descriptor, 'ChatGPT agent plugin descriptor is unavailable.');
    if (!chatGPTPluginModulePromise) {
      chatGPTPluginModulePromise = (async () => {
        const bytes = await loadAgentPlugin(descriptor);
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
    chatGPTPluginRegistry = new core.AgentPluginRegistry({ apiVersion: descriptor.api_version });
    chatGPTPluginRegistry.registerModule(module);
    chatGPTAgent = chatGPTPluginRegistry.create('chatgpt-web', { ref: descriptor.ref });
    chatGPTCanonicalSession = chatGPTPluginRegistry.session(chatGPTAgent);
    assert(chatGPTCanonicalSession,
      'AIConversationCore did not create a canonical session for the ChatGPT agent.');
    const identity = chatGPTAgent.version();
    assert(identity?.plugin === 'chatgpt-web', 'Loaded ChatGPT plugin identity is incorrect.');
    assert(identity?.version === descriptor.version,
      `Loaded ChatGPT plugin version ${identity?.version ?? 'unknown'} differs from configured ${descriptor.version}.`);
    assert(identity?.ref === descriptor.ref,
      `Loaded ChatGPT plugin ref ${identity?.ref ?? 'unknown'} differs from configured ${descriptor.ref}.`);
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
