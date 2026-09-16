from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
USERSCRIPT = ROOT / 'chatgpt-conversation-markdown-export.user.js'


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def replace_all(text, old, new, expected_minimum, label):
    count = text.count(old)
    if count < expected_minimum:
        raise RuntimeError(f'{label}: expected at least {expected_minimum} matches, found {count}')
    return text.replace(old, new)


def top_level_function_span(text, name):
    starts = [
        text.find(f'  async function {name}('),
        text.find(f'  function {name}('),
    ]
    starts = [start for start in starts if start >= 0]
    if not starts:
        raise RuntimeError(f'production function {name} is missing')
    start = min(starts)
    end = text.find('\n\n  /**', start + 1)
    if end < 0:
        end = text.find('\n  // END ', start + 1)
    if end < 0:
        raise RuntimeError(f'production function {name} boundary is missing')
    return start, end


def replace_top_level_function(text, name, replacement):
    start, end = top_level_function_span(text, name)
    return text[:start] + replacement.rstrip() + text[end:]


def insert_after_top_level_function(text, name, addition, marker):
    if marker in text:
        raise RuntimeError(f'{marker} already exists before cleanup')
    _, end = top_level_function_span(text, name)
    return text[:end] + '\n\n' + addition.rstrip() + text[end:]


def remove_unindented_function(text, name):
    start = text.find(f'function {name}(')
    if start < 0:
        raise RuntimeError(f'test helper function {name} is missing')
    brace = text.find('{', start)
    if brace < 0:
        raise RuntimeError(f'test helper function {name} has no body')
    depth = 0
    end = None
    for index in range(brace, len(text)):
        char = text[index]
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end is None:
        raise RuntimeError(f'test helper function {name} has no end')
    while text[end:end + 1] == '\n':
        end += 1
    return text[:start] + text[end:]


def share_userscript_loader(path):
    text = path.read_text(encoding='utf-8')
    pattern = re.compile(
        r"const userscript = await readFile\(\s*"
        r"new URL\('\.\./chatgpt-conversation-markdown-export\.user\.js', import\.meta\.url\),\s*"
        r"'utf8'\s*\);\n*",
        re.MULTILINE,
    )
    text, count = pattern.subn('', text, count=1)
    if count == 0:
        return False
    helper_import = "import { userscript } from './helpers/userscript-source.mjs';\n"
    if helper_import not in text:
        text = helper_import + text
    if 'readFile(' not in text:
        text = text.replace("import { readFile } from 'node:fs/promises';\n", '')
    path.write_text(text, encoding='utf-8')
    return True


def set_helper_import(path, names):
    text = path.read_text(encoding='utf-8')
    replacement = "import { " + ', '.join(names) + " } from './helpers/userscript-source.mjs';"
    text, count = re.subn(
        r"import \{ [^\n]+ \} from '\./helpers/userscript-source\.mjs';",
        replacement,
        text,
        count=1,
    )
    if count != 1:
        raise RuntimeError(f'{path.name}: shared helper import is missing')
    path.write_text(text, encoding='utf-8')


text = USERSCRIPT.read_text(encoding='utf-8')
text = replace_once(
    text,
    '// @version      1.2.0-issue.134.4',
    '// @version      1.2.0-issue.134.5',
    'version bump',
)
text = replace_once(
    text,
    "  /** Guards page/session lifecycle listeners against duplicate installation after reauthorization. */\n"
    "  let communicationLogLifecycleInstalled = false;\n",
    "  /** Guards page/session lifecycle listeners against duplicate installation after reauthorization. */\n"
    "  let communicationLogLifecycleInstalled = false;\n"
    "  /** Whether one communication-log file-management action is currently updating panel state. */\n"
    "  let communicationLogUiActionInProgress = false;\n",
    'communication-log UI action state',
)

GENERAL_HELPERS = r'''  /**
   * Normalizes one thrown value to readable diagnostic text.
   *
   * @param {unknown} error - Thrown value to describe.
   * @returns {string} Readable error text.
   */
  function errorMessage(error) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
    return String(error);
  }

  /**
   * Clones one Request/Response-like object without allowing a clone failure to escape.
   *
   * @param {Object|null} value - Cloneable object, when available.
   * @returns {Object|null} Independent clone, or null when cloning is unavailable or fails.
   */
  function cloneSafely(value) {
    try {
      return typeof value?.clone === 'function' ? value.clone() : null;
    } catch {
      return null;
    }
  }

  /**
   * Releases one stream-reader lock without allowing cleanup failure to replace the primary outcome.
   *
   * @param {Object|null} reader - Reader whose lock should be released.
   * @returns {void} No value is returned.
   */
  function releaseReaderLockQuietly(reader) {
    try { reader?.releaseLock?.(); } catch {}
  }

  /**
   * Aborts one writable stream without allowing cleanup failure to replace the primary outcome.
   *
   * @param {Object|null} writable - Writable stream to abort when present.
   * @returns {Promise<void>} Resolves after best-effort abort cleanup.
   */
  async function abortWritableQuietly(writable) {
    try { await writable?.abort?.(); } catch {}
  }

  /**
   * Cancels one readable body without allowing cleanup failure to replace the primary outcome.
   *
   * @param {Object|null} body - Readable stream body to cancel when present.
   * @returns {Promise<void>} Resolves after best-effort cancellation.
   */
  async function cancelReadableBodyQuietly(body) {
    try { await body?.cancel?.(); } catch {}
  }'''
text = insert_after_top_level_function(text, 'assert', GENERAL_HELPERS, 'function errorMessage(error)')

