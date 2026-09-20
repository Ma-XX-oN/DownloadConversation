   *
   * @returns {void} No value is returned.
   */
  function communicationLogInstallLifecycleObservers() {
    if (communicationLogLifecycleInstalled) return;
    communicationLogLifecycleInstalled = true;
    communicationLogCheckpointTimer = setInterval(() => void communicationLogCheckpoint('periodic'), COMMUNICATION_LOG_CHECKPOINT_MS);
    window.addEventListener('beforeunload', () => {
      void communicationLogCheckpointForDocumentDeparture('beforeunload');
    });
    window.addEventListener('pagehide', event => {
      void communicationLogRecord('communication_pagehide', {
        persisted: event.persisted === true,
        visibility_state: document.visibilityState
      });
      void communicationLogCheckpointForDocumentDeparture('pagehide');
    });
    document.addEventListener('visibilitychange', () => {
      void communicationLogRecord('communication_visibility_change', {
        visibility_state: document.visibilityState
      });
      if (document.visibilityState === 'hidden') {
        void communicationLogCheckpoint('visibility-hidden');
      }
    });
  }

  /**
   * Activates disk logging for one granted directory and the current conversation.
   *
   * @param {Object} handle - Granted FileSystemDirectoryHandle.
   * @returns {Promise<boolean>} True when logging becomes ready.
   */
  async function communicationLogActivateDirectory(handle) {
    const conversationName = await communicationLogWaitForConversationName();
    if (!conversationName) {
      communicationLogShowDirectoryPrompt('Conversation title is not available yet.');
      return false;
    }
    communicationLogDirectoryHandle = handle;
    communicationLogFileName = `DownloadConversation_${sanitizeFileName(conversationTitle())}.jsonl`;
    if (/^DownloadConversation_(?:ChatGPT|ChatGPT conversation)\.jsonl$/i.test(communicationLogFileName)) {
      communicationLogFileName = `DownloadConversation_${conversationName}.jsonl`;
    }
    await communicationLogRecoverSwapFiles();
    communicationLogReady = true;
    communicationLogDisarmDirectoryGesture();
    document.getElementById('tm-communication-directory-required')?.remove();
    communicationLogPromptShown = false;
    communicationLogInstallLifecycleObservers();
    const navigation = performance.getEntriesByType?.('navigation')?.[0] ?? null;
    await communicationLogRecord('communication_session_start', {
      script_version: VERSION,
      core_version: CORE_VERSION,
      conversation_id: currentConversationId(),
      conversation_name: conversationName,
      file_name: communicationLogFileName,
      page_url: stockNetworkSafeUrl(location.href),
      navigation_type: navigation?.type ?? null,
      time_origin: performance.timeOrigin,
      dropped_before_ready: communicationLogDroppedBeforeReady
    });
    communicationLogDroppedBeforeReady = 0;
    return true;
  }

  /**
   * Displays a user-gesture directory authorization prompt required by File System Access.
   *
   * @param {string} reason - Why directory authorization is required.
   * @returns {void} No value is returned.
   */
  /**
   * Removes the trusted-gesture listeners once directory authorization succeeds.
   *
   * @returns {void} No value is returned.
   */
  function communicationLogDisarmDirectoryGesture() {
    if (!communicationLogDirectoryGestureArmed) return;
    communicationLogDirectoryGestureArmed = false;
    window.removeEventListener('click', communicationLogHandleDirectoryGesture, true);
    window.removeEventListener('keydown', communicationLogHandleDirectoryGesture, true);
  }

  /**
   * Uses the first trusted page interaction to launch the native directory chooser directly.
   *
   * The File System Access picker call must remain synchronous with this trusted event; no
   * awaited work may occur before `showDirectoryPicker()` or Chromium will discard transient
   * user activation.
   *
   * @param {Event} event - Trusted click or keydown reserved for directory authorization.
   * @returns {void} No value is returned.
   */
  function communicationLogHandleDirectoryGesture(event) {
    if (!communicationLogDirectoryGestureArmed || communicationLogDirectoryPickerOpening) return;
    if (event.isTrusted !== true) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const pickerWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (typeof pickerWindow.showDirectoryPicker !== 'function') {
      communicationLogReportFailure(
        'directory-authorization',
        new Error('This browser does not expose showDirectoryPicker().')
      );
      return;
    }

    let pickerPromise;
    try {
      communicationLogDirectoryPickerOpening = true;
      pickerPromise = pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
    } catch (error) {
      communicationLogDirectoryPickerOpening = false;
      communicationLogReportFailure('directory-authorization', error);
      return;
    }

    Promise.resolve(pickerPromise)
      .then(async handle => {
        const permission = await communicationLogPermissionState(handle);
        if (permission !== 'granted') {
          throw new Error('The selected folder did not grant read/write permission.');
        }
        await communicationLogStoreDirectoryHandle(handle);
        await communicationLogActivateDirectory(handle);
      })
      .catch(error => {
        if (error?.name === 'AbortError') {
          logDiagnostic('debug', 'communication-directory-picker-cancelled', {});
        } else {
          communicationLogReportFailure('directory-authorization', error);
        }
      })
      .finally(() => {
        communicationLogDirectoryPickerOpening = false;
      });
  }

  /**
   * Blocks page interaction until the next trusted click or key press can open the native chooser.
   *
   * @param {string} reason - Why directory authorization is required.
   * @returns {void} No value is returned.
   */
  function communicationLogShowDirectoryPrompt(reason) {
    logDiagnostic('warnings', 'communication-directory-required', { reason });
    if (!communicationLogDirectoryGestureArmed) {
      communicationLogDirectoryGestureArmed = true;
      window.addEventListener('click', communicationLogHandleDirectoryGesture, { capture: true });
      window.addEventListener('keydown', communicationLogHandleDirectoryGesture, { capture: true });
    }
    if (communicationLogPromptShown) return;
    communicationLogPromptShown = true;

    /**
     * Mounts the blocking explanation after the document body exists.
     *
     * @returns {void} No value is returned.
     */
    const mount = () => {
      if (!document.body) {
        requestAnimationFrame(mount);
        return;
      }
      if (document.getElementById('tm-communication-directory-required')) return;
      const prompt = document.createElement('div');
      prompt.id = 'tm-communication-directory-required';
      prompt.tabIndex = -1;
      prompt.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#000a;color:#fff;font:14px/1.5 system-ui,sans-serif;cursor:pointer';
      const card = document.createElement('div');
      card.style.cssText = 'max-width:520px;padding:18px;border:1px solid #888;border-radius:10px;background:#202123;box-shadow:0 6px 24px #000a';
      card.textContent = `DownloadConversation needs a writable folder for the communication log. Click or press any key to open the native folder chooser. ${reason}`;
      prompt.append(card);
      document.body.append(prompt);
      try { prompt.focus({ preventScroll: true }); } catch {}
    };
    mount();
  }

  /**
   * Restores the persisted communication-log directory and starts disk logging when permission permits.
   *
   * @returns {Promise<boolean>} True when a saved writable directory was activated.
   */
  async function initializeCommunicationDiskRecorder() {
    try {
      const handle = await communicationLogLoadDirectoryHandle();
      if (!handle) {
        communicationLogShowDirectoryPrompt('No log folder has been authorized for this browser profile.');
        return false;
      }
      const permission = await communicationLogPermissionState(handle);
      if (permission !== 'granted') {
        communicationLogShowDirectoryPrompt('The saved log folder is no longer authorized; choose it again.');
        return false;
      }
      return communicationLogActivateDirectory(handle);
    } catch (error) {
      communicationLogReportFailure('startup', error);
      communicationLogShowDirectoryPrompt('The saved log folder could not be restored.');
      return false;
    }
  }

  /**
   * Redacts credential-bearing headers while retaining ordinary protocol/cache/routing metadata.
   *
   * @param {Object} headers - Headers-like or plain header collection.
   * @returns {Object} Header map safe to persist to the communication log.
   */
  function communicationLogSafeHeaders(headers) {
    const raw = rawHeadersToObject(headers);
    const safe = {};
    for (const [name, value] of Object.entries(raw).slice(0, 200)) {
      if (/(?:^|[-_])(?:authorization|cookie|set-cookie|proxy-authorization|access-token|refresh-token|api-key|csrf|xsrf|session|jwt|secret)(?:$|[-_])/i.test(name)) {
        safe[name] = '[redacted]';
      } else {
        safe[name] = boundedDiagnosticText(communicationLogRedactText(value), 4000);
      }
    }
    return safe;
  }

  /**
   * Finds the earliest sensitive-value prefix in uncommitted communication text.
   *
   * @param {string} text - Uncommitted text held by the streaming redactor.
   * @returns {Object|null} Trigger descriptor, or null when no complete prefix is present.
   */
  function communicationLogFindSecretTrigger(text) {
    const candidates = [];
    const query = /[?&](?:sig|signature|access_token|refresh_token|token|key|secret|auth|authorization|session|jwt|api_key)=/i.exec(text);
    if (query) candidates.push({ index: query.index, prefix: query[0], kind: 'query', terminator: null });
    const bearer = /\bBearer\s+/i.exec(text);
    if (bearer) candidates.push({ index: bearer.index, prefix: bearer[0], kind: 'bearer', terminator: null });
    const quoted = /(?:\"|')?(?:access_token|refresh_token|authorization|cookie|session|jwt|api[_-]?key|secret)(?:\"|')?\s*:\s*(\"|')/i.exec(text);
    if (quoted) candidates.push({ index: quoted.index, prefix: quoted[0], kind: 'quoted', terminator: quoted[1] });
    if (!candidates.length) return null;
    candidates.sort((left, right) => left.index - right.index || right.prefix.length - left.prefix.length);
    return candidates[0];
  }

