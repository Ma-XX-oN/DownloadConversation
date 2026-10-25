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
    try {
      await ensureChatGPTCanonicalAgent();
    } catch (error) {
      const message = errorMessage(error);
      logDiagnostic('errors', 'agent-plugin-readiness-failure', {
        operation: 'export',
        message
      });
      setStatus(`Export setup failed: ${message}`);
      return;
    }
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
    // #297 Test cases arm their own observer before #310 host connection.
    if (name.startsWith('AICC #127')) return runOneTestWithCanonicalAgent(name, fn);
    if (name !== 'Worker + Zstd/CSP'
      && name !== 'CSC Worker stream + directory'
      && name !== 'CSC dual clone + Worker') {
      await ensureChatGPTCanonicalAgent();
    }
    return runOneTestWithCanonicalAgent(name, fn);
  };

  /**
   * Ensures the complete browser test matrix uses the registered provider path.
   *
   * @returns {Promise<void>} Resolves after the original matrix runner completes.
   */
  runTests = async function runTestsAfterChatGPTPluginReady() {
    // Arm the witness before provider loading or the first queue drain.
    sessionStorage.setItem(AICC127_ARMED_KEY, 'true');
    aicc127Prepare();
    await ensureChatGPTCanonicalAgent();
    return runTestsWithCanonicalAgent();
  };
