
  /**
   * Publishes one private-plugin request descriptor into shared userscript storage.
   *
   * @param {Object} descriptor - Public plugin selector/integrity metadata.
   * @param {string} requestId - Unique request identity.
   * @returns {void} No value is returned.
   */
  function publishAgentPluginRequest(descriptor, requestId) {
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
  }