STOCK_BODY_IDENTITY = r'''  /**
   * Classifies one bounded stock-network text body into JSON identity or text identity evidence.
   *
   * @param {string} text - Bounded response text.
   * @param {string} contentType - Response content type used as JSON evidence.
   * @returns {Object} Exactly one JSON-identity or text-identity projection.
   */
  function stockNetworkBodyIdentity(text, contentType) {
    const value = String(text ?? '');
    if (/json/i.test(contentType) || /^[\s\r\n]*[\[{]/.test(value)) {
      try {
        return { json_identity: stockNetworkJsonIdentitySummary(JSON.parse(value)) };
      } catch {}
    }
    return { text_identity: stockNetworkTextIdentitySummary(value) };
  }'''
text = insert_after_top_level_function(
    text,
    'stockNetworkTextIdentitySummary',
    STOCK_BODY_IDENTITY,
    'function stockNetworkBodyIdentity(text, contentType)',
)

text = replace_top_level_function(text, 'stockNetworkInspectFetchBody', r'''  async function stockNetworkInspectFetchBody(response, trace) {
    try {
      const bounded = await stockNetworkReadBoundedText(response);
      const contentType = response.headers?.get?.('content-type') ?? '';
      const identity = stockNetworkBodyIdentity(bounded.text, contentType);
      logDiagnostic('debug', 'stock-network-fetch-body-summary', {
        network_sequence: trace.sequence,
        url: trace.url,
        content_type: boundedDiagnosticText(contentType, 500),
        byte_count: bounded.byte_count,
        truncated: bounded.truncated,
        json_identity: identity.json_identity ?? null,
        text_identity: identity.text_identity ?? null
      });
    } catch (error) {
      logDiagnostic('debug', 'stock-network-fetch-body-summary-failed', {
        network_sequence: trace.sequence,
        url: trace.url,
        error: boundedDiagnosticText(errorMessage(error), 1000)
      });
    }
  }''')

text = replace_top_level_function(text, 'stockNetworkTraceFetchResponse', r'''  function stockNetworkTraceFetchResponse(response, trace) {
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
  }''')

text = replace_top_level_function(text, 'stockNetworkTraceXhrResponse', r'''  function stockNetworkTraceXhrResponse(xhr, trace) {
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
  }''')

COMMUNICATION_LOG_ENQUEUE = r'''  /**
   * Serializes one communication-log operation and recovers the shared write chain after failure.
   *
   * @param {string} stage - Diagnostic stage reported when the operation rejects.
   * @param {Function} task - Deferred filesystem/recording operation executed behind prior work.
   * @param {unknown} failureValue - Value used to recover the shared chain after failure.
   * @returns {Object} Original operation promise plus the recovered shared-chain promise.
   */
  function communicationLogEnqueue(stage, task, failureValue = undefined) {
    const operation = communicationLogWriteChain.then(task);
    communicationLogWriteChain = operation.catch(communicationError => {
      communicationLogReportFailure(stage, communicationError);
      return failureValue;
    });
    return { operation, chain: communicationLogWriteChain };
  }'''
text = insert_after_top_level_function(
    text,
    'communicationLogCloseActiveWriter',
    COMMUNICATION_LOG_ENQUEUE,
    'function communicationLogEnqueue(stage, task, failureValue = undefined)',
)

text = replace_top_level_function(text, 'communicationLogCheckpoint', r'''  function communicationLogCheckpoint(reason) {
    const queued = communicationLogEnqueue(`checkpoint:${reason}`, async () => {
      if (!communicationLogWritable || !communicationLogWriterDirty) return false;
      try {
        await communicationLogWritable.close();
        communicationLogWritable = null;
        communicationLogWriterDirty = false;
        return true;
      } catch (error) {
        communicationLogWritable = null;
        if (!communicationLogIsStaleFileStateError(error)) {
          communicationLogReady = false;
          throw error;
        }
        try {
          await communicationLogRecoverSwapFiles();
          communicationLogWriterDirty = false;
          return true;
        } catch (recoveryError) {
          communicationLogReady = false;
          throw recoveryError;
        }
      }
    }, false);
    return queued.chain;
  }''')

text = replace_top_level_function(text, 'communicationLogRename', r'''  function communicationLogRename(newFileName) {
    const queued = communicationLogEnqueue('rename', async () => {
      const validatedName = communicationLogValidateFileName(newFileName);
      if (!communicationLogReady || !communicationLogDirectoryHandle || !communicationLogFileName) {
        throw new Error('Communication log directory/file is not ready.');
      }
      if (validatedName === communicationLogFileName) return communicationLogFileName;
      if (await communicationLogFileExists(validatedName)) {
        throw new Error(`Communication log file already exists: ${validatedName}`);
      }

      await communicationLogCloseActiveWriter();
      const sourceName = communicationLogFileName;
      const sourceSnapshot = await communicationLogRefreshedFileSnapshot();
      await communicationLogCopySnapshot(sourceSnapshot.file, validatedName);

      try {
        await communicationLogDirectoryHandle.removeEntry(sourceName);
      } catch (error) {
        try { await communicationLogDirectoryHandle.removeEntry(validatedName); } catch {}
        throw error;
      }

      communicationLogFileName = validatedName;
      return validatedName;
    });
    return queued.operation;
  }''')

text = replace_top_level_function(text, 'communicationLogDuplicate', r'''  function communicationLogDuplicate() {
    const queued = communicationLogEnqueue('duplicate', async () => {
      if (!communicationLogReady || !communicationLogDirectoryHandle || !communicationLogFileName) {
        throw new Error('Communication log directory/file is not ready.');
      }

      await communicationLogCloseActiveWriter();
      const sourceSnapshot = await communicationLogRefreshedFileSnapshot();
      let duplicateNumber = 1;
      let duplicateName = communicationLogDuplicateFileName(
        communicationLogFileName,
        duplicateNumber
      );
      while (await communicationLogFileExists(duplicateName)) {
        duplicateNumber += 1;
        duplicateName = communicationLogDuplicateFileName(
          communicationLogFileName,
          duplicateNumber
        );
      }

      await communicationLogCopySnapshot(sourceSnapshot.file, duplicateName);
      return duplicateName;
    });
    return queued.operation;
  }''')

