   *
   * @returns {void} No value is returned.
   */
  function communicationLogInstallLifecycleObservers() {
    if (communicationLogLifecycleInstalled) return;
    communicationLogLifecycleInstalled = true;
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
    });
  }

  /**
   * Activates disk logging for one granted directory and the current conversation.
   *
   * @param {Object} handle - Granted FileSystemDirectoryHandle.
   * @returns {Promise<boolean>} True when logging becomes ready.
   */
  async function communicationLogActivateDirectory(handle) {
    logDiagnostic('debug', 'communication-log-activation-entered', {
      directory_handle_present: Boolean(handle)
    });
    const conversationName = await communicationLogWaitForConversationName();
    logDiagnostic('debug', 'communication-log-conversation-name-resolved', {
      available: Boolean(conversationName),
      conversation_id: currentConversationId()
    });
    if (!conversationName) {
      communicationLogShowDirectoryPrompt('Conversation title is not available yet.');
      return false;
    }
    communicationLogDirectoryHandle = handle;
    communicationLogFileName = `DownloadConversation_${conversationFileBaseName()}.jsonl`;
    if (/^DownloadConversation_(?:ChatGPT|ChatGPT conversation)\.jsonl$/i.test(communicationLogFileName)) {
      const projectName = conversationProjectName();
      const fallbackBase = projectName
        ? `${sanitizeFileName(projectName)} - ${conversationName}`
        : conversationName;
      communicationLogFileName = `DownloadConversation_${fallbackBase}.jsonl`;
    }
    logDiagnostic('debug', 'communication-log-segment-initialize-call-started', {
      initializer_type: typeof communicationLogInitializeSegmentStorage
    });
    await communicationLogInitializeSegmentStorage();
    logDiagnostic('debug', 'communication-log-swap-recovery-started', {
      file_name: communicationLogActiveFileName
    });
    await communicationLogRecoverSwapFiles();
    logDiagnostic('debug', 'communication-log-swap-recovery-completed', {
      file_name: communicationLogActiveFileName
    });
    communicationLogReady = true;
    communicationLogStorageFailed = false;
    const recoveredDuplicateRequest =
      communicationLogSegmentManifest?.duplicate_request
        ? { ...communicationLogSegmentManifest.duplicate_request }
        : null;
    logDiagnostic('debug', 'communication-log-recorder-ready', {
      file_name: communicationLogFileName,
      segment_directory: communicationLogSegmentDirectoryName(),
      active_segment_bytes: communicationLogActiveSegmentBytes,
      historical_segments: (await communicationLogHistoricalSegmentsFromDirectory()).length
    });
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
      project_name: conversationProjectName(),
      file_name: communicationLogFileName,
      page_url: stockNetworkSafeUrl(location.href),
      navigation_type: navigation?.type ?? null,
      time_origin: performance.timeOrigin,
      dropped_before_ready: communicationLogDroppedBeforeReady
    });
    communicationLogDroppedBeforeReady = 0;
    if (recoveredDuplicateRequest) {
      queueMicrotask(() => {
        void communicationLogArchiveDuplicate(recoveredDuplicateRequest)
          .catch(error => communicationLogReportFailure('duplicate-restart', error));
      });
    }
    return true;
  }

  /**
   * Displays a user-gesture directory authorization prompt required by File System Access.
   *
   * @param {string} reason - Why directory authorization is required.
   * @returns {void} No value is returned.
   */
  /**
   * Keeps a COMM file/storage failure from masquerading as lost folder permission.
   * The diagnostic remains available in GEN; ChatGPT page interaction is restored.
   *
   * @param {string} stage - Failing recorder operation.
   * @param {Object} error - Original exception.
   * @returns {void} No value is returned.
   */
  function communicationLogSuspendDirectoryAfterStorageFailure(stage, error) {
    communicationLogStorageFailed = true;
    communicationLogDisarmDirectoryGesture();
    document.getElementById('tm-communication-directory-required')?.remove();
    communicationLogPromptShown = false;
    logDiagnostic('warnings', 'communication-log-storage-unavailable', {
      stage,
      message: boundedDiagnosticText(errorMessage(error), 2000)
    });
  }

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
    // A peer grant can already be activating this tab; never start another authorisation.
    if (communicationLogReady || communicationLogDirectoryRestorePromise) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const pickerWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const savedHandle = communicationLogDirectoryReselectRequired
      ? null : communicationLogPendingDirectoryHandle;
    let pickerPromise;
    try {
      communicationLogDirectoryPickerOpening = true;
      if (savedHandle && typeof savedHandle.requestPermission === 'function') {
        // The permission request, like the picker, must run before activation expires.
        pickerPromise = Promise.resolve(savedHandle.requestPermission({ mode: 'readwrite' }))
          .then(permission => {
            if (permission !== 'granted') {
              communicationLogPendingDirectoryHandle = null;
              communicationLogDirectoryReselectRequired = true;
              throw new Error('Saved folder access was not granted. Click again to choose a folder.');
            }
            return savedHandle;
          });
      } else {
        if (typeof pickerWindow.showDirectoryPicker !== 'function') {
          throw new Error('This browser does not expose showDirectoryPicker().');
        }
        pickerPromise = pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
      }
    } catch (error) {
      communicationLogDirectoryPickerOpening = false;
      communicationLogReportFailure('directory-authorization', error);
      return;
    }

    let storageAttempted = false;
    Promise.resolve(pickerPromise)
      .then(async handle => {
        const permission = await communicationLogPermissionState(handle);
        if (permission !== 'granted') {
          throw new Error('The selected folder did not grant read/write permission.');
        }
        storageAttempted = true;
        await communicationLogStoreDirectoryHandle(handle);
        communicationLogDirectoryReselectRequired = false;
        communicationLogPendingDirectoryHandle = handle;
        await communicationLogActivateDirectory(handle);
      })
      .catch(error => {
        if (error?.name === 'AbortError') {
          logDiagnostic('debug', 'communication-directory-picker-cancelled', {});
        } else {
          communicationLogReportFailure('directory-authorization', error);
          if (storageAttempted) {
            communicationLogSuspendDirectoryAfterStorageFailure('directory-authorization', error);
          } else if (communicationLogDirectoryReselectRequired) {
            document.getElementById('tm-communication-directory-required')?.remove();
            communicationLogPromptShown = false;
            communicationLogShowDirectoryPrompt('Saved folder access was denied; choose a new folder.');
          }
        }
      })
      .finally(() => {
        communicationLogDirectoryPickerOpening = false;
        // A peer can finish authorisation while this tab's chooser is open.
        if (!communicationLogReady) void communicationLogRetryStoredDirectory();
      });
  }

  /**
   * Blocks page interaction until the next trusted click or key press can open the native chooser.
   *
   * @param {string} reason - Why directory authorization is required.
   * @returns {void} No value is returned.
   */
  function communicationLogShowDirectoryPrompt(reason) {
    if (communicationLogStorageFailed) return;
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
      // Another restored tab can authorise this one before deferred mounting occurs.
      if (!communicationLogPromptShown || communicationLogReady) return;
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
      const action = communicationLogPendingDirectoryHandle && !communicationLogDirectoryReselectRequired
        ? 'reauthorise the saved folder' : 'open the native folder chooser';
      card.textContent = `DownloadConversation needs a writable folder for the communication log. Click or press any key to ${action}. ${reason}`;
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
    logDiagnostic('debug', 'communication-log-startup-entered', {});
    communicationLogInstallDirectoryRetryObservers();
    try {
      const handle = await communicationLogLoadDirectoryHandle();
      logDiagnostic('debug', 'communication-log-directory-restore-completed', {
        handle_present: Boolean(handle)
      });
      communicationLogPendingDirectoryHandle = handle;
      if (!handle) {
        communicationLogShowDirectoryPrompt('No log folder has been authorized for this browser profile.');
        return false;
      }
      const permission = await communicationLogPermissionState(handle);
      logDiagnostic('debug', 'communication-log-directory-permission-checked', {
        permission
      });
      if (permission !== 'granted') {
        communicationLogShowDirectoryPrompt('The saved folder needs authorisation.');
        return false;
      }
      return await communicationLogActivateDirectory(handle);
    } catch (error) {
      try {
        logDiagnostic('warnings', 'communication-log-startup-caught', {
          name: String(error?.name ?? ''),
          message: String(error?.message ?? error),
          stack: boundedDiagnosticText(String(error?.stack ?? ''), 6000)
        });
      } catch (diagnosticError) {
        logConsoleDiagnostic(
          'warnings',
          '[DownloadConversation] communication recorder startup diagnostic failed',
          {
            startup_error: String(error?.message ?? error),
            diagnostic_error: String(diagnosticError?.message ?? diagnosticError)
          }
        );
      }
      communicationLogReportFailure('startup', error);
      communicationLogSuspendDirectoryAfterStorageFailure('startup', error);
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

