
  /** Shared verified-source cache prefix. */
  const AGENT_PLUGIN_CACHE_PREFIX = 'downloadconversation:agent-plugin-cache:';

  /**
   * Returns the shared-cache key for one exact verified plugin artifact.
   *
   * @param {Object} descriptor - Public plugin descriptor.
   * @returns {string} Tampermonkey shared-storage key.
   */
  function agentPluginCacheKey(descriptor) {
    return `${AGENT_PLUGIN_CACHE_PREFIX}${descriptor.id}:${descriptor.git_blob_sha1}`;
  }

  /**
   * Loads a previously verified private artifact from shared userscript storage.
   * Integrity is rechecked before execution.
   *
   * @param {Object} descriptor - Public plugin descriptor.
   * @returns {Promise<string|null>} Verified ESM source, or null when absent/invalid.
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