text = replace_top_level_function(text, 'communicationLogReset', r'''  function communicationLogReset() {
    const queued = communicationLogEnqueue('reset', async () => {
      await communicationLogCloseActiveWriter();
      const refreshed = await communicationLogRefreshedFileSnapshot();
      let writable = null;
      try {
        writable = await refreshed.handle.createWritable({ keepExistingData: true });
        await writable.truncate(0);
        await writable.close();
        writable = null;
        communicationLogWriterDirty = false;
        const verified = await communicationLogRefreshedFileSnapshot();
        if (verified.file.size !== 0) {
          throw new Error(`Communication log reset verification failed: expected 0 bytes, found ${verified.file.size}.`);
        }
      } catch (error) {
        await abortWritableQuietly(writable);
        throw error;
      }
    });
    return queued.operation;
  }''')

text = replace_top_level_function(text, 'communicationLogAppendLine', r'''  function communicationLogAppendLine(line) {
    const queued = communicationLogEnqueue('append', async () => {
      await communicationLogOpenWriter();
      await communicationLogWritable.write(line);
      communicationLogWriterDirty = true;
    });
    return queued.operation;
  }''')

COMMUNICATION_LOG_READY_OR_DROP = r'''  /**
   * Waits for recorder readiness and records one intentional pre-ready drop when unavailable.
   *
   * @param {Object|null} body - Optional cloned body to cancel when the recorder remains unavailable.
   * @returns {Promise<boolean>} True when recording may continue; otherwise false after drop cleanup.
   */
  async function communicationLogAwaitReadyOrDrop(body = null) {
    if (await communicationLogAwaitReady()) return true;
    communicationLogDroppedBeforeReady += 1;
    await cancelReadableBodyQuietly(body);
    return false;
  }'''
text = insert_after_top_level_function(
    text,
    'communicationLogAwaitReady',
    COMMUNICATION_LOG_READY_OR_DROP,
    'function communicationLogAwaitReadyOrDrop(body = null)',
)

text = replace_all(
    text,
    "    if (!(await communicationLogAwaitReady())) {\n"
    "      communicationLogDroppedBeforeReady += 1;\n"
    "      try { await cloned?.body?.cancel?.(); } catch {}\n"
    "      return;\n"
    "    }",
    "    if (!(await communicationLogAwaitReadyOrDrop(cloned?.body ?? null))) return;",
    2,
    'fetch readiness/drop handling',
)
text = replace_all(
    text,
    "    if (!(await communicationLogAwaitReady())) {\n"
    "      communicationLogDroppedBeforeReady += 1;\n"
    "      return;\n"
    "    }",
    "    if (!(await communicationLogAwaitReadyOrDrop())) return;",
    4,
    'non-fetch readiness/drop handling',
)
text = replace_once(
    text,
    "    let cloned = null;\n    try { cloned = request?.clone?.() ?? null; } catch {}",
    "    const cloned = cloneSafely(request);",
    'fetch request clone',
)
text = replace_once(
    text,
    "    let cloned = null;\n    try { cloned = response.clone(); } catch {}",
    "    const cloned = cloneSafely(response);",
    'communication response clone',
)
text = replace_once(
    text,
    "              let cloned;\n              try { cloned = response.clone(); } catch { return; }\n              void captureGenerationStreamResponse(cloned, capture);",
    "              const cloned = cloneSafely(response);\n              if (!cloned) return;\n              void captureGenerationStreamResponse(cloned, capture);",
    'stream response clone',
)
text = replace_all(
    text,
    "try { await cloned.body.cancel(); } catch {}",
    "await cancelReadableBodyQuietly(cloned.body);",
    2,
    'binary cloned-body cancellation',
)
text = replace_all(
    text,
    "try { reader.releaseLock(); } catch {}",
    "releaseReaderLockQuietly(reader);",
    3,
    'reader lock cleanup',
)
text = replace_all(
    text,
    "try { await writable?.abort(); } catch {}",
    "await abortWritableQuietly(writable);",
    3,
    'writable abort cleanup',
)

PANEL_CONTROLS = r'''  /**
   * Returns the communication-log controls from the static recorder panel DOM.
   *
   * @param {Element|null} panel - Recorder panel root, or null to look it up by stable id.
   * @returns {Object} Current filename viewport/text and file-action button elements.
   */
  function communicationLogPanelControls(panel = document.getElementById(PANEL_ID)) {
    const root = panel instanceof Element ? panel : null;
    return {
      communicationLogNameViewport: root?.querySelector('[data-role="communication-log-name-viewport"]') ?? null,
      communicationLogNameText: root?.querySelector('[data-role="communication-log-name"]') ?? null,
      renameCommunicationLogButton: root?.querySelector('[data-role="rename-communication-log"]') ?? null,
      duplicateCommunicationLogButton: root?.querySelector('[data-role="duplicate-communication-log"]') ?? null,
      resetCommunicationLogButton: root?.querySelector('[data-role="reset-communication-log"]') ?? null
    };
  }

  /**
   * Runs one communication-log panel action with shared busy, accessibility, and failure handling.
   *
   * @param {HTMLButtonElement|null} button - Action button that owns busy presentation.
   * @param {Object} options - Labels, operation callback, success callback, and failure prefix.
   * @returns {Promise<void>} Resolves after the action and shared UI state are complete.
   */
  async function runCommunicationLogPanelAction(button, options) {
    if (!(button instanceof HTMLButtonElement) || button.disabled || communicationLogUiActionInProgress) return;
    communicationLogUiActionInProgress = true;
    button.setAttribute('aria-label', options.busyLabel);
    button.title = options.busyTitle;
    refreshStatus();
    try {
      const result = await options.operation();
      if (typeof options.onSuccess === 'function') await options.onSuccess(result);
    } catch (error) {
      setStatus(`⚠ ${options.failurePrefix}: ${errorMessage(error)}`);
    } finally {
      communicationLogUiActionInProgress = false;
      button.setAttribute('aria-label', options.idleLabel);
      button.title = options.idleTitle ?? options.idleLabel;
      refreshStatus();
    }
  }'''
