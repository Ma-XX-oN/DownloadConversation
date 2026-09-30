  /** Original export implementation after source acquisition/render assembly. */
  const runExportWithCanonicalAgent = runExport;
  /** Original single built-in test runner. */
  const runOneTestWithCanonicalAgent = runOneTest;
  /** Original complete built-in test runner. */
  const runTestsWithCanonicalAgent = runTests;

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

  /**
   * Ensures a single built-in test that may exercise canonical rendering has the
   * same registered provider/Core session available as production export.
   *
   * @param {string} name - Built-in test name.
   * @param {Function} fn - Built-in test function.
   * @returns {Promise<void>} Resolves after the original runner completes.
   */
  runOneTest = async function runOneTestAfterChatGPTPluginReady(name, fn) {
    await ensureChatGPTCanonicalAgent();
    return runOneTestWithCanonicalAgent(name, fn);
  };

  /**
   * Ensures the complete browser test matrix uses the registered provider path.
   *
   * @returns {Promise<void>} Resolves after the original matrix runner completes.
   */
  runTests = async function runTestsAfterChatGPTPluginReady() {
    await ensureChatGPTCanonicalAgent();
    return runTestsWithCanonicalAgent();
  };
