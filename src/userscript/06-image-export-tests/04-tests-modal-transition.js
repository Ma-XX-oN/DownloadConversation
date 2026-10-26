    const cases = [
      ['0', 0, 'user', 'u1'],
      ['1', 1, 'user', 'u2'],
      ['-1', 2, 'user', 'u3'],
      ['-2', 1, 'user', 'u2'],
      ['u2', 1, 'user', 'u2'],
      ['a2', 1, 'assistant', 'a2']
    ];
    for (const [input, index, role, id] of cases) {
      const resolved = resolveJumpIdentifier(spine, input);
      assert(resolved.uap_index === index && resolved.role === role && resolved.message_id === id,
        `Jump resolver failed for ${input}: ${JSON.stringify(resolved)}.`);
    }
    for (const input of ['3', '-4']) {
      let rejected = false;
      try { resolveJumpIdentifier(spine, input); } catch { rejected = true; }
      assert(rejected, `Jump resolver did not reject out-of-range index ${input}.`);
    }
  }

  /**
   * Tests generated sandbox download link.
   *
   * @returns {void} No value is returned.
   */
  function testGeneratedSandboxDownloadLink() {
    const conversationId = currentConversationId();
    assert(conversationId, 'Sandbox-link test requires a ChatGPT conversation page.');
    const record = { id: 'assistant-test-id', author: { role: 'assistant' } };
    const source = 'sandbox:/mnt/data/work107/chatgpt-conversation-markdown-export.user.js';
    const url = cgGeneratedSandboxDownloadUrl(source, record);
    assert(url && url.includes(`/backend-api/conversation/${encodeURIComponent(conversationId)}/interpreter/download?`),
      'sandbox file link did not use the observed interpreter/download route.');
    assert(url.includes('message_id=assistant-test-id'), 'sandbox file link omitted Assistant message_id.');
    assert(url.includes('sandbox_path=%2Fmnt%2Fdata%2Fwork107%2Fchatgpt-conversation-markdown-export.user.js'),
      'sandbox file link did not preserve/encode sandbox_path.');
    assert(url.endsWith('&download_intent=true'), 'sandbox file link did not force download_intent=true.');
    const markdown = cgRewriteGeneratedSandboxLinks(`[Download userscript](${source})`, record);
    assert(markdown === `[Download userscript](${url})`, 'sandbox Markdown link rewrite changed label or URL unexpectedly.');
    const parenthesizedSource = 'sandbox:/mnt/data/work/fixture(phase2).txt';
    const parenthesizedUrl = cgGeneratedSandboxDownloadUrl(parenthesizedSource, record);
    const parenthesizedMarkdown = cgRewriteGeneratedSandboxLinks(
      `[Download fixture](${parenthesizedSource})`, record
    );
    assert(parenthesizedMarkdown === `[Download fixture](${parenthesizedUrl})`,
      'sandbox Markdown link rewrite truncated a filename containing parentheses.');
    const nestedSource = 'sandbox:/mnt/data/work/fixture((phase2)).txt';
    const nestedUrl = cgGeneratedSandboxDownloadUrl(nestedSource, record);
    assert(cgRewriteGeneratedSandboxLinks(`[Nested](${nestedSource})`, record) === `[Nested](${nestedUrl})`,
      'sandbox Markdown link rewrite did not preserve nested parentheses.');
    const twoLinks = cgRewriteGeneratedSandboxLinks(
      `[One](${parenthesizedSource}) and [Two](${source})`, record
    );
    assert(twoLinks === `[One](${parenthesizedUrl}) and [Two](${url})`,
      'sandbox Markdown link rewrite did not preserve multiple links.');
    const userRecord = { id: 'user-test-id', author: { role: 'user' } };
    assert(cgRewriteGeneratedSandboxLinks(`[x](${source})`, userRecord) === `[x](${source})`,
      'sandbox link rewrite should not apply to User records.');
    assert(cgRewriteGeneratedSandboxLinks('[x](sediment://file_123)', record) === '[x](sediment://file_123)',
      'sandbox link rewrite must not rewrite sediment pointers.');
  }

  /** DOM id of the built-in test matrix overlay. */
  const TEST_MATRIX_ID = `${PANEL_ID}-test-matrix`;
  /** Local-storage key for the previous built-in test outcomes. */
  const TEST_RESULT_HISTORY_KEY = 'tm-conversation-recorder-test-result-history';
  /** Last persisted PASS/FAIL result for each built-in test. */
  let testMatrixPreviousResults = new Map();
  /** Results produced during the current built-in test session. */
  let testMatrixCurrentResults = new Map();

  /**
   * Handles built in tests.
   *
   * @returns {Array<unknown>} The ordered values produced by `builtInTests`.
   */
  function builtInTests() {
    return [
      ['CGP2 installed interface and AICC identity', testCGP2InstalledInterface],
      ['AICC registration and retained agent identity', testCGP2DirectLoaderIdentity],
      ['CGP2 canonical fixture and repeat parity', testCGP2CanonicalFixtureParity],
      ['CGP2 ordered exchange isolation', testCGP2IndependentExchangeOrdering],
      ['CGP2 isolated lifecycle and observers', testCGP2IsolatedLifecycle],
      ['CGP2 rejects mismatched plugin API', testCGP2RejectsWrongVersion],
      ['CGP2 rejects missing provider', testCGP2MissingProvider],
      ['API pagination', testApiPaginationLogic],
      ['Stable API message IDs', testStableMessageIds],
      ['Multimodal User + chronological order', testMultimodalUserAndChronologicalOrder],
      ['AI-transcript renderer parity', testRendererParityFeatures],
      ['Generated sandbox download link', testGeneratedSandboxDownloadLink],
      ['Jump identifier resolution', testJumpIdentifierResolution],
      ['Conversation API access/schema', testConversationApiAccessAndSchema],
      // Opt-in browser capability probes. They must never run automatically.
      ['CSC dual clone + Worker', testCscDualCloneOwnership],
      ['Worker + Zstd/CSP', testWorkerZstdCsp],
      ['CSC Worker stream + directory', testCscWorkerBoundary],
      // Live observer rows are only evidence from the actual browser.
      ['AICC #127 staged registered host', testAicc127StagedArtifact],
      ['AICC #127 verified project identity', testAicc127LiveProject],
      ['AICC #127 standalone gizmo null', testAicc127LiveStandalone],
      ['AICC #127 zero-network A-B-A', testAicc127Navigation],
      ['AICC #127 stale response safety', testAicc127StaleResponse],
      ['AICC #127 reload and rebind', testAicc127ReloadRebind],
      ['AICC #127 recording group 1', testAicc127GroupOne],
      ['AICC #127 export evidence', aicc127ExportEvidence, 'Action'],
      ['Favicon source comparison', null, 'Visual']
    ];
  }

  /**
   * Loads test result history.
   *
   * @returns {Map<unknown, unknown>} The lookup map produced by `loadTestResultHistory`.
   */
  function loadTestResultHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TEST_RESULT_HISTORY_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
      return new Map(Object.entries(parsed).filter(([, value]) => value === 'PASS' || value === 'FAIL' || value === 'INCOMPLETE'));
    } catch {
      return new Map();
    }
  }

  /**
   * Saves test result history.
   *
   * @returns {void} No value is returned.
   */
  function saveTestResultHistory() {
    try {
      const history = loadTestResultHistory();
      for (const [name, result] of testMatrixCurrentResults) history.set(name, result.status);
      localStorage.setItem(TEST_RESULT_HISTORY_KEY, JSON.stringify(Object.fromEntries(history)));
    } catch {}
  }

  /**
   * Tests matrix result text.
   *
   * @param {Object} result - The test result to format.
   * @returns {string} The string produced by `testMatrixResultText`.
   */
  function testMatrixResultText(result) {
    return result ? result.status + (result.detail ? `: ${result.detail}` : '') : '—';
  }

  /**
   * Refreshes test matrix.
   *
   * @returns {void} No value is returned.
   */
  function refreshTestMatrix() {
    const matrix = document.getElementById(TEST_MATRIX_ID);
    if (!matrix) return;
    for (const row of matrix.querySelectorAll('[data-test-name]')) {
      const name = row.getAttribute('data-test-name');
      const previous = row.querySelector('[data-role="previous-result"]');
      const current = row.querySelector('[data-role="current-result"]');
      const run = row.querySelector('[data-role="run-test"]');
      if (previous) previous.textContent = testMatrixPreviousResults.get(name) || '—';
      if (current) current.textContent = testMatrixResultText(testMatrixCurrentResults.get(name));
      if (run instanceof HTMLButtonElement) run.disabled = testInProgress || exportInProgress || jumpInProgress;
    }
    const runAll = matrix.querySelector('[data-role="run-all-tests"]');
    if (runAll instanceof HTMLButtonElement) runAll.disabled = testInProgress || exportInProgress || jumpInProgress;
  }

  /**
   * Handles execute built in test.
   *
   * @param {string} name - The name to process.
   * @param {Function} fn - The test function to execute.
   * @returns {Promise<string>} A promise that resolves to the string result produced by `executeBuiltInTest`.
   */
  async function executeBuiltInTest(name, fn) {
    try {
      const outcome = await fn();
      const status = outcome && typeof outcome === 'object' &&
        typeof outcome.status === 'string' ? outcome.status : 'PASS';
      if (!['PASS', 'FAIL', 'INCOMPLETE'].includes(status)) {
        throw new TypeError('Invalid built-in test status');
      }
      const detail = typeof outcome === 'string' ? outcome :
        typeof outcome?.detail === 'string' ? outcome.detail : '';
      testMatrixCurrentResults.set(name, { status, detail });
      return (status === 'PASS' ? '✅ ' :
        status === 'INCOMPLETE' ? '⚠️ ' : '❌ ') + name;
    } catch (error) {
      const detail = errorMessage(error);
      testMatrixCurrentResults.set(name, { status: 'FAIL', detail });
      return `❌ ${name}: ${detail}`;
    } finally {
      saveTestResultHistory();
      refreshTestMatrix();
    }
  }

  /**
   * Handles current test status lines.
   *
   * @returns {Array<unknown>} The ordered values produced by `currentTestStatusLines`.
   */
  function currentTestStatusLines() {
    return builtInTests()
      .filter(([name]) => testMatrixCurrentResults.has(name))
      .map(([name]) => {
        const result = testMatrixCurrentResults.get(name);
        return result.status === 'PASS' ? `✅ ${name}` :
          result.status === 'INCOMPLETE' ? `⚠️ ${name}: ${result.detail}` :
          `❌ ${name}: ${result.detail}`;
      });
  }

  /**
   * Handles run one test.
   *
   * @param {string} name - The name to process.
   * @param {Function} fn - The test function to execute.
   * @returns {void} No value is returned.
   */
  async function runOneTest(name, fn) {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    testInProgress = true;
    updateUi();
    refreshTestMatrix();
    try {
      await executeBuiltInTest(name, fn);
    } finally {
      testInProgress = false;
      updateUi();
      refreshTestMatrix();
    }
  }

  /**
   * Handles run tests.
   *
   * @returns {void} No value is returned.
   */
  async function runTests() {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    testInProgress = true;
    updateUi();
    refreshTestMatrix();
    try {
      for (const [name, fn, type] of builtInTests()) {
        if (name === 'CSC Worker stream + directory') continue;
        if (name === 'CSC dual clone + Worker') continue;
        if (name === 'Worker + Zstd/CSP') continue;
        if (type !== 'Visual' && type !== 'Action') await executeBuiltInTest(name, fn);
      }
    } finally {
      testInProgress = false;
      updateUi();
      refreshTestMatrix();
    }
  }

  /**
   * Handles modal focusable elements.
   *
   * @param {HTMLElement} dialog - The dialog element whose focusable controls are requested.
   * @returns {Array<unknown>} The ordered values produced by `modalFocusableElements`.
   */
  function modalFocusableElements(dialog) {
    return [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => element instanceof HTMLElement && !element.hidden && element.offsetParent !== null);
  }

  /**
   * Handles install modal contract.
   *
   * @param {Object} overlay - The modal overlay element.
   * @param {Object} options2 - The destructured options object used by this operation.
   * @param {Object} options2.defaultButton - The defaultButton value required by this function.
   * @param {Object} options2.null - The null value required by this function.
   * @param {Object} options2.onClose - The onClose value required by this function.
