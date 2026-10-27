  /**
   * Records stock fetch response metadata and starts bounded identity inspection.
   *
   * @param {Response} response - Original page response, left untouched for ChatGPT.
   * @param {Object} trace - Request/response correlation state.
   * @returns {void} No value is returned.
   */
  function stockNetworkTraceFetchResponse(response, trace) {
    const contentType = response?.headers?.get?.('content-type') ?? '';
    logDiagnostic('debug', 'stock-network-fetch-response', {
      network_sequence: trace.sequence,
      method: trace.method,
      url: trace.url,
      response_url: stockNetworkSafeUrl(response?.url ?? ''),
      status: response?.status ?? null,
      ok: response?.ok === true,
      type: response?.type ?? null,
      redirected: response?.redirected === true,
      duration_ms: Math.round(performance.now() - trace.started_at),
      content_type: boundedDiagnosticText(contentType, 500),
      response_headers: stockNetworkSafeResponseHeaders(response?.headers)
    });
    const inspectable = trace.same_origin && (
      /(?:json|text|event-stream|x-component|javascript)/i.test(contentType) ||
      /\/backend-api\/(?:conversation|conversations|f\/conversation)(?:\/|\?|$)/.test(trace.url)
    );
    if (!inspectable) return;
    const cloned = cloneSafely(response);
    if (cloned) void stockNetworkInspectFetchBody(cloned, trace);
  }

  /**
   * Starts one stock page XHR diagnostic observation.
   *
   * @param {XMLHttpRequest} xhr - Page XHR instance.
   * @param {Object} info - Captured XHR method/URL/header metadata.
   * @returns {Object} Correlation state for loadend.
   */
  function stockNetworkTraceXhrStart(xhr, info, captured = null) {
    const sequence = captured?.network_sequence ?? ++stockNetworkSequence;
    const trace = {
      sequence,
      started_at: captured?.captured_at_mono_ms ?? performance.now(),
      method: String(info?.method ?? 'GET').toUpperCase(),
      url: stockNetworkSafeUrl(info?.url ?? '')
    };
    logDiagnostic('debug', 'stock-network-xhr-start', {
      network_sequence: sequence,
      method: trace.method,
      url: trace.url,
      response_type: xhr?.responseType || null,
      headers: stockNetworkRequestHeaderSummary(info?.headers)
    });
    return trace;
  }

  /**
   * Parses XHR raw response headers into a Headers-like safe lookup object.
   *
   * @param {XMLHttpRequest} xhr - Completed page XHR instance.
   * @returns {Object} Headers-like object with get(name).
   */
  function stockNetworkXhrHeaderLookup(xhr) {
    const values = {};
    try {
      for (const line of String(xhr?.getAllResponseHeaders?.() ?? '').split(/\r?\n/)) {
        const split = line.indexOf(':');
        if (split <= 0) continue;
        values[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
      }
    } catch {}
    return { get: name => values[String(name).toLowerCase()] ?? null };
  }

  /**
   * Records completed stock XHR response metadata and bounded identity information.
   *
   * @param {XMLHttpRequest} xhr - Completed page XHR instance.
   * @param {Object} trace - Request/response correlation state.
   * @returns {void} No value is returned.
   */
  function stockNetworkTraceXhrResponse(xhr, trace) {
    const headerLookup = stockNetworkXhrHeaderLookup(xhr);
    const contentType = headerLookup.get('content-type') ?? '';
    let bodyIdentity = null;
    try {
      if (xhr.responseType === 'json' && xhr.response && typeof xhr.response === 'object') {
        bodyIdentity = { json_identity: stockNetworkJsonIdentitySummary(xhr.response) };
      } else if (!xhr.responseType || xhr.responseType === 'text') {
        const rawText = String(xhr.responseText ?? '');
        const boundedText = rawText.slice(0, STOCK_NETWORK_JSON_BYTE_LIMIT);
        bodyIdentity = {
          ...stockNetworkBodyIdentity(boundedText, contentType),
          truncated: rawText.length > boundedText.length
        };
      }
    } catch {}
    logDiagnostic('debug', 'stock-network-xhr-response', {
      network_sequence: trace.sequence,
      method: trace.method,
      url: trace.url,
      response_url: stockNetworkSafeUrl(xhr?.responseURL ?? ''),
      status: Number.isFinite(xhr?.status) ? xhr.status : null,
      duration_ms: Math.round(performance.now() - trace.started_at),
      content_type: boundedDiagnosticText(contentType, 500),
      response_headers: stockNetworkSafeResponseHeaders(headerLookup),
      body_identity: bodyIdentity
    });
  }
  // END Issue #123 stock network diagnostics


  // BEGIN Issue #123 disk communication recorder
  /** Interval between dirty communication-log checkpoints. */
  /** Long-lived writable stream used by normal communication-log appends. */
  let communicationLogWritable = null;
  /** Whether the current long-lived writable contains bytes not yet checkpointed. */
  let communicationLogWriterDirty = false;
  /** Exact accepted byte count in the current active raw segment. */
  let communicationLogActiveBytes = null;
  /** Periodic checkpoint timer installed once communication logging becomes active. */
  /**
   * Opens the IndexedDB database that retains the authorized directory handle.
   *
   * @returns {Promise<IDBDatabase>} Open handle database.
   */
  function communicationLogOpenDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(COMMUNICATION_LOG_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(COMMUNICATION_LOG_DB_STORE)) {
          db.createObjectStore(COMMUNICATION_LOG_DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open communication-log handle database.'));
    });
  }

  /**
   * Loads the previously selected communication-log directory handle.
   *
   * @returns {Promise<Object|null>} Persisted directory handle, or null when none exists.
   */
  async function communicationLogLoadDirectoryHandle() {
    const db = await communicationLogOpenDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(COMMUNICATION_LOG_DB_STORE, 'readonly')
          .objectStore(COMMUNICATION_LOG_DB_STORE)
          .get(COMMUNICATION_LOG_HANDLE_KEY);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error ?? new Error('Could not load communication-log directory handle.'));
      });
    } finally {
      db.close();
    }
  }

  /**
   * Persists one authorized communication-log directory handle for later reloads.
   *
   * @param {Object} handle - FileSystemDirectoryHandle selected by the user.
   * @returns {Promise<void>} Resolves after IndexedDB stores the handle.
   */
  async function communicationLogStoreDirectoryHandle(handle) {
    const db = await communicationLogOpenDb();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(COMMUNICATION_LOG_DB_STORE, 'readwrite');
        transaction.objectStore(COMMUNICATION_LOG_DB_STORE).put(handle, 'communication-directory');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Could not store communication-log directory handle.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Communication-log directory transaction aborted.'));
      });
      // Notify only after the shared handle is durably committed in IndexedDB.
      try {
        localStorage.setItem(COMMUNICATION_LOG_DIRECTORY_SIGNAL_KEY,
          `${Date.now()}:${crypto.randomUUID()}`);
      } catch (error) {
        logDiagnostic('warnings', 'communication-directory-notification-failed', {
          message: String(error?.message ?? error)
        });
      }
    } finally {
      db.close();
    }
  }

  /**
   * Retries the shared directory handle when another tab grants permission or this tab is focused.
   *
   * @returns {Promise<boolean>} True if the saved handle has become ready.
   */
  async function communicationLogRetryStoredDirectory() {
    if (communicationLogReady || communicationLogDirectoryPickerOpening ||
        communicationLogDirectoryReselectRequired || communicationLogStorageFailed) return false;
    if (communicationLogDirectoryRestorePromise) return communicationLogDirectoryRestorePromise;
    // Startup already checks the same handle; defer concurrent notifications until it finishes.
    if (communicationLogInitializationPromise && !communicationLogPromptShown) return false;

    const restore = (async () => {
      const handle = await communicationLogLoadDirectoryHandle();
      if (!handle) return false;
      communicationLogPendingDirectoryHandle = handle;
      if (await communicationLogPermissionState(handle) !== 'granted') return false;
      return communicationLogActivateDirectory(handle);
    })();
    communicationLogDirectoryRestorePromise = restore;
    try {
      return await restore;
    } catch (error) {
      communicationLogReportFailure('directory-cross-tab-restore', error);
      communicationLogSuspendDirectoryAfterStorageFailure('directory-cross-tab-restore', error);
      return false;
    } finally {
      communicationLogDirectoryRestorePromise = null;
    }
  }

  /**
   * Installs lightweight permission-retry observers for all restored tabs.
   *
   * @returns {void} No value is returned.
   */
  function communicationLogInstallDirectoryRetryObservers() {
    if (communicationLogDirectoryRetryInstalled) return;
    communicationLogDirectoryRetryInstalled = true;
    window.addEventListener('storage', event => {
      if (event.key !== COMMUNICATION_LOG_DIRECTORY_SIGNAL_KEY) return;
      void communicationLogRetryStoredDirectory();
    });
    window.addEventListener('focus', () => {
      if (!communicationLogReady) void communicationLogRetryStoredDirectory();
    });
  }

  /**
   * Reads current read/write permission for one File System Access directory handle.
   *
   * @param {Object|null} handle - Candidate FileSystemDirectoryHandle.
   * @returns {Promise<string>} Browser permission state.
   */
  async function communicationLogPermissionState(handle) {
    if (!handle || typeof handle.queryPermission !== 'function') return 'denied';
    return handle.queryPermission({ mode: 'readwrite' });
  }

  /**
   * Returns the current conversation title, preferring a previously retained title during early reload startup.
   *
   * @returns {string|null} Sanitized conversation name, or null before a usable title is known.
   */
  function communicationLogConversationName() {
    const conversationId = currentConversationId();
    const storageKey = `${COMMUNICATION_LOG_TITLE_STORAGE_PREFIX}${conversationId ?? 'unknown'}`;
    const current = sanitizeFileName(conversationTitle());
    const currentUsable = usableConversationTitle(current);
    if (currentUsable) {
      try { localStorage.setItem(storageKey, current); } catch {}
      return current;
    }
    try {
      const stored = localStorage.getItem(storageKey);
      return stored && usableConversationTitle(stored) ? sanitizeFileName(stored) : null;
    } catch {
      return null;
    }
  }

  /**
   * Waits briefly for the conversation title needed by the required disk-log filename.
   *
   * @returns {Promise<string|null>} Sanitized title when available, otherwise null.
   */
  async function communicationLogWaitForConversationName() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const name = communicationLogConversationName();
      if (name) return name;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }

  /**
   * Commits queued communication-log state at a hard document-departure boundary.
   *
   * Browser lifecycle events start this operation on a best-effort basis because
   * the browser does not promise to await arbitrary asynchronous unload work.
   * DownloadConversation-initiated full-document navigation must await this same
   * function before changing location.
   *
   * @param {string} reason - Lifecycle boundary identifying why the document is departing.
   * @returns {Promise<boolean>} True when dirty writer bytes were checkpointed.
   */
  function communicationLogCheckpointForDocumentDeparture(reason) {
    return communicationLogCheckpoint(reason);
  }

  /**
   * Installs page/session lifecycle records after the disk recorder becomes writable.