text = insert_after_top_level_function(
    text,
    'progressStatus',
    PANEL_CONTROLS,
    'function communicationLogPanelControls(panel = document.getElementById(PANEL_ID))',
)

text = replace_top_level_function(text, 'refreshCommunicationLogNameOverflow', r'''  function refreshCommunicationLogNameOverflow() {
    const { communicationLogNameViewport, communicationLogNameText } = communicationLogPanelControls();
    if (!communicationLogNameViewport || !communicationLogNameText) return;
    const overflow = Math.max(0, communicationLogNameText.scrollWidth - communicationLogNameViewport.clientWidth);
    communicationLogNameText.style.setProperty('--tm-log-name-overflow', `${overflow}px`);
    communicationLogNameText.style.setProperty('--tm-log-name-duration', overflow > 0 ? `${Math.max(1.5, overflow / 40)}s` : '0s');
  }''')

text = replace_top_level_function(text, 'refreshStatus', r'''  function refreshStatus() {
    const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
    if (!status) return;
    const {
      communicationLogNameViewport,
      communicationLogNameText,
      renameCommunicationLogButton,
      duplicateCommunicationLogButton,
      resetCommunicationLogButton
    } = communicationLogPanelControls();
    const communicationLogAvailable = Boolean(communicationLogReady && communicationLogFileName);
    const communicationLogDisplayName = communicationLogAvailable ? communicationLogFileName : 'Not configured';
    if (communicationLogNameText) communicationLogNameText.textContent = communicationLogDisplayName;
    if (communicationLogNameViewport) {
      communicationLogNameViewport.title = communicationLogDisplayName;
      communicationLogNameViewport.setAttribute(
        'aria-label',
        communicationLogAvailable
          ? `Current communication log filename: ${communicationLogFileName}`
          : 'Current communication log filename: not configured'
      );
      requestAnimationFrame(refreshCommunicationLogNameOverflow);
    }
    if (renameCommunicationLogButton) {
      renameCommunicationLogButton.disabled = !communicationLogAvailable || communicationLogUiActionInProgress;
    }
    if (duplicateCommunicationLogButton) {
      duplicateCommunicationLogButton.disabled = !communicationLogAvailable || communicationLogUiActionInProgress;
    }
    if (resetCommunicationLogButton) resetCommunicationLogButton.disabled = communicationLogUiActionInProgress;
    if (progressState) {
      status.textContent = progressStatus(exportKind === 'md' ? 'Extract MD' : 'Extract JSONL');
    } else {
      status.textContent = statusText;
    }
  }''')

RENAME_ICON = r'''  /**
   * Returns the shared pencil/edit action icon.
   *
   * @returns {string} Inline SVG markup for the Rename button.
   */
  function renameIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"></path><path d="m13.5 6.5 4 4"></path></svg>';
  }'''
text = insert_after_top_level_function(text, 'checkIconMarkup', RENAME_ICON, 'function renameIconMarkup()')

BIND_STORED_CHECKBOX = r'''  /**
   * Binds one persistent checkbox to a state setter and the shared recorder UI refresh.
   *
   * @param {Element} panel - Recorder panel containing the checkbox.
   * @param {string} role - Stable data-role value identifying the checkbox.
   * @param {string} storageKey - Local-storage key retaining the preference.
   * @param {boolean} initialValue - Current preference value applied at panel creation.
   * @param {Function} applyValue - Callback that updates the corresponding in-memory state.
   * @returns {void} No value is returned.
   */
  function bindStoredCheckbox(panel, role, storageKey, initialValue, applyValue) {
    const checkbox = panel.querySelector(`[data-role="${role}"]`);
    if (!(checkbox instanceof HTMLInputElement)) return;
    checkbox.checked = initialValue;
    checkbox.addEventListener('change', () => {
      applyValue(checkbox.checked);
      localStorage.setItem(storageKey, String(checkbox.checked));
      updateUi();
    });
  }'''
text = insert_after_top_level_function(text, 'makeLauncher', BIND_STORED_CHECKBOX, 'function bindStoredCheckbox(panel, role, storageKey, initialValue, applyValue)')

