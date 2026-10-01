
  /** Shared Tampermonkey storage key carrying the newest private-plugin request. */
  const AGENT_PLUGIN_REQUEST_KEY = 'downloadconversation:agent-plugin-request';
  /** Shared Tampermonkey storage prefix for one private-plugin broker response. */
  const AGENT_PLUGIN_RESPONSE_PREFIX = 'downloadconversation:agent-plugin-response:';
  /** Shared Tampermonkey storage prefix for GitHub-side broker progress diagnostics. */
  const AGENT_PLUGIN_TRACE_PREFIX = 'downloadconversation:agent-plugin-trace:';
  /** Shared Tampermonkey storage prefix for verified plugin source cache entries. */
  const AGENT_PLUGIN_CACHE_PREFIX = 'downloadconversation:agent-plugin-cache:';
  /** Maximum age accepted for a browser-broker request. */
  const AGENT_PLUGIN_REQUEST_MAX_AGE_MS = 2 * 60 * 1000;
  /** Maximum time the ChatGPT tab waits for one broker response. */
  const AGENT_PLUGIN_BROKER_TIMEOUT_MS = 2 * 60 * 1000;

  /**
   * Constructs the authenticated GitHub file-page URL selected by one public
   * plugin descriptor.  The private source remains on github.com and is read from
   * GitHub's own read-only file textarea; no raw-host token is requested or stored.
   *
   * @param {Object} descriptor - Public plugin selector and integrity metadata.
   * @returns {string} HTTPS GitHub file-page URL.
   */
  function githubAgentPluginBlobUrl(descriptor) {
    const [owner, repository] = String(descriptor.repository).split('/');
    assert(owner && repository, 'Agent plugin repository identity is invalid.');
    const artifactPath = String(descriptor.path)
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/');
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
      + `/blob/${encodeURIComponent(descriptor.ref)}/${artifactPath}`;
  }

  /**
   * Returns whether the current GitHub document is the exact configured plugin
   * file page rather than merely another page in the same private repository.
   *
   * @param {Object} descriptor - Build-owned plugin descriptor.
   * @returns {boolean} `true` only on the configured GitHub file page.
   */
  function githubAgentPluginPageMatches(descriptor) {
    if (location.origin !== 'https://github.com') return false;
    const expected = new URL(githubAgentPluginBlobUrl(descriptor));
    return location.pathname === expected.pathname;
  }

  /**
   * Publishes one GitHub-side broker progress event to shared userscript storage.
   * This carries only stage metadata; plugin source and GitHub credentials are
   * never included in diagnostic events.
   *
   * @param {Object} request - Active broker request.
   * @param {string} stage - Stable broker progress stage.
   * @param {Object} [detail={}] - Non-sensitive diagnostic detail.
   * @returns {void} No value is returned.
   */
  function publishGitHubAgentPluginTrace(request, stage, detail = {}) {
    if (!request || typeof request.request_id !== 'string') return;
    GM_setValue(`${AGENT_PLUGIN_TRACE_PREFIX}${request.request_id}`, {
      request_id: request.request_id,
      stage,
      at: Date.now(),
      ...detail
    });
  }

  /**
   * Reads GitHub's read-only code textarea once the file view has rendered.
   * The textarea value is the browser-decoded file text, not HTML markup.
   * DOM wrappers can cross userscript/page realms, so this deliberately avoids
   * realm-sensitive element-class checks.
   *
   * @returns {string|null} Current file source, or null until GitHub renders it.
   */
  function githubAgentPluginSourceFromPage() {
    const textarea = document.querySelector(
      'textarea[data-testid="read-only-cursor-text-area"][aria-label="file content"]'
    );
    if (!textarea || String(textarea.tagName ?? '').toUpperCase() !== 'TEXTAREA'
        || typeof textarea.value !== 'string') return null;
    return textarea.value.length ? textarea.value : null;
  }

  /**
   * Restores GitHub file-view's omitted terminal LF only when the descriptor proves
   * the displayed UTF-8 text is exactly one byte shorter than the pinned artifact.
   * The ChatGPT side still verifies the full Git blob SHA-1 before execution, so an
   * incorrect reconstruction is rejected rather than trusted.
   *
   * @param {Object} descriptor - Exact plugin artifact descriptor.
   * @param {string} source - Source text read from GitHub's file-view textarea.
   * @returns {{source: string, displayed_byte_length: number, transferred_byte_length: number, terminal_lf_restored: boolean}}
   *   Source transfer result and non-sensitive byte-length diagnostics.
   */
  function normalizeGitHubAgentPluginSource(descriptor, source) {
    const displayedByteLength = new TextEncoder().encode(source).byteLength;
    const shouldRestoreTerminalLf = displayedByteLength + 1 === descriptor.byte_length
      && !source.endsWith('\n');
    const normalized = shouldRestoreTerminalLf ? `${source}\n` : source;
    return {
      source: normalized,
      displayed_byte_length: displayedByteLength,
      transferred_byte_length: new TextEncoder().encode(normalized).byteLength,
      terminal_lf_restored: shouldRestoreTerminalLf
    };
  }

  /**
   * Waits for GitHub's file viewer to materialize its read-only source textarea.
   *
   * @returns {Promise<string>} Exact source text displayed by GitHub.
   */
  function waitForGitHubAgentPluginSource() {
    const immediate = githubAgentPluginSourceFromPage();
    if (immediate !== null) return Promise.resolve(immediate);
    return new Promise((resolve, reject) => {
      let settled = false;
      let observer = null;
      let timer = null;
      const finish = (error, source = null) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        if (timer !== null) clearTimeout(timer);
        if (error) reject(error);
        else resolve(source);
      };
      const check = () => {
        const source = githubAgentPluginSourceFromPage();
        if (source !== null) finish(null, source);
      };
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      timer = setTimeout(() => {
        finish(new Error('GitHub file content did not become available.'));
      }, AGENT_PLUGIN_BROKER_TIMEOUT_MS);
      check();
    });
  }

  /**
   * Returns whether a broker request exactly matches the descriptor compiled into
   * this public DownloadConversation build.
   *
   * @param {Object} request - Shared-storage request from a ChatGPT tab.
   * @param {Object} descriptor - Build-owned plugin descriptor.
   * @returns {boolean} `true` only for the exact configured private artifact.
   */
  function githubAgentPluginRequestMatches(request, descriptor) {
    return request?.plugin_id === descriptor?.id
      && request?.repository === descriptor?.repository
      && request?.ref === descriptor?.ref
      && request?.path === descriptor?.path
      && request?.version === descriptor?.version
      && request?.api_version === descriptor?.api_version
      && request?.git_blob_sha1 === descriptor?.git_blob_sha1
      && request?.byte_length === descriptor?.byte_length;
  }

  /**
   * Handles one plugin request inside GitHub's authenticated file-view origin.
   * Browser session cookies remain owned by GitHub/Chrome and are never copied into
   * DownloadConversation storage or exposed to ChatGPT.  Only the file text shown
   * by GitHub is transferred through shared userscript storage.
   *
   * @param {Object} request - Shared-storage request from a ChatGPT tab.
   * @returns {Promise<void>} Resolves after a success/failure response is published.
   */
  async function handleGitHubAgentPluginRequest(request) {
    if (!request || typeof request.request_id !== 'string') return;
    const descriptor = DC_AGENT_PLUGIN_DESCRIPTORS?.[request.plugin_id];
    if (!descriptor || !githubAgentPluginRequestMatches(request, descriptor)) return;
    const age = Date.now() - Number(request.requested_at ?? 0);
    if (!Number.isFinite(age) || age < 0 || age > AGENT_PLUGIN_REQUEST_MAX_AGE_MS) return;

    const responseKey = `${AGENT_PLUGIN_RESPONSE_PREFIX}${request.request_id}`;
    publishGitHubAgentPluginTrace(request, 'request-accepted', {
      pathname: location.pathname
    });
    try {
      if (!githubAgentPluginPageMatches(descriptor)) {
        publishGitHubAgentPluginTrace(request, 'wrong-file-page', {
          pathname: location.pathname
        });
        GM_setValue(responseKey, {
          request_id: request.request_id,
          ok: false,
          reason: 'WRONG_GITHUB_FILE_PAGE'
        });
        return;
      }
      publishGitHubAgentPluginTrace(request, 'waiting-for-file-content');
      const displayedSource = await waitForGitHubAgentPluginSource();
      const normalized = normalizeGitHubAgentPluginSource(descriptor, displayedSource);
      publishGitHubAgentPluginTrace(request, 'file-content-read', {
        character_length: displayedSource.length,
        displayed_byte_length: normalized.displayed_byte_length,
        transferred_byte_length: normalized.transferred_byte_length,
        terminal_lf_restored: normalized.terminal_lf_restored
      });
      GM_setValue(responseKey, {
        request_id: request.request_id,
        ok: true,
        source: normalized.source
      });
      publishGitHubAgentPluginTrace(request, 'response-published', {
        transferred_byte_length: normalized.transferred_byte_length,
        terminal_lf_restored: normalized.terminal_lf_restored
      });
      window.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publishGitHubAgentPluginTrace(request, 'file-view-error', { message });
      GM_setValue(responseKey, {
        request_id: request.request_id,
        ok: false,
        status: null,
        reason: 'FILE_VIEW_ERROR',
        message
      });
    }
  }

  /**
   * Installs the GitHub-side broker when this same userscript is running on the
   * configured private repository page.
   *
   * @returns {boolean} `true` when GitHub broker mode owns this userscript realm.
   */
  function installGitHubAgentPluginBroker() {
    if (location.hostname !== 'github.com') return false;
    const descriptor = DC_AGENT_PLUGIN_DESCRIPTORS?.['chatgpt-web'];
    if (!descriptor) return false;
    const repositoryPath = `/${descriptor.repository}`.toLowerCase();
    if (!location.pathname.toLowerCase().startsWith(repositoryPath)) return false;

    const dispatch = value => {
      handleGitHubAgentPluginRequest(value).catch(error => {
        console.error('[DownloadConversation] GitHub plugin broker failed', error);
      });
    };
    GM_addValueChangeListener(AGENT_PLUGIN_REQUEST_KEY, (_name, _oldValue, newValue) => {
      dispatch(newValue);
    });
    dispatch(GM_getValue(AGENT_PLUGIN_REQUEST_KEY, null));
    return true;
  }

  if (installGitHubAgentPluginBroker()) return;
