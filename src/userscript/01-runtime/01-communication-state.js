  /** Persisted user-authorized directory used for the disk communication recorder. */
  let communicationLogDirectoryHandle = null;
  /** Whether the next trusted page gesture is reserved for native directory chooser launch. */
  let communicationLogDirectoryGestureArmed = false;
  /** Whether a native directory chooser promise is currently outstanding. */
  let communicationLogDirectoryPickerOpening = false;
  /** Active `DownloadConversation_<conversation>.jsonl` file name. */
  let communicationLogFileName = null;
  /** Serializes append operations so independent network observers cannot overlap file writes. */
  let communicationLogWriteChain = Promise.resolve();
  /** Whether the disk recorder has a writable directory and resolved conversation file name. */
  let communicationLogReady = false;
  /** Guards the required-directory prompt against duplicate page UI. */
  let communicationLogPromptShown = false;
  /** Monotonic sequence assigned to JSONL communication records within this page session. */
  let communicationLogSequence = 0;
  /** Startup restoration promise shared by early intercepted network clones. */
  let communicationLogInitializationPromise = null;
  /** Count of communication records intentionally skipped before disk logging became available. */
  let communicationLogDroppedBeforeReady = 0;
  /** Last newest-Assistant lifecycle signature written to disk, preventing mutation-scan duplicates. */
  let communicationLogLastAssistantLifecycleKey = null;
  /** Guards page/session lifecycle listeners against duplicate installation after reauthorization. */
  let communicationLogLifecycleInstalled = false;
  /** Whether one communication-log file-management action is currently updating panel state. */
  let communicationLogUiActionInProgress = false;
  /** Unique identity correlating all communication records produced by this page lifetime. */
  const communicationLogSessionId = crypto.randomUUID();
