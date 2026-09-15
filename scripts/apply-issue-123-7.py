from pathlib import Path

SOURCE = Path('chatgpt-conversation-markdown-export.user.js')
DESIGN = Path('DESIGN.md')


def replace_once(text: str, old: str, new: str, label: str) -> str:
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


source = SOURCE.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      1.0.1-issue.123.6',
  '// @version      1.0.1-issue.123.7',
  'version'
)

source = replace_once(
  source,
  "  /** Maximum response-body bytes inspected for stock-network identity diagnostics. */\n"
  "  const STOCK_NETWORK_JSON_BYTE_LIMIT = 1024 * 1024;\n",
  "  /** Maximum response-body bytes inspected for stock-network identity diagnostics. */\n"
  "  const STOCK_NETWORK_JSON_BYTE_LIMIT = 1024 * 1024;\n"
  "  /** IndexedDB database retaining the user-authorized communication-log directory handle. */\n"
  "  const COMMUNICATION_LOG_DB_NAME = 'downloadconversation-communication-log';\n"
  "  /** IndexedDB object store containing File System Access handles. */\n"
  "  const COMMUNICATION_LOG_DB_STORE = 'handles';\n"
  "  /** Stable IndexedDB key for the communication-log directory handle. */\n"
  "  const COMMUNICATION_LOG_HANDLE_KEY = 'communication-directory';\n"
  "  /** Prefix used to retain the last known conversation title for immediate reload logging. */\n"
  "  const COMMUNICATION_LOG_TITLE_STORAGE_PREFIX = 'tm-downloadconversation-communication-title:';\n"
  "  /** Maximum decoded text retained before one communication body chunk is flushed to disk. */\n"
  "  const COMMUNICATION_LOG_BODY_CHUNK_CHARS = 256 * 1024;\n"
  "  /** Lookahead retained across body chunks so credential redaction can span ordinary boundaries. */\n"
  "  const COMMUNICATION_LOG_REDACTION_CARRY_CHARS = 4096;\n"
  "  /** Maximum wait for startup directory restoration before a cloned network body is abandoned. */\n"
  "  const COMMUNICATION_LOG_READY_WAIT_MS = 2000;\n"
  "  /** Bounded retry count for Chromium stale File System Access interface state. */\n"
  "  const COMMUNICATION_LOG_WRITE_RETRY_LIMIT = 3;\n"
  "  /** Byte comparison chunk size used to verify ambiguous append outcomes. */\n"
  "  const COMMUNICATION_LOG_COMPARE_CHUNK_BYTES = 256 * 1024;\n",
  'communication constants'
)

source = replace_once(
  source,
  "  /** Monotonic sequence assigned to stock page fetch/XHR diagnostics in this page lifetime. */\n"
  "  let stockNetworkSequence = 0;\n",
  "  /** Monotonic sequence assigned to stock page fetch/XHR diagnostics in this page lifetime. */\n"
  "  let stockNetworkSequence = 0;\n"
  "  /** Persisted user-authorized directory used for the disk communication recorder. */\n"
  "  let communicationLogDirectoryHandle = null;\n"
  "  /** Previously persisted handle awaiting a user-gesture permission renewal. */\n"
  "  let communicationLogPendingDirectoryHandle = null;\n"
  "  /** Active `DownloadConversation_<conversation>.jsonl` file name. */\n"
  "  let communicationLogFileName = null;\n"
  "  /** Serializes append operations so independent network observers cannot overlap file writes. */\n"
  "  let communicationLogWriteChain = Promise.resolve();\n"
  "  /** Whether the disk recorder has a writable directory and resolved conversation file name. */\n"
  "  let communicationLogReady = false;\n"
  "  /** Guards the required-directory prompt against duplicate page UI. */\n"
  "  let communicationLogPromptShown = false;\n"
  "  /** Monotonic sequence assigned to JSONL communication records within this page session. */\n"
  "  let communicationLogSequence = 0;\n"
  "  /** Startup restoration promise shared by early intercepted network clones. */\n"
  "  let communicationLogInitializationPromise = null;\n"
  "  /** Count of communication records intentionally skipped before disk logging became available. */\n"
  "  let communicationLogDroppedBeforeReady = 0;\n"
  "  /** Last newest-Assistant lifecycle signature written to disk, preventing mutation-scan duplicates. */\n"
  "  let communicationLogLastAssistantLifecycleKey = null;\n"
  "  /** Guards page/session lifecycle listeners against duplicate installation after reauthorization. */\n"
  "  let communicationLogLifecycleInstalled = false;\n"
  "  /** Unique identity correlating all communication records produced by this page lifetime. */\n"
  "  const communicationLogSessionId = crypto.randomUUID();\n",
  'communication state'
)

