  /** Original export implementation after source acquisition/render assembly. */
  const runExportWithCanonicalAgent = runExport;

  /**
   * Ensures the registered ChatGPT provider agent is ready before any synchronous
   * canonical projection or image-resource lookup runs during export.
   *
   * @param {Array<'jsonl'|'md'>} kinds - Selected output formats.
   * @param {Object} options - Export options forwarded unchanged.
   * @returns {Promise<void>} Resolves after the underlying export completes.
   */
  runExport = async function runExportAfterChatGPTPluginReady(kinds, options = {}) {
    await ensureChatGPTCanonicalAgent();
    return runExportWithCanonicalAgent(kinds, options);
  };
