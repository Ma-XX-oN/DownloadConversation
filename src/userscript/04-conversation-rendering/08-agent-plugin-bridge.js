  /** Shared cache prefix for verified direct-download artifacts. */
  const AGENT_PLUGIN_CACHE_PREFIX = 'downloadconversation:agent-plugin-cache:';
  /** Direct GitHub-origin retrieval timeout in milliseconds. */
  const AGENT_PLUGIN_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;

  /** Promise for the one AICC-selected ChatGPT plugin module import in this page realm. */
  let chatGPTPluginModulePromise = null;
  /** Provider-owned ChatGPT agent instance created through AICC. */
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
   * Verifies artifact source against AICC-owned Git object identity.
   *
   * @param {Object} descriptor - Core-owned artifact selector and integrity metadata.
   * @param {string} source - Retrieved self-contained ESM source.
   * @returns {Promise<Uint8Array>} Exact verified UTF-8 source bytes.
   */
  async function verifyAgentPluginSource(descriptor, source) {
    const bytes = new TextEncoder().encode(source);
    assert(bytes.byteLength === descriptor.byteLength,
      `Plugin byte length ${bytes.byteLength} differs from configured ${descriptor.byteLength}.`);
    const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
    const gitObject = new Uint8Array(header.byteLength + bytes.byteLength);
    gitObject.set(header, 0);
    gitObject.set(bytes, header.byteLength);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', gitObject));
    assert(agentPluginHex(digest) === descriptor.gitBlobSha1,
      'Plugin Git blob integrity check failed.');
    return bytes;
  }

  /**
   * Returns the shared cache key for one exact AICC-selected artifact.
   *
   * @param {Object} descriptor - Core-owned artifact descriptor.
   * @returns {string} Shared userscript-storage key.
   */
  function agentPluginCacheKey(descriptor) {
    return `${AGENT_PLUGIN_CACHE_PREFIX}${descriptor.id}:${descriptor.gitBlobSha1}`;
  }

  /**
   * Reads a previously verified artifact candidate from shared userscript storage.
   * Integrity is rechecked asynchronously before execution.
   *
   * @param {Object} descriptor - Core-owned artifact descriptor.
   * @returns {string|null} Cached ESM source candidate, or null when unavailable.
   */
  function cachedAgentPluginSource(descriptor) {
    const cached = GM_getValue(agentPluginCacheKey(descriptor), null);
    if (!cached || cached.ref !== descriptor.ref || cached.version !== descriptor.version
        || typeof cached.source !== 'string') return null;
    return cached.source;
  }

  /**
   * Fetches the Core-selected private artifact through authenticated GitHub raw.
   * The GitHub-origin request uses the user's browser session; GitHub may redirect
   * to the raw CDN after checking access. The caller verifies exact Git identity.
   *
   * @param {Object} descriptor - Core-owned artifact descriptor.
   * @returns {Promise<string>} Unmodified UTF-8 source for integrity validation.
   */
  function requestAgentPluginFromGitHub(descriptor) {
    const [owner, repository] = String(descriptor.repository).split('/');
    assert(owner && repository, 'Invalid plugin repository.');
    const encodePath = value => String(value).split('/').map(encodeURIComponent).join('/');
    const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
      + `/raw/${encodeURIComponent(descriptor.ref)}/${encodePath(descriptor.path)}`;
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: AGENT_PLUGIN_DOWNLOAD_TIMEOUT_MS,
        onload(response) {
          if (response.status !== 200) {
            reject(new Error(`Private plugin download returned HTTP ${response.status}.`));
            return;
          }
          const source = response.responseText;
          if (typeof source !== 'string') {
            reject(new Error('Private plugin download returned no UTF-8 source.'));
            return;
          }
          resolve(source);
        },
        onerror() {
          reject(new Error('Private plugin download failed.'));
        },
        ontimeout() {
          reject(new Error('Private plugin download timed out.'));
        }
      });
    });
  }

  /**
   * Retrieves, verifies and caches one AICC-selected plugin artifact.
   *
   * @param {Object} descriptor - Core-owned artifact descriptor.
   * @returns {Promise<Uint8Array>} Verified module bytes.
   */
  async function loadAgentPlugin(descriptor) {
    const cachedSource = cachedAgentPluginSource(descriptor);
    if (cachedSource) {
      try {
        const bytes = await verifyAgentPluginSource(descriptor, cachedSource);
        logDiagnostic('debug', 'agent-plugin-cache-hit', {
          plugin_id: descriptor.id,
          ref: descriptor.ref,
          version: descriptor.version
        });
        return bytes;
      } catch (error) {
        GM_setValue(agentPluginCacheKey(descriptor), null);
        throw new Error(
          `Cached agent plugin failed integrity verification; retry Extract to reacquire it. ${errorMessage(error)}`
        );
      }
    }

    const source = await requestAgentPluginFromGitHub(descriptor);
    const bytes = await verifyAgentPluginSource(descriptor, source);
    GM_setValue(agentPluginCacheKey(descriptor), {
      ref: descriptor.ref,
      version: descriptor.version,
      source,
      verified_at: Date.now()
    });
    logDiagnostic('debug', 'agent-plugin-cache-stored', {
      plugin_id: descriptor.id,
      ref: descriptor.ref,
      version: descriptor.version
    });
    return bytes;
  }

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