block = r'''

  // BEGIN Issue #123 disk communication recorder
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
        const request = db.transaction(COMMUNICATION_LOG_DB_STORE, 'readwrite')
          .objectStore(COMMUNICATION_LOG_DB_STORE)
          .put(handle, 'communication-directory');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('Could not store communication-log directory handle.'));
      });
    } finally {
      db.close();
    }
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
    const currentUsable = !/^(?:ChatGPT|ChatGPT conversation)$/i.test(current);
    if (currentUsable) {
      try { localStorage.setItem(storageKey, current); } catch {}
      return current;
    }
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? sanitizeFileName(stored) : null;
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
   * Installs page/session lifecycle records after the disk recorder becomes writable.
   *
   * @returns {void} No value is returned.
   */
  function communicationLogInstallLifecycleObservers() {
    if (communicationLogLifecycleInstalled) return;
    communicationLogLifecycleInstalled = true;
    window.addEventListener('pagehide', event => {
      void communicationLogRecord('communication_pagehide', {
        persisted: event.persisted === true,
        visibility_state: document.visibilityState
      });
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
    const conversationName = await communicationLogWaitForConversationName();
    if (!conversationName) {
      communicationLogShowDirectoryPrompt('Conversation title is not available yet.');
      return false;
    }
    communicationLogDirectoryHandle = handle;
    communicationLogPendingDirectoryHandle = null;
    communicationLogFileName = `DownloadConversation_${sanitizeFileName(conversationTitle())}.jsonl`;
    if (/^DownloadConversation_(?:ChatGPT|ChatGPT conversation)\.jsonl$/i.test(communicationLogFileName)) {
      communicationLogFileName = `DownloadConversation_${conversationName}.jsonl`;
    }
    communicationLogReady = true;
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
  function communicationLogShowDirectoryPrompt(reason) {
    logDiagnostic('warnings', 'communication-directory-required', { reason });
    if (communicationLogPromptShown) return;
    communicationLogPromptShown = true;
    const mount = () => {
      if (!document.body) {
        requestAnimationFrame(mount);
        return;
      }
      if (document.getElementById('tm-communication-directory-required')) return;
      const prompt = document.createElement('div');
      prompt.id = 'tm-communication-directory-required';
      prompt.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:390px;padding:12px;border:1px solid #888;border-radius:8px;background:#202123;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px #0008';
      const text = document.createElement('div');
      text.textContent = `DownloadConversation needs a writable folder for the communication log. ${reason}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Choose Log Folder';
      button.style.cssText = 'margin-top:8px;padding:6px 10px;cursor:pointer';
      button.addEventListener('click', async () => {
        try {
          let handle = communicationLogPendingDirectoryHandle;
          if (handle) {
            let permission = await communicationLogPermissionState(handle);
            if (permission !== 'granted' && typeof handle.requestPermission === 'function') {
              permission = await handle.requestPermission({ mode: 'readwrite' });
            }
            if (permission !== 'granted') handle = null;
          }
          if (!handle) {
            handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            const permission = await communicationLogPermissionState(handle);
            if (permission !== 'granted' && typeof handle.requestPermission === 'function') {
              const requested = await handle.requestPermission({ mode: 'readwrite' });
              if (requested !== 'granted') throw new Error('Read/write permission was not granted.');
            }
          }
          await communicationLogStoreDirectoryHandle(handle);
          await communicationLogActivateDirectory(handle);
        } catch (error) {
          communicationLogReportFailure('directory-authorization', error);
        }
      });
      prompt.append(text, button);
      document.body.append(prompt);
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
        communicationLogPendingDirectoryHandle = handle;
        communicationLogShowDirectoryPrompt('The saved log folder needs read/write permission again.');
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
   * Redacts common credential forms from persisted textual request/response data.
   *
   * @param {string} value - Raw textual communication data.
   * @returns {string} Redacted text suitable for disk persistence.
   */
  function communicationLogRedactText(value) {
    return String(redactDiagnosticSignedTokens(String(value ?? '')))
      .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [redacted]')
      .replace(/([?&](?:access_token|refresh_token|token|key|secret|auth|authorization|session|jwt|api_key)=)[^&#\s]*/gi, '$1[redacted]')
      .replace(/((?:\"|')?(?:access_token|refresh_token|authorization|cookie|session|jwt|api[_-]?key|secret)(?:\"|')?\s*:\s*(?:\"|'))[^\"'\r\n]*/gi, '$1[redacted]');
  }

  /**
   * Reports whether a content type represents textual communication worth persisting verbatim.
   *
   * @param {string} contentType - HTTP content type.
   * @returns {boolean} True for text, JSON, SSE, JavaScript, XML, form, or component text.
   */
  function communicationLogIsTextContentType(contentType) {
    return /(?:^text\/|json|event-stream|javascript|xml|x-www-form-urlencoded|x-component)/i.test(String(contentType ?? ''));
  }

  /**
   * Reports whether the given URL/content type may persist a textual body.
   *
   * Cross-origin payloads remain metadata-only. Binary same-origin payloads also remain metadata-only.
   *
   * @param {string} url - Communication URL.
   * @param {string} contentType - Declared content type.
   * @returns {boolean} True when body text may be written to disk.
   */
  function communicationLogShouldCaptureBody(url, contentType) {
    try {
      const parsed = new URL(String(url ?? ''), location.href);
      if (parsed.origin !== location.origin) return false;
      if (communicationLogIsTextContentType(contentType)) return true;
      return parsed.pathname.startsWith('/backend-api/');
    } catch {
      return false;
    }
  }

  /**
   * Compares bounded byte ranges without loading whole files into memory.
   *
   * @param {Blob} left - First file/blob.
   * @param {Blob} right - Second file/blob.
   * @param {number} leftOffset - First byte offset.
   * @param {number} rightOffset - Second byte offset.
   * @param {number} length - Number of bytes to compare.
   * @returns {Promise<boolean>} True only when every compared byte matches.
   */
  async function communicationLogBlobsEqual(left, right, leftOffset, rightOffset, length) {
    for (let offset = 0; offset < length; offset += COMMUNICATION_LOG_COMPARE_CHUNK_BYTES) {
      const count = Math.min(COMMUNICATION_LOG_COMPARE_CHUNK_BYTES, length - offset);
      const leftBytes = new Uint8Array(await left.slice(leftOffset + offset, leftOffset + offset + count).arrayBuffer());
      const rightBytes = new Uint8Array(await right.slice(rightOffset + offset, rightOffset + offset + count).arrayBuffer());
      if (leftBytes.length !== rightBytes.length) return false;
      for (let index = 0; index < leftBytes.length; index += 1) {
        if (leftBytes[index] !== rightBytes[index]) return false;
      }
    }
    return true;
  }

  /**
   * Reacquires the active log file from its parent directory and reads fresh on-disk state.
   *
   * @returns {Promise<Object>} Fresh file handle and File snapshot.
   */
  async function communicationLogRefreshedFileSnapshot() {
    if (!communicationLogDirectoryHandle || !communicationLogFileName) {
      throw new Error('Communication log directory/file is not ready.');
    }
    const handle = await communicationLogDirectoryHandle.getFileHandle(communicationLogFileName, { create: true });
    const file = await handle.getFile();
    return { handle, file };
  }

  /**
   * Identifies Chromium's stale File System Access interface-state failure.
   *
   * @param {Object} error - Write failure.
   * @returns {boolean} True only for the observed stale-state InvalidStateError class.
   */
  function communicationLogIsStaleFileStateError(error) {
    return error?.name === 'InvalidStateError' || /state.*changed.*disk|cached.*interface object/i.test(String(error?.message ?? ''));
  }

  /**
   * Appends bytes using fresh EOF state and verifies ambiguous stale-handle outcomes before retrying.
   *
   * This is the Issue-44 append invariant: reacquire from the directory, derive the append
   * offset from the current file, open/seek/write/close, and never duplicate bytes when Chromium
   * reports InvalidStateError after a write actually committed.
   *
   * @param {string|Blob} data - Bytes to append.
   * @returns {Promise<number>} Byte offset at which the append committed.
   */
  async function communicationLogAppendData(data) {
    const desired = data instanceof Blob ? data : new Blob([data]);
    for (let attempt = 1; attempt <= COMMUNICATION_LOG_WRITE_RETRY_LIMIT; attempt += 1) {
      const refreshed = await communicationLogRefreshedFileSnapshot();
      const currentHandle = refreshed.handle;
      const before = await currentHandle.getFile();
      let writable = null;
      try {
        writable = await currentHandle.createWritable({ keepExistingData: true });
        await writable.seek(before.size);
        await writable.write(data);
        await writable.close();
        return before.size;
      } catch (error) {
        try { await writable?.abort(); } catch {}
        if (!communicationLogIsStaleFileStateError(error) || attempt >= COMMUNICATION_LOG_WRITE_RETRY_LIMIT) throw error;
        const afterSnapshot = await communicationLogRefreshedFileSnapshot();
        const after = afterSnapshot.file;
        if (after.size >= before.size + desired.size &&
            await communicationLogBlobsEqual(after, desired, before.size, 0, desired.size)) {
          return before.size;
        }
        const originalPrefixStillMatches = after.size >= before.size &&
          await communicationLogBlobsEqual(after, before, 0, 0, before.size);
        if (after.size !== before.size || !originalPrefixStillMatches) {
          throw new Error(`'${communicationLogFileName}' changed on disk while the recorder was appending; the append was not retried.`);
        }
        await new Promise(resolve => setTimeout(resolve, 50 * attempt));
      }
    }
    throw new Error(`Appending to '${communicationLogFileName}' exhausted the filesystem retry limit.`);
  }

  /**
   * Serializes one JSONL append while closing the writable stream after every record.
   *
   * @param {string} line - Complete newline-terminated JSONL record.
   * @returns {Promise<number>} Byte offset where the record committed.
   */
  function communicationLogAppendLine(line) {
    const operation = communicationLogWriteChain.then(() => communicationLogAppendData(line));
    communicationLogWriteChain = operation.catch(communicationError => {
      communicationLogReportFailure('append', communicationError);
    });
    return operation;
  }

  /**
   * Reports disk-recorder failures through existing diagnostics without throwing into page networking.
   *
   * @param {string} stage - Recorder stage that failed.
   * @param {Object} error - Failure value.
   * @returns {void} No value is returned.
   */
  function communicationLogReportFailure(stage, error) {
    logDiagnostic('warnings', 'communication-log-write-failure', {
      stage,
      file_name: communicationLogFileName,
      message: boundedDiagnosticText(error?.message ?? String(error), 2000)
    });
  }

  /**
   * Writes one structured communication event to the active append-only JSONL file.
   *
   * @param {string} type - Stable record type.
   * @param {Object} data - Event-specific JSON-compatible fields.
   * @returns {Promise<boolean>} True when the record committed to disk.
   */
  async function communicationLogRecord(type, data = {}) {
    if (!communicationLogReady) {
      communicationLogDroppedBeforeReady += 1;
      return false;
    }
    const record = {
      timestamp: new Date().toISOString(),
      monotonic_ms: Math.round(performance.now() * 1000) / 1000,
      time_origin: performance.timeOrigin,
      session_id: communicationLogSessionId,
      sequence: ++communicationLogSequence,
      type,
      ...data
    };
    await communicationLogAppendLine(`${JSON.stringify(record)}\n`);
    return true;
  }

  /**
   * Waits briefly for asynchronous IndexedDB handle restoration used by document-start interception.
   *
   * @returns {Promise<boolean>} True when the disk recorder becomes ready within the bounded wait.
   */
  async function communicationLogAwaitReady() {
    if (communicationLogReady) return true;
    if (!communicationLogInitializationPromise) return false;
    await Promise.race([
      communicationLogInitializationPromise.catch(() => false),
      new Promise(resolve => setTimeout(resolve, COMMUNICATION_LOG_READY_WAIT_MS))
    ]);
    return communicationLogReady;
  }

  /**
   * Persists one textual body stream in bounded JSONL chunks without accumulating the whole body.
   *
   * @param {ReadableStream|null} body - Cloned Request/Response body stream.
   * @param {string} recordType - JSONL chunk record type.
   * @param {Object} context - Correlation metadata repeated on each chunk.
   * @returns {Promise<Object>} Persisted byte/chunk counts.
   */
  async function communicationLogStreamBody(body, recordType, context) {
    if (!body) return { byte_count: 0, chunk_count: 0 };
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let byteCount = 0;
    let chunkCount = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        if (!result.value?.byteLength) continue;
        byteCount += result.value.byteLength;
        pending += decoder.decode(result.value, { stream: true });
        while (pending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS + COMMUNICATION_LOG_REDACTION_CARRY_CHARS) {
          const chunk = pending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          pending = pending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          chunkCount += 1;
          await communicationLogRecord(recordType, {
            ...context,
            chunk_ordinal: chunkCount,
            data: communicationLogRedactText(chunk)
          });
        }
      }
      pending += decoder.decode();
      if (pending) {
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: communicationLogRedactText(pending)
        });
      }
      return { byte_count: byteCount, chunk_count: chunkCount };
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  /**
   * Persists one already-materialized textual body in bounded chunks.
   *
   * @param {string} text - Raw body text already held by XHR/WebSocket/page code.
   * @param {string} recordType - JSONL chunk record type.
   * @param {Object} context - Correlation metadata repeated on each chunk.
   * @returns {Promise<Object>} Persisted character/chunk counts.
   */
  async function communicationLogTextBody(text, recordType, context) {
    const value = String(text ?? '');
    let chunkCount = 0;
    for (let offset = 0; offset < value.length; offset += COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
      chunkCount += 1;
      await communicationLogRecord(recordType, {
        ...context,
        chunk_ordinal: chunkCount,
        data: communicationLogRedactText(value.slice(offset, offset + COMMUNICATION_LOG_BODY_CHUNK_CHARS))
      });
    }
    return { character_count: value.length, chunk_count: chunkCount };
  }

  /**
   * Captures one stock fetch Request clone and its textual body without consuming the page Request.
   *
   * @param {Request|null} request - Page Request object.
   * @param {Object} trace - Stock-network correlation state.
   * @returns {Promise<void>} Resolves after request data is persisted or deliberately omitted.
   */
  async function communicationLogFetchRequest(request, trace) {
    let cloned = null;
    try { cloned = request?.clone?.() ?? null; } catch {}
    if (!(await communicationLogAwaitReady())) {
      communicationLogDroppedBeforeReady += 1;
      try { await cloned?.body?.cancel?.(); } catch {}
      return;
    }
    const contentType = request?.headers?.get?.('content-type') ?? '';
    await communicationLogRecord('communication_fetch_request', {
      network_sequence: trace?.sequence ?? null,
      method: String(request?.method ?? trace?.method ?? 'GET').toUpperCase(),
      url: stockNetworkSafeUrl(request?.url ?? trace?.url ?? ''),
      cache_mode: request?.cache ?? null,
      request_mode: request?.mode ?? null,
      credentials_mode: request?.credentials ?? null,
      destination: request?.destination ?? null,
      redirect_mode: request?.redirect ?? null,
      content_type: contentType,
      headers: communicationLogSafeHeaders(request?.headers)
    });
    if (cloned?.body && communicationLogShouldCaptureBody(request?.url ?? trace?.url ?? '', contentType)) {
      const summary = await communicationLogStreamBody(cloned.body, 'communication_request_chunk', {
        transport: 'fetch',
        network_sequence: trace?.sequence ?? null
      });
      await communicationLogRecord('communication_fetch_request_body_end', {
        network_sequence: trace?.sequence ?? null,
        ...summary
      });
    } else if (cloned?.body) {
      await communicationLogRecord('communication_fetch_request_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
      try { await cloned.body.cancel(); } catch {}
    }
  }

  /**
   * Captures one stock fetch Response clone, including full textual API/SSE content in bounded chunks.
   *
   * @param {Response} response - Original page response; only a clone is read.
   * @param {Object} trace - Stock-network correlation state.
   * @returns {Promise<void>} Resolves after response data is persisted or deliberately omitted.
   */
  async function communicationLogFetchResponse(response, trace) {
    let cloned = null;
    try { cloned = response.clone(); } catch {}
    if (!(await communicationLogAwaitReady())) {
      communicationLogDroppedBeforeReady += 1;
      try { await cloned?.body?.cancel?.(); } catch {}
      return;
    }
    const contentType = response?.headers?.get?.('content-type') ?? '';
    const responseUrl = response?.url ?? trace?.url ?? '';
    await communicationLogRecord('communication_fetch_response', {
      network_sequence: trace?.sequence ?? null,
      method: trace?.method ?? null,
      request_url: trace?.url ?? null,
      response_url: stockNetworkSafeUrl(responseUrl),
      status: response?.status ?? null,
      ok: response?.ok === true,
      redirected: response?.redirected === true,
      response_type: response?.type ?? null,
      duration_ms: trace?.started_at == null ? null : Math.round(performance.now() - trace.started_at),
      content_type: contentType,
      headers: communicationLogSafeHeaders(response?.headers)
    });
    if (cloned?.body && communicationLogShouldCaptureBody(responseUrl, contentType)) {
      const summary = await communicationLogStreamBody(cloned.body, 'communication_response_chunk', {
        transport: 'fetch',
        network_sequence: trace?.sequence ?? null
      });
      await communicationLogRecord('communication_fetch_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        ...summary
      });
    } else if (cloned?.body) {
      await communicationLogRecord('communication_fetch_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
      try { await cloned.body.cancel(); } catch {}
    }
  }

  /**
   * Captures one XHR request and any directly available textual request body.
   *
   * @param {Object} info - Captured XHR method/URL/header metadata.
   * @param {Object|null} body - XHR send() body.
   * @param {Object} trace - Stock-network correlation state.
   * @returns {Promise<void>} Resolves after request data is persisted.
   */
  async function communicationLogXhrRequest(info, body, trace) {
    if (!(await communicationLogAwaitReady())) {
      communicationLogDroppedBeforeReady += 1;
      return;
    }
    const contentType = info?.headers?.['content-type'] ?? '';
    await communicationLogRecord('communication_xhr_request', {
      network_sequence: trace?.sequence ?? null,
      method: String(info?.method ?? 'GET').toUpperCase(),
      url: stockNetworkSafeUrl(info?.url ?? ''),
      content_type: contentType,
      headers: communicationLogSafeHeaders(info?.headers)
    });
    if (typeof body === 'string' || body instanceof URLSearchParams) {
      await communicationLogTextBody(String(body), 'communication_request_chunk', {
        transport: 'xmlhttprequest',
        network_sequence: trace?.sequence ?? null
      });
    } else if (body != null) {
      await communicationLogRecord('communication_xhr_request_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
    }
  }

  /**
   * Captures one completed XHR response without changing its responseType or page-visible data.
   *
   * @param {XMLHttpRequest} xhr - Completed page XHR instance.
   * @param {Object} trace - Stock-network correlation state.
   * @returns {Promise<void>} Resolves after response data is persisted.
   */
  async function communicationLogXhrResponse(xhr, trace) {
    if (!(await communicationLogAwaitReady())) {
      communicationLogDroppedBeforeReady += 1;
      return;
    }
    const responseHeaders = {};
    try {
      for (const line of String(xhr?.getAllResponseHeaders?.() ?? '').split(/\r?\n/)) {
        const split = line.indexOf(':');
        if (split <= 0) continue;
        responseHeaders[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
      }
    } catch {}
    const contentType = responseHeaders['content-type'] ?? '';
    const responseUrl = xhr?.responseURL ?? trace?.url ?? '';
    await communicationLogRecord('communication_xhr_response', {
      network_sequence: trace?.sequence ?? null,
      method: trace?.method ?? null,
      request_url: trace?.url ?? null,
      response_url: stockNetworkSafeUrl(responseUrl),
      status: Number.isFinite(xhr?.status) ? xhr.status : null,
      response_type: xhr?.responseType || 'text',
      duration_ms: trace?.started_at == null ? null : Math.round(performance.now() - trace.started_at),
      content_type: contentType,
      headers: communicationLogSafeHeaders(responseHeaders)
    });
    if (!communicationLogShouldCaptureBody(responseUrl, contentType)) {
      await communicationLogRecord('communication_xhr_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
      return;
    }
    let text = null;
    try {
      if (!xhr.responseType || xhr.responseType === 'text') text = xhr.responseText;
      else if (xhr.responseType === 'json') text = JSON.stringify(xhr.response);
    } catch {}
    if (typeof text === 'string') {
      const summary = await communicationLogTextBody(text, 'communication_response_chunk', {
        transport: 'xmlhttprequest',
        network_sequence: trace?.sequence ?? null
      });
      await communicationLogRecord('communication_xhr_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        ...summary
      });
    } else {
      await communicationLogRecord('communication_xhr_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
    }
  }

  /**
   * Persists one outgoing WebSocket frame while leaving socket.send behavior unchanged.
   *
   * @param {string} url - WebSocket URL.
   * @param {Object} data - Frame data supplied to send().
   * @returns {Promise<void>} Resolves after frame metadata/content is persisted.
   */
  async function communicationLogWebSocketSend(url, data) {
    if (!(await communicationLogAwaitReady())) {
      communicationLogDroppedBeforeReady += 1;
      return;
    }
    await communicationLogRecord('communication_websocket_send', {
      url: stockNetworkSafeUrl(url),
      data_type: typeof data === 'string' ? 'text' : Object.prototype.toString.call(data)
    });
    if (typeof data === 'string') {
      await communicationLogTextBody(data, 'communication_request_chunk', { transport: 'websocket' });
    } else {
      await communicationLogRecord('communication_websocket_send_body_end', {
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
    }
  }

  /**
   * Persists one incoming WebSocket frame while the existing streamed-tail consumer sees the original data.
   *
   * @param {string} url - WebSocket URL.
   * @param {Object} data - Incoming MessageEvent data.
   * @returns {Promise<void>} Resolves after frame metadata/content is persisted.
   */
  async function communicationLogWebSocketMessage(url, data) {
    if (!(await communicationLogAwaitReady())) {
      communicationLogDroppedBeforeReady += 1;
      return;
    }
    await communicationLogRecord('communication_websocket_message', {
      url: stockNetworkSafeUrl(url),
      data_type: typeof data === 'string' ? 'text' : Object.prototype.toString.call(data)
    });
    if (typeof data === 'string') {
      await communicationLogTextBody(data, 'communication_response_chunk', { transport: 'websocket' });
    } else {
      await communicationLogRecord('communication_websocket_message_body_end', {
        binary_body_omitted: true,
        body_omitted: 'binary'
      });
    }
  }

  /**
   * Persists transitions of the newest visible Assistant placeholder/error/thinking/hydrated state.
   *
   * @param {Object|null} marker - Newest mounted Assistant live-tail marker.
   * @param {string} reason - Live-tail scan reason.
   * @returns {void} No value is returned.
   */
  function communicationLogAssistantLifecycle(marker, reason) {
    if (!marker || marker.role !== 'assistant') return;
    const text = String(marker.comparison_text ?? '').trim();
    let state = marker.message_id ? 'hydrated' : 'placeholder';
    if (/message delivery timed out|timed out\. please try again/i.test(text)) state = 'timeout';
    else if (text.length <= 300 && /something went wrong|please try again|\bretry\b|connection interrupted/i.test(text)) state = 'retry';
    else if (!marker.message_id && text.length <= 100 && /^thinking(?:…|\.\.\.|\s*)$/i.test(text)) state = 'thinking';
    const lifecycleKey = [state, marker.message_id ?? '', marker.dom_turn_id ?? '', marker.content_fingerprint ?? ''].join('|');
    if (lifecycleKey === communicationLogLastAssistantLifecycleKey) return;
    communicationLogLastAssistantLifecycleKey = lifecycleKey;
    void communicationLogRecord('communication_assistant_lifecycle', {
      state,
      reason,
      conversation_id: currentConversationId(),
      message_id: marker.message_id ?? null,
      dom_turn_id: marker.dom_turn_id ?? null,
      container_id: marker.container_id ?? null,
      content_length: marker.content_length ?? null,
      content_fingerprint: marker.content_fingerprint ?? null
    }).catch(communicationError => communicationLogReportFailure('assistant-lifecycle', communicationError));
  }
  // END Issue #123 disk communication recorder
'''