text = replace_once(
    text,
    '#${PANEL_ID} select,#${PANEL_ID} button{border:1px solid #666;border-radius:9px;background:#292929;color:#fff;padding:9px 12px;font:inherit}',
    '#${PANEL_ID} select,#${PANEL_ID} button,#${TEST_MATRIX_ID} button{border:1px solid #666;background:#292929;color:#fff;font:inherit}\n      #${PANEL_ID} select,#${PANEL_ID} button{border-radius:9px;padding:9px 12px}',
    'shared panel/test button base CSS',
)
text = replace_once(
    text,
    '#${PANEL_ID} button{cursor:pointer}',
    '#${PANEL_ID} button,#${TEST_MATRIX_ID} button{cursor:pointer}',
    'shared button cursor CSS',
)
text = replace_once(
    text,
    '#${PANEL_ID} button:disabled{opacity:.45;cursor:not-allowed}',
    '#${PANEL_ID} button:disabled,#${TEST_MATRIX_ID} button:disabled{opacity:.45;cursor:not-allowed}',
    'shared disabled-button CSS',
)
text = replace_once(
    text,
    '#${TEST_MATRIX_ID} button{border:1px solid #666;border-radius:8px;background:#292929;color:#fff;padding:7px 10px;font:inherit;cursor:pointer}',
    '#${TEST_MATRIX_ID} button{border-radius:8px;padding:7px 10px}',
    'test-matrix button specialization CSS',
)
text = replace_once(
    text,
    '      #${TEST_MATRIX_ID} button:disabled{opacity:.45;cursor:not-allowed}\n',
    '',
    'duplicate test-matrix disabled CSS',
)
text = replace_once(
    text,
    '#${PANEL_ID} .tm-icon-button{width:30px;height:28px;padding:4px;display:grid;place-items:center}',
    '#${PANEL_ID} .tm-icon-button{box-sizing:border-box;width:30px;height:28px;padding:4px;display:grid;place-items:center;transition:opacity .2s ease}',
    'complete icon-button geometry CSS',
)
text = replace_once(
    text,
    '      #${PANEL_ID} .tm-icon-button{transition:opacity .2s ease}\n',
    '',
    'duplicate icon-button transition CSS',
)
text = replace_once(
    text,
    '<button data-role="rename-communication-log" type="button" aria-label="Rename communication log" title="Rename communication log">✎</button>',
    '<button class="tm-icon-button" data-role="rename-communication-log" type="button" aria-label="Rename communication log" title="Rename communication log"></button>',
    'rename icon-button markup',
)

old_lookup = '''    const communicationLogNameViewport = panel.querySelector('[data-role="communication-log-name-viewport"]');
    const renameCommunicationLogButton = panel.querySelector('[data-role="rename-communication-log"]');
    const duplicateCommunicationLogButton = panel.querySelector('[data-role="duplicate-communication-log"]');
    if (duplicateCommunicationLogButton) duplicateCommunicationLogButton.innerHTML = duplicateIconMarkup();
    communicationLogNameViewport?.addEventListener('pointerenter', refreshCommunicationLogNameOverflow);'''
new_lookup = '''    const {
      communicationLogNameViewport,
      renameCommunicationLogButton,
      duplicateCommunicationLogButton,
      resetCommunicationLogButton
    } = communicationLogPanelControls(panel);
    if (renameCommunicationLogButton) renameCommunicationLogButton.innerHTML = renameIconMarkup();
    if (duplicateCommunicationLogButton) duplicateCommunicationLogButton.innerHTML = duplicateIconMarkup();
    if (resetCommunicationLogButton) resetCommunicationLogButton.innerHTML = resetIconMarkup();
    communicationLogNameViewport?.addEventListener('pointerenter', refreshCommunicationLogNameOverflow);'''
text = replace_once(text, old_lookup, new_lookup, 'communication-log control lookup')

old_rename = '''    renameCommunicationLogButton?.addEventListener('click', () => {
      if (renameCommunicationLogButton.disabled || !communicationLogFileName) return;
      const requestedName = window.prompt('Rename communication log', communicationLogFileName);
      if (requestedName === null || requestedName === communicationLogFileName) return;
      renameCommunicationLogButton.disabled = true;
      duplicateCommunicationLogButton.disabled = true;
      void communicationLogRename(requestedName)
        .then(newFileName => {
          setStatus(`Communication log renamed to ${newFileName}.`);
        })
        .catch(error => {
          setStatus(`⚠ Communication log rename failed: ${error?.message ?? String(error)}`);
        })
        .finally(() => {
          refreshStatus();
        });
    });'''
new_rename = '''    renameCommunicationLogButton?.addEventListener('click', () => {
      if (renameCommunicationLogButton.disabled || communicationLogUiActionInProgress || !communicationLogFileName) return;
      const requestedName = window.prompt('Rename communication log', communicationLogFileName);
      if (requestedName === null || requestedName === communicationLogFileName) return;
      void runCommunicationLogPanelAction(renameCommunicationLogButton, {
        idleLabel: 'Rename communication log',
        busyLabel: 'Renaming communication log',
        busyTitle: 'Renaming…',
        operation: () => communicationLogRename(requestedName),
        onSuccess: newFileName => setStatus(`Communication log renamed to ${newFileName}.`),
        failurePrefix: 'Communication log rename failed'
      });
    });'''
text = replace_once(text, old_rename, new_rename, 'rename UI action')

old_duplicate = '''    duplicateCommunicationLogButton?.addEventListener('click', () => {
      if (duplicateCommunicationLogButton.disabled || !communicationLogFileName) return;
      duplicateCommunicationLogButton.disabled = true;
      renameCommunicationLogButton.disabled = true;
      duplicateCommunicationLogButton.setAttribute('aria-label', 'Duplicating communication log');
      duplicateCommunicationLogButton.title = 'Duplicating…';
      void communicationLogDuplicate()
        .then(duplicateName => {
          setStatus(`Communication log duplicated as ${duplicateName}.`);
        })
        .catch(error => {
          setStatus(`⚠ Communication log duplicate failed: ${error?.message ?? String(error)}`);
        })
        .finally(() => {
          duplicateCommunicationLogButton.setAttribute('aria-label', 'Duplicate communication log');
          duplicateCommunicationLogButton.title = 'Duplicate communication log';
          refreshStatus();
        });
    });'''
