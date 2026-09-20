
(() => {
  'use strict';

  /** Installed userscript version reported in diagnostics and runtime metadata. */
  const VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || 'unknown';
  /** Loaded AIConversationCore semantic version derived from the pinned dependency. */
  const CORE_VERSION = canonicalCore().getVersion();
  /** DOM id of the recorder panel so UI lookups share one stable selector. */
  const PANEL_ID = 'tm-conversation-recorder';
  /** DOM id of the floating launcher button that opens the recorder panel. */
  const LAUNCHER_ID = 'tm-conversation-recorder-launcher';
  /** Enables invasive launcher topology/call-stack diagnostics when manually set true. */
  const DEEP_LAUNCHER_DIAGNOSTICS = false;
  /** Numeric severity ordering used to decide which diagnostic entries are emitted. */
  const DIAGNOSTIC_LEVELS = Object.freeze({ errors: 0, warnings: 1, debug: 2, verbose: 3 });
  /** Default diagnostic threshold when the user has not stored a preference. */
  const DEFAULT_DIAGNOSTICS = 'warnings';
  /** Conversation API page size requested while walking backward through history. */
  const PAGE_TURNS = 100;
  /** Safety cap that prevents malformed pagination from running without bound. */
  const MAX_PAGES = 10000;
  /** Local-storage key for the keep-screen-on capture preference. */
  const SCREEN_ON_STORAGE_KEY = 'tm-conversation-recorder-screen-on-when-capturing';
  /** Local-storage key for Markdown heading timestamp visibility. */
  const SHOW_TIMESTAMPS_STORAGE_KEY = 'tm-conversation-recorder-show-timestamps';
  /** Local-storage key for Markdown JSONL record-number visibility. */
  const SHOW_RECORD_NUMBERS_STORAGE_KEY = 'tm-conversation-recorder-show-record-numbers';
  /** Local-storage key for Markdown source/provider turn-ID visibility. */
  const SHOW_TURN_IDS_STORAGE_KEY = 'tm-conversation-recorder-show-turn-ids';
  /** Local-storage key for Markdown Core debug-provenance visibility. */
  const SHOW_DEBUG_PROVENANCE_STORAGE_KEY = 'tm-conversation-recorder-show-debug-provenance';
  /** Local-storage key for the current integer agent terminal-sound volume. */
  const AGENT_SOUND_VOLUME_STORAGE_KEY = 'tm-conversation-recorder-agent-sound-volume';
  /** Legacy boolean sound preference retained only for deterministic migration. */
  const LEGACY_AGENT_SOUNDS_STORAGE_KEY = 'tm-conversation-recorder-agent-sounds';
  /** Yellow RGB used while Agent processing is observed. */
  const AGENT_FAVICON_PROCESSING_RGB = Object.freeze([255, 255, 0]);
  /** Light-green RGB used after a current-page successful completion. */
  const AGENT_FAVICON_COMPLETED_RGB = Object.freeze([144, 238, 144]);
  /** Red RGB used after a normalized Agent terminal error. */
  const AGENT_FAVICON_ERROR_RGB = Object.freeze([255, 0, 0]);
  /** DOM id of the fixed agent-turn stopwatch display. */
  const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';
  /** Refresh cadence for the live agent-turn stopwatch display. */
  const AGENT_STOPWATCH_REFRESH_MS = 250;
  /** Local-storage key for continued console mirroring after the status panel first appears. */
  const CONSOLE_DIAGNOSTICS_STORAGE_KEY = 'tm-conversation-recorder-console-diagnostics';
  /** Session-storage key for the retained recorder diagnostic log. */
  const DIAGNOSTIC_LOG_STORAGE_KEY = 'tm-conversation-recorder-diagnostic-log';
  /** Maximum number of diagnostic entries retained in memory and session storage. */
  const MAX_DIAGNOSTIC_LOG_ITEMS = 10000;
  /** Maximum retained diagnostic entries persisted across a page reload. */
  const MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS = 5000;
  /** Debounce used to keep high-volume debug diagnostics from serializing the full log on every event. */
  const DIAGNOSTIC_PERSIST_DELAY_MS = 1000;
  /** Maximum number of legitimate forward tail markers retained for export consistency checks. */
  const LIVE_TAIL_MARKER_LIMIT = 10;
  /** Maximum normalized visible characters retained per live tail marker for bounded comparison. */
  const LIVE_TAIL_TEXT_LIMIT = 8192;
  /** Session-storage key for the newest exact streamed conversation-turn capture. */
  const STREAM_TAIL_STORAGE_KEY = 'tm-conversation-recorder-stream-tail';
  /** Maximum source records retained from one live streamed conversation turn. */
  const STREAM_TAIL_RECORD_LIMIT = 512;
  /** Maximum message identities retained in one stock-network body summary. */
  const STOCK_NETWORK_ID_LIMIT = 64;
  /** Maximum response-body bytes inspected for stock-network identity diagnostics. */
  const STOCK_NETWORK_JSON_BYTE_LIMIT = 1024 * 1024;
  /** IndexedDB database retaining the user-authorized communication-log directory handle. */
  const COMMUNICATION_LOG_DB_NAME = 'downloadconversation-communication-log';
  /** IndexedDB object store containing File System Access handles. */
  const COMMUNICATION_LOG_DB_STORE = 'handles';
  /** Stable IndexedDB key for the communication-log directory handle. */
  const COMMUNICATION_LOG_HANDLE_KEY = 'communication-directory';
  /** Prefix used to retain the last known conversation title for immediate reload logging. */
  const COMMUNICATION_LOG_TITLE_STORAGE_PREFIX = 'tm-downloadconversation-communication-title:';
  /** Maximum decoded text retained before one communication body chunk is flushed to disk. */
  const COMMUNICATION_LOG_BODY_CHUNK_CHARS = 256 * 1024;
  /** Maximum wait for startup directory restoration before a cloned network body is abandoned. */
  const COMMUNICATION_LOG_READY_WAIT_MS = 2000;
  /** Bounded retry count for Chromium stale File System Access interface state. */
  const COMMUNICATION_LOG_WRITE_RETRY_LIMIT = 3;
  /** Byte comparison chunk size used to verify ambiguous append outcomes. */
  const COMMUNICATION_LOG_COMPARE_CHUNK_BYTES = 256 * 1024;

  /** Unwrapped page-realm fetch implementation captured before installing interception. */
  let originalPageFetch = null;
  /** Latest captured Conversation API authorization/header context for direct requests. */
  let apiRequestContext = null;
  /** Guards network interception so page hooks are installed only once. */
  let captureInstalled = false;
  /** Currently selected diagnostic threshold, restored from local storage at startup. */
  let diagnosticsLevel = localStorage.getItem('tm-conversation-recorder-diagnostics') || DEFAULT_DIAGNOSTICS;
  /** Saved opt-in for console output after startup; independent of panel diagnostic verbosity. */
  let consoleDiagnostics = localStorage.getItem(CONSOLE_DIAGNOSTICS_STORAGE_KEY) === 'true';
  /** One-way startup boundary: hiding or reopening the panel does not restore automatic console output. */
  let generalStatusShown = false;
  /** Whether active exports should request a screen wake lock. */
  let screenOnWhenCapturing = localStorage.getItem(SCREEN_ON_STORAGE_KEY) !== 'false';
  /** Whether Markdown headings should include local-time source timestamps. */
  let showTimestamps = localStorage.getItem(SHOW_TIMESTAMPS_STORAGE_KEY) === 'true';
  /** Whether Markdown headings should include one-based JSONL record numbers. */
  let showRecordNumbers = localStorage.getItem(SHOW_RECORD_NUMBERS_STORAGE_KEY) === 'true';
  /** Whether Markdown headings should include source/provider turn IDs. */
  let showTurnIds = localStorage.getItem(SHOW_TURN_IDS_STORAGE_KEY) === 'true';
  /** Whether Markdown headings should include Core-derived source debug provenance. */
  let showDebugProvenance = localStorage.getItem(SHOW_DEBUG_PROVENANCE_STORAGE_KEY) === 'true';
  /**
   * Loads the persisted 0-10 terminal-sound volume, including the legacy checkbox migration.
   *
   * @returns {number} Integer terminal-sound volume from 0 through 10.
   */
  function loadAgentSoundVolume() {
    const stored = localStorage.getItem(AGENT_SOUND_VOLUME_STORAGE_KEY);
    if (stored !== null) {
      const parsed = Number.parseInt(stored, 10);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0;
    }
    const legacy = localStorage.getItem(LEGACY_AGENT_SOUNDS_STORAGE_KEY);
    if (legacy === 'true') return 10;
    if (legacy === 'false') return 0;
    return 0;
  }

  /** Persisted integer terminal-sound volume; zero is the only disabled state. */
  let agentSoundVolume = loadAgentSoundVolume();
  /** AudioContext unlocked by a user gesture when terminal sounds are enabled. */
  let agentSoundAudioContext = null;
  /** Bounded stable turn identities that have already emitted a terminal sound. */
  const agentSoundTerminalKeys = new Set();
  /** Maximum number of emitted terminal turn identities retained for de-duplication. */
  const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;
  /** Original source href retained per stock favicon link before DownloadConversation recolors it. */
  const agentFaviconOriginalSources = new Map();
  /** Monotonic render generation preventing stale asynchronous favicon writes. */
  let agentFaviconRenderGeneration = 0;
  /** Whether processing has been observed in this loaded page and may transition to green. */
  let agentFaviconProcessingObserved = false;
  /** Current agent-turn stopwatch session, including completed lap durations. */
  let agentStopwatchState = null;
  /** Interval handle refreshing the live agent-turn stopwatch, or null while stopped. */
  let agentStopwatchTimer = null;
  /** Active screen wake-lock handle, or null when no lock is held. */
  let wakeLockSentinel = null;
  /** Serializes export work so overlapping extraction runs cannot start. */
  let exportInProgress = false;
  /** Format of the active export, used by shared status/progress rendering. */
  let exportKind = null;
  /** Persistent status message shown when no structured progress state is active. */
  let statusText = 'Ready.';
  /** Interval handle used to refresh elapsed time and ETA while work is active. */
  let statusTimer = null;
  /** Structured state for the active fetch/render progress display. */
  let progressState = null;
  /** Guards the built-in test runner against overlapping operations. */
  let testInProgress = false;
  /** Guards turn-jump navigation against overlapping operations. */
  let jumpInProgress = false;
  /** Monotonic identifier assigned to click-correlation diagnostic observations. */
  let clickDiagnosticSequence = 0;
  /** Click observation currently collecting correlated network/resource evidence. */
  let activeClickDiagnostic = null;
  /** In-memory diagnostic history mirrored to session storage for the panel. */
  let diagnosticLog = [];
  /** Pending debounced diagnostic-log persistence timer, or null when no write is scheduled. */
  let diagnosticPersistTimer = null;
  /** Whether the recorder panel currently shows the expanded diagnostic history. */
  let diagnosticLogExpanded = false;
  /** Element to refocus after the active recorder modal closes. */
  let lastModalOpener = null;
  /** Conversation id whose live high-water tail is currently retained. */
  let liveTailConversationId = null;
  /** Newest legitimate forward-progression markers retained as a bounded high-water history. */
  let liveTailMarkers = [];
  /** Whether current materialization is historical navigation and therefore cannot advance the high-water tail. */
  let liveTailHistoricalNavigation = false;
  /** Whether an explicit prompt submission currently authorizes User then Assistant tail advancement. */
  let liveTailPromptAdvancePending = false;
  /** Guards live-tail DOM/event tracking so observers are installed only once. */
  let liveTailTrackingInstalled = false;
  /** Coalesces high-volume DOM mutations into one live-tail scan per task. */
  let liveTailScanScheduled = false;
  /** Last observed conversation-scroll position used only to detect upward historical navigation. */
  let liveTailLastScrollTop = null;
  /** Thread element currently carrying mounted virtual-window conversation turns. */
  let liveTailObservedThread = null;
  /** Mutation observer scoped to the current conversation thread. */
  let liveTailThreadObserver = null;
  /** Lightweight root observer used only to detect host replacement of the conversation thread. */
  let liveTailRootObserver = null;
  /** Scroll root currently supplying direction evidence for live-tail tracking. */
  let liveTailObservedScrollRoot = null;
  /** Newest passive /f/conversation streamed-turn capture observed in this page lifetime. */
  let streamTailCapture = null;
  /** Monotonic sequence assigned to stock page fetch/XHR diagnostics in this page lifetime. */
  let stockNetworkSequence = 0;
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
  try {
    const storedDiagnosticLog = JSON.parse(sessionStorage.getItem(DIAGNOSTIC_LOG_STORAGE_KEY) || '[]');
    if (Array.isArray(storedDiagnosticLog)) diagnosticLog = storedDiagnosticLog.slice(-MAX_DIAGNOSTIC_LOG_ITEMS);
  } catch {}

  logConsoleDiagnostic('debug', `[DownloadConversation v${VERSION} | AIConversationCore v${CORE_VERSION}] version identity`);

  /**
   * Handles assert.
   *
   * @param {Object} condition - The condition that must be true.
   * @param {string} message - The assertion failure message.
   * @returns {void} No value is returned.
   */
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  /**
   * Normalizes one thrown value to readable diagnostic text.
   *