source = replace_once(
  source,
  '  // END Issue #123 stock network diagnostics\n',
  '  // END Issue #123 stock network diagnostics\n' + block,
  'disk recorder insertion'
)

source = replace_once(
  source,
  "        const stockTrace = stockNetworkTraceFetchStart(request, requestUrl);\n"
  "        rememberApiRequestContext(requestUrl, request?.headers, init.headers);\n",
  "        const stockTrace = stockNetworkTraceFetchStart(request, requestUrl);\n"
  "        void communicationLogFetchRequest(request, stockTrace)\n"
  "          .catch(communicationError => communicationLogReportFailure('fetch-request', communicationError));\n"
  "        rememberApiRequestContext(requestUrl, request?.headers, init.headers);\n",
  'fetch request hook'
)

source = replace_once(
  source,
  "        return responsePromise.then(response => {\n"
  "          stockNetworkTraceFetchResponse(response, stockTrace);\n"
  "          if (capturePromise) {\n",
  "        return responsePromise.then(response => {\n"
  "          stockNetworkTraceFetchResponse(response, stockTrace);\n"
  "          void communicationLogFetchResponse(response, stockTrace)\n"
  "            .catch(communicationError => communicationLogReportFailure('fetch-response', communicationError));\n"
  "          if (capturePromise) {\n",
  'fetch response hook'
)