new_duplicate = '''    duplicateCommunicationLogButton?.addEventListener('click', () => {
      if (duplicateCommunicationLogButton.disabled || communicationLogUiActionInProgress || !communicationLogFileName) return;
      void runCommunicationLogPanelAction(duplicateCommunicationLogButton, {
        idleLabel: 'Duplicate communication log',
        busyLabel: 'Duplicating communication log',
        busyTitle: 'Duplicating…',
        operation: communicationLogDuplicate,
        onSuccess: duplicateName => setStatus(`Communication log duplicated as ${duplicateName}.`),
        failurePrefix: 'Communication log duplicate failed'
      });
    });'''
text = replace_once(text, old_duplicate, new_duplicate, 'duplicate UI action')

old_reset = '''    const resetCommunicationLogButton = panel.querySelector('[data-role="reset-communication-log"]');
    if (resetCommunicationLogButton) resetCommunicationLogButton.innerHTML = resetIconMarkup();
    resetCommunicationLogButton?.addEventListener('click', () => {
      if (resetCommunicationLogButton.disabled) return;
      resetCommunicationLogButton.disabled = true;
      resetCommunicationLogButton.setAttribute('aria-label', 'Resetting communication log');
      resetCommunicationLogButton.title = 'Resetting…';
      void communicationLogReset()
        .then(() => {
          logDiagnostic('debug', 'communication-log-reset-complete', {
            file_name: communicationLogFileName
          });
          setStatus('Communication log reset to empty.');
        })
        .catch(error => {
          setStatus(`⚠ Communication log reset failed: ${error?.message ?? String(error)}`);
        })
        .finally(() => {
          resetCommunicationLogButton.disabled = false;
          resetCommunicationLogButton.setAttribute('aria-label', 'Reset communication log');
          resetCommunicationLogButton.title = 'Reset communication log';
        });
    });'''
new_reset = '''    resetCommunicationLogButton?.addEventListener('click', () => {
      if (resetCommunicationLogButton.disabled || communicationLogUiActionInProgress) return;
      void runCommunicationLogPanelAction(resetCommunicationLogButton, {
        idleLabel: 'Reset communication log',
        busyLabel: 'Resetting communication log',
        busyTitle: 'Resetting…',
        operation: communicationLogReset,
        onSuccess: () => {
          logDiagnostic('debug', 'communication-log-reset-complete', {
            file_name: communicationLogFileName
          });
          setStatus('Communication log reset to empty.');
        },
        failurePrefix: 'Communication log reset failed'
      });
    });'''
text = replace_once(text, old_reset, new_reset, 'reset UI action')

old_metadata = '''    const timestamps = panel.querySelector('[data-role="show-timestamps"]');
    const recordNumbers = panel.querySelector('[data-role="show-record-numbers"]');
    const turnIds = panel.querySelector('[data-role="show-turn-ids"]');
    const debugProvenance = panel.querySelector('[data-role="show-debug-provenance"]');
    if (timestamps) {
      timestamps.checked = showTimestamps;
      timestamps.addEventListener('change', () => {
        showTimestamps = timestamps.checked;
        localStorage.setItem(SHOW_TIMESTAMPS_STORAGE_KEY, String(showTimestamps));
        updateUi();
      });
    }
    if (recordNumbers) {
      recordNumbers.checked = showRecordNumbers;
      recordNumbers.addEventListener('change', () => {
        showRecordNumbers = recordNumbers.checked;
        localStorage.setItem(SHOW_RECORD_NUMBERS_STORAGE_KEY, String(showRecordNumbers));
        updateUi();
      });
    }
    if (turnIds) {
      turnIds.checked = showTurnIds;
      turnIds.addEventListener('change', () => {
        showTurnIds = turnIds.checked;
        localStorage.setItem(SHOW_TURN_IDS_STORAGE_KEY, String(showTurnIds));
        updateUi();
      });
    }
    if (debugProvenance) {
      debugProvenance.checked = showDebugProvenance;
      debugProvenance.addEventListener('change', () => {
        showDebugProvenance = debugProvenance.checked;
        localStorage.setItem(SHOW_DEBUG_PROVENANCE_STORAGE_KEY, String(showDebugProvenance));
        updateUi();
      });
    }'''
new_metadata = '''    bindStoredCheckbox(panel, 'show-timestamps', SHOW_TIMESTAMPS_STORAGE_KEY, showTimestamps, value => {
      showTimestamps = value;
    });
    bindStoredCheckbox(panel, 'show-record-numbers', SHOW_RECORD_NUMBERS_STORAGE_KEY, showRecordNumbers, value => {
      showRecordNumbers = value;
    });
    bindStoredCheckbox(panel, 'show-turn-ids', SHOW_TURN_IDS_STORAGE_KEY, showTurnIds, value => {
      showTurnIds = value;
    });
    bindStoredCheckbox(panel, 'show-debug-provenance', SHOW_DEBUG_PROVENANCE_STORAGE_KEY, showDebugProvenance, value => {
      showDebugProvenance = value;
    });'''
text = replace_once(text, old_metadata, new_metadata, 'persistent metadata checkbox wiring')

# Normalize repeated error-to-text expressions after the UI blocks above are replaced.
text = text.replace('String(error?.message ?? error)', 'errorMessage(error)')
text = text.replace('error instanceof Error ? error.message : String(error)', 'errorMessage(error)')
text = text.replace('error?.message ?? String(error)', 'errorMessage(error)')

USERSCRIPT.write_text(text, encoding='utf-8')

