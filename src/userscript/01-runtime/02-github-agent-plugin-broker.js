
  /** Shared Tampermonkey storage key carrying the newest private-plugin request. */
  const AGENT_PLUGIN_REQUEST_KEY = 'downloadconversation:agent-plugin-request';
  /** Shared Tampermonkey storage prefix for one private-plugin broker response. */
  const AGENT_PLUGIN_RESPONSE_PREFIX = 'downloadconversation:agent-plugin-response:';
  /** Maximum age accepted for a browser-broker request. */
  const AGENT_PLUGIN_REQUEST_MAX_AGE_MS = 2 * 60 * 1000;

  /**
   * Constructs the authenticated same-origin GitHub raw-file URL selected by one
   * public plugin descriptor.
   *
   * @param {Object} descriptor - Public plugin selector and integrity metadata.
   * @returns {string} HTTPS GitHub URL fetched inside the authenticated GitHub tab.
   */
  function githubAgentPluginRawUrl(descriptor) {
    const [owner, repository] = String(descriptor.repository).split('/');
    assert(owner && repository, 'Agent plugin repository identity is invalid.');
    const ref = encodeURIComponent(descriptor.ref);
    const artifactPath = String(descriptor.path)
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/');
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/raw/${ref}/${artifactPath}`;
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
   * Handles one private-plugin request inside GitHub's own authenticated origin.
   * Browser session cookies remain owned by GitHub/Chrome and are never copied into
   * DownloadConversation storage or exposed to ChatGPT.
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
    try {
      const response = await fetch(githubAgentPluginRawUrl(descriptor), {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow'
      });
      if (!response.ok) {
        GM_setValue(responseKey, {
          request_id: request.request_id,
          ok: false,
          status: response.status,
          reason: response.status === 404 ? 'ACCESS_DENIED_OR_NOT_FOUND' : 'HTTP_ERROR'
        });
        return;
      }
      const source = await response.text();
      GM_setValue(responseKey, {
        request_id: request.request_id,
        ok: true,
        source
      });
    } catch (error) {
      GM_setValue(responseKey, {
        request_id: request.request_id,
        ok: false,
        status: null,
        reason: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : String(error)
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