source = replace_once(
  source,
  "        const stockTrace = stockNetworkTraceXhrStart(this, info);\n"
  "        this.addEventListener('loadend', () => stockNetworkTraceXhrResponse(this, stockTrace), { once: true });\n"
  "        rememberApiRequestContext(info.url, info.headers);\n",
  "        const stockTrace = stockNetworkTraceXhrStart(this, info);\n"
  "        void communicationLogXhrRequest(info, body, stockTrace)\n"
  "          .catch(communicationError => communicationLogReportFailure('xhr-request', communicationError));\n"
  "        this.addEventListener('loadend', () => {\n"
  "          stockNetworkTraceXhrResponse(this, stockTrace);\n"
  "          void communicationLogXhrResponse(this, stockTrace)\n"
  "            .catch(communicationError => communicationLogReportFailure('xhr-response', communicationError));\n"
  "        }, { once: true });\n"
  "        rememberApiRequestContext(info.url, info.headers);\n",
  'xhr hooks'
)

source = replace_once(
  source,
  "        construct(target, args) {\n"
  "          const socket = Reflect.construct(target, args, target);\n"
  "          socket.addEventListener('message', event => captureGenerationWebSocketFrame(event.data));\n"
  "          return socket;\n"
  "        }\n",
  "        construct(target, args) {\n"
  "          const socket = Reflect.construct(target, args, target);\n"
  "          const socketUrl = String(args[0] ?? '');\n"
  "          const nativeSend = socket.send;\n"
  "          socket.send = function(data) {\n"
  "            void communicationLogWebSocketSend(socketUrl, data)\n"
  "              .catch(communicationError => communicationLogReportFailure('websocket-send', communicationError));\n"
  "            return nativeSend.call(this, data);\n"
  "          };\n"
  "          socket.addEventListener('open', () => {\n"
  "            void communicationLogRecord('communication_websocket_open', { url: stockNetworkSafeUrl(socketUrl) });\n"
  "          });\n"
  "          socket.addEventListener('message', event => {\n"
  "            captureGenerationWebSocketFrame(event.data);\n"
  "            void communicationLogWebSocketMessage(socketUrl, event.data)\n"
  "              .catch(communicationError => communicationLogReportFailure('websocket-message', communicationError));\n"
  "          });\n"
  "          socket.addEventListener('close', event => {\n"
  "            void communicationLogRecord('communication_websocket_close', {\n"
  "              url: stockNetworkSafeUrl(socketUrl),\n"
  "              code: event.code,\n"
  "              was_clean: event.wasClean === true\n"
  "            });\n"
  "          });\n"
  "          socket.addEventListener('error', () => {\n"
  "            void communicationLogRecord('communication_websocket_error', { url: stockNetworkSafeUrl(socketUrl) });\n"
  "          });\n"
  "          return socket;\n"
  "        }\n",
  'websocket hooks'
)