# Shared test-source helper removes repeated userscript reads and production-block extraction code.
helper_dir = ROOT / 'tests' / 'helpers'
helper_dir.mkdir(parents=True, exist_ok=True)
(helper_dir / 'userscript-source.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const userscript = await readFile(
  new URL('../../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

export function markedBlock(startMarker, endMarker, source = userscript) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Production block ${startMarker} is missing.`);
  return source.slice(start, end + endMarker.length);
}

export function diskBlock() {
  return markedBlock(
    '  // BEGIN Issue #123 disk communication recorder',
    '  // END Issue #123 disk communication recorder'
  );
}

export function productionFunctionSource(name, source = userscript) {
  const starts = [
    source.indexOf(`async function ${name}(`),
    source.indexOf(`function ${name}(`)
  ].filter(index => index >= 0);
  assert.ok(starts.length > 0, `Production function ${name} is missing.`);
  const start = Math.min(...starts);
  const brace = source.indexOf('{', start);
  assert.ok(brace > start, `Production function ${name} has no body.`);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Production function ${name} has an unterminated body.`);
}

export function diskFunctionSource(name) {
  return productionFunctionSource(name, diskBlock());
}

export function diskHarnessSource() {
  return [
    productionFunctionSource('errorMessage'),
    productionFunctionSource('cloneSafely'),
    productionFunctionSource('releaseReaderLockQuietly'),
    productionFunctionSource('abortWritableQuietly'),
    productionFunctionSource('cancelReadableBodyQuietly'),
    diskBlock()
  ].join('\n');
}
''', encoding='utf-8')

# Share the userscript loader wherever the common top-level declaration exists.
for test_path in sorted((ROOT / 'tests').glob('*.mjs')):
    share_userscript_loader(test_path)

# Replace repeated extraction helpers with the shared test helper.
special = ROOT / 'tests' / 'communication-log-file-controls.test.mjs'
s = special.read_text(encoding='utf-8')
s = remove_unindented_function(s, 'diskBlock')
s = s.replace('${diskBlock()}\\ncommunicationLogDirectoryHandle', '${diskHarnessSource()}\\ncommunicationLogDirectoryHandle')
s = s.replace('@version\\s+1\\.2\\.0-issue\\.134\\.4', '@version\\s+1\\.2\\.0-issue\\.134\\.5')
s = s.replace(
    "  assert.match(userscript, /querySelector\\('\\[data-role=\\\"rename-communication-log\\\"\\]'\\)/);\n"
    "  assert.match(userscript, /querySelector\\('\\[data-role=\\\"duplicate-communication-log\\\"\\]'\\)/);",
    "  assert.match(userscript, /function communicationLogPanelControls\\(/);\n"
    "  assert.match(userscript, /renameCommunicationLogButton:/);\n"
    "  assert.match(userscript, /duplicateCommunicationLogButton:/);",
)
s = s.replace(
    "  assert.match(userscript, /data-role=\\\"rename-communication-log\\\"/);",
    "  assert.match(userscript, /class=\\\"tm-icon-button\\\" data-role=\\\"rename-communication-log\\\"/);",
)
s += r'''

test('communication-log mutators share queue, writer-close, and panel action infrastructure', () => {
  const block = diskBlock();
  assert.match(block, /function communicationLogEnqueue\(/);
  for (const name of [
    'communicationLogCheckpoint',
    'communicationLogRename',
    'communicationLogDuplicate',
    'communicationLogReset',
    'communicationLogAppendLine'
  ]) {
    assert.match(diskFunctionSource(name), /communicationLogEnqueue\(/,
      `${name} must use the shared communication-log queue helper.`);
  }
  assert.match(diskFunctionSource('communicationLogReset'), /communicationLogCloseActiveWriter\(\)/);
  assert.doesNotMatch(diskFunctionSource('communicationLogReset'), /communicationLogWritable\.close\(\)/,
    'Reset must not reimplement active-writer close state cleanup.');
  assert.match(userscript, /function runCommunicationLogPanelAction\(/);
  assert.match(userscript, /function communicationLogPanelControls\(/);
});
'''
special.write_text(s, encoding='utf-8')
set_helper_import(special, ['diskBlock', 'diskFunctionSource', 'diskHarnessSource', 'userscript'])

reset = ROOT / 'tests' / 'communication-log-reset.test.mjs'
s = reset.read_text(encoding='utf-8')
s = remove_unindented_function(s, 'diskBlock')
s = s.replace('${diskBlock()}\ncommunicationLogReportFailure', '${diskHarnessSource()}\ncommunicationLogReportFailure')
reset.write_text(s, encoding='utf-8')
set_helper_import(reset, ['diskHarnessSource', 'userscript'])

directory = ROOT / 'tests' / 'directory-picker-gesture.test.mjs'
s = directory.read_text(encoding='utf-8')
s = remove_unindented_function(s, 'diskBlock')
directory.write_text(s, encoding='utf-8')
set_helper_import(directory, ['diskBlock', 'userscript'])

disk = ROOT / 'tests' / 'disk-communication-recorder.test.mjs'
s = disk.read_text(encoding='utf-8')
s = remove_unindented_function(s, 'diskBlock')
s = remove_unindented_function(s, 'functionBlock')
s = s.replace('functionBlock(', 'diskFunctionSource(')
s = s.replace('${diskBlock()}\\nthis.__redaction', '${diskHarnessSource()}\\nthis.__redaction')
s = s.replace('${diskBlock()}\\nthis.__bodyPolicy', '${diskHarnessSource()}\\nthis.__bodyPolicy')
s = s.replace('/request\\.clone\\(\\)|input\\.clone\\(\\)/', '/cloneSafely\\(request\\)/')
s = s.replace('/response\\.clone\\(\\)/', '/cloneSafely\\(response\\)/')
disk.write_text(s, encoding='utf-8')
set_helper_import(disk, ['diskBlock', 'diskFunctionSource', 'diskHarnessSource', 'userscript'])

console_test = ROOT / 'tests' / 'console-diagnostics.test.mjs'
s = console_test.read_text(encoding='utf-8')
s = remove_unindented_function(s, 'productionFunctionSource')
console_test.write_text(s, encoding='utf-8')
set_helper_import(console_test, ['productionFunctionSource', 'userscript'])

sediment = ROOT / 'tests' / 'sediment-resolver.test.mjs'
s = sediment.read_text(encoding='utf-8')
s = remove_unindented_function(s, 'productionFunctionSource')
sediment.write_text(s, encoding='utf-8')
set_helper_import(sediment, ['productionFunctionSource', 'userscript'])

modal = ROOT / 'tests' / 'modal-focus-retention.test.mjs'
s = modal.read_text(encoding='utf-8')
s = remove_unindented_function(s, 'extractTopLevelFunction')
s = s.replace("extractTopLevelFunction('modalFocusableElements')", "productionFunctionSource('modalFocusableElements')")
s = s.replace("extractTopLevelFunction('installModalContract')", "productionFunctionSource('installModalContract')")
modal.write_text(s, encoding='utf-8')
set_helper_import(modal, ['productionFunctionSource', 'userscript'])

stock = ROOT / 'tests' / 'stock-network-diagnostics.test.mjs'
s = stock.read_text(encoding='utf-8')
s = s.replace('/response\\.clone\\(\\)/', '/cloneSafely\\(response\\)/')
stock.write_text(s, encoding='utf-8')

heading = ROOT / 'tests' / 'heading-metadata-controls.test.mjs'
s = heading.read_text(encoding='utf-8')
s = s.replace(
    "  assert.match(userscript, /localStorage\\.setItem\\(SHOW_TURN_IDS_STORAGE_KEY, String\\(showTurnIds\\)\\)/);\n"
    "  assert.match(userscript, /localStorage\\.setItem\\(SHOW_DEBUG_PROVENANCE_STORAGE_KEY, String\\(showDebugProvenance\\)\\)/);",
    "  assert.match(userscript, /bindStoredCheckbox\\(panel, 'show-turn-ids', SHOW_TURN_IDS_STORAGE_KEY, showTurnIds/);\n"
    "  assert.match(userscript, /bindStoredCheckbox\\(panel, 'show-debug-provenance', SHOW_DEBUG_PROVENANCE_STORAGE_KEY, showDebugProvenance/);\n"
    "  assert.match(userscript, /localStorage\\.setItem\\(storageKey, String\\(checkbox\\.checked\\)\\)/);",
)
heading.write_text(s, encoding='utf-8')

layout = ROOT / 'tests' / 'communication-log-layout-contract.test.mjs'
s = layout.read_text(encoding='utf-8')
s = s.replace(
    "  assert.match(row, /data-role=\\\"rename-communication-log\\\"/);",
    "  assert.match(row, /class=\\\"tm-icon-button\\\" data-role=\\\"rename-communication-log\\\"/);",
)
s = s.replace(
    "test('Duplicate and Reset use their approved icon treatments', () => {",
    "test('Rename, Duplicate and Reset use their approved icon treatments', () => {\n"
    "  assert.match(userscript, /function renameIconMarkup\\(\\)/);\n"
    "  assert.match(userscript, /renameCommunicationLogButton\\.innerHTML = renameIconMarkup\\(\\)/);",
)
layout.write_text(s, encoding='utf-8')

# Structural regression guards against the concrete duplication removed by this revision.
dry_test = ROOT / 'tests' / 'dry-contract.test.mjs'
dry_test.write_text(r'''import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { diskBlock, userscript } from './helpers/userscript-source.mjs';

test('tests share the userscript source loader and disk-block extractor', async () => {
  for (const name of await readdir(new URL('.', import.meta.url))) {
    if (!name.endsWith('.mjs') || name === 'dry-contract.test.mjs') continue;
    const source = await readFile(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(source,
      /const userscript = await readFile\([\s\S]{0,160}chatgpt-conversation-markdown-export\.user\.js/,
      `${name} reimplemented the shared userscript loader.`);
    assert.doesNotMatch(source, /function diskBlock\(\)/,
      `${name} reimplemented the shared disk-block extractor.`);
  }
});

test('production icon buttons and communication-log queue each have one shared contract', () => {
  assert.equal((userscript.match(/#\$\{PANEL_ID\} \.tm-icon-button\{/g) ?? []).length, 1,
    'Icon-button geometry/style must have one production CSS rule.');
  assert.match(userscript,
    /class="tm-icon-button" data-role="rename-communication-log"/);
  assert.match(userscript, /function communicationLogEnqueue\(/);
  assert.equal((diskBlock().match(/communicationLogWriteChain = operation\.catch/g) ?? []).length, 1,
    'Only the shared communication-log queue helper may recover the write chain.');
});
''', encoding='utf-8')

# Add the structural DRY regression to normal CI.
ci = ROOT / '.github' / 'workflows' / 'ci.yml'
ci_text = ci.read_text(encoding='utf-8')
ci_text = replace_once(
    ci_text,
    "      - name: Communication log file controls regression\n"
    "        run: node --test tests/communication-log-file-controls.test.mjs tests/communication-log-layout-contract.test.mjs\n",
    "      - name: Communication log file controls regression\n"
    "        run: node --test tests/communication-log-file-controls.test.mjs tests/communication-log-layout-contract.test.mjs tests/dry-contract.test.mjs\n",
    'CI DRY regression registration',
)
ci.write_text(ci_text, encoding='utf-8')

print('Issue #134 DRY cleanup applied.')