source = replace_once(
  source,
  "    const mounted = [...document.querySelectorAll('section[data-turn-id]')]\n"
  "      .map(liveTailSectionMarker)\n"
  "      .filter(Boolean);\n"
  "    if (!mounted.length) return;\n"
  "    const scrollRoot = liveTailObservedScrollRoot || conversationScrollRoot();\n"
  "    applyMountedLiveTailMarkers(mounted, liveTailAtPhysicalBottom(scrollRoot), reason);\n",
  "    const mounted = [...document.querySelectorAll('section[data-turn-id]')]\n"
  "      .map(liveTailSectionMarker)\n"
  "      .filter(Boolean);\n"
  "    if (!mounted.length) return;\n"
  "    const scrollRoot = liveTailObservedScrollRoot || conversationScrollRoot();\n"
  "    const atPhysicalBottom = liveTailAtPhysicalBottom(scrollRoot);\n"
  "    applyMountedLiveTailMarkers(mounted, atPhysicalBottom, reason);\n"
  "    if (atPhysicalBottom) {\n"
  "      const newestAssistant = [...mounted].reverse().find(marker => marker.role === 'assistant') ?? null;\n"
  "      communicationLogAssistantLifecycle(newestAssistant, reason);\n"
  "    }\n",
  'assistant lifecycle hook'
)

source = replace_once(
  source,
  "  installLiveTailTracking();\n"
  "  installNetworkCapture();\n"
  "  bootstrapUi();\n",
  "  communicationLogInitializationPromise = initializeCommunicationDiskRecorder();\n"
  "  installLiveTailTracking();\n"
  "  installNetworkCapture();\n"
  "  bootstrapUi();\n",
  'startup initialization'
)

SOURCE.write_text(source, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
section = r'''

## Issue #123 disk-backed communication recorder

Rare delayed-tail failures can disappear or change across a hard reload, so bounded
in-memory diagnostics are not sufficient evidence for the next occurrence.  The
userscript therefore maintains a persistent, append-only communication trace in the
user-authorized directory.  The per-conversation filename is
`DownloadConversation_<conversation-name>.jsonl`, using the same filename sanitation
as exported conversation files.

The selected `FileSystemDirectoryHandle` is stored in IndexedDB.  A later reload
reuses it automatically when read/write permission remains granted.  If no usable
handle exists, the page presents a user-gesture **Choose Log Folder** control because
Chromium does not permit the directory picker to be opened autonomously at
document-start.  The most recently resolved conversation title is also retained by
conversation ID so an already-authorized reload can begin logging before the visible
heading rematerializes.

Communication JSONL is intentionally disk-backed rather than accumulated as another
large diagnostic array.  Stock page fetch/XHR and WebSocket traffic receives
session/transaction/timing/cache metadata; same-origin textual/API/SSE request and
response bodies are written in bounded chunks.  Binary or cross-origin bodies are
metadata-only.  Authorization, Cookie/Set-Cookie, bearer/session/token/API-key and
signed-secret values are redacted before persistence.  Session/reload metadata and
newest-Assistant placeholder, Thinking, Retry/error, timeout and hydrated state
transitions are written to the same file so one rare failure provides both a time
bound and the supplying network transaction.

Every JSONL write reuses the stale-File-System-Access invariant established by the
legacy Issue 44 recorder.  The file handle is reacquired from its parent directory,
a fresh `File` supplies the current EOF, `createWritable({ keepExistingData: true })`
opens only for that append, the writer seeks to the fresh EOF, writes and closes.
If Chromium raises its evidenced `InvalidStateError`, the recorder reacquires the
file and byte-verifies whether the intended append already committed before retrying;
unexpected external modification is rejected rather than overwritten.  Writes are
serialized, but no writable stream or cached append offset survives between records.
This keeps the JSONL readable/sendable while recording and prevents a read by another
program from turning a stale cached interface into duplicate or lost log bytes.

The communication recorder is passive observability.  Its failures are isolated from
ChatGPT networking and reported through ordinary recorder diagnostics.  It does not
add an export acquisition, change the #102 single-snapshot contract, change source
precedence/recovery semantics, or cross the AIConversationCore rendering boundary.
'''
if '## Issue #123 disk-backed communication recorder' in design:
  raise SystemExit('DESIGN section already exists')
DESIGN.write_text(design.rstrip() + section + '\n', encoding='utf-8')
