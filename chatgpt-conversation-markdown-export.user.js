// ==UserScript==
// @name         ChatGPT Conversation Markdown Recorder
// @namespace    https://chatgpt.com/
// @version      0.6.172
// @description  Exports the current ChatGPT conversation directly from the Conversation API as Markdown or JSONL.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @require      https://raw.githubusercontent.com/Ma-XX-oN/AIConversationCore/3233cba838bbf2d2cea5a2a6f1900ed6014dcfb0/dist/aiconversationcore.chatgpt.browser.js
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  /** Installed userscript version reported in diagnostics and runtime metadata. */
  const VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || 'unknown';
  console.log(`[DownloadConversation] version ${VERSION}`);
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
  /** Session-storage key for the retained recorder diagnostic log. */
  const DIAGNOSTIC_LOG_STORAGE_KEY = 'tm-conversation-recorder-diagnostic-log';
  /** Maximum number of diagnostic entries retained in memory and session storage. */
  const MAX_DIAGNOSTIC_LOG_ITEMS = 10000;
  /** Maximum retained diagnostic entries persisted across a page reload. */
  const MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS = 5000;
  /** Debounce used to keep high-volume debug diagnostics from serializing the full log on every event. */
  const DIAGNOSTIC_PERSIST_DELAY_MS = 1000;

  /** Unwrapped page-realm fetch implementation captured before installing interception. */
  let originalPageFetch = null;
  /** Latest captured Conversation API authorization/header context for direct requests. */
  let apiRequestContext = null;
  /** Guards network interception so page hooks are installed only once. */
  let captureInstalled = false;
  /** Currently selected diagnostic threshold, restored from local storage at startup. */
  let diagnosticsLevel = localStorage.getItem('tm-conversation-recorder-diagnostics') || DEFAULT_DIAGNOSTICS;
  /** Whether active exports should request a screen wake lock. */
  let screenOnWhenCapturing = localStorage.getItem(SCREEN_ON_STORAGE_KEY) !== 'false';
  /** Whether Markdown headings should include local-time source timestamps. */
  let showTimestamps = localStorage.getItem(SHOW_TIMESTAMPS_STORAGE_KEY) === 'true';
  /** Whether Markdown headings should include one-based JSONL record numbers. */
  let showRecordNumbers = localStorage.getItem(SHOW_RECORD_NUMBERS_STORAGE_KEY) === 'true';
  /** Whether Markdown headings should include source/provider turn IDs. */
  let showTurnIds = localStorage.getItem(SHOW_TURN_IDS_STORAGE_KEY) !== 'false';
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
  try {
    const storedDiagnosticLog = JSON.parse(sessionStorage.getItem(DIAGNOSTIC_LOG_STORAGE_KEY) || '[]');
    if (Array.isArray(storedDiagnosticLog)) diagnosticLog = storedDiagnosticLog.slice(-MAX_DIAGNOSTIC_LOG_ITEMS);
  } catch {}

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
   * Formats duration.
   *
   * @param {Object} milliseconds - The duration in milliseconds.
   * @returns {string} The string produced by `formatDuration`.
   */
  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  /**
   * Handles escape HTML text.
   *
   * @param {string} text - The text to process.
   * @returns {string} The string produced by `escapeHtmlText`.
   */
  function escapeHtmlText(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Handles escape HTML attribute.
   *
   * @param {string} text - The text to process.
   * @returns {string} The string produced by `escapeHtmlAttribute`.
   */
  function escapeHtmlAttribute(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Quotes literal message text as the transcript blockquote representation while preserving line order.
   *
   * @param {string} markdown - The Markdown text to process.
   * @returns {string} The string produced by `quoteMarkdown`.
   */
  function quoteMarkdown(markdown) {
    const text = String(markdown ?? '').replace(/\s+$/, '');
    if (!text) return '>';
    return text.split('\n').map(line => line.length ? `> ${line}` : '>').join('\n');
  }

  /**
   * Handles conversation title.
   *
   * @returns {string} The string produced by `conversationTitle`.
   */
  function conversationTitle() {
    const heading = document.querySelector('h1')?.textContent?.trim();
    const title = heading || document.title || 'ChatGPT conversation';
    return title.replace(/\s*[-–—]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT conversation';
  }

  /**
   * Sanitizes file name.
   *
   * @param {string} name - The name to process.
   * @returns {string} The string produced by `sanitizeFileName`.
   */
  function sanitizeFileName(name) {
    return String(name || 'ChatGPT conversation')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim() || 'ChatGPT conversation';
  }

  /**
   * Handles current conversation ID.
   *
   * @returns {null} The value produced by `currentConversationId`, or `null` when unavailable.
   */
  function currentConversationId() {
    return location.pathname.match(/\/c\/([^/?#]+)/)?.[1] ?? null;
  }

  /**
   * Checks whether conversation API URL.
   *
   * @param {string} url - The URL to process.
   * @returns {boolean} `true` when `isConversationApiUrl` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function isConversationApiUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin) return false;
      return /^\/backend-api\/conversations\/[^/]+(?:\/messages)?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  /**
   * Handles raw headers to object.
   *
   * @param {Object} headers - The HTTP header values to inspect.
   * @returns {Object} The Object value produced by `rawHeadersToObject`.
   */
  function rawHeadersToObject(headers) {
    const result = {};
    /**
     * Handles put.
     *
     * @param {string} name - The name to process.
     * @param {string} value - The value to process.
     * @returns {void} No value is returned.
     */
    const put = (name, value) => {
      if (name == null || value == null) return;
      const key = String(name).toLowerCase();
      result[key] = result[key] ? `${result[key]}, ${value}` : String(value);
    };
    try {
      if (typeof headers?.forEach === 'function') {
        headers.forEach((value, key) => put(key, value));
      } else if (Array.isArray(headers)) {
        for (const entry of headers) {
          if (Array.isArray(entry) && entry.length >= 2) put(entry[0], entry[1]);
        }
      } else if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) put(key, value);
      }
    } catch {}
    return result;
  }

  /**
   * Handles remember API request context.
   *
   * @param {string} url - The URL to process.
   * @param {Array<Object>} headerCandidates - The HTTP header values to inspect.
   * @returns {void} No value is returned.
   */
  function rememberApiRequestContext(url, ...headerCandidates) {
    if (!isConversationApiUrl(url)) return;
    try {
      const parsed = new URL(url, location.href);
      const match = parsed.pathname.match(/^\/backend-api\/conversations\/([^/]+)/);
      if (!match) return;
      const headers = {};
      for (const candidate of headerCandidates) {
        for (const [key, value] of Object.entries(rawHeadersToObject(candidate))) {
          if (!(key in headers)) headers[key] = value;
        }
      }
      if (!headers.authorization) return;
      apiRequestContext = {
        conversation_id: match[1],
        headers,
        captured_at: new Date().toISOString()
      };
    } catch {}
  }

  /**
   * Handles click diagnostic element snapshot.
   *
   * @param {Element} element - The DOM element to inspect or update.
   * @returns {Object|null} The value produced by `clickDiagnosticElementSnapshot`, or `null` when unavailable.
   */
  function clickDiagnosticElementSnapshot(element) {
    if (!(element instanceof Element)) return null;
    const attributes = {};
    for (const attribute of [...element.attributes].slice(0, 40)) {
      if (attribute.name.startsWith('data-') ||
          ['href', 'src', 'aria-label', 'title', 'alt', 'download', 'target', 'role'].includes(attribute.name)) {
        attributes[attribute.name] = boundedDiagnosticText(attribute.value, 1000);
      }
    }
    return {
      tag: element.tagName.toLowerCase(),
      attributes,
      href_property: element instanceof HTMLAnchorElement ? element.href || null : null,
      src_property: element instanceof HTMLImageElement ? element.src || null : null,
      current_src: element instanceof HTMLImageElement ? element.currentSrc || null : null,
      text: boundedDiagnosticText(element.textContent?.trim() || '', 500) || null
    };
  }

  /**
   * Handles click diagnostic turn context.
   *
   * @param {EventTarget|null} target - The target element or resolved jump target.
   * @returns {Object|null} The value produced by `clickDiagnosticTurnContext`, or `null` when no value is available.
   */
  function clickDiagnosticTurnContext(target) {
    const section = target instanceof Element ? target.closest('section[data-turn-id]') : null;
    if (!(section instanceof HTMLElement)) return null;
    const message = section.querySelector('[data-message-id]');
    const clickedImage = target.closest('img');
    // One-based image ordinal used to correlate a click with the matching source image.
    let imageOrdinal = null;
    if (clickedImage instanceof HTMLImageElement) {
      const images = [...section.querySelectorAll(
        'button[aria-label^="Open image:"] img, [class~="group/message-image"] img'
      )];
      const index = images.indexOf(clickedImage);
      if (index >= 0) imageOrdinal = index + 1;
    }
    return {
      turn_id: section.getAttribute('data-turn-id') || null,
      message_id: message?.getAttribute('data-message-id') || null,
      role: section.getAttribute('data-turn') || null,
      image_ordinal: imageOrdinal
    };
  }

  /**
   * Handles record click diagnostic network request.
   *
   * @param {string} url - The URL to process.
   * @param {Object} initiatorType - The initiatorType value required by this function.
   * @returns {void} No value is returned.
   */
  function recordClickDiagnosticNetworkRequest(url, initiatorType) {
    // Snapshot the observation so this request is attributed to one click consistently.
    const active = activeClickDiagnostic;
    if (!active || performance.now() > active.deadline) return;
    const value = typeof url === 'string' ? url : String(url ?? '');
    if (!value) return;
    const item = {
      url: boundedDiagnosticText(value, 2000),
      initiator_type: initiatorType,
      elapsed_ms: Math.round(performance.now() - active.started_at)
    };
    active.network_requests.push(item);
    if (active.network_requests.length > 50) active.network_requests.shift();
    logDiagnostic('debug', 'conversation-click-network-request', {
      click_sequence: active.sequence,
      ...item
    });
  }

  /**
   * Handles finish conversation click diagnostic.
   *
   * @param {Object} observation - The observation value required by this function.
   * @param {string} reason - The reason the operation is being completed.
   * @returns {void} No value is returned.
   */
  function finishConversationClickDiagnostic(observation, reason = 'timer') {
    if (!observation || observation.finished) return;
    observation.finished = true;
    if (activeClickDiagnostic === observation) activeClickDiagnostic = null;
    const endedAt = performance.now();
    const resources = performance.getEntriesByType('resource')
      .filter(entry => entry instanceof PerformanceResourceTiming &&
        entry.startTime >= observation.started_at - 1 && entry.startTime <= endedAt + 1)
      .slice(-100)
      .map(entry => ({
        url: boundedDiagnosticText(entry.name, 2000),
        initiator_type: entry.initiatorType || null,
        response_status: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
        transfer_size: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
        decoded_body_size: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
        start_offset_ms: Math.round(entry.startTime - observation.started_at),
        duration_ms: Math.round(entry.duration)
      }));
    logDiagnostic('debug', 'conversation-click-resolution-result', {
      click_sequence: observation.sequence,
      finish_reason: reason,
      observation_ms: Math.round(endedAt - observation.started_at),
      turn: observation.turn,
      clicked: observation.clicked,
      closest_anchor: observation.closest_anchor,
      closest_button: observation.closest_button,
      closest_image: observation.closest_image,
      network_requests: observation.network_requests,
      new_performance_resources: resources
    });
  }

  /**
   * Handles capture conversation click diagnostic.
   *
   * @param {Event|Object} event - The event or event-like object being handled.
   * @returns {void} No value is returned.
   */
  function captureConversationClickDiagnostic(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest('#thread')) return;
    const turn = clickDiagnosticTurnContext(target);
    if (!turn) return;
    if (activeClickDiagnostic) finishConversationClickDiagnostic(activeClickDiagnostic, 'superseded-by-next-click');
    const startedAt = performance.now();
    const observation = {
      sequence: ++clickDiagnosticSequence,
      started_at: startedAt,
      deadline: startedAt + 2500,
      turn,
      clicked: clickDiagnosticElementSnapshot(target),
      closest_anchor: clickDiagnosticElementSnapshot(target.closest('a[href]')),
      closest_button: clickDiagnosticElementSnapshot(target.closest('button')),
      closest_image: clickDiagnosticElementSnapshot(target.closest('img')),
      network_requests: [],
      finished: false
    };
    activeClickDiagnostic = observation;
    logDiagnostic('debug', 'conversation-click-resolution-start', {
      click_sequence: observation.sequence,
      turn: observation.turn,
      clicked: observation.clicked,
      closest_anchor: observation.closest_anchor,
      closest_button: observation.closest_button,
      closest_image: observation.closest_image
    });
    setTimeout(() => finishConversationClickDiagnostic(observation, 'timer'), 2500);
  }

  /**
   * Handles install network capture.
   *
   * @returns {void} No value is returned.
   */
  function installNetworkCapture() {
    if (captureInstalled) return;
    // Use the page realm rather than the userscript sandbox when intercepting page networking.
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    if (typeof pageWindow.fetch === 'function') {
      const originalFetch = pageWindow.fetch;
      originalPageFetch = originalFetch;
      pageWindow.fetch = function(...args) {
        const input = args[0];
        const init = args[1] || {};
        let request = null;
        try {
          const PageRequest = pageWindow.Request || Request;
          request = input instanceof PageRequest ? input : new PageRequest(input, init);
        } catch {}
        const requestUrl = request?.url ?? String(input);
        rememberApiRequestContext(requestUrl, request?.headers, init.headers);
        recordClickDiagnosticNetworkRequest(requestUrl, 'fetch');
        return originalFetch.apply(this, args);
      };
    }

    // Retain the page-realm XHR constructor whose prototype is patched for capture.
    const XHR = pageWindow.XMLHttpRequest;
    if (XHR?.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      const originalSetRequestHeader = XHR.prototype.setRequestHeader;
      XHR.prototype.open = function(method, url, ...rest) {
        this.__tmApiRequest = { method: String(method), url: String(url), headers: {} };
        return originalOpen.call(this, method, url, ...rest);
      };
      XHR.prototype.setRequestHeader = function(name, value) {
        if (this.__tmApiRequest) {
          const key = String(name).toLowerCase();
          const prior = this.__tmApiRequest.headers[key];
          this.__tmApiRequest.headers[key] = prior ? `${prior}, ${value}` : String(value);
        }
        return originalSetRequestHeader.call(this, name, value);
      };
      XHR.prototype.send = function(body) {
        const info = this.__tmApiRequest || { url: '', headers: {} };
        rememberApiRequestContext(info.url, info.headers);
        recordClickDiagnosticNetworkRequest(info.url, 'xmlhttprequest');
        return originalSend.call(this, body);
      };
    }

    if (typeof pageWindow.open === 'function') {
      const originalOpen = pageWindow.open;
      pageWindow.open = function(url, ...rest) {
        recordClickDiagnosticNetworkRequest(url, 'window.open');
        return originalOpen.call(this, url, ...rest);
      };
    }

    captureInstalled = true;
  }

  /**
   * Handles API fetch.
   *
   * @param {string} url - The URL to process.
   * @returns {Promise<Object|boolean|string|number|null>} A promise that resolves to the Object|boolean|string|number|null result produced by `apiFetch`.
   */
  async function apiFetch(url) {
    const conversationId = currentConversationId();
    // Snapshot the captured request context used to authorize this direct API request.
    const context = apiRequestContext;
    if (!context?.headers?.authorization || context.conversation_id !== conversationId) {
      throw new Error('No authenticated Conversation API context is available. Reload this conversation, then try again.');
    }
    // Use the page realm rather than the userscript sandbox when intercepting page networking.
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    // Prefer the pre-interception fetch implementation to avoid recursively capturing ourselves.
    const fetchFn = originalPageFetch || pageWindow.fetch;
    return fetchFn.call(pageWindow, url, {
      method: 'GET',
      headers: { ...context.headers },
      credentials: 'include'
    });
  }

  /**
   * Handles conversation schema ok.
   *
   * @param {Object} data - The data value required by this function.
   * @returns {boolean} `true` when `conversationSchemaOk` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function conversationSchemaOk(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.messages) &&
      !!data.page_info && typeof data.page_info === 'object';
  }

  /**
   * Handles page URL.
   *
   * @param {string} conversationId - The Conversation API conversation identifier.
   * @param {Object|null} cursor - The pagination cursor, or null for the first page.
   * @returns {string} The string produced by `pageUrl`.
   */
  function pageUrl(conversationId, cursor = null) {
    if (cursor === null) {
      return `${location.origin}/backend-api/conversations/${encodeURIComponent(conversationId)}?include_has_versions=true&num_turns=${PAGE_TURNS}`;
    }
    return `${location.origin}/backend-api/conversations/${encodeURIComponent(conversationId)}/messages?before=${encodeURIComponent(cursor)}&include_has_versions=true&num_turns=${PAGE_TURNS}`;
  }

  /**
   * Handles bounded diagnostic text.
   *
   * @param {string} text - The text to process.
   * @param {number} maxChars - The maximum number of characters to retain.
   * @returns {string} The string produced by `boundedDiagnosticText`.
   */
  function boundedDiagnosticText(text, maxChars = 2000) {
    const value = typeof text === 'string' ? text : String(text ?? '');
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]`;
  }


  /**
   * Handles diagnostic request path.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `diagnosticRequestPath`.
   */
  function diagnosticRequestPath(url) {
    try {
      const parsed = new URL(url, location.href);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return String(url);
    }
  }

  /**
   * Fetches one conversation page.
   *
   * @param {string} url - The URL to process.
   * @param {Object} description - The description value required by this function.
   * @param {Object} requestInfo - The requestInfo value required by this function.
   * @returns {Promise<Object|boolean|string|number|null>} A promise that resolves to the Object|boolean|string|number|null result produced by `fetchOneConversationPage`.
   */
  async function fetchOneConversationPage(url, description, requestInfo = {}) {
    const startedAt = performance.now();
    const requestDetails = {
      page_number: requestInfo.page_number ?? null,
      request_kind: requestInfo.request_kind ?? 'unknown',
      cursor: requestInfo.cursor ?? null,
      request_path: diagnosticRequestPath(url),
      previous_page_info: requestInfo.previous_page_info ?? null
    };

    logDiagnostic('verbose', 'conversation-api-page-request-start', requestDetails);

    let response;
    try {
      response = await apiFetch(url);
    } catch (error) {
      logDiagnostic('errors', 'conversation-api-page-network-failure', {
        ...requestDetails,
        elapsed_ms: Math.round(performance.now() - startedAt),
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    const responseDetails = {
      ...requestDetails,
      elapsed_ms: Math.round(performance.now() - startedAt),
      status: response.status,
      status_text: response.statusText,
      content_type: response.headers.get('content-type') || ''
    };

    if (!response.ok) {
      let bodyPreview = '';
      try {
        bodyPreview = boundedDiagnosticText(await response.clone().text());
      } catch (error) {
        bodyPreview = `[response body unavailable: ${error instanceof Error ? error.message : String(error)}]`;
      }
      logDiagnostic('errors', 'conversation-api-page-http-failure', {
        ...responseDetails,
        response_body_preview: bodyPreview
      });
      throw new Error(`${description} returned HTTP ${response.status}.`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      logDiagnostic('errors', 'conversation-api-page-json-failure', {
        ...responseDetails,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    if (!conversationSchemaOk(data)) {
      logDiagnostic('errors', 'conversation-api-page-schema-failure', {
        ...responseDetails,
        top_level_keys: data && typeof data === 'object' ? Object.keys(data) : [],
        messages_is_array: Array.isArray(data?.messages),
        page_info_type: data?.page_info === null ? 'null' : typeof data?.page_info
      });
      throw new Error(`${description} did not contain messages[] and page_info.`);
    }

    logDiagnostic('debug', 'conversation-api-page-success', {
      ...responseDetails,
      record_count: data.messages.length,
      page_info: {
        start_cursor: data.page_info.start_cursor ?? null,
        end_cursor: data.page_info.end_cursor ?? null,
        has_previous_page: data.page_info.has_previous_page ?? null,
        has_next_page: data.page_info.has_next_page ?? null
      }
    });
    return data;
  }

  /**
   * Collects conversation pages.
   *
   * @param {Object} fetchPage - The callback used to fetch one Conversation API page.
   * @param {Object} onProgress - The callback invoked with progress updates.
   * @returns {Promise<Object>} A promise that resolves to the Object result produced by `collectConversationPages`.
   */
  async function collectConversationPages(fetchPage, onProgress) {
    // Pages are accumulated newest-to-oldest as the API previous-page cursor is followed.
    const pages = [];
    // Tracks pagination cursors already consumed so a server loop is detected immediately.
    const seenCursors = new Set();
    // Running count of source records fetched across all Conversation API pages.
    let rawRecordCount = 0;
    // Null requests the newest page; later values request progressively older pages.
    let cursor = null;

    for (;;) {
      if (pages.length >= MAX_PAGES) {
        throw new Error(`Conversation pagination exceeded the ${MAX_PAGES}-page safety limit.`);
      }
      const previousPageInfo = pages.length ? pages[pages.length - 1].page_info : null;
      const pageNumber = pages.length + 1;
      const pageStartedAt = performance.now();
      onProgress?.({
        stage: 'fetching',
        phase: 'request-start',
        page_count: pages.length,
        raw_record_count: rawRecordCount,
        page_number: pageNumber,
        page_started_at: pageStartedAt
      });
      const data = await fetchPage(cursor, pageNumber, previousPageInfo);
      if (!conversationSchemaOk(data)) {
        throw new Error('Conversation API page did not contain messages[] and page_info.');
      }
      if (pages.length === 0 && data.page_info.has_next_page === true) {
        throw new Error('Initial Conversation API page reports has_next_page=true; newest boundary is not established.');
      }

      pages.push(data);
      rawRecordCount += data.messages.length;
      onProgress?.({
        stage: 'fetching',
        phase: 'request-complete',
        page_count: pages.length,
        raw_record_count: rawRecordCount,
        page_number: pageNumber,
        page_started_at: 0
      });

      if (data.page_info.has_previous_page !== true) break;
      cursor = data.page_info.start_cursor;
      if (!cursor) {
        throw new Error('Conversation API reports a previous page but supplied no start_cursor.');
      }
      if (seenCursors.has(cursor)) {
        throw new Error(`Conversation pagination repeated start_cursor ${cursor}.`);
      }
      seenCursors.add(cursor);
    }

    return { pages, raw_record_count: rawRecordCount };
  }

  /**
   * Fetches conversation pages.
   *
   * @param {string} conversationId - The Conversation API conversation identifier.
   * @param {Object} onProgress - The callback invoked with progress updates.
   * @returns {Promise<Array<unknown>>} A promise that resolves to the Array<unknown> result produced by `fetchConversationPages`.
   */
  async function fetchConversationPages(conversationId, onProgress) {
    return collectConversationPages(
      (cursor, pageNumber, previousPageInfo) => fetchOneConversationPage(
        pageUrl(conversationId, cursor),
        cursor === null ? 'Initial Conversation API request' : 'Conversation pagination request',
        {
          page_number: pageNumber,
          request_kind: cursor === null ? 'initial' : 'pagination',
          cursor,
          previous_page_info: previousPageInfo ? {
            start_cursor: previousPageInfo.start_cursor ?? null,
            end_cursor: previousPageInfo.end_cursor ?? null,
            has_previous_page: previousPageInfo.has_previous_page ?? null,
            has_next_page: previousPageInfo.has_next_page ?? null
          } : null
        }
      ),
      onProgress
    );
  }

  /**
   * Handles conversation spine from pages.
   *
   * @param {Object} pages - The ordered Conversation API pages.
   * @returns {Object} The Object value produced by `conversationSpineFromPages`.
   */
  function conversationSpineFromPages(pages) {
    // Maps each stable message id to its slot so duplicate page overlap can be replaced in place.
    const messageIndexById = new Map();
    // De-duplicated Conversation API messages in chronological source order.
    const messages = [];
    // Counts page-overlap records whose stable message id was already present.
    let duplicateMessageIds = 0;
    for (const page of [...pages].reverse()) {
      for (const message of page?.messages ?? []) {
        const id = typeof message?.id === 'string' ? message.id : '';
        if (!id) throw new Error('Conversation API message is missing a stable id.');
        const existingIndex = messageIndexById.get(id);
        if (existingIndex !== undefined) {
          duplicateMessageIds += 1;
          messages[existingIndex] = message;
          continue;
        }
        messageIndexById.set(id, messages.length);
        messages.push(message);
      }
    }

    /**
     * Handles records.
     */
    const records = messages.map((message, ordinal) => {
      const metadata = message?.metadata && typeof message.metadata === 'object'
        ? message.metadata
        : {};
      return {
        ordinal,
        message_id: message.id,
        role: typeof message?.author?.role === 'string' ? message.author.role : null,
        channel: typeof message?.channel === 'string' ? message.channel : null,
        content_type: typeof message?.content?.content_type === 'string'
          ? message.content.content_type
          : null,
        turn_exchange_id: typeof metadata.turn_exchange_id === 'string'
          ? metadata.turn_exchange_id
          : null,
        working_turn_id: typeof metadata.working_turn_id === 'string'
          ? metadata.working_turn_id
          : null,
        message
      };
    });

    // User records become chronological UAP anchors for associating following activity.
    const uapAnchors = [];
    for (const record of records) {
      if (record.role !== 'user') continue;
      uapAnchors.push({
        ordinal: uapAnchors.length,
        user_message_id: record.message_id,
        user_record_ordinal: record.ordinal,
        turn_exchange_id: record.turn_exchange_id,
        working_turn_id: record.working_turn_id
      });
    }

    return {
      pages: [...pages],
      messages,
      records,
      uap_anchors: uapAnchors,
      duplicate_message_ids: duplicateMessageIds
    };
  }

  /**
   * Handles API linkage key is identifier like.
   *
   * @param {string} key - The lookup key to process.
   * @returns {boolean} `true` when the api linkage key is identifier like condition is satisfied; otherwise `false`.
   */
  function apiLinkageKeyIsIdentifierLike(key) {
    return /(?:^id$|_id$|_ids$|call|parent|source|reference|tool|exchange|working|request|response)/i
      .test(String(key ?? ''));
  }

  /**
   * Handles API linkage scalar is safe.
   *
   * @param {string} key - The lookup key to process.
   * @param {string} value - The value to process.
   * @returns {boolean} `true` when `apiLinkageScalarIsSafe` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function apiLinkageScalarIsSafe(key, value) {
    if (value === null || value === undefined) return false;
    if (!['string', 'number'].includes(typeof value)) return false;
    if (/(?:authorization|cookie|token|secret|password)/i.test(String(key ?? ''))) return false;
    if (typeof value === 'string' && value.length > 256) return false;
    return true;
  }

  /**
   * Handles API record identifier scalars.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {Array<unknown>} The ordered values produced by `apiRecordIdentifierScalars`.
   */
  function apiRecordIdentifierScalars(record) {
    const raw = record?.message && typeof record.message === 'object' ? record.message : {};
    const result = [];
    const seen = new Set();
    // Content-bearing fields are excluded from identifier linkage scanning to avoid false matches.
    const freeformKeys = new Set([
      'text', 'parts', 'thinking', 'summary', 'message', 'prompt', 'output', 'input', 'content'
    ]);
    /**
     * Handles walk.
     *
     * @param {string} value - The value to process.
     * @param {string} path - The property path being traversed.
     * @param {Object} depth - The current traversal depth.
     * @returns {void} No value is returned.
     */
    const walk = (value, path, depth) => {
      if (depth > 8 || value === null || value === undefined) return;
      if (Array.isArray(value)) {
        for (let i = 0; i < Math.min(value.length, 12); i += 1) {
          walk(value[i], `${path}[${i}]`, depth + 1);
        }
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (child && typeof child === 'object') {
          if (!freeformKeys.has(key)) walk(child, childPath, depth + 1);
          continue;
        }
        if (freeformKeys.has(key)) continue;
        if (apiLinkageKeyIsIdentifierLike(key) && apiLinkageScalarIsSafe(key, child)) {
          result.push({ path: childPath, key, value: child });
        }
      }
    };
    walk(raw, '', 0);
    return result;
  }

  /**
   * Handles API conversation UAP grouping.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @returns {Object} The Object value produced by `apiConversationUapGrouping`.
   */
  function apiConversationUapGrouping(spine) {
    const anchors = spine?.uap_anchors ?? [];
    const records = spine?.records ?? [];
    // Maps each exact turn-exchange id to the UAP anchor ordinals that carry it.
    const exchangeToAnchors = new Map();
    // Maps each exact working-turn id to the UAP anchor ordinals that carry it.
    const workingToAnchors = new Map();
    /**
     * Handles add.
     *
     * @param {Map<unknown, unknown>} map - The map value required by this function.
     * @param {string} key - The lookup key to process.
     * @param {number} ordinal - The ordinal position to process.
     * @returns {void} No value is returned.
     */
    const add = (map, key, ordinal) => {
      if (!key) return;
      const values = map.get(key) ?? [];
      values.push(ordinal);
      map.set(key, values);
    };
    for (const anchor of anchors) {
      add(exchangeToAnchors, anchor.turn_exchange_id, anchor.ordinal);
      add(workingToAnchors, anchor.working_turn_id, anchor.ordinal);
    }

    /**
     * Handles groups.
     */
    const groups = anchors.map(anchor => ({
      ordinal: anchor.ordinal,
      user_message_id: anchor.user_message_id,
      user_record_ordinal: anchor.user_record_ordinal,
      record_ordinals: [],
      exact_record_ordinals: []
    }));
    // Stores one association classification for every source record in spine order.
    const classifications = [];
    // Summarizes association evidence without affecting the grouping decisions themselves.
    const counts = { exact: 0, fallback: 0, ungrouped: 0, conflict: 0 };

    /**
     * Handles chronological anchor.
     *
     * @param {number} recordOrdinal - The zero-based record ordinal.
     * @returns {null} The value produced by `chronologicalAnchor`, or `null` when unavailable.
     */
    const chronologicalAnchor = recordOrdinal => {
      let candidate = null;
      for (const anchor of anchors) {
        if (anchor.user_record_ordinal > recordOrdinal) break;
        candidate = anchor.ordinal;
      }
      return candidate;
    };

    for (const record of records) {
      const exchangeCandidates = record.turn_exchange_id
        ? (exchangeToAnchors.get(record.turn_exchange_id) ?? [])
        : [];
      const workingCandidates = record.working_turn_id
        ? (workingToAnchors.get(record.working_turn_id) ?? [])
        : [];
      const exactCandidates = [...new Set([...exchangeCandidates, ...workingCandidates])];
      const disagreement = exchangeCandidates.length === 1 && workingCandidates.length === 1 &&
        exchangeCandidates[0] !== workingCandidates[0];
      let classification;
      let uapOrdinal = null;
      let basis = null;
      if (disagreement || exactCandidates.length > 1) {
        classification = 'conflict';
      } else if (exactCandidates.length === 1) {
        classification = 'exact';
        uapOrdinal = exactCandidates[0];
        basis = exchangeCandidates.length === 1 && workingCandidates.length === 1
          ? 'turn_exchange_id+working_turn_id'
          : exchangeCandidates.length === 1 ? 'turn_exchange_id' : 'working_turn_id';
        groups[uapOrdinal].exact_record_ordinals.push(record.ordinal);
      } else {
        uapOrdinal = chronologicalAnchor(record.ordinal);
        if (uapOrdinal === null) classification = 'ungrouped';
        else {
          classification = 'fallback';
          basis = 'chronological-window';
        }
      }
      counts[classification] += 1;
      classifications.push({
        record_ordinal: record.ordinal,
        message_id: record.message_id,
        role: record.role,
        classification,
        uap_ordinal: uapOrdinal,
        basis
      });
    }
    return { groups, classifications, counts };
  }

  /**
   * Handles API unresolved UAP linkage analysis.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @param {Object} primary - The primary value required by this function.
   * @returns {Object} The Object value produced by `apiUnresolvedUapLinkageAnalysis`.
   */
  function apiUnresolvedUapLinkageAnalysis(spine, primary) {
    const records = spine?.records ?? [];
    // Reverse lookup from exactly-associated message ids to their proven UAP ordinal.
    const exactMessageToUap = new Map();
    // Reverse lookup from identifier-like source values to UAPs established by exact records.
    const exactIdentifierToUaps = new Map();
    /**
     * Handles key for.
     *
     * @param {string} value - The value to process.
     * @returns {void} No value is returned.
     */
    const keyFor = value => `${typeof value}:${String(value)}`;
    /**
     * Handles add ref.
     *
     * @param {Map<unknown, unknown>} map - The map value required by this function.
     * @param {string} value - The value to process.
     * @param {number} uapOrdinal - The zero-based uap ordinal.
     * @returns {void} No value is returned.
     */
    const addRef = (map, value, uapOrdinal) => {
      const key = keyFor(value);
      const values = map.get(key) ?? new Set();
      values.add(uapOrdinal);
      map.set(key, values);
    };

    for (const item of primary.classifications) {
      if (item.classification !== 'exact') continue;
      const record = records[item.record_ordinal];
      exactMessageToUap.set(record.message_id, item.uap_ordinal);
      for (const scalar of apiRecordIdentifierScalars(record)) {
        addRef(exactIdentifierToUaps, scalar.value, item.uap_ordinal);
      }
    }

    /**
     * Handles exact before after.
     *
     * @param {number} ordinal - The ordinal position to process.
     * @returns {Object} The Object value produced by `exactBeforeAfter`.
     */
    const exactBeforeAfter = ordinal => {
      let before = null;
      let after = null;
      for (let i = ordinal - 1; i >= 0; i -= 1) {
        const item = primary.classifications[i];
        if (item?.classification === 'exact') {
          before = item;
          break;
        }
      }
      for (let i = ordinal + 1; i < primary.classifications.length; i += 1) {
        const item = primary.classifications[i];
        if (item?.classification === 'exact') {
          after = item;
          break;
        }
      }
      return { before, after };
    };

    const unresolved = [];
    for (const item of primary.classifications) {
      if (!['fallback', 'ungrouped'].includes(item.classification)) continue;
      const record = records[item.record_ordinal];
      const refs = new Set();
      for (const scalar of apiRecordIdentifierScalars(record)) {
        const exactUap = exactMessageToUap.get(String(scalar.value));
        if (exactUap !== undefined) refs.add(exactUap);
      }
      for (const uap of exactIdentifierToUaps.get(keyFor(record.message_id)) ?? []) refs.add(uap);
      const { before, after } = exactBeforeAfter(item.record_ordinal);
      const sameUapBounded = before && after && before.uap_ordinal === after.uap_ordinal;
      unresolved.push({
        record_ordinal: item.record_ordinal,
        referenced_uap_ordinals: [...refs].sort((a, b) => a - b),
        same_uap_bounded: Boolean(sameUapBounded),
        bounded_uap_ordinal: sameUapBounded ? before.uap_ordinal : null
      });
    }
    return { unresolved };
  }

  /**
   * Handles API conversation UAP final grouping.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @returns {Object} The Object value produced by `apiConversationUapFinalGrouping`.
   */
  function apiConversationUapFinalGrouping(spine) {
    const primary = apiConversationUapGrouping(spine);
    const linkage = apiUnresolvedUapLinkageAnalysis(spine, primary);
    // Indexes unresolved-linkage analysis by source ordinal for the refinement pass.
    const linkageByOrdinal = new Map(
      linkage.unresolved.map(item => [item.record_ordinal, item])
    );
    const records = spine?.records ?? [];
    /**
     * Handles groups.
     */
    const groups = (spine?.uap_anchors ?? []).map(anchor => ({
      ordinal: anchor.ordinal,
      user_message_id: anchor.user_message_id,
      record_ordinals: []
    }));
    // Stores one association classification for every source record in spine order.
    const classifications = [];
    const counts = { exact: 0, linked: 0, bounded: 0, global: 0, conflict: 0, unresolved: 0 };

    for (const item of primary.classifications) {
      const record = records[item.record_ordinal];
      let classification = item.classification;
      let uapOrdinal = item.uap_ordinal;
      let basis = item.basis;
      if (classification === 'fallback' || classification === 'ungrouped') {
        const evidence = linkageByOrdinal.get(item.record_ordinal);
        const refs = evidence?.referenced_uap_ordinals ?? [];
        const boundedOrdinal = evidence?.same_uap_bounded
          ? evidence.bounded_uap_ordinal
          : null;
        if (refs.length > 1 ||
            (refs.length === 1 && boundedOrdinal !== null && refs[0] !== boundedOrdinal)) {
          classification = 'conflict';
          uapOrdinal = null;
          basis = 'unresolved-evidence-conflict';
        } else if (refs.length === 1) {
          classification = 'linked';
          uapOrdinal = refs[0];
          basis = 'identifier-linkage';
        } else if (boundedOrdinal !== null && record?.role !== 'system') {
          classification = 'bounded';
          uapOrdinal = boundedOrdinal;
          basis = 'exact-neighbour-containment';
        } else if (record?.role === 'system' &&
                   record?.message?.metadata?.is_visually_hidden_from_conversation === true) {
          classification = 'global';
          uapOrdinal = null;
          basis = 'hidden-system-outside-exchange';
        } else {
          classification = 'unresolved';
          uapOrdinal = null;
          basis = 'insufficient-evidence';
        }
      }
      if (classification === 'conflict') uapOrdinal = null;
      counts[classification] = (counts[classification] ?? 0) + 1;
      if (uapOrdinal !== null && groups[uapOrdinal]) {
        groups[uapOrdinal].record_ordinals.push(item.record_ordinal);
      }
      classifications.push({ ...item, classification, uap_ordinal: uapOrdinal, basis });
    }

    return {
      groups,
      classifications,
      exact_record_count: counts.exact,
      linked_record_count: counts.linked,
      bounded_record_count: counts.bounded,
      global_record_count: counts.global,
      conflicting_record_count: counts.conflict,
      unresolved_record_count: counts.unresolved
    };
  }

  /**
   * Handles fallback is hidden.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {boolean} `true` when `cgIsHidden` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function cgIsHidden(record) {
    return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
  }

  /**
   * Handles fallback text parts.
   *
   * @param {Array<unknown>} parts - The ordered parts values to process.
   * @returns {Array<unknown>} The ordered values produced by `cgTextParts`.
   */
  function cgTextParts(parts) {
    const texts = [];
    if (!Array.isArray(parts)) return texts;
    for (const part of parts) {
      if (typeof part === 'string') {
        if (part.trim()) texts.push(part);
      } else if (part && typeof part === 'object') {
        for (const key of ['text', 'content']) {
          const value = part[key];
          if (typeof value === 'string' && value.trim()) texts.push(value);
        }
      }
    }
    return texts;
  }

  /**
   * Handles fallback citation root.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgCitationRoot`.
   */
  function cgCitationRoot(url) {
    try {
      const parsed = new URL(url);
      return parsed.host ? `${parsed.protocol}//${parsed.host}` : '';
    } catch {
      return '';
    }
  }

  /**
   * Handles fallback citation hostname.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgCitationHostname`.
   */
  function cgCitationHostname(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /**
   * Handles fallback normalize citation URL.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgNormalizeCitationUrl`.
   */
  function cgNormalizeCitationUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';
    const raw = url.trim();
    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      parsed.protocol = parsed.protocol.toLowerCase();
      parsed.hostname = parsed.hostname.toLowerCase();
      parsed.searchParams.delete('utm_source');
      return parsed.toString();
    } catch {
      return raw;
    }
  }

  /**
   * Handles fallback search result URL index.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {Map<unknown, unknown>} The lookup map produced by `cgSearchResultUrlIndex`.
   */
  function cgSearchResultUrlIndex(record) {
    const metadata = record?.metadata;
    const groups = metadata && typeof metadata === 'object' ? metadata.search_result_groups : null;
    if (!Array.isArray(groups)) return new Map();
    const result = new Map();
    for (const group of groups) {
      if (!group || typeof group !== 'object' || !Array.isArray(group.entries)) continue;
      for (const entry of group.entries) {
        if (!entry || typeof entry !== 'object') continue;
        const key = cgNormalizeCitationUrl(entry.url);
        if (!key) continue;
        const merged = result.get(key) ?? { title: '', snippet: '', attribution: '' };
        for (const field of ['title', 'snippet', 'attribution']) {
          const value = entry[field];
          if (!merged[field] && typeof value === 'string' && value.trim()) {
            merged[field] = value.trim();
          }
        }
        result.set(key, merged);
      }
    }
    return result;
  }

  /**
   * Handles fallback shorten inline text.
   *
   * @param {string} text - The text to process.
   * @param {number} maxChars - The maximum number of characters to retain.
   * @returns {string} The string produced by `cgShortenInlineText`.
   */
  function cgShortenInlineText(text, maxChars = 200) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxChars) return clean;
    let clipped = clean.slice(0, maxChars - 1).trimEnd();
    if (clipped.includes(' ')) clipped = clipped.slice(0, clipped.lastIndexOf(' '));
    return `${clipped.replace(/[ ,;:-]+$/g, '')}…`;
  }

  /**
   * Handles fallback wrap tooltip block.
   *
   * @param {string} text - The text to process.
   * @param {number} width - The maximum wrapped line width in characters.
   * @param {number} maxChars - The maximum number of characters to retain.
   * @returns {string} The string produced by `cgWrapTooltipBlock`.
   */
  function cgWrapTooltipBlock(text, width = 78, maxChars = 520) {
    const shortened = cgShortenInlineText(text, maxChars);
    if (!shortened) return '';
    const words = shortened.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }

  /**
   * Handles fallback clean citation blurb.
   *
   * @param {string} text - The text to process.
   * @returns {Array<unknown>} The ordered values produced by `cgCleanCitationBlurb`.
   */
  function cgCleanCitationBlurb(text) {
    if (typeof text !== 'string' || !text.trim()) return [];
    const clean = text.replace(/\s+/g, ' ').trim()
      .replace(/\s*Read more\.?$/i, '')
      .replace(/^Abstract\b[:.]?\s*/i, '')
      .replace(/\.\s*\./g, '.')
      .replace(/\s+\./g, '.');
    let meta = '';
    let body = clean;
    const dash = clean.indexOf('—');
    if (dash >= 0) {
      const head = clean.slice(0, dash).trim().replace(/^[- ]+|[- ]+$/g, '');
      const tail = clean.slice(dash + 1).trim();
      if (tail && (
        head.toLowerCase().startsWith('by ') ||
        head.toLowerCase().includes('cited by') ||
        /^[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}$/.test(head)
      )) {
        meta = head;
        body = tail;
      }
    }
    body = body.replace(/\s*[•·]\s*/g, ' • ');
    const blocks = [];
    if (meta) blocks.push(cgWrapTooltipBlock(meta, 78, 180));
    const wrappedBody = cgWrapTooltipBlock(body, 78, 520);
    if (wrappedBody) blocks.push(wrappedBody);
    return blocks;
  }

  /**
   * Handles fallback citation tooltip.
   *
   * @param {Node} node - The node to process.
   * @param {Object} urlInfo - The urlInfo value required by this function.
   * @param {string} fallback - The fallback value required by this function.
   * @returns {string} The string produced by `cgCitationTooltip`.
   */
  function cgCitationTooltip(node, urlInfo = {}, fallback = '') {
    let title = typeof node?.title === 'string' ? node.title.trim() : '';
    if (!title) title = typeof urlInfo?.title === 'string' ? urlInfo.title.trim() : '';
    let snippet = typeof node?.snippet === 'string' ? node.snippet.trim() : '';
    if (!snippet) snippet = typeof urlInfo?.snippet === 'string' ? urlInfo.snippet.trim() : '';
    const parts = [];
    if (title) {
      const wrapped = cgWrapTooltipBlock(title, 78, 220);
      if (wrapped) parts.push(wrapped);
    }
    if (snippet) {
      for (const block of cgCleanCitationBlurb(snippet)) {
        if (block && !parts.includes(block)) parts.push(block);
      }
    }
    if (parts.length) return parts.join('\n\n');
    return cgWrapTooltipBlock(fallback, 78, 220);
  }

  /**
   * Handles fallback citation favicon.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgCitationFavicon`.
   */
  function cgCitationFavicon(url) {
    const root = cgCitationRoot(url);
    return root ? `https://www.google.com/s2/favicons?domain=${root}&sz=32` : '';
  }

  /**
   * Handles fallback collect web citation sources.
   *
   * @param {Object} reference - The provider reference object to process.
   * @param {Map<unknown, unknown>} urlIndex - The zero-based url index.
   * @returns {Array<unknown>} The ordered values produced by `cgCollectWebCitationSources`.
   */
  function cgCollectWebCitationSources(reference, urlIndex = new Map()) {
    const sources = [];
    const seen = new Set();
    /**
     * Handles append.
     *
     * @param {string} url - The URL to process.
     * @param {string} label - The label value required by this function.
     * @param {Object} tooltip - The tooltip value required by this function.
     * @returns {void} No value is returned.
     */
    const append = (url, label, tooltip) => {
      if (typeof url !== 'string' || !url.trim() || seen.has(url.trim())) return;
      const clean = url.trim();
      seen.add(clean);
      const shown = typeof label === 'string' && label.trim()
        ? label.trim()
        : (cgCitationHostname(clean) || 'source');
      sources.push({
        url: clean,
        label: shown,
        tooltip: typeof tooltip === 'string' ? tooltip.trim() : ''
      });
    };
    /**
     * Handles visit.
     *
     * @param {Node} node - The node to process.
     * @param {string} inheritedTooltip - The inheritedTooltip value required by this function.
     * @returns {void} No value is returned.
     */
    const visit = (node, inheritedTooltip = '') => {
      if (!node || typeof node !== 'object') return;
      const url = node.url;
      if (typeof url === 'string' && url.trim()) {
        const urlInfo = urlIndex.get(cgNormalizeCitationUrl(url)) ?? {};
        let label = typeof node.attribution === 'string' ? node.attribution.trim() : '';
        if (!label && typeof urlInfo.attribution === 'string') label = urlInfo.attribution.trim();
        if (!label) label = cgCitationHostname(url);
        const tooltip = cgCitationTooltip(node, urlInfo, inheritedTooltip || label);
        append(url, label, tooltip);
        inheritedTooltip = tooltip;
      }
      for (const key of ['items', 'supporting_websites', 'webpages', 'sources']) {
        if (Array.isArray(node[key])) {
          for (const item of node[key]) visit(item, inheritedTooltip);
        }
      }
    };
    visit(reference);
    if (!sources.length && Array.isArray(reference?.safe_urls)) {
      for (const url of reference.safe_urls) append(url, cgCitationHostname(url), '');
    }
    return sources;
  }

  /**
   * Handles fallback render web citation.
   *
   * @param {Object} reference - The provider reference object to process.
   * @param {Map<unknown, unknown>} urlIndex - The zero-based url index.
   * @returns {string} The string produced by `cgRenderWebCitation`.
   */
  function cgRenderWebCitation(reference, urlIndex = new Map()) {
    const links = [];
    for (const source of cgCollectWebCitationSources(reference, urlIndex)) {
      const titleAttribute = source.tooltip
        ? ` title="${escapeHtmlAttribute(source.tooltip).replace(/\n/g, '&#10;')}"`
        : '';
      const favicon = cgCitationFavicon(source.url);
      const icon = favicon
        ? `<img alt="" src="${escapeHtmlAttribute(favicon)}" width="15" height="15"${titleAttribute} style="width:0.97em;height:0.97em;vertical-align:-0.13em;margin-right:0.22em;border-radius:2px;">`
        : '';
      links.push(
        `<a href="${escapeHtmlAttribute(source.url)}"${titleAttribute} style="display:inline-block;white-space:nowrap;">${icon}${escapeHtmlText(source.label)}</a>`
      );
    }
    return links.length ? `**(cite: ${links.join(', ')})**` : '';
  }

  /** Private-use marker that begins a fallback inline-reference token. */
  const CG_INLINE_TOKEN_START = '\ue200';
  /** Private-use marker that terminates a fallback inline-reference token. */
  const CG_INLINE_TOKEN_END = '\ue201';
  /** Private-use separator between fields inside a fallback inline-reference token. */
  const CG_INLINE_TOKEN_SEP = '\ue202';
  /** Matcher for complete fallback inline-reference tokens embedded in source text. */
  const CG_INLINE_TOKEN_RX = /\ue200[^\ue201]*\ue201/g;

  /**
   * Handles fallback inline token segments.
   *
   * @param {Object} token - The inline token to parse or render.
   * @returns {Array<unknown>} The ordered values produced by `cgInlineTokenSegments`.
   */
  function cgInlineTokenSegments(token) {
    if (typeof token !== 'string' ||
        !token.startsWith(CG_INLINE_TOKEN_START) ||
        !token.endsWith(CG_INLINE_TOKEN_END)) return [];
    return token.slice(1, -1).split(CG_INLINE_TOKEN_SEP);
  }

  /**
   * Handles fallback strip inline tokens.
   *
   * @param {string} text - The text to process.
   * @returns {string} The string produced by `cgStripInlineTokens`.
   */
  function cgStripInlineTokens(text) {
    return typeof text === 'string' ? text.replace(CG_INLINE_TOKEN_RX, '') : '';
  }

  /**
   * Handles fallback file token spec.
   *
   * @param {Object} token - The inline token to parse or render.
   * @returns {Object} The Object value produced by `cgFileTokenSpec`.
   */
  function cgFileTokenSpec(token) {
    const segments = cgInlineTokenSegments(token);
    if (segments.length < 2 || segments[0] !== 'filecite') return { key: null, lineRef: '' };
    const match = /^turn(\d+)file(\d+)$/.exec(segments[1]);
    if (!match) return { key: null, lineRef: '' };
    return {
      key: `${Number(match[1])}:${Number(match[2])}`,
      lineRef: segments.length > 2 ? segments[2].trim() : ''
    };
  }

  /**
   * Handles fallback register file reference.
   *
   * @param {number} index - The zero-based index to process.
   * @param {Object} record - The provider/source record to process.
   * @returns {void} No value is returned.
   */
  function cgRegisterFileReference(index, record) {
    if (!(index instanceof Map) || !record?.metadata || typeof record.metadata !== 'object') return;
    const metadata = record.metadata;
    const citation = metadata.citation_metadata;
    if (!citation || typeof citation !== 'object') return;
    const turnNumber = Number(metadata.retrieval_turn_number);
    const fileIndex = Number(metadata.retrieval_file_index);
    if (!Number.isInteger(turnNumber) || !Number.isInteger(fileIndex)) return;
    const title = typeof citation.title === 'string' ? citation.title.trim() : '';
    const url = typeof citation.url === 'string' ? citation.url.trim() : '';
    if (!title && !url) return;
    index.set(`${turnNumber}:${fileIndex}`, citation);
  }

  /**
   * Handles fallback build file reference index.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @returns {Map<unknown, unknown>} The lookup map produced by `cgBuildFileReferenceIndex`.
   */
  function cgBuildFileReferenceIndex(records) {
    const index = new Map();
    for (const record of records ?? []) cgRegisterFileReference(index, record);
    return index;
  }

  /**
   * Handles fallback collect memory citation sources.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {Array<unknown>} The ordered values produced by `cgCollectMemoryCitationSources`.
   */
  function cgCollectMemoryCitationSources(record) {
    const entries = Array.isArray(record?.metadata?.conversation_context_citation_metadata)
      ? record.metadata.conversation_context_citation_metadata
      : [];
    const sources = [];
    const seen = new Set();
    for (const entry of entries) {
      const citation = entry?.citation;
      if (!citation || typeof citation !== 'object') continue;
      const url = typeof citation.url === 'string' ? citation.url.trim() : '';
      let label = typeof citation.title === 'string' ? citation.title.trim() : '';
      if (!label && typeof citation.attribution === 'string') label = citation.attribution.trim();
      if (!label) label = cgCitationHostname(url) || 'memory';
      if (!url && !label) continue;
      const dedupe = `${url}\u0000${label}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      sources.push({ url, label, tooltip: cgCitationTooltip(citation, {}, label) });
    }
    return sources;
  }

  /**
   * Handles fallback render source citation.
   *
   * @param {Object} kind - The export kind to execute.
   * @param {Object} sources - The sources value required by this function.
   * @returns {string} The string produced by `cgRenderSourceCitation`.
   */
  function cgRenderSourceCitation(kind, sources) {
    const links = [];
    for (const source of sources ?? []) {
      const titleAttribute = source.tooltip
        ? ` title="${escapeHtmlAttribute(source.tooltip).replace(/\n/g, '&#10;')}"`
        : '';
      const favicon = source.url ? cgCitationFavicon(source.url) : '';
      const icon = favicon
        ? `<img alt="" src="${escapeHtmlAttribute(favicon)}" width="15" height="15"${titleAttribute} style="width:0.97em;height:0.97em;vertical-align:-0.13em;margin-right:0.22em;border-radius:2px;">`
        : '';
      if (source.url) {
        links.push(`<a href="${escapeHtmlAttribute(source.url)}"${titleAttribute} style="display:inline-block;white-space:nowrap;">${icon}${escapeHtmlText(source.label)}</a>`);
      } else {
        links.push(`<span${titleAttribute} style="display:inline-block;white-space:nowrap;">${icon}${escapeHtmlText(source.label)}</span>`);
      }
    }
    return links.length ? `**(${kind}: ${links.join(', ')})**` : '';
  }

  /**
   * Handles fallback render memory citation.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {string} The string produced by `cgRenderMemoryCitation`.
   */
  function cgRenderMemoryCitation(record) {
    const sources = cgCollectMemoryCitationSources(record);
    return sources.length ? cgRenderSourceCitation('memory', sources) : '**(memory context)**';
  }

  /**
   * Handles fallback display file URL.
   *
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgDisplayFileUrl`.
   */
  function cgDisplayFileUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';
    const cleaned = url.trim();
    try {
      const parsed = new URL(cleaned);
      if (parsed.hostname.toLowerCase() !== 'api.github.com') return cleaned;
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 4 || segments[0] !== 'repos' || segments[3] !== 'contents') return cleaned;
      const owner = segments[1];
      const repo = segments[2];
      const relative = segments.slice(4).map(decodeURIComponent);
      const ref = parsed.searchParams.get('ref') || 'main';
      if (!relative.length) return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(ref)}`;
      const target = relative[relative.length - 1].includes('.') ? 'blob' : 'tree';
      /**
       * Handles rel.
       */
      const rel = relative.map(segment => encodeURIComponent(segment)).join('/');
      return `https://github.com/${owner}/${repo}/${target}/${encodeURIComponent(ref)}/${rel}`;
    } catch {
      return cleaned;
    }
  }

  /**
   * Handles fallback display file label.
   *
   * @param {string} name - The name to process.
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgDisplayFileLabel`.
   */
  function cgDisplayFileLabel(name, url) {
    let shown = typeof name === 'string' ? name.trim().replace(/`/g, '') : '';
    const displayUrl = cgDisplayFileUrl(url);
    let parsed = null;
    try { parsed = displayUrl ? new URL(displayUrl) : null; } catch {}
    const segments = parsed ? parsed.pathname.split('/').filter(Boolean) : [];
    const generic = new Set(['', 'file', 'content', 'contents']);
    if (generic.has(shown.toLowerCase())) {
      if (parsed?.hostname.toLowerCase() === 'github.com') {
        if (segments.length >= 4 && segments[2] === 'tree' && segments.length === 4) {
          shown = `${segments[1]} contents`;
        } else if (segments.length >= 5 && ['blob', 'tree'].includes(segments[2])) {
          shown = decodeURIComponent(segments[segments.length - 1] || '');
        } else if (segments.length) shown = decodeURIComponent(segments[segments.length - 1]);
      } else if (segments.length) shown = decodeURIComponent(segments[segments.length - 1]);
    }
    return shown || 'file';
  }

  /**
   * Handles fallback render named file reference.
   *
   * @param {string} name - The name to process.
   * @param {string} matchedText - The matchedText value required by this function.
   * @param {string} url - The URL to process.
   * @returns {string} The string produced by `cgRenderNamedFileReference`.
   */
  function cgRenderNamedFileReference(name, matchedText = '', url = '') {
    const shown = cgDisplayFileLabel(name, url);
    const { lineRef } = cgFileTokenSpec(matchedText);
    const label = `${shown}${lineRef ? ` ${lineRef}` : ''}`;
    const displayUrl = cgDisplayFileUrl(url);
    if (displayUrl) return `<a href="${escapeHtmlAttribute(displayUrl)}">${escapeHtmlText(label)}</a>`;
    return lineRef ? `\`${shown}\` ${lineRef}` : `\`${shown}\``;
  }

  /**
   * Handles fallback hidden file reference.
   *
   * @param {Object} reference - The provider reference object to process.
   * @param {Object} record - The provider/source record to process.
   * @param {number} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgHiddenFileReference`.
   */
  function cgHiddenFileReference(reference, record, fileRefIndex) {
    const token = reference?.matched_text ?? '';
    const { key } = cgFileTokenSpec(token);
    if (!key) return '';
    let citation = null;
    const metadata = record?.metadata;
    if (metadata && typeof metadata === 'object') {
      const currentTurn = Number(metadata.retrieval_turn_number);
      const currentFile = Number(metadata.retrieval_file_index);
      if (Number.isInteger(currentTurn) && Number.isInteger(currentFile) &&
          `${currentTurn}:${currentFile}` === key && metadata.citation_metadata &&
          typeof metadata.citation_metadata === 'object') citation = metadata.citation_metadata;
    }
    if (!citation && fileRefIndex instanceof Map) citation = fileRefIndex.get(key) ?? null;
    return cgRenderNamedFileReference(citation?.title ?? '', token, citation?.url ?? '');
  }

  /**
   * Renders one provider-native inline content reference on the legacy/fallback Markdown path.
   *
   * Source -> output transformation: grouped web, alt-text, file, memory, and retrieved-file references are converted to their established visible Markdown/HTML representation; unsupported reference kinds render no replacement.
   *
   * @param {Object} reference - The provider reference object to process.
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} urlIndex - The zero-based url index.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderInlineReference`.
   */
  function cgRenderInlineReference(reference, record, urlIndex = new Map(), fileRefIndex = new Map()) {
    if (reference?.type === 'grouped_webpages') return cgRenderWebCitation(reference, urlIndex);
    if (reference?.type === 'alt_text') {
      for (const key of ['alt', 'prompt_text']) {
        const value = reference[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    }
    if (reference?.type === 'file') {
      return cgRenderNamedFileReference(reference.name ?? '', reference.matched_text ?? '', reference.url ?? '');
    }
    if (reference?.type === 'hidden') {
      const segments = cgInlineTokenSegments(reference.matched_text ?? '');
      if (!segments.length) return '';
      if (segments[0] === 'memcite') return cgRenderMemoryCitation(record);
      if (segments[0] === 'filecite') return cgHiddenFileReference(reference, record, fileRefIndex);
    }
    return '';
  }

  /**
   * Handles fallback render unstructured inline token.
   *
   * @param {Object} token - The inline token to parse or render.
   * @param {Object} record - The provider/source record to process.
   * @param {number} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderUnstructuredInlineToken`.
   */
  function cgRenderUnstructuredInlineToken(token, record, fileRefIndex) {
    const segments = cgInlineTokenSegments(token);
    if (!segments.length) return '';
    if (segments[0] === 'memcite') return cgRenderMemoryCitation(record);
    if (segments[0] === 'filecite') return cgHiddenFileReference({ type: 'hidden', matched_text: token }, record, fileRefIndex);
    return '';
  }

  /**
   * Handles fallback generated sandbox download URL.
   *
   * @param {Object} source - The source value to inspect.
   * @param {Object} record - The provider/source record to process.
   * @returns {string|null} The string produced by `cgGeneratedSandboxDownloadUrl`, or `null` when no value is available.
   */
  function cgGeneratedSandboxDownloadUrl(source, record) {
    if (record?.author?.role !== 'assistant') return null;
    const value = String(source ?? '').trim();
    const match = value.match(/^sandbox:(\/\/)?(\/mnt\/data\/.*)$/i);
    if (!match) return null;
    const conversationId = currentConversationId();
    const messageId = record?.id;
    if (!conversationId || !messageId) return null;
    const sandboxPath = match[2];
    return `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationId)}` +
      `/interpreter/download?message_id=${encodeURIComponent(messageId)}` +
      `&sandbox_path=${encodeURIComponent(sandboxPath)}&download_intent=true`;
  }

  /**
   * Handles fallback rewrite generated sandbox links.
   *
   * @param {string} text - The text to process.
   * @param {Object} record - The provider/source record to process.
   * @returns {string} The string produced by `cgRewriteGeneratedSandboxLinks`.
   */
  function cgRewriteGeneratedSandboxLinks(text, record) {
    if (!text || record?.author?.role !== 'assistant') return text;
    const value = String(text);
    // Accumulates rewritten Markdown while cursor tracks the next unread source character.
    let rendered = '';
    // Offset of the next source character not yet copied into the rewritten Markdown.
    let cursor = 0;
    while (cursor < value.length) {
      const destinationPrefix = value.indexOf('](', cursor);
      if (destinationPrefix < 0) break;
      const sourceStart = destinationPrefix + 2;
      const remainder = value.slice(sourceStart);
      const sandboxPrefix = remainder.match(/^sandbox:(?:\/\/)?\/mnt\/data\//i)?.[0];
      if (!sandboxPrefix) {
        rendered += value.slice(cursor, sourceStart);
        cursor = sourceStart;
        continue;
      }

      // Tracks parentheses nested inside the Markdown link destination being scanned.
      let nestedParentheses = 0;
      // Index of the closing parenthesis for the current sandbox link destination.
      let sourceEnd = -1;
      for (let index = sourceStart; index < value.length; index += 1) {
        const character = value[index];
        if (character === '\\') {
          index += 1;
          continue;
        }
        if (character === '(') {
          nestedParentheses += 1;
          continue;
        }
        if (character !== ')') continue;
        if (nestedParentheses > 0) {
          nestedParentheses -= 1;
          continue;
        }
        sourceEnd = index;
        break;
      }
      if (sourceEnd < 0) break;

      const source = value.slice(sourceStart, sourceEnd);
      const url = cgGeneratedSandboxDownloadUrl(source, record);
      if (!url) {
        rendered += value.slice(cursor, sourceEnd + 1);
        cursor = sourceEnd + 1;
        continue;
      }
      rendered += `${value.slice(cursor, sourceStart)}${url})`;
      cursor = sourceEnd + 1;
    }
    return rendered + value.slice(cursor);
  }

  /**
   * Handles fallback render inline references.
   *
   * @param {string} text - The text to process.
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderInlineReferences`.
   */
  function cgRenderInlineReferences(text, record, fileRefIndex = new Map()) {
    if (!text) return text;
    const references = Array.isArray(record?.metadata?.content_references)
      ? record.metadata.content_references
      : [];
    const urlIndex = cgSearchResultUrlIndex(record);
    let rendered = text;
    for (const reference of references) {
      const matched = reference?.matched_text;
      if (typeof matched !== 'string' || !matched || !rendered.includes(matched)) continue;
      const replacement = cgRenderInlineReference(reference, record, urlIndex, fileRefIndex);
      if (replacement) rendered = rendered.split(matched).join(replacement);
    }
    for (const token of rendered.match(CG_INLINE_TOKEN_RX) ?? []) {
      const fallback = cgRenderUnstructuredInlineToken(token, record, fileRefIndex);
      if (fallback) rendered = rendered.split(token).join(fallback);
    }
    return rendered;
  }

  /**
   * Handles fallback image pointer source.
   *
   * @param {Object} part - The provider content part to process.
   * @returns {string} The string produced by `cgImagePointerSource`.
   */
  function cgImagePointerSource(part) {
    if (!part || typeof part !== 'object') return '';
    const metadata = part.metadata && typeof part.metadata === 'object' ? part.metadata : {};
    for (const value of [metadata.asset_pointer_link, part.asset_pointer_link, part.asset_pointer]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  /**
   * Handles fallback image unavailable Markdown.
   *
   * @param {Object} source - The source value to inspect.
   * @returns {string} The string produced by `cgImageUnavailableMarkdown`.
   */
  function cgImageUnavailableMarkdown(source) {
    const clean = typeof source === 'string' ? source.trim() : '';
    return clean ? `[image not available](${clean})` : '[image not available]';
  }

  /**
   * Handles fallback image failure Markdown.
   *
   * @param {Object} source - The source value to inspect.
   * @param {Object|null} httpStatus - The httpStatus value required by this function.
   * @returns {string} The string produced by `cgImageFailureMarkdown`.
   */
  function cgImageFailureMarkdown(source, httpStatus = null) {
    if (httpStatus === 404 || httpStatus === 410) return '[image missing]';
    return cgImageUnavailableMarkdown(source);
  }

  /**
   * Returns canonical conversation-image resources for one source record keyed by provider part index.
   *
   * Provider/source -> canonical transformation is delegated to the pinned AIConversationCore adapter; DownloadConversation does not reconstruct provider pointer mappings itself.
   *
   * @param {Object} record - The provider/source record containing image parts.
   * @returns {Map<number, Object>} Canonical conversation-image resources keyed by original source part index.
   */
  function canonicalImageResourcesByRecordAndPart(records) {
    assert(Array.isArray(records), 'Canonical image-resource lookup requires the ordered source record set.');
    const events = canonicalCore().adaptChatGPTRecords(records);
    const byRecord = new Map();
    for (const event of events) {
      const recordId = event?.source_record_id;
      if (typeof recordId !== 'string' || !recordId) continue;
      const resources = Array.isArray(event?.resources) ? event.resources : [];
      let byPart = byRecord.get(recordId);
      for (const resource of resources) {
        if (resource?.type !== 'image' || resource?.resource_kind !== 'conversation_image') continue;
        const partIndex = resource?.source?.part_index;
        if (!Number.isInteger(partIndex)) continue;
        if (!byPart) {
          byPart = new Map();
          byRecord.set(recordId, byPart);
        }
        assert(!byPart.has(partIndex), `Duplicate canonical image resource for ${recordId}:${partIndex}.`);
        byPart.set(partIndex, resource);
      }
    }
    return byRecord;
  }

  /**
   * Fetches image bytes through a canonical Core-supplied authenticated transport URL.
   *
   * The first request resolves provider identity to transient access data. The returned signed URL is used only for the immediate image fetch and is never persisted in diagnostics or canonical state.
   *
   * @param {string} resolverUrl - Deterministic authenticated transport URL supplied by AIConversationCore.
   * @param {Object|null} timing - Mutable timing/result object populated without retaining signed URLs or image payload data.
   * @returns {Promise<string>} A promise resolving to the fetched image as a data URL.
   */
  async function fetchCanonicalResolvedImageDataUrl(resolverUrl, timing = null) {
    const startedAt = performance.now();
    try {
      if (timing) {
        timing.stage = 'resolver';
        timing.source_scheme = 'core-resolver';
        timing.resolver_status = null;
        timing.resolver_ms = null;
      }
      const resolverResponse = await apiFetch(resolverUrl);
      const resolverAt = performance.now();
      if (timing) {
        timing.resolver_status = resolverResponse.status;
        timing.resolver_ms = Math.round(resolverAt - startedAt);
      }
      if (!resolverResponse.ok) {
        const error = new Error(`Conversational image resolver returned HTTP ${resolverResponse.status}.`);
        error.httpStatus = resolverResponse.status;
        if (timing) timing.outcome = 'resolver-http-error';
        throw error;
      }
      const resolverPayload = await resolverResponse.json();
      const resolvedSource = typeof resolverPayload?.download_url === 'string'
        ? resolverPayload.download_url.trim()
        : '';
      if (!resolvedSource) {
        if (timing) timing.outcome = 'resolver-response-error';
        throw new Error('Conversational image resolver response did not contain download_url.');
      }
      const dataUrl = await fetchImageDataUrl(resolvedSource, timing);
      if (timing) {
        timing.resolver_status = resolverResponse.status;
        timing.resolver_ms = Math.round(resolverAt - startedAt);
        timing.total_ms = Math.round(performance.now() - startedAt);
      }
      return dataUrl;
    } catch (error) {
      if (timing) {
        timing.total_ms = Math.round(performance.now() - startedAt);
        if (!timing.outcome) timing.outcome = `${timing.stage || 'resolver'}-error`;
      }
      throw error;
    }
  }

  /**
   * Resolves one provider image pointer into Markdown while optionally recording timing metrics.
   *
   * AIConversationCore owns provider-pointer interpretation. DownloadConversation consumes canonical `data_url` or `download_url` fields and performs only the credential-bound browser retrieval step.
   *
   * @param {Object} part - The provider content part to process.
   * @param {Object|null} resource - Canonical conversation-image resource for this source part.
   * @param {string} recordId - The provider/source record identifier.
   * @param {number} imageOrdinal - The one-based image ordinal within the source record.
   * @param {Object|null} timing - Mutable timing/result object populated without retaining image payload data.
   * @returns {Promise<string>} A promise that resolves to image Markdown or the established unavailable-image fallback.
   */
  async function cgResolveImagePointerMarkdown(part, resource, recordId, imageOrdinal, timing = null) {
    const startedAt = performance.now();
    const source = typeof resource?.source_pointer === 'string' && resource.source_pointer.trim()
      ? resource.source_pointer.trim()
      : cgImagePointerSource(part);
    if (!source) {
      if (timing) {
        timing.stage = 'complete';
        timing.outcome = 'missing-pointer';
        timing.source_scheme = null;
        timing.total_ms = Math.round(performance.now() - startedAt);
      }
      return '[image missing]';
    }
    try {
      let dataUrl = '';
      if (typeof resource?.data_url === 'string' && resource.data_url.startsWith('data:image/')) {
        dataUrl = resource.data_url;
        if (timing) {
          timing.stage = 'complete';
          timing.outcome = 'data-url';
          timing.source_scheme = 'canonical-data-url';
          timing.fetch_ms = 0;
          timing.body_ms = 0;
          timing.encode_ms = 0;
          timing.data_url_chars = dataUrl.length;
          timing.total_ms = Math.round(performance.now() - startedAt);
        }
      } else if (typeof resource?.download_url === 'string' && resource.download_url.trim()) {
        dataUrl = await fetchCanonicalResolvedImageDataUrl(resource.download_url.trim(), timing);
      } else {
        let parsed = null;
        try { parsed = new URL(source, location.href); } catch {}
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
          if (timing) {
            timing.stage = 'complete';
            timing.outcome = 'unresolved-pointer';
            timing.source_scheme = parsed?.protocol ?? null;
            timing.total_ms = Math.round(performance.now() - startedAt);
          }
          return cgImageUnavailableMarkdown(source);
        }
        dataUrl = await fetchImageDataUrl(source, timing);
      }
      return dataUrl ? `![image-${recordId}-${imageOrdinal}](${dataUrl})` : cgImageUnavailableMarkdown(source);
    } catch (error) {
      const status = Number(error?.httpStatus);
      return cgImageFailureMarkdown(source, Number.isFinite(status) ? status : null);
    }
  }

  /**
   * Handles fallback image pointer fallback.
   *
   * @param {Object} part - The provider content part to process.
   * @returns {string} The string produced by `cgImagePointerFallback`.
   */
  function cgImagePointerFallback(part) {
    const source = cgImagePointerSource(part);
    return source ? cgImageUnavailableMarkdown(source) : '[image missing]';
  }

  /**
   * Handles fallback content text parts.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {Array<unknown>} The ordered values produced by `cgContentTextParts`.
   */
  function cgContentTextParts(record, fileRefIndex = new Map(), recoveredImages = []) {
    const content = record?.content ?? {};
    const parts = content.parts;
    const role = record?.author?.role ?? '';
    const type = content.content_type ?? '';
    const cleaned = [];
    let imageOrdinal = 0;
    if (!Array.isArray(parts)) return cleaned;
    for (const part of parts) {
      const texts = [];
      if (typeof part === 'string') {
        if (part.trim()) texts.push(part);
      } else if (part && typeof part === 'object') {
        if (part.content_type === 'image_asset_pointer') {
          cleaned.push(recoveredImages[imageOrdinal] || cgImagePointerFallback(part));
          imageOrdinal += 1;
          continue;
        }
        for (const key of ['text', 'content']) {
          const value = part[key];
          if (typeof value === 'string' && value.trim()) texts.push(value);
        }
      }
      for (const value of texts) {
        const stripped = value.trim();
        if (role === 'tool' && type === 'multimodal_text' &&
            stripped.startsWith('Make sure to include ') && stripped.includes('cite this file')) continue;
        const rendered = cgRewriteGeneratedSandboxLinks(
          cgStripInlineTokens(cgRenderInlineReferences(value, record, fileRefIndex)), record
        ).trim();
        if (rendered) cleaned.push(rendered);
      }
    }
    return cleaned;
  }

  /**
   * Handles fallback visible user text.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {string} The string produced by `cgVisibleUserText`.
   */
  function cgVisibleUserText(record, fileRefIndex = new Map(), recoveredImages = []) {
    if (cgIsHidden(record) || record?.author?.role !== 'user' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex, recoveredImages).join('\n\n').trim();
  }

  /**
   * Handles fallback visible assistant text.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {string} The string produced by `cgVisibleAssistantText`.
   */
  function cgVisibleAssistantText(record, fileRefIndex = new Map(), recoveredImages = []) {
    if (cgIsHidden(record) || record?.author?.role !== 'assistant' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex, recoveredImages).join('\n\n').trim();
  }

  /**
   * Handles fallback visible assistant markdown.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {string} The string produced by `cgVisibleAssistantMarkdown`.
   */
  function cgVisibleAssistantMarkdown(record, fileRefIndex = new Map(), recoveredImages = []) {
    return cgVisibleAssistantText(record, fileRefIndex, recoveredImages);
  }

  /**
   * Handles fallback record search texts.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {Array<unknown>} The ordered values produced by `cgRecordSearchTexts`.
   */
  function cgRecordSearchTexts(record, fileRefIndex = new Map()) {
    if (cgIsHidden(record) || record?.author?.role === 'system') return [];
    const content = record?.content ?? {};
    const type = content.content_type ?? '';
    const texts = [];
    if (type === 'text' || type === 'multimodal_text') {
      texts.push(...cgContentTextParts(record, fileRefIndex));
    } else if (type === 'thoughts' && Array.isArray(content.thoughts)) {
      for (const thought of content.thoughts) {
        if (!thought || typeof thought !== 'object') continue;
        if (typeof thought.summary === 'string' && thought.summary.trim()) texts.push(thought.summary);
        if (typeof thought.content === 'string' && thought.content.trim()) texts.push(thought.content);
        else if (Array.isArray(thought.chunks)) {
          for (const chunk of thought.chunks) if (typeof chunk === 'string' && chunk.trim()) texts.push(chunk);
        }
      }
    } else if (type === 'code' || type === 'execution_output') {
      for (const key of ['text', 'content']) if (typeof content[key] === 'string' && content[key].trim()) texts.push(content[key]);
    } else if (type === 'reasoning_recap') {
      if (typeof content.content === 'string' && content.content.trim()) texts.push(content.content);
    } else if (type === 'model_editable_context') {
      for (const key of ['model_set_context', 'repo_summary']) if (typeof content[key] === 'string' && content[key].trim()) texts.push(content[key]);
    } else if (type === 'tether_browsing_display') {
      for (const key of ['summary', 'result']) if (typeof content[key] === 'string' && content[key].trim()) texts.push(content[key]);
      const assets = Array.isArray(content.assets) ? content.assets : [content.assets];
      for (const asset of assets) {
        if (!asset || typeof asset !== 'object') continue;
        for (const key of ['title', 'text', 'alt', 'caption', 'url']) if (typeof asset[key] === 'string' && asset[key].trim()) texts.push(asset[key]);
      }
    }
    return texts;
  }

  /**
   * Wraps opaque source/tool payload text in a collision-safe Markdown code fence.
   *
   * Source -> output transformation: scans the literal payload for its longest run of backtick characters, then emits an outer fence one character longer (minimum three). The payload itself is not rewritten.
   *
   * @param {string} text - The text to process.
   * @param {string} language - The code-fence language identifier.
   * @returns {string} The string produced by `cgCodeFence`.
   */
  function cgCodeFence(text, language = '') {
    const body = String(text ?? '').replace(/\s+$/, '');
    const runs = body.match(/`+/g) ?? [];
    /**
     * Handles longest.
     */
    const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}${language || ''}\n${body}\n${fence}`;
  }

  /**
   * Wraps a summary and opaque body in the HTML `details` structure used by fallback Markdown output.
   *
   * @param {Object} summary - The summary label to render.
   * @param {Object} body - The body content to render.
   * @returns {string} The string produced by `cgRenderDetail`.
   */
  function cgRenderDetail(summary, body) {
    return body ? `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>` : '';
  }

  /**
   * Infers a Markdown fence language only for the legacy/fallback renderer when no stronger canonical language is available.
   *
   * Source -> output transformation: explicit source language wins; otherwise provider metadata/recipient and limited code-prefix evidence may map to a fence language such as `python` or `bash`. This fallback does not alter payload text.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Object} code - The source code to classify.
   * @param {string} explicitLanguage - The provider-supplied language label, when available.
   * @returns {string} The string produced by `cgInferCodeLanguage`.
   */
  function cgInferCodeLanguage(record, code, explicitLanguage = '') {
    if (typeof explicitLanguage === 'string' && explicitLanguage.trim()) return explicitLanguage.trim();
    const language = record?.metadata?.language;
    if (typeof language === 'string' && language.trim()) return language.trim();
    const recipient = String(record?.recipient ?? '').toLowerCase();
    if (recipient.includes('python')) return 'python';
    if (recipient.includes('shell') || recipient.includes('bash') || recipient.includes('terminal')) return 'bash';
    const trimmed = String(code ?? '').trimStart();
    if (/^(?:import |from \w+ import |def |class )/.test(trimmed)) return 'python';
    return '';
  }

  /**
   * Handles fallback render thought item.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderThoughtItem`.
   */
  function cgRenderThoughtItem(record, fileRefIndex = new Map()) {
    if (cgIsHidden(record)) return '';
    const role = record?.author?.role ?? '';
    const content = record?.content ?? {};
    const type = content.content_type ?? '';
    if (role === 'assistant' && type === 'thoughts') {
      const blocks = [];
      for (const thought of Array.isArray(content.thoughts) ? content.thoughts : []) {
        if (!thought || typeof thought !== 'object') continue;
        const summary = typeof thought.summary === 'string' ? thought.summary.trim() : '';
        const body = typeof thought.content === 'string' ? thought.content.trim() : '';
        if (body) blocks.push(summary ? `**${summary}**\n\n${body}` : body);
        else if (summary) blocks.push(summary);
        else if (Array.isArray(thought.chunks)) {
          /**
           * Handles chunk text.
           */
          const chunkText = thought.chunks.filter(chunk => typeof chunk === 'string' && chunk.trim()).join('\n\n');
          if (chunkText) blocks.push(chunkText);
        }
      }
      return blocks.join('\n\n');
    }
    if (role === 'assistant' && type === 'reasoning_recap') return typeof content.content === 'string' ? content.content.trim() : '';
    if (role === 'assistant' && type === 'code') {
      const code = typeof content.text === 'string' ? content.text : '';
      if (!code.trim()) return '';
      return cgRenderDetail(`${record?.recipient || 'tool'} code`, cgCodeFence(code, cgInferCodeLanguage(record, code, content.language ?? '')));
    }
    if (role === 'assistant' && type === 'model_editable_context') {
      const texts = cgRecordSearchTexts(record, fileRefIndex);
      return texts.length ? cgRenderDetail('editable context', quoteMarkdown(texts.join('\n\n'))) : '';
    }
    if (role === 'tool') {
      const texts = cgRecordSearchTexts(record, fileRefIndex);
      if (!texts.length) return '';
      return cgRenderDetail(`${record?.author?.name || record?.recipient || 'tool'} output`, cgCodeFence(texts.join('\n\n')));
    }
    return '';
  }

  /**
   * Handles fallback render thought block.
   *
   * @param {Array<Object>} items - The ordered items values to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderThoughtBlock`.
   */
  function cgRenderThoughtBlock(items, fileRefIndex = new Map()) {
    const rendered = [];
    for (const record of items) {
      const body = cgRenderThoughtItem(record, fileRefIndex);
      if (body) rendered.push(body);
    }
    return rendered.length ? `<details>\n<summary>Thoughts</summary>\n\n${rendered.join('\n\n')}\n\n</details>` : '';
  }

  // BEGIN AIConversationCore Phase 5 integration
  /**
   * Returns the loaded AIConversationCore browser API after asserting the required adapter and renderer entry points are available.
   *
   * @returns {boolean} `true` when `canonicalCore` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalCore() {
    const core = globalThis.AIConversationCore;
    assert(core && typeof core === 'object', 'AIConversationCore browser bundle is not loaded.');
    assert(typeof core.adaptChatGPTRecords === 'function', 'AIConversationCore ChatGPT adapter is unavailable.');
    assert(typeof core.renderCanonicalMarkdown === 'function', 'AIConversationCore Markdown renderer is unavailable.');
    return core;
  }

  /**
   * Converts DownloadConversation recovery Markdown for one image into canonical image-resource state.
   *
   * Source -> canonical transformation: recovered data-image Markdown becomes `status: available` plus `data_url`; missing/unavailable placeholders become the corresponding canonical status and optional source pointer.
   *
   * @param {string} markdown - The Markdown text to process.
   * @returns {Object|null} The value produced by `canonicalRecoveredImageState`, or `null` when no value is available.
   */
  function canonicalRecoveredImageState(markdown) {
    const value = String(markdown ?? '').trim();
    if (!value) return null;
    if (value === '[image missing]') return { status: 'missing' };
    const data = value.match(/^!\[[^\]]*\]\((data:image\/[^)]+)\)$/s);
    if (data) return { status: 'available', data_url: data[1] };
    if (value === '[image not available]') return { status: 'unavailable' };
    const unavailable = value.match(/^\[image not available\]\((.*)\)$/s);
    if (unavailable) return { status: 'unavailable', source_pointer: unavailable[1] };
    return null;
  }

  /**
   * Enriches canonical conversation-image resources with host-recovered image state without changing canonical event order.
   *
   * Source -> canonical transformation: the already-normalized image resource remains the identity-bearing object; recovery Markdown contributes only availability/data/source-pointer fields at the matching source image ordinal.
   *
   * @param {Event|Object} event - The event or event-like object being handled.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {Object} The Object value produced by `canonicalEnrichRecoveredImages`.
   */
  function canonicalEnrichRecoveredImages(event, recoveredImages = []) {
    if (!event || !Array.isArray(recoveredImages) || !recoveredImages.length) return event;
    // Advances only across canonical conversation-image resources to preserve source ordinals.
    let imageIndex = 0;
    /**
     * Handles resources.
     */
    const resources = (event.resources ?? []).map(resource => {
      if (resource?.type !== 'image' || resource?.resource_kind !== 'conversation_image') return resource;
      const recovered = canonicalRecoveredImageState(recoveredImages[imageIndex]);
      imageIndex += 1;
      if (!recovered) return resource;
      const enriched = { ...resource, ...recovered };
      if (recovered.data_url) enriched.data_url = recovered.data_url;
      if (recovered.source_pointer) enriched.source_pointer = recovered.source_pointer;
      return enriched;
    });
    return { ...event, resources };
  }

  /**
   * Handles canonical events by source record.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @param {Map<unknown, unknown>} recoveredImageMap - The recovered-image lookup keyed by source record.
   * @returns {Map<unknown, unknown>} The lookup map produced by `canonicalEventsBySourceRecord`.
   */
  function canonicalEventsBySourceRecord(records, recoveredImageMap = new Map()) {
    const conversationId = typeof currentConversationId === 'function' ? currentConversationId() : null;
    /**
     * Handles has metadata.
     */
    const hasMetadata = records.some(record => record?.record_type === 'chatgpt_conversation_metadata');
    const adapterRecords = conversationId && !hasMetadata
      ? [...records, {
          record_type: 'chatgpt_conversation_metadata',
          schema_version: 1,
          conversation_id: conversationId
        }]
      : records;
    const events = canonicalCore().adaptChatGPTRecords(adapterRecords);
    assert(Array.isArray(events), 'AIConversationCore ChatGPT adapter did not return canonical events.');
    // Maps stable source record ids back to their adapted canonical events.
    const bySourceRecord = new Map();
    for (const event of events) {
      const sourceIndex = event?.source_index;
      const sourceRecordId = event?.source_record_id;
      if (!Number.isInteger(sourceIndex) || typeof sourceRecordId !== 'string' || !sourceRecordId) continue;
      const original = records[sourceIndex];
      if (!original) continue;
      assert(original?.id === sourceRecordId,
        `AIConversationCore source record mismatch at JSONL index ${sourceIndex}.`);
      assert(event?.source?.record_id === sourceRecordId,
        `AIConversationCore did not preserve source record ID ${sourceRecordId}.`);
      assert(event?.source?.record_index === sourceIndex,
        `AIConversationCore did not preserve source record index ${sourceIndex}.`);
      assert(event?.source?.turn_id === sourceRecordId,
        `AIConversationCore source turn identity differs from record ${sourceRecordId}.`);
      assert(event?.source?.create_time === (original?.create_time ?? null),
        `AIConversationCore did not preserve create_time for ${sourceRecordId}.`);
      assert(event?.source?.update_time === (original?.update_time ?? null),
        `AIConversationCore did not preserve update_time for ${sourceRecordId}.`);
      const enrichedEvent = canonicalEnrichRecoveredImages(
        event, recoveredImageMap.get(sourceRecordId) ?? []);
      bySourceRecord.set(sourceRecordId, enrichedEvent);
    }
    return bySourceRecord;
  }

  /**
   * Handles canonical rendered has unresolved inline tokens.
   *
   * @param {Object} rendered - The rendered value required by this function.
   * @returns {boolean} `true` when the canonical rendered has unresolved inline tokens condition is satisfied; otherwise `false`.
   */
  function canonicalRenderedHasUnresolvedInlineTokens(rendered) {
    return String(rendered ?? '').includes(CG_INLINE_TOKEN_START);
  }

  /**
   * Determines whether one source User/Assistant record and its canonical event can be rendered by the shared canonical Markdown renderer.
   *
   * Source/canonical -> routing transformation: returns only an eligibility decision. It never rewrites the source record or canonical event; unsupported shapes remain on the legacy fallback path.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The event or event-like object being handled.
   * @returns {boolean} `true` when the canonical message record eligible condition is satisfied; otherwise `false`.
   */
  function canonicalMessageRecordEligible(record, event) {
    if (!event || cgIsHidden(record) || event?.visibility === 'hidden') return false;
    const role = record?.author?.role;
    if (!['user', 'assistant'].includes(role)) return false;
    if (role === 'user' && event.kind !== 'message') return false;
    if (role === 'assistant' && !['message', 'commentary'].includes(event.kind)) return false;
    if (!['text', 'multimodal_text'].includes(record?.content?.content_type)) return false;
    if (!(event.blocks ?? []).some(block => block?.type === 'text' || block?.type === 'image')) return false;
    const sourceText = Array.isArray(record?.content?.parts)
      ? record.content.parts.filter(part => typeof part === 'string').join('')
      : '';
    if (role === 'user' && /sandbox:\/\/?/i.test(sourceText)) return false;
    const rendered = canonicalCore().renderCanonicalMarkdown([event]);
    return Boolean(rendered.trim()) && !canonicalRenderedHasUnresolvedInlineTokens(rendered);
  }

  /**
   * Formats one ChatGPT source timestamp like AI-transcript.py's default -d output.
   *
   * @param {Object} record - The provider/source record to inspect.
   * @returns {string|null} Local-time YYYY-MM-DD HH:MM:SS, or null when unavailable.
   */
  function transcriptTimestamp(record) {
    const raw = record?.create_time ?? record?.update_time;
    if (raw == null) return null;
    const date = new Date(Number(raw) * 1000);
    if (!Number.isFinite(date.getTime())) return null;
    /**
     * Zero-pads one date/time component to two digits.
     *
     * @param {number} value - Numeric date/time component to pad.
     * @returns {string} Two-character decimal representation.
     */
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  /**
   * Builds shared-core heading metadata for one ChatGPT source record.
   *
   * @param {Object} record - The provider/source record to inspect.
   * @param {number|null} recordNumber - The one-based paired JSONL record number.
   * @returns {Object} Consumer heading metadata understood by AIConversationCore.
   */
  function canonicalHeadingMetadata(record, recordNumber = null) {
    const metadata = {};
    if (showTimestamps) {
      const timestamp = transcriptTimestamp(record);
      if (timestamp) metadata.timestamp = timestamp;
    }
    if (showRecordNumbers && Number.isInteger(recordNumber)) metadata.record_number = recordNumber;
    return metadata;
  }

  /**
   * Renders one eligible canonical message event while preserving DownloadConversation source-turn identity in the transcript heading.
   *
   * Canonical -> output transformation: AIConversationCore supplies the plain canonical heading/body; DownloadConversation replaces only that heading with its existing source-record `turn_id` comment and preserves the rendered body.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The event or event-like object being handled.
   * @param {number|null} recordNumber - The one-based paired JSONL record number.
   * @returns {string} The string produced by `canonicalRecordBlock`.
   */
  function canonicalRecordBlock(record, event, recordNumber = null) {
    assert(canonicalMessageRecordEligible(record, event),
      `AIConversationCore message record ${record?.id ?? 'unknown'} is not eligible for canonical rendering.`);
    // Provider/source ID projected onto renderer-generated headings for this record.
    const sourceId = showTurnIds && typeof record?.id === 'string' ? record.id : '';
    const headingMetadata = canonicalHeadingMetadata(record, recordNumber);
    const hasHeadingMetadata = Object.keys(headingMetadata).length > 0;
    // Canonical event clone carrying DownloadConversation presentation metadata.
    const projectedEvent = (sourceId || hasHeadingMetadata)
      ? {
          ...event,
          projection: {
            ...(event?.projection ?? {}),
            ...(hasHeadingMetadata ? {
              heading_metadata: {
                ...(event?.projection?.heading_metadata ?? {}),
                ...headingMetadata
              }
            } : {}),
            ...(sourceId ? { heading_suffix: ` <!-- turn_id=${sourceId} -->` } : {})
          }
        }
      : event;
    return canonicalCore().renderCanonicalMarkdown([projectedEvent]).trimEnd();
  }

  /**
   * Determines whether one non-message canonical Assistant activity event is supported by the shared canonical Markdown renderer.
   *
   * Canonical -> routing transformation: reasoning summaries, tool calls, and tool results are eligible; the event payload is not modified.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The event or event-like object being handled.
   * @returns {boolean} `true` when `canonicalThoughtRecordEligible` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalThoughtRecordEligible(record, event) {
    if (!event || cgIsHidden(record) || event?.visibility === 'hidden') return false;
    return ['reasoning_summary', 'tool_call', 'tool_result'].includes(event.kind);
  }

  /**
   * Determines whether an ordered Assistant activity segment can be rendered wholly by AIConversationCore without changing its source association.
   *
   * Source/canonical -> routing transformation: validates semantic event combinations and returns a Boolean; it does not regroup, reorder, or rewrite records.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @param {Array<Object>} events - The canonical events associated with the source records.
   * @returns {boolean} `true` when the canonical assistant segment eligible condition is satisfied; otherwise `false`.
   */
  function canonicalAssistantSegmentEligible(records, events) {
    if (!Array.isArray(records) || !records.length || !Array.isArray(events) || events.length !== records.length) {
      return false;
    }
    // Tracks the one ordinary final Assistant message allowed in a canonical response segment.
    let finalMessageIndex = -1;
    let hasAssistantSource = false;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const event = events[index];
      if (record?.author?.role === 'assistant') hasAssistantSource = true;
      if (canonicalMessageRecordEligible(record, event)) {
        if (record?.author?.role !== 'assistant') return false;
        if (event?.kind === 'commentary') continue;
        if (event?.kind !== 'message' || finalMessageIndex >= 0) return false;
        finalMessageIndex = index;
        continue;
      }
      if (!canonicalThoughtRecordEligible(record, event)) return false;
    }
    if (!hasAssistantSource) return false;
    if (finalMessageIndex >= 0 && finalMessageIndex !== records.length - 1) return false;
    const rendered = canonicalCore().renderCanonicalMarkdown(events);
    // Tool payloads are opaque literal data and may legitimately contain ChatGPT
    // inline-token character sequences. Message/commentary records were already
    // checked individually above, so do not reject the whole segment by scanning
    // rendered tool payload text.
    return Boolean(rendered.trim());
  }

  /**
   * Renders one eligible canonical Assistant activity segment while preserving DownloadConversation source-turn identity in the transcript heading.
   *
   * Canonical -> output transformation: AIConversationCore renders the ordered segment; DownloadConversation substitutes only its established source-record heading/comment for the plain canonical heading. Tool payloads and rendered body remain opaque.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @param {Array<Object>} events - The canonical events associated with the source records.
   * @param {Map<unknown, unknown>} recordNumberById - Paired JSONL record numbers keyed by source ID.
   * @returns {string} The string produced by `canonicalAssistantSegmentBlock`.
   */
  function canonicalAssistantSegmentBlock(records, events, recordNumberById = new Map()) {
    assert(canonicalAssistantSegmentEligible(records, events),
      'AIConversationCore Assistant segment contains an unsupported record.');
    /**
     * Handles message record.
     */
    const messageRecord = [...records].reverse().find((record, indexFromEnd) => {
      const index = records.length - 1 - indexFromEnd;
      return canonicalMessageRecordEligible(record, events[index]);
    }) ?? null;
    /**
     * Handles heading record.
     */
    const headingRecord = messageRecord ?? records.find(record => record?.author?.role === 'assistant') ?? records[0];
    // Source ID retained on the one enclosing ChatGPT response heading.
    const headingSourceId = showTurnIds && typeof headingRecord?.id === 'string' ? headingRecord.id : '';
    // Canonical event sequence decorated only with source heading identities.
    const projectedEvents = events.map((event, index) => {
      const commentarySourceId = showTurnIds && event?.kind === 'commentary' && typeof records[index]?.id === 'string'
        ? records[index].id
        : '';
      const sourceId = commentarySourceId || (index === 0 ? headingSourceId : '');
      const responseHeadingSuffix = index === 0 && headingSourceId
        ? ` <!-- turn_id=${headingSourceId} -->`
        : '';
      const headingMetadata = canonicalHeadingMetadata(
        records[index], recordNumberById.get(records[index]?.id) ?? null
      );
      const hasHeadingMetadata = Object.keys(headingMetadata).length > 0;
      if (!sourceId && !responseHeadingSuffix && !hasHeadingMetadata) return event;
      return {
        ...event,
        projection: {
          ...(event?.projection ?? {}),
          ...(hasHeadingMetadata ? {
            heading_metadata: {
              ...(event?.projection?.heading_metadata ?? {}),
              ...headingMetadata
            }
          } : {}),
          ...(sourceId ? { heading_suffix: ` <!-- turn_id=${sourceId} -->` } : {}),
          ...(responseHeadingSuffix ? { response_heading_suffix: responseHeadingSuffix } : {})
        }
      };
    });
    const rendered = canonicalCore().renderCanonicalMarkdown(projectedEvents).trimEnd();
    if (diagnosticEnabled('debug')) {
      logDiagnostic('debug', 'canonical-assistant-segment-rendered', {
        source_record_ids: records.map(record => record?.id ?? null),
        final_source_record_id: messageRecord?.id ?? null,
        event_kinds: events.map(event => event?.kind ?? null),
        rendered_length: rendered.length
      });
    }
    return rendered;
  }

  // Compatibility helpers retained for the already-established #93/#97 regressions.
  /**
   * Handles canonical plain record eligible.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {boolean} `true` when `canonicalPlainRecordEligible` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalPlainRecordEligible(record) {
    if (cgIsHidden(record)) return false;
    if (!['user', 'assistant'].includes(record?.author?.role)) return false;
    if (record?.content?.content_type !== 'text') return false;
    const parts = record?.content?.parts;
    if (!Array.isArray(parts) || !parts.length || parts.some(part => typeof part !== 'string')) return false;
    if (!parts.some(part => part.trim())) return false;
    const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    if (Array.isArray(metadata.content_references) && metadata.content_references.length) return false;
    if (Array.isArray(metadata.citations) && metadata.citations.length) return false;
    const text = parts.join('');
    if (text.includes(CG_INLINE_TOKEN_START)) return false;
    if (/sandbox:\/\/?/i.test(text)) return false;
    return true;
  }

  /**
   * Handles canonical plain record block.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Event|Object} event - The event or event-like object being handled.
   * @param {number|null} recordNumber - The one-based paired JSONL record number.
   * @returns {boolean} `true` when `canonicalPlainRecordBlock` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalPlainRecordBlock(record, event, recordNumber = null) {
    return canonicalRecordBlock(record, event, recordNumber);
  }

  /**
   * Handles canonical plain assistant segment eligible.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @returns {boolean} `true` when `canonicalPlainAssistantSegmentEligible` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalPlainAssistantSegmentEligible(records) {
    if (!Array.isArray(records) || records.length < 2) return false;
    let hasAssistantMessage = false;
    for (const record of records) {
      if (cgIsHidden(record)) return false;
      if (record?.author?.role !== 'assistant') return false;
      const type = record?.content?.content_type;
      if (type === 'thoughts') continue;
      if (type !== 'text' || !canonicalPlainRecordEligible(record)) return false;
      hasAssistantMessage = true;
    }
    return hasAssistantMessage;
  }

  /**
   * Handles canonical plain assistant segment block.
   *
   * @param {Array<Object>} records - The ordered provider/source records to process.
   * @param {Array<Object>} events - The canonical events associated with the source records.
   * @returns {boolean} `true` when `canonicalPlainAssistantSegmentBlock` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function canonicalPlainAssistantSegmentBlock(records, events) {
    assert(canonicalPlainAssistantSegmentEligible(records),
      'AIConversationCore Assistant segment requires only plain visible Assistant records.');
    return canonicalAssistantSegmentBlock(records, events);
  }
  // END AIConversationCore Phase 5 integration

  /**
   * Builds the DownloadConversation transcript heading from the actual provider/source record.
   *
   * Source -> output transformation: the source record ID is emitted as the `turn_id` comment; it is intentionally not replaced by AIConversationCore derived turn identity.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {number|null} recordNumber - The one-based paired JSONL record number.
   * @returns {string} The string produced by `transcriptHeading`.
   */
  function transcriptHeading(record, recordNumber = null) {
    const id = typeof record?.id === 'string' ? record.id : '';
    const headingMetadata = canonicalHeadingMetadata(record, recordNumber);
    const fields = [];
    if (headingMetadata.timestamp != null) fields.push(`[${headingMetadata.timestamp}]:`);
    if (headingMetadata.record_number != null) fields.push(`${headingMetadata.record_number}:`);
    const metadata = fields.length ? ` ${fields.join(' ')}` : '';
    const turnId = showTurnIds && id ? ` <!-- turn_id=${id} -->` : '';
    if (record?.author?.role === 'user') return `## User${metadata}${turnId}`;
    if (record?.author?.role === 'assistant' && record?.channel === 'commentary') {
      return `## ChatGPT Commentary${metadata}${turnId}`;
    }
    if (record?.author?.role === 'assistant') return `## ChatGPT${metadata}${turnId}`;
    return '';
  }

  /**
   * Renders conversation markdown.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @param {Object} onProgress - The callback invoked with progress updates.
   * @param {Map<unknown, unknown>} recoveredImageMap - The recovered-image lookup keyed by source record.
   * @returns {string} The string produced by `renderConversationMarkdown`.
   */
  function renderConversationMarkdown(spine, onProgress, recoveredImageMap = new Map()) {
    assert(Array.isArray(spine?.records), 'Conversation API Markdown export requires spine records.');
    /**
     * Handles records.
     */
    const records = spine.records.map(item => item.message).filter(Boolean);
    const recordNumberById = new Map();
    spine.records.forEach((item, index) => {
      if (typeof item?.message?.id === 'string') recordNumberById.set(item.message.id, index + 2);
    });
    const output = [];
    // Fallback citation lookup keyed by ChatGPT retrieval turn/file coordinates.
    const fileRefIndex = cgBuildFileReferenceIndex(records);
    // Canonical-event lookup kept in source-record identity space for order-preserving rendering.
    const canonicalEventBySourceRecord = canonicalEventsBySourceRecord(records, recoveredImageMap);
    // Buffers Assistant reasoning/tool activity until its complete output segment can be rendered.
    let pendingThoughts = [];

    /**
     * Handles flush assistant block.
     *
     * @param {string} body - The body content to render.
     * @param {Object|null} record - The provider/source record to process.
     * @returns {void} No value is returned.
     */
    const flushAssistantBlock = (body = '', record = null) => {
      if (!body && !pendingThoughts.length) return;
      const headingRecord = record ?? pendingThoughts[0];
      const parts = [transcriptHeading(headingRecord, recordNumberById.get(headingRecord?.id) ?? null)];
      const thoughts = cgRenderThoughtBlock(pendingThoughts, fileRefIndex);
      if (thoughts) parts.push(thoughts);
      if (body) parts.push(quoteMarkdown(body));
      output.push(parts.join('\n\n'));
      pendingThoughts = [];
    };

    /**
     * Handles flush pending assistant.
     *
     * @returns {void} No value is returned.
     */
    const flushPendingAssistant = () => {
      if (!pendingThoughts.length) return;
      const events = pendingThoughts
        .map(record => canonicalEventBySourceRecord.get(record.id) ?? null)
        .filter(Boolean);
      if (events.length === pendingThoughts.length &&
          canonicalAssistantSegmentEligible(pendingThoughts, events)) {
        output.push(canonicalAssistantSegmentBlock(pendingThoughts, events, recordNumberById));
        pendingThoughts = [];
        return;
      }
      flushAssistantBlock();
    };

    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      onProgress?.({
        stage: 'rendering',
        record_number: i + 1,
        record_count: records.length
      });
      const recoveredImages = recoveredImageMap.get(record.id) ?? [];
      const canonicalEvent = canonicalEventBySourceRecord.get(record.id) ?? null;

      if (canonicalEvent && canonicalMessageRecordEligible(record, canonicalEvent)) {
        if (record?.author?.role === 'user') {
          flushPendingAssistant();
          output.push(canonicalRecordBlock(record, canonicalEvent, recordNumberById.get(record.id) ?? null));
          continue;
        }
        if (record?.author?.role === 'assistant' && canonicalEvent?.kind === 'commentary') {
          pendingThoughts.push(record);
          continue;
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length > 0) {
          const segmentRecords = [...pendingThoughts, record];
          const segmentEvents = segmentRecords
            .map(item => canonicalEventBySourceRecord.get(item.id) ?? null)
            .filter(Boolean);
          const canonicalSegmentComplete = segmentEvents.length === segmentRecords.length;
          const canonicalSegmentEligible = canonicalSegmentComplete &&
            canonicalAssistantSegmentEligible(segmentRecords, segmentEvents);
          if (diagnosticEnabled('debug') && segmentRecords.some(item =>
              item?.content?.content_type === 'code' || item?.author?.role === 'tool')) {
            logDiagnostic('debug', 'canonical-tool-segment-routing', {
              complete: canonicalSegmentComplete,
              eligible: canonicalSegmentEligible,
              rejection_reason: canonicalSegmentEligible
                ? null
                : (!canonicalSegmentComplete ? 'missing-canonical-events' : 'unsupported-canonical-segment'),
              records: segmentRecords.map((item, index) => ({
                source_record_id: item?.id ?? null,
                source_role: item?.author?.role ?? null,
                source_recipient: item?.recipient ?? null,
                source_channel: item?.channel ?? null,
                source_content_type: item?.content?.content_type ?? null,
                source_language: item?.content?.language ?? null,
                event_kind: segmentEvents[index]?.kind ?? null,
                event_role: segmentEvents[index]?.role ?? null,
                event_blocks: Array.isArray(segmentEvents[index]?.blocks)
                  ? segmentEvents[index].blocks.map(block => ({
                    type: block?.type ?? null,
                    name: block?.name ?? null,
                    input_format: block?.input_format ?? null,
                    language: block?.language ?? null,
                    source_language: block?.source_language ?? null
                  }))
                  : []
              }))
            });
          }
          if (canonicalSegmentEligible) {
            logDiagnostic('debug', 'conversation-markdown-segment-render-request', {
              source_record_ids: segmentRecords.map(item => item?.id ?? null),
              final_source_record_id: record?.id ?? null,
              event_kinds: segmentEvents.map(event => event?.kind ?? null),
              output_index_before_append: output.length
            });
            const renderedSegment = canonicalAssistantSegmentBlock(segmentRecords, segmentEvents, recordNumberById);
            output.push(renderedSegment);
            if (diagnosticEnabled('debug')) {
              logDiagnostic('debug', 'conversation-markdown-block-appended', {
                route: 'canonical-assistant-segment',
                output_index: output.length - 1,
                source_record_ids: segmentRecords.map(item => item?.id ?? null),
                final_source_record_id: record?.id ?? null,
                block_length: renderedSegment.length
              });
            }
            pendingThoughts = [];
            continue;
          }
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length === 0) {
          output.push(canonicalRecordBlock(record, canonicalEvent, recordNumberById.get(record.id) ?? null));
          continue;
        }
      }

      if (canonicalEvent && canonicalThoughtRecordEligible(record, canonicalEvent)) {
        pendingThoughts.push(record);
        continue;
      }

      const userText = cgVisibleUserText(record, fileRefIndex, recoveredImages);
      if (userText) {
        flushPendingAssistant();
        output.push(`${transcriptHeading(record, recordNumberById.get(record.id) ?? null)}\n\n${quoteMarkdown(userText)}`);
        continue;
      }
      const assistantText = cgVisibleAssistantMarkdown(record, fileRefIndex, recoveredImages);
      if (assistantText) {
        flushAssistantBlock(assistantText, record);
        continue;
      }
      const fallbackThought = cgRenderThoughtItem(record, fileRefIndex);
      if (fallbackThought) {
        pendingThoughts.push(record);
        continue;
      }
      if (diagnosticEnabled('debug') && i >= Math.max(0, records.length - 32)) {
        logDiagnostic('debug', 'conversation-markdown-record-excluded', {
          source_index: i,
          source_record_id: record?.id ?? null,
          source_role: record?.author?.role ?? null,
          source_recipient: record?.recipient ?? null,
          source_channel: record?.channel ?? null,
          source_content_type: record?.content?.content_type ?? null,
          event_kind: canonicalEvent?.kind ?? null,
          event_visibility: canonicalEvent?.visibility ?? null,
          reason: 'no-canonical-or-fallback-renderer-produced-output'
        });
      }
    }
    flushPendingAssistant();
    const markdown = `${output.join('\n\n')}\n`;
    if (diagnosticEnabled('debug')) {
      logDiagnostic('debug', 'conversation-markdown-assembled', {
        source_record_count: records.length,
        output_block_count: output.length,
        markdown_length: markdown.length,
        source_tail: records.slice(-32).map((record, offset) => ({
          source_index: records.length - Math.min(32, records.length) + offset,
          source_record_id: record?.id ?? null,
          source_role: record?.author?.role ?? null,
          source_recipient: record?.recipient ?? null,
          source_channel: record?.channel ?? null,
          source_content_type: record?.content?.content_type ?? null
        }))
      });
    }
    return markdown;
  }

  /**
   * Builds the DownloadConversation metadata record prepended to a JSONL export.
   *
   * @param {string} conversationId - The Conversation API conversation identifier.
   * @returns {Object} The Object value produced by `conversationMetadataJsonlRecord`.
   */
  function conversationMetadataJsonlRecord(conversationId) {
    assert(typeof conversationId === 'string' && conversationId.trim(), 'Conversation ID is required for JSONL export metadata.');
    return {
      record_type: 'chatgpt_conversation_metadata',
      schema_version: 1,
      conversation_id: conversationId.trim()
    };
  }

  /**
   * Handles api records jsonl.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @param {string} conversationId - The Conversation API conversation identifier.
   * @returns {string} The string produced by `apiRecordsJsonl`.
   */
  function apiRecordsJsonl(spine, conversationId = currentConversationId()) {
    const metadata = conversationMetadataJsonlRecord(conversationId);
    /**
     * Handles records.
     */
    const records = [metadata, ...spine.records.map(record => record.message)];
    return `${records.map(record => JSON.stringify(record)).join('\n')}\n`;
  }

  /**
   * Handles progress status.
   *
   * @param {Object} prefix - The status text prefix.
   * @returns {string} The string produced by `progressStatus`.
   */
  function progressStatus(prefix) {
    if (!progressState) return statusText;
    const now = performance.now();
    const elapsed = now - progressState.started_at;
    const stage = progressState.stage;

    if (stage === 'fetching') {
      const pageNumber = Number(progressState.fetch_page_number) || (Number(progressState.page_count) || 0) + 1;
      const pageElapsed = progressState.fetch_page_started_at > 0
        ? Math.max(0, now - progressState.fetch_page_started_at)
        : 0;
      return `${prefix}: fetching API page ${pageNumber}…\
Completed: ${progressState.page_count} page(s), ${progressState.raw_record_count} raw record(s)\
Page elapsed: ${formatDuration(pageElapsed)} — Total elapsed: ${formatDuration(elapsed)}`;
    }
    if (stage === 'recovering-images') {
      const imageCount = Number(progressState.image_count) || 0;
      const imageNumber = Number(progressState.image_number) || 0;
      const imageCompleted = Number(progressState.image_completed) || 0;
      const imageElapsed = progressState.image_started_at > 0
        ? Math.max(0, now - progressState.image_started_at)
        : 0;
      const path = progressState.image_path ? ` (${progressState.image_path})` : '';
      return `${prefix}: recovering image ${imageNumber}/${imageCount}${path}…\
Image elapsed: ${formatDuration(imageElapsed)} — Completed: ${imageCompleted}/${imageCount} — Total elapsed: ${formatDuration(elapsed)}`;
    }
    if (stage === 'rendering') {
      let eta = 'calculating…';
      if (progressState.record_number > 0 && progressState.record_count > progressState.record_number) {
        const renderElapsed = Math.max(0, now - progressState.render_started_at);
        eta = formatDuration(
          (renderElapsed / progressState.record_number) *
          (progressState.record_count - progressState.record_number)
        );
      } else if (progressState.record_number === progressState.record_count) {
        eta = '0s';
      }
      return `${prefix}: rendering API record ${progressState.record_number}/${progressState.record_count}…\nElapsed: ${formatDuration(elapsed)} — ETA: ${eta}`;
    }
    return statusText;
  }

  /**
   * Refreshes status.
   *
   * @returns {void} No value is returned.
   */
  function refreshStatus() {
    const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
    if (!status) return;
    if (progressState) {
      status.textContent = progressStatus(exportKind === 'md' ? 'Extract MD' : 'Extract JSONL');
    } else {
      status.textContent = statusText;
    }
  }

  /**
   * Sets status.
   *
   * @param {string} text - The text to process.
   * @returns {void} No value is returned.
   */
  function setStatus(text) {
    statusText = text;
    refreshStatus();
  }

  /**
   * Handles start status timer.
   *
   * @returns {void} No value is returned.
   */
  function startStatusTimer() {
    if (statusTimer !== null) clearInterval(statusTimer);
    statusTimer = setInterval(refreshStatus, 1000);
  }

  /**
   * Handles stop status timer.
   *
   * @returns {void} No value is returned.
   */
  function stopStatusTimer() {
    if (statusTimer !== null) clearInterval(statusTimer);
    statusTimer = null;
  }

  /**
   * Handles acquire wake lock.
   *
   * @returns {void} No value is returned.
   */
  async function acquireWakeLock() {
    if (!screenOnWhenCapturing || !exportInProgress ||
        document.visibilityState !== 'visible' || !navigator.wakeLock?.request) return;
    if (wakeLockSentinel) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      }, { once: true });
    } catch {}
  }

  /**
   * Handles release wake lock.
   *
   * @returns {void} No value is returned.
   */
  async function releaseWakeLock() {
    // Detach the current wake-lock handle before awaiting release to avoid stale global state.
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {}
    }
  }

  /**
   * Handles download blob.
   *
   * @param {Blob} blob - The Blob to download.
   * @param {Object} filename - The filename to use for the download.
   * @returns {void} No value is returned.
   */
  function downloadBlob(blob, filename) {
    logDiagnostic('debug', 'conversation-download-triggered', {
      filename: String(filename ?? ''),
      blob_size: Number.isFinite(blob?.size) ? blob.size : null,
      blob_type: typeof blob?.type === 'string' ? blob.type : null
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Handles conversation jump user records.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @returns {Array<unknown>} The ordered values produced by `jumpUserRecords`.
   */
  function jumpUserRecords(spine) {
    return (spine?.records ?? []).filter(record => record?.role === 'user');
  }

  /**
   * Resolves jump identifier.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @param {Object} identifier - The identifier value required by this function.
   * @returns {Object} The Object value produced by `resolveJumpIdentifier`.
   */
  function resolveJumpIdentifier(spine, identifier) {
    const value = String(identifier ?? '').trim();
    assert(value, 'A User/Assistant turn ID or numeric UAP index is required.');
    const records = spine?.records ?? [];
    const users = jumpUserRecords(spine);
    assert(users.length > 0, 'The conversation contains no User turns.');

    if (/^-?\d+$/.test(value)) {
      const requested = Number(value);
      assert(Number.isSafeInteger(requested), `UAP index ${value} is not a safe integer.`);
      const index = requested >= 0 ? requested : users.length + requested;
      assert(index >= 0 && index < users.length,
        `UAP index ${requested} is out of range for ${users.length} UAPs.`);
      return { uap_index: index, role: 'user', message_id: users[index].message_id };
    }

    /**
     * Handles record.
     */
    const record = records.find(item => item?.message_id === value);
    assert(record, `Turn ID ${value} was not found in the Conversation API.`);
    assert(record.role === 'user' || record.role === 'assistant',
      `Turn ID ${value} belongs to role ${record.role ?? 'unknown'}, not User or Assistant.`);
    // Tracks the latest User anchor at or before the requested source record.
    let uapIndex = -1;
    for (let index = 0; index < users.length; index += 1) {
      if (users[index].ordinal > record.ordinal) break;
      uapIndex = index;
    }
    assert(uapIndex >= 0, `Turn ID ${value} appears before the first User turn.`);
    return { uap_index: uapIndex, role: record.role, message_id: record.message_id };
  }

  /**
   * Returns mounted turn section.
   *
   * @param {string} messageId - The provider/source message identifier.
   * @param {Object|null} role - The message role to match.
   * @returns {null} The null value produced by `mountedTurnSection`.
   */
  function mountedTurnSection(messageId, role = null) {
    for (const section of document.querySelectorAll('section[data-turn-id]')) {
      if (role && section.getAttribute('data-turn') !== role) continue;
      if (section.getAttribute('data-turn-id') === messageId) return section;
      const message = section.querySelector('[data-message-id]');
      if (message?.getAttribute('data-message-id') === messageId) return section;
    }
    return null;
  }

  /**
   * Handles conversation scroll root.
   *
   * @returns {Element} The Element value produced by `conversationScrollRoot`.
   */
  function conversationScrollRoot() {
    const thread = document.querySelector('#thread');
    for (let node = thread?.parentElement; node instanceof HTMLElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight + 1) return node;
    }
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
  }

  /**
   * Waits for for jump target.
   *
   * @param {EventTarget|null} target - The target element or resolved jump target.
   * @param {number} timeoutMs - The timeout duration in milliseconds.
   * @returns {Promise<null>} A promise that resolves to the null result produced by `waitForJumpTarget`.
   */
  async function waitForJumpTarget(target, timeoutMs = 12000) {
    const deadline = performance.now() + timeoutMs;
    const scrollRoot = conversationScrollRoot();
    while (performance.now() < deadline) {
      const section = mountedTurnSection(target.message_id, target.role);
      if (section instanceof HTMLElement) return section;
      if (target.role === 'assistant') {
        scrollRoot.scrollBy({ top: Math.max(140, Math.floor(scrollRoot.clientHeight * 0.45)), behavior: 'auto' });
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }

  /**
   * Handles conversation jump TOC index control.
   *
   * @param {number} uapIndex - The zero-based uap index.
   * @returns {Element|null} The value produced by `jumpTocIndexControl`, or `null` when no value is available.
   */
  function jumpTocIndexControl(uapIndex) {
    return document.querySelector(`button[data-toc-item-index="${uapIndex}"]`);
  }

  /**
   * Handles populate jump TOC index.
   *
   * @param {number} uapIndex - The zero-based uap index.
   * @param {number} timeoutMs - The timeout duration in milliseconds.
   * @returns {Promise<null>} A promise resolving to the value produced by `populateJumpTocIndex`.
   */
  async function populateJumpTocIndex(uapIndex, timeoutMs = 60000) {
    let toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return toc;

    const scrollRoot = conversationScrollRoot();
    // Preserve the caller scroll position so image recovery can restore the page exactly.
    const originalScrollTop = scrollRoot.scrollTop;
    const deadline = performance.now() + timeoutMs;
    let steps = 0;
    let stagnantSteps = 0;
    logDiagnostic('debug', 'conversation-jump-toc-autopopulate-start', {
      uap_index: uapIndex,
      original_scroll_top: originalScrollTop,
      scroll_height: scrollRoot.scrollHeight,
      client_height: scrollRoot.clientHeight
    });

    scrollRoot.scrollTo({ top: 0, behavior: 'auto' });
    await new Promise(resolve => setTimeout(resolve, 100));

    while (performance.now() < deadline) {
      toc = jumpTocIndexControl(uapIndex);
      if (toc instanceof HTMLElement) {
        logDiagnostic('debug', 'conversation-jump-toc-autopopulate-complete', {
          uap_index: uapIndex,
          found: true,
          steps,
          scroll_top: scrollRoot.scrollTop
        });
        return toc;
      }

      const maxScrollTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
      if (scrollRoot.scrollTop >= maxScrollTop - 2) break;
      const before = scrollRoot.scrollTop;
      scrollRoot.scrollBy({
        top: Math.max(100, Math.floor(scrollRoot.clientHeight * 0.5)),
        behavior: 'auto'
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      steps += 1;
      if (Math.abs(scrollRoot.scrollTop - before) < 1) stagnantSteps += 1;
      else stagnantSteps = 0;
      if (steps % 20 === 0) {
        logDiagnostic('debug', 'conversation-jump-toc-autopopulate-progress', {
          uap_index: uapIndex,
          steps,
          scroll_top: scrollRoot.scrollTop,
          scroll_height: scrollRoot.scrollHeight,
          target_available: jumpTocIndexControl(uapIndex) instanceof HTMLElement
        });
      }
      if (stagnantSteps >= 5) break;
    }

    toc = jumpTocIndexControl(uapIndex);
    if (!(toc instanceof HTMLElement)) scrollRoot.scrollTo({ top: originalScrollTop, behavior: 'auto' });
    logDiagnostic('debug', 'conversation-jump-toc-autopopulate-complete', {
      uap_index: uapIndex,
      found: toc instanceof HTMLElement,
      steps,
      scroll_top: scrollRoot.scrollTop
    });
    return toc instanceof HTMLElement ? toc : null;
  }

  /**
   * Handles conversation jump to resolved target.
   *
   * @param {EventTarget|null} target - The target element or resolved jump target.
   * @returns {Promise<Object|boolean|string|number|null>} A promise that resolves to the Object|boolean|string|number|null result produced by `jumpToResolvedTarget`.
   */
  async function jumpToResolvedTarget(target) {
    let section = mountedTurnSection(target.message_id, target.role);
    logDiagnostic('debug', 'conversation-jump-materialization-step', {
      message_id: target.message_id,
      role: target.role,
      uap_index: target.uap_index,
      step: 'initial-mounted-check',
      mounted: section instanceof HTMLElement
    });
    if (!(section instanceof HTMLElement)) {
      let toc = jumpTocIndexControl(target.uap_index);
      logDiagnostic('debug', 'conversation-jump-materialization-step', {
        message_id: target.message_id,
        role: target.role,
        uap_index: target.uap_index,
        step: 'toc-index-control-lookup',
        available: toc instanceof HTMLElement
      });
      if (!(toc instanceof HTMLElement)) {
        toc = await populateJumpTocIndex(target.uap_index);
        logDiagnostic('debug', 'conversation-jump-materialization-step', {
          message_id: target.message_id,
          role: target.role,
          uap_index: target.uap_index,
          step: 'toc-index-control-after-autopopulate',
          available: toc instanceof HTMLElement
        });
      }
      assert(toc instanceof HTMLElement,
        `Turn ${target.message_id} is not mounted and the conversation did not expose a UAP index control for ${target.uap_index} after automatic index population.`);
      logDiagnostic('debug', 'conversation-jump-materialization-step', {
        message_id: target.message_id,
        role: target.role,
        uap_index: target.uap_index,
        step: 'toc-index-control-click'
      });
      toc.click();
      if (target.role === 'assistant') {
        const userMessageId = jumpUserRecords(target.spine)[target.uap_index]?.message_id;
        if (userMessageId) {
          const userSection = await waitForJumpTarget({
            uap_index: target.uap_index,
            role: 'user',
            message_id: userMessageId
          }, 6000);
          logDiagnostic('debug', 'conversation-jump-materialization-step', {
            message_id: target.message_id,
            role: target.role,
            uap_index: target.uap_index,
            step: 'assistant-user-anchor-wait',
            user_message_id: userMessageId,
            mounted: userSection instanceof HTMLElement
          });
          userSection?.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
      }
      section = await waitForJumpTarget(target);
      logDiagnostic('debug', 'conversation-jump-materialization-step', {
        message_id: target.message_id,
        role: target.role,
        uap_index: target.uap_index,
        step: 'target-wait-complete',
        mounted: section instanceof HTMLElement
      });
    }
    assert(section instanceof HTMLElement, `${target.role === 'assistant' ? 'Assistant' : 'User'} turn ${target.message_id} did not materialize.`);
    section.scrollIntoView({ block: 'center', behavior: 'smooth' });
    logDiagnostic('debug', 'conversation-jump-materialization-complete', {
      message_id: target.message_id,
      role: target.role,
      uap_index: target.uap_index,
      turn_id: section.getAttribute('data-turn-id') || null,
      data_turn: section.getAttribute('data-turn') || null
    });
    return section;
  }

  /**
   * Handles run jump.
   *
   * @returns {void} No value is returned.
   */
  async function runJump() {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    const requested = window.prompt('Enter a User or Assistant turn_id, or numeric UAP index (0 = first, -1 = last):');
    if (requested === null) return;
    const identifier = requested.trim();
    if (!identifier) {
      setStatus('No User/Assistant turn ID or UAP index was entered.');
      return;
    }
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    logDiagnostic('debug', 'conversation-jump-request', {
      raw_requested_identifier: boundedDiagnosticText(requested, 500),
      identifier,
      conversation_id: conversationId
    });
    jumpInProgress = true;
    updateUi();
    let resolvedTarget = null;
    try {
      setStatus('Resolving Jump target…');
      const fetched = await fetchConversationPages(conversationId);
      const spine = conversationSpineFromPages(fetched.pages);
      const target = resolveJumpIdentifier(spine, identifier);
      resolvedTarget = {
        uap_index: target.uap_index,
        role: target.role,
        message_id: target.message_id
      };
      logDiagnostic('debug', 'conversation-jump-target-resolved', {
        identifier,
        ...resolvedTarget
      });
      target.spine = spine;
      setStatus(`Jumping to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn…`);
      const section = await jumpToResolvedTarget(target);
      if (target.role === 'user') {
        /**
         * Handles target record.
         */
        const targetRecord = spine.records.find(item => item?.message_id === target.message_id)?.message;
        if (targetRecord && userImagePointerCount(targetRecord) > 0) {
          logInternalImagePointerEvidence(targetRecord, section, mountedUserConversationImages(section));
        }
      }
      logDiagnostic('debug', 'conversation-jump-success', {
        identifier,
        ...resolvedTarget
      });
      setStatus(`Jumped to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn ${target.message_id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDiagnostic('warnings', 'conversation-jump-failure', {
        raw_requested_identifier: boundedDiagnosticText(requested, 500),
        identifier,
        conversation_id: conversationId,
        resolved_target: resolvedTarget,
        message
      });
      setStatus(`Jump failed: ${message}`);
    } finally {
      jumpInProgress = false;
      updateUi();
    }
  }

  /**
   * Handles user image pointer count.
   *
   * @param {Object} record - The provider/source record to process.
   * @returns {number} The numeric value produced by `userImagePointerCount`.
   */
  function userImagePointerCount(record) {
    if (record?.author?.role !== 'user' || !Array.isArray(record?.content?.parts)) return 0;
    return record.content.parts.filter(part =>
      part && typeof part === 'object' && part.content_type === 'image_asset_pointer'
    ).length;
  }

  /**
   * Returns mounted user conversation images.
   *
   * @param {HTMLElement} section - The mounted conversation-turn section.
   * @returns {Array<unknown>} The ordered values produced by `mountedUserConversationImages`.
   */
  function mountedUserConversationImages(section) {
    if (!(section instanceof HTMLElement) || section.getAttribute('data-turn') !== 'user') return [];
    const images = [];
    const seen = new Set();
    for (const image of section.querySelectorAll(
      'button[aria-label^="Open image:"] img, [class~="group/message-image"] img'
    )) {
      if (!(image instanceof HTMLImageElement) || seen.has(image)) continue;
      const src = image.currentSrc || image.getAttribute('src') || '';
      if (!src) continue;
      seen.add(image);
      images.push(image);
    }
    return images;
  }

  /**
   * Handles internal image pointer protocol.
   *
   * @param {Object} source - The source value to inspect.
   * @returns {string|null} The string produced by `internalImagePointerProtocol`, or `null` when no value is available.
   */
  function internalImagePointerProtocol(source) {
    const value = String(source ?? '').trim().toLowerCase();
    if (value.startsWith('sandbox://')) return 'sandbox';
    if (value.startsWith('sediment://')) return 'sediment';
    return null;
  }

  /**
   * Handles internal image pointer asset key.
   *
   * @param {Object} source - The source value to inspect.
   * @returns {string} The string produced by `internalImagePointerAssetKey`.
   */
  function internalImagePointerAssetKey(source) {
    const value = String(source ?? '').trim();
    const protocol = internalImagePointerProtocol(value);
    if (!protocol) return '';
    return value
      .replace(/^[a-z]+:\/\//i, '')
      .split(/[?#]/, 1)[0]
      .split('/')
      .filter(Boolean)
      .pop() ?? '';
  }

  /**
   * Handles image pointer DOM candidate.
   *
   * @param {Object} image - The image element to inspect.
   * @param {number} ordinal - The ordinal position to process.
   * @returns {Object|null} The value produced by `imagePointerDomCandidate`, or `null` when no value is available.
   */
  function imagePointerDomCandidate(image, ordinal) {
    if (!(image instanceof HTMLImageElement)) return null;
    const button = image.closest('button');
    const anchor = image.closest('a[href]');
    return {
      ordinal,
      src: image.getAttribute('src') || null,
      current_src: image.currentSrc || null,
      alt: image.getAttribute('alt') || null,
      title: image.getAttribute('title') || null,
      button_aria_label: button?.getAttribute('aria-label') || null,
      anchor_href: anchor?.getAttribute('href') || null
    };
  }

  /**
   * Handles image pointer resource evidence.
   *
   * @param {Object} source - The source value to inspect.
   * @param {Object} domCandidate - The domCandidate value required by this function.
   * @returns {Object} The Object value produced by `imagePointerResourceEvidence`.
   */
  function imagePointerResourceEvidence(source, domCandidate) {
    const assetKey = internalImagePointerAssetKey(source);
    // DOM-derived URLs are exact evidence candidates before broader resource heuristics are tried.
    const exactUrls = new Set([
      domCandidate?.src,
      domCandidate?.current_src,
      domCandidate?.anchor_href
    ].filter(Boolean));
    const exact = [];
    const heuristic = [];
    const entries = performance.getEntriesByType('resource').slice(-500);
    for (const entry of entries) {
      if (!(entry instanceof PerformanceResourceTiming)) continue;
      const name = String(entry.name || '');
      const record = {
        url: name,
        initiator_type: entry.initiatorType || null,
        response_status: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
        transfer_size: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
        decoded_body_size: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null
      };
      if (exactUrls.has(name)) {
        exact.push({ ...record, basis: 'dom-url-match' });
        continue;
      }
      if (assetKey && (name.includes(assetKey) || name.includes(encodeURIComponent(assetKey)))) {
        exact.push({ ...record, basis: 'asset-token-match' });
        continue;
      }
      if (['img', 'fetch', 'xmlhttprequest'].includes(entry.initiatorType) && /(?:image|file|asset|download|backend-api)/i.test(name)) {
        heuristic.push({ ...record, basis: 'recent-image-like-resource' });
      }
    }
    return {
      asset_key: assetKey || null,
      exact: exact.slice(-20),
      heuristic: heuristic.slice(-30)
    };
  }

  /**
   * Logs internal image pointer evidence.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {HTMLElement} section - The mounted conversation-turn section.
   * @param {boolean} candidates - Whether candidates is enabled.
   * @returns {void} No value is returned.
   */
  function logInternalImagePointerEvidence(record, section, candidates) {
    const parts = Array.isArray(record?.content?.parts) ? record.content.parts : [];
    let imageOrdinal = 0;
    for (const part of parts) {
      if (!part || typeof part !== 'object' || part.content_type !== 'image_asset_pointer') continue;
      imageOrdinal += 1;
      const source = cgImagePointerSource(part);
      const protocol = internalImagePointerProtocol(source);
      if (!protocol) continue;
      const image = candidates[imageOrdinal - 1] ?? null;
      const domCandidate = imagePointerDomCandidate(image, imageOrdinal);
      logDiagnostic('debug', 'conversation-image-pointer-resolution-evidence', {
        message_id: record.id ?? null,
        turn_id: section?.getAttribute?.('data-turn-id') ?? null,
        image_ordinal: imageOrdinal,
        pointer_protocol: protocol,
        pointer_source: source,
        dom_match_basis: domCandidate ? 'same-turn-image-ordinal' : null,
        dom_candidate: domCandidate,
        mounted_image_count: candidates.length,
        resource_candidates: imagePointerResourceEvidence(source, domCandidate)
      });
    }
  }

  /**
   * Fetches one conversational image source and converts its bytes to a data URL.
   *
   * @param {string} source - Browser-resolvable image source URL or existing data URL.
   * @param {Object|null} timing - Mutable timing/result object populated without storing image payload data.
   * @returns {Promise<string>} A promise resolving to the image data URL.
   */
  async function fetchImageDataUrl(source, timing = null) {
    const startedAt = performance.now();
    const src = String(source ?? '');
    assert(src, 'Conversational image has no source URL.');
    if (timing) {
      timing.stage = 'source';
      timing.outcome = null;
      timing.source_scheme = null;
      timing.http_status = null;
      timing.fetch_ms = null;
      timing.body_ms = null;
      timing.encode_ms = null;
      timing.blob_bytes = null;
      timing.data_url_chars = null;
      timing.total_ms = null;
      try { timing.source_scheme = new URL(src, location.href).protocol; } catch {}
    }
    if (src.startsWith('data:')) {
      if (timing) {
        timing.stage = 'complete';
        timing.outcome = 'data-url';
        timing.fetch_ms = 0;
        timing.body_ms = 0;
        timing.encode_ms = 0;
        timing.data_url_chars = src.length;
        timing.total_ms = Math.round(performance.now() - startedAt);
      }
      return src;
    }
    try {
      if (timing) timing.stage = 'fetch';
      const response = await fetch(src, { credentials: 'include' });
      const headersAt = performance.now();
      if (timing) {
        timing.fetch_ms = Math.round(headersAt - startedAt);
        timing.http_status = response.status;
      }
      if (!response.ok) {
        const error = new Error(`Conversational image request returned HTTP ${response.status}.`);
        error.httpStatus = response.status;
        if (timing) timing.outcome = 'http-error';
        throw error;
      }
      if (timing) timing.stage = 'body';
      const blob = await response.blob();
      const bodyAt = performance.now();
      if (timing) {
        timing.body_ms = Math.round(bodyAt - headersAt);
        timing.blob_bytes = blob.size;
        timing.stage = 'encode';
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read conversational image blob.'));
        reader.readAsDataURL(blob);
      });
      const finishedAt = performance.now();
      if (timing) {
        timing.encode_ms = Math.round(finishedAt - bodyAt);
        timing.data_url_chars = dataUrl.length;
        timing.total_ms = Math.round(finishedAt - startedAt);
        timing.outcome = 'success';
        timing.stage = 'complete';
      }
      return dataUrl;
    } catch (error) {
      if (timing) {
        timing.total_ms = Math.round(performance.now() - startedAt);
        if (!timing.outcome) timing.outcome = `${timing.stage || 'unknown'}-error`;
      }
      throw error;
    }
  }

  /**
   * Converts a mounted conversation image element to a data URL while optionally recording timing metrics.
   *
   * @param {HTMLImageElement} image - Mounted conversation image element whose current source is recovered.
   * @param {Object|null} timing - Mutable timing/result object populated by `fetchImageDataUrl`.
   * @returns {Promise<string>} A promise resolving to the image data URL.
   */
  async function imageElementDataUrl(image, timing = null) {
    const src = image.currentSrc || image.getAttribute('src') || '';
    return fetchImageDataUrl(src, timing);
  }

  /**
   * Recovers user images while exposing compact per-image and whole-phase timing diagnostics.
   *
   * Existing recovery order and fallback behavior are preserved: images are still
   * recovered serially, mounted DOM candidates are preferred, and provider pointers
   * are used only where the established path already used them.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @returns {Promise<Map<unknown, unknown>>} A promise resolving to recovered image Markdown keyed by source message id.
   */
  async function recoverUserImages(spine) {
    // Recovered image Markdown is keyed by source message id for later canonical enrichment.
    const recovered = new Map();
    const scrollRoot = conversationScrollRoot();
    // Preserve the caller scroll position so image recovery can restore the page exactly.
    const originalScrollTop = scrollRoot.scrollTop;
    /** Exact ordered Conversation API message set used as the single Core adaptation input. */
    const sourceRecords = (spine?.records ?? []).map(item => item?.message).filter(Boolean);
    /** Canonical Core image resources keyed by source record identity and original part index. */
    const canonicalResourcesByRecord = canonicalImageResourcesByRecordAndPart(sourceRecords);
    /** Ordered source records that contain one or more user image pointers. */
    const records = (spine?.records ?? []).filter(record => userImagePointerCount(record?.message) > 0);
    /** Total unique image pointers expected across the source records. */
    const totalImages = records.reduce((total, item) => total + userImagePointerCount(item?.message), 0);
    /** Highest unique image ordinal completed during this recovery phase. */
    let recoveredImages = 0;
    /** Number of mounted-image recovery operations that threw an error. */
    let failedImages = 0;
    /** Number of pointer resolutions that completed with an unavailable/missing outcome. */
    let unavailableImages = 0;
    /** Sum of downloaded Blob byte sizes observed by timed image operations. */
    let totalBlobBytes = 0;
    /** Sum of resulting data-URL character lengths observed by timed image operations. */
    let totalDataUrlChars = 0;
    /** Zero-based count of unique image pointers preceding the current source record. */
    let imageBase = 0;
    /** Monotonic start time for the complete image-recovery phase. */
    const recoveryStartedAt = performance.now();
    /** Whether the whole recovery phase reached the normal loop completion point. */
    let recoveryCompleted = false;

    if (progressState) {
      progressState.stage = 'recovering-images';
      progressState.image_number = 0;
      progressState.image_count = totalImages;
      progressState.image_completed = 0;
      progressState.image_path = null;
      progressState.image_started_at = 0;
    }
    logDiagnostic('debug', 'conversation-image-recovery-start', {
      script_version: VERSION,
      source_message_count: records.length,
      total_images: totalImages,
      diagnostic_log_capacity: MAX_DIAGNOSTIC_LOG_ITEMS
    });
    refreshStatus();

    /**
     * Runs one existing image-recovery operation while recording compact timing/progress state.
     *
     * @param {Function} loader - Async image loader that accepts one mutable timing object.
     * @param {Object} context - Stable source/image correlation fields for the operation.
     * @returns {Promise<string>} A promise resolving to the existing image recovery result.
     */
    const recoverOne = async (loader, context) => {
      /** Mutable timing fields populated by the underlying image loader. */
      const timing = {};
      /** Monotonic start time for this one image recovery operation. */
      const startedAt = performance.now();
      if (progressState) {
        progressState.stage = 'recovering-images';
        progressState.image_number = context.image_number;
        progressState.image_count = totalImages;
        progressState.image_path = context.path;
        progressState.image_started_at = startedAt;
        progressState.image_message_id = context.message_id;
        progressState.image_ordinal = context.image_ordinal;
      }
      refreshStatus();
      logDiagnostic('debug', 'conversation-image-recovery-item-start', {
        script_version: VERSION,
        image_number: context.image_number,
        total_images: totalImages,
        message_id: context.message_id,
        image_ordinal: context.image_ordinal,
        path: context.path
      });
      try {
        const value = await loader(timing);
        const outcome = timing.outcome ?? 'success';
        if (!['success', 'data-url'].includes(outcome)) unavailableImages += 1;
        logDiagnostic('debug', 'conversation-image-recovery-item-complete', {
          script_version: VERSION,
          image_number: context.image_number,
          total_images: totalImages,
          message_id: context.message_id,
          image_ordinal: context.image_ordinal,
          path: context.path,
          outcome,
          source_scheme: timing.source_scheme ?? null,
          resolver_status: timing.resolver_status ?? null,
          resolver_ms: timing.resolver_ms ?? null,
          http_status: timing.http_status ?? null,
          fetch_ms: timing.fetch_ms ?? null,
          body_ms: timing.body_ms ?? null,
          encode_ms: timing.encode_ms ?? null,
          blob_bytes: timing.blob_bytes ?? null,
          data_url_chars: timing.data_url_chars ?? null,
          elapsed_ms: timing.total_ms ?? Math.round(performance.now() - startedAt)
        });
        return value;
      } catch (error) {
        failedImages += 1;
        logDiagnostic('debug', 'conversation-image-recovery-item-failure', {
          script_version: VERSION,
          image_number: context.image_number,
          total_images: totalImages,
          message_id: context.message_id,
          image_ordinal: context.image_ordinal,
          path: context.path,
          outcome: timing.outcome ?? 'error',
          last_stage: timing.stage ?? null,
          source_scheme: timing.source_scheme ?? null,
          resolver_status: timing.resolver_status ?? null,
          resolver_ms: timing.resolver_ms ?? null,
          http_status: (timing.http_status ?? Number(error?.httpStatus)) || null,
          fetch_ms: timing.fetch_ms ?? null,
          body_ms: timing.body_ms ?? null,
          encode_ms: timing.encode_ms ?? null,
          blob_bytes: timing.blob_bytes ?? null,
          data_url_chars: timing.data_url_chars ?? null,
          elapsed_ms: timing.total_ms ?? Math.round(performance.now() - startedAt),
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        if (Number.isFinite(timing.blob_bytes)) totalBlobBytes += timing.blob_bytes;
        if (Number.isFinite(timing.data_url_chars)) totalDataUrlChars += timing.data_url_chars;
        recoveredImages = Math.max(recoveredImages, context.image_number);
        if (progressState) {
          progressState.image_completed = recoveredImages;
          progressState.image_started_at = 0;
        }
        refreshStatus();
      }
    };

    try {
      for (const item of records) {
        const record = item.message;
        /** Provider image-pointer parts expected for this source record. */
        const expectedParts = record.content.parts.filter(part =>
          part && typeof part === 'object' && part.content_type === 'image_asset_pointer'
        );
        /** Number of expected image pointers in this source record. */
        const expected = expectedParts.length;
        /** Existing fallback Markdown for each expected image pointer. */
        const images = expectedParts.map(part => cgImagePointerFallback(part));
        /** Canonical Core image resources keyed by their original provider part index. */
        const canonicalResources = canonicalResourcesByRecord.get(record.id) ?? new Map();
        /** Original provider part index for each image ordinal in this source record. */
        const imagePartIndexes = record.content.parts
          .map((part, partIndex) => ({ part, partIndex }))
          .filter(item => item.part && typeof item.part === 'object' && item.part.content_type === 'image_asset_pointer')
          .map(item => item.partIndex);
        /** Global image-number offset for this source record. */
        const recordImageBase = imageBase;
        const section = mountedTurnSection(record.id, 'user');
        const candidates = section instanceof HTMLElement ? mountedUserConversationImages(section) : [];
        if (section instanceof HTMLElement) logInternalImagePointerEvidence(record, section, candidates);
        for (let index = 0; index < expected; index += 1) {
          const partIndex = imagePartIndexes[index];
          const resource = canonicalResources.get(partIndex) ?? null;
          const sourcePointer = cgImagePointerSource(expectedParts[index]);
          const isSediment = internalImagePointerProtocol(sourcePointer) === 'sediment';
          const hasCanonicalTransport = typeof resource?.download_url === 'string' && resource.download_url.trim();
          const hasCanonicalData = typeof resource?.data_url === 'string' && resource.data_url.startsWith('data:image/');
          if (isSediment && !hasCanonicalTransport && !hasCanonicalData) {
            logDiagnostic('errors', 'conversation-image-core-resource-missing', {
              script_version: VERSION,
              message_id: record.id,
              image_ordinal: index + 1,
              part_index: partIndex,
              resource_present: Boolean(resource),
              source_scheme: 'sediment:'
            });
            throw new Error(
              `AIConversationCore did not provide a download_url or data_url for sediment image ${record.id}:${index + 1}.`
            );
          }
          if (hasCanonicalTransport || hasCanonicalData) {
            images[index] = await recoverOne(
              timing => cgResolveImagePointerMarkdown(expectedParts[index], resource, record.id, index + 1, timing),
              {
                image_number: recordImageBase + index + 1,
                message_id: record.id,
                image_ordinal: index + 1,
                path: hasCanonicalData ? 'core-data' : 'core-download'
              }
            );
            continue;
          }
          if (candidates[index] instanceof HTMLImageElement) {
            try {
              const dataUrl = await recoverOne(
                timing => imageElementDataUrl(candidates[index], timing),
                {
                  image_number: recordImageBase + index + 1,
                  message_id: record.id,
                  image_ordinal: index + 1,
                  path: 'dom'
                }
              );
              if (dataUrl) images[index] = `![image-${record.id}-${index + 1}](${dataUrl})`;
              continue;
            } catch (error) {
              const status = Number(error?.httpStatus);
              const source = candidates[index]?.currentSrc || candidates[index]?.getAttribute('src') ||
                cgImagePointerSource(expectedParts[index]);
              images[index] = cgImageFailureMarkdown(source, status);
              logDiagnostic('warnings', 'conversation-image-recovery-failure', {
                message_id: record.id,
                image_ordinal: index + 1,
                http_status: Number.isFinite(status) ? status : null,
                fallback: images[index],
                message: error instanceof Error ? error.message : String(error)
              });
              continue;
            }
          }
          images[index] = await recoverOne(
            timing => cgResolveImagePointerMarkdown(expectedParts[index], resource, record.id, index + 1, timing),
            {
              image_number: recordImageBase + index + 1,
              message_id: record.id,
              image_ordinal: index + 1,
              path: 'pointer'
            }
          );
        }
        recovered.set(record.id, images);
        imageBase += expected;
        recoveredImages = Math.max(recoveredImages, imageBase);
        if (progressState) progressState.image_completed = recoveredImages;
        refreshStatus();
      }
      recoveryCompleted = true;
    } finally {
      scrollRoot.scrollTop = originalScrollTop;
      logDiagnostic('debug', 'conversation-image-recovery-complete', {
        script_version: VERSION,
        outcome: recoveryCompleted ? 'complete' : 'aborted',
        source_message_count: records.length,
        total_images: totalImages,
        completed_images: recoveredImages,
        failed_images: failedImages,
        unavailable_images: unavailableImages,
        blob_bytes: totalBlobBytes,
        data_url_chars: totalDataUrlChars,
        elapsed_ms: Math.round(performance.now() - recoveryStartedAt)
      });
    }
    return recovered;
  }

  /**
   * Runs one requested Conversation API export from acquisition through optional image recovery, rendering/serialization, download, status, and failure diagnostics.
   *
   * @param {Object} kind - The export kind to execute.
   * @returns {void} No value is returned.
   */
  async function runExport(kind) {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    exportInProgress = true;
    exportKind = kind;
    progressState = {
      started_at: performance.now(),
      stage: 'fetching',
      page_count: 0,
      raw_record_count: 0,
      record_number: 0,
      record_count: 0,
      render_started_at: 0
    };
    startStatusTimer();
    updateUi();
    await acquireWakeLock();
    try {
      /**
       * Fetches ed.
       */
      const fetched = await fetchConversationPages(conversationId, progress => {
        progressState.stage = 'fetching';
        progressState.page_count = progress.page_count;
        progressState.raw_record_count = progress.raw_record_count;
        progressState.fetch_page_number = progress.page_number;
        progressState.fetch_page_started_at = progress.page_started_at;
        refreshStatus();
      });
      const spine = conversationSpineFromPages(fetched.pages);
      if (kind === 'jsonl') {
        const filename = `${sanitizeFileName(conversationTitle())}.jsonl`;
        downloadBlob(
          new Blob([apiRecordsJsonl(spine)], { type: 'application/x-ndjson;charset=utf-8' }),
          filename
        );
        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);
      } else {
        progressState.stage = 'recovering-images';
        const recoveredImageMap = await recoverUserImages(spine);
        progressState.stage = 'rendering';
        progressState.render_started_at = performance.now();
        progressState.record_number = 0;
        progressState.record_count = spine.records.length;
        refreshStatus();
        // Yield once so the completed image state is painted before synchronous rendering begins.
        await new Promise(resolve => setTimeout(resolve, 0));
        /**
         * Handles markdown.
         */
        /** Monotonic start time for synchronous Markdown rendering/final assembly. */
        const renderStartedAt = performance.now();
        logDiagnostic('debug', 'conversation-export-phase-start', {
          phase: 'markdown-render',
          source_record_count: spine.records.length
        });
        const markdown = renderConversationMarkdown(spine, progress => {
          progressState.stage = 'rendering';
          progressState.record_number = progress.record_number;
          progressState.record_count = progress.record_count;
          refreshStatus();
        }, recoveredImageMap);
        const filename = `${sanitizeFileName(conversationTitle())}.md`;
        logDiagnostic('debug', 'conversation-export-phase-complete', {
          phase: 'markdown-render',
          elapsed_ms: Math.round(performance.now() - renderStartedAt),
          markdown_length: markdown.length
        });
        if (diagnosticEnabled('debug')) {
          const sourceTail = spine.records.slice(-32).map(item => ({
            source_record_id: item?.message_id ?? item?.message?.id ?? null,
            source_role: item?.role ?? item?.message?.author?.role ?? null,
            source_channel: item?.channel ?? item?.message?.channel ?? null,
            source_content_type: item?.content_type ?? item?.message?.content?.content_type ?? null
          }));
          logDiagnostic('debug', 'conversation-export-markdown-ready', {
            filename,
            source_record_count: spine.records.length,
            source_tail: sourceTail,
            markdown_length: markdown.length
          });
        }
        const blobStartedAt = performance.now();
        logDiagnostic('debug', 'conversation-export-phase-start', {
          phase: 'blob-create',
          markdown_length: markdown.length
        });
        const markdownBlob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        logDiagnostic('debug', 'conversation-export-phase-complete', {
          phase: 'blob-create',
          elapsed_ms: Math.round(performance.now() - blobStartedAt),
          blob_size: markdownBlob.size
        });
        if (diagnosticEnabled('debug')) {
          logDiagnostic('debug', 'conversation-export-blob-created', {
            filename,
            markdown_length: markdown.length,
            blob_size: markdownBlob.size,
            blob_type: markdownBlob.type
          });
        }
        const downloadStartedAt = performance.now();
        logDiagnostic('debug', 'conversation-export-phase-start', {
          phase: 'download-trigger',
          blob_size: markdownBlob.size
        });
        downloadBlob(markdownBlob, filename);
        logDiagnostic('debug', 'conversation-export-phase-complete', {
          phase: 'download-trigger',
          elapsed_ms: Math.round(performance.now() - downloadStartedAt),
          blob_size: markdownBlob.size
        });
        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDiagnostic('errors', 'conversation-export-failure', {
        kind,
        stage: progressState?.stage ?? null,
        record_number: progressState?.record_number ?? null,
        record_count: progressState?.record_count ?? null,
        message
      });
      setStatus(
        `${kind === 'md' ? 'Markdown' : 'JSONL'} extraction failed: ${message}`
      );
    } finally {
      progressState = null;
      exportInProgress = false;
      exportKind = null;
      stopStatusTimer();
      await releaseWakeLock();
      updateUi();
      refreshStatus();
    }
  }

  /**
   * Tests API pagination logic.
   *
   * @returns {void} No value is returned.
   */
  async function testApiPaginationLogic() {
    const calls = [];
    const pagesByCursor = new Map([
      [null, {
        messages: [{ id: 'newest' }],
        page_info: { has_next_page: false, has_previous_page: true, start_cursor: 'cursor-2' }
      }],
      ['cursor-2', {
        messages: [{ id: 'middle' }],
        page_info: { has_next_page: true, has_previous_page: true, start_cursor: 'cursor-3' }
      }],
      ['cursor-3', {
        messages: [{ id: 'oldest' }],
        page_info: { has_next_page: true, has_previous_page: false, start_cursor: null }
      }]
    ]);
    /**
     * Collects ed.
     */
    const collected = await collectConversationPages(async cursor => {
      calls.push(cursor);
      assert(pagesByCursor.has(cursor), `Unexpected test cursor ${cursor}.`);
      return pagesByCursor.get(cursor);
    });
    assert(collected.pages.length === 3, 'Pagination test did not collect all three pages.');
    assert(calls.length === 3, 'Pagination test fetched a page more than once.');
    assert(calls[0] === null && calls[1] === 'cursor-2' && calls[2] === 'cursor-3',
      'Pagination test followed cursors in the wrong order.');

    let repeatedCursorRejected = false;
    try {
      await collectConversationPages(async cursor => ({
        messages: [{ id: String(cursor ?? 'first') }],
        page_info: { has_next_page: cursor !== null, has_previous_page: true, start_cursor: 'loop' }
      }));
    } catch (error) {
      repeatedCursorRejected = /repeated start_cursor/.test(String(error?.message ?? error));
    }
    assert(repeatedCursorRejected, 'Pagination test did not reject a repeated cursor.');
  }

  /**
   * Tests stable message ids.
   *
   * @returns {void} No value is returned.
   */
  function testStableMessageIds() {
    const pages = [
      { messages: [{ id: 'b', marker: 'new-b' }, { id: 'c' }], page_info: {} },
      { messages: [{ id: 'a' }, { id: 'b', marker: 'old-b' }], page_info: {} }
    ];
    const spine = conversationSpineFromPages(pages);
    assert(spine.messages.length === 3, 'Stable-ID test did not deduplicate overlapping pages.');
    assert(spine.messages.map(message => message.id).join(',') === 'a,b,c',
      'Stable-ID test did not preserve oldest-to-newest order.');
    assert(spine.messages.find(message => message.id === 'b')?.marker === 'new-b',
      'Stable-ID test did not retain the newer duplicate record.');

    let missingIdRejected = false;
    try {
      conversationSpineFromPages([{ messages: [{}], page_info: {} }]);
    } catch (error) {
      missingIdRejected = /missing a stable id/.test(String(error?.message ?? error));
    }
    assert(missingIdRejected, 'Stable-ID test did not reject a message without an id.');
  }

  /**
   * Tests conversation API access and schema.
   *
   * @returns {void} No value is returned.
   */
  async function testConversationApiAccessAndSchema() {
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    const data = await fetchOneConversationPage(
      pageUrl(conversationId),
      'Conversation API test request',
      { page_number: 1, request_kind: 'test', cursor: null, previous_page_info: null }
    );
    assert(conversationSchemaOk(data), 'Conversation API test response schema is unsupported.');
    for (const message of data.messages) {
      assert(typeof message?.id === 'string' && message.id.length > 0,
        'Conversation API test page contains a message without a stable id.');
    }
  }

  /**
   * Tests multimodal user and chronological order.
   *
   * @returns {void} No value is returned.
   */
  async function testMultimodalUserAndChronologicalOrder() {
    /**
     * Handles record.
     *
     * @param {string} id - The id value required by this function.
     * @param {Object} role - The message role to match.
     * @param {string} contentType - The contentType value required by this function.
     * @param {Array<unknown>} parts - The ordered parts values to process.
     * @returns {void} No value is returned.
     */
    const record = (id, role, contentType, parts) => ({
      id,
      author: { role },
      content: { content_type: contentType, parts },
      metadata: {}
    });
    const spine = {
      records: [
        { ordinal: 0, message: record('u1', 'user', 'multimodal_text', [
          { content_type: 'image_asset_pointer', asset_pointer: 'sediment://fixture-image' },
          { content_type: 'image_asset_pointer' },
          'First User'
        ]) },
        { ordinal: 1, message: record('a1', 'assistant', 'text', ['First Assistant']) },
        { ordinal: 2, message: record('u2', 'user', 'text', ['Second User']) },
        { ordinal: 3, message: record('a2', 'assistant', 'text', ['Second Assistant']) }
      ]
    };
    const fallbackMarkdown = renderConversationMarkdown(spine);
    const unavailableToken = '[image not available](sediment://fixture-image)';
    const missingToken = '[image missing]';
    assert(fallbackMarkdown.includes(unavailableToken), 'protected image pointer did not render as linked image-not-available.');
    assert(fallbackMarkdown.includes(missingToken), 'image pointer without a source did not render as image missing.');
    assert(fallbackMarkdown.indexOf(unavailableToken) < fallbackMarkdown.indexOf(missingToken) &&
      fallbackMarkdown.indexOf(missingToken) < fallbackMarkdown.indexOf('First User'),
      'image placeholders did not preserve source order before adjacent User text.');
    assert(cgImageFailureMarkdown('https://example.test/missing.png', 404) === '[image missing]',
      'HTTP 404 image was not classified as missing.');
    assert(cgImageFailureMarkdown('https://example.test/private.png', 403) ===
      '[image not available](https://example.test/private.png)',
      'HTTP 403 image was not classified as linked image-not-available.');
    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';
    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken, missingToken]]]));
    assert(markdown.includes('First User'), 'multimodal_text User content was not rendered.');
    assert(markdown.includes(recoveredToken), 'recovered multimodal image was not rendered at its API image pointer.');
    assert(markdown.indexOf(recoveredToken) < markdown.indexOf(missingToken) &&
      markdown.indexOf(missingToken) < markdown.indexOf('First User'),
      'recovered/missing image tokens did not remain in source order.');
    const u1 = markdown.indexOf('<!-- turn_id=u1 -->');
    const a1 = markdown.indexOf('<!-- turn_id=a1 -->');
    const u2 = markdown.indexOf('<!-- turn_id=u2 -->');
    const a2 = markdown.indexOf('<!-- turn_id=a2 -->');
    assert(u1 >= 0 && a1 >= 0 && u2 >= 0 && a2 >= 0,
      'chronological rendering test did not emit all expected headings.');
    assert(u1 < a1 && a1 < u2 && u2 < a2,
      'Conversation API Markdown rendering did not preserve chronological record order.');
}

  /**
   * Tests renderer parity features.
   *
   * @returns {void} No value is returned.
   */
  function testRendererParityFeatures() {
    const fileToken = `${CG_INLINE_TOKEN_START}filecite${CG_INLINE_TOKEN_SEP}turn7file2${CG_INLINE_TOKEN_SEP}L1-L2${CG_INLINE_TOKEN_END}`;
    const citeToken = `${CG_INLINE_TOKEN_START}cite${CG_INLINE_TOKEN_SEP}web${CG_INLINE_TOKEN_END}`;
    const memoryToken = `${CG_INLINE_TOKEN_START}memcite${CG_INLINE_TOKEN_END}`;
    const records = [
      { id: 'file-meta', author: { role: 'tool' }, content: { content_type: 'text', parts: [] }, metadata: { is_visually_hidden_from_conversation: true, retrieval_turn_number: 7, retrieval_file_index: 2, citation_metadata: { title: 'notes.txt', url: 'https://example.com/notes.txt' } } },
      { id: 'u1', author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: ['Question', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://image' }] }, metadata: {} },
      { id: 'tool1', author: { role: 'tool', name: 'tether_browsing_display' }, content: { content_type: 'tether_browsing_display', summary: 'Waiting for sources.' }, metadata: {} },
      { id: 'a1', author: { role: 'assistant' }, channel: 'final', content: { content_type: 'multimodal_text', parts: [`File ${fileToken}\n\nWeb ${citeToken}\n\nMemory ${memoryToken}`] }, metadata: { content_references: [ { type: 'hidden', matched_text: fileToken }, { type: 'grouped_webpages', matched_text: citeToken, items: [{ url: 'https://example.com/web', attribution: 'Example', title: 'Example source' }] }, { type: 'hidden', matched_text: memoryToken } ], conversation_context_citation_metadata: [{ citation: { url: 'https://example.com/memory', title: 'Prior note' } }] } }
    ];
    /**
     * Handles spine.
     */
    const spine = { records: records.map((message, ordinal) => ({ ordinal, message })) };
    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';
    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken]]]));
    assert(markdown.includes(recoveredToken), 'recovered image_asset_pointer was not rendered.');
    assert(markdown.indexOf(recoveredToken) < markdown.indexOf('Question'),
      'recovered image_asset_pointer did not preserve its position before User text.');
    assert(markdown.includes('<a href="https://example.com/notes.txt">notes.txt L1-L2</a>'), 'hidden file citation was not resolved to its link.');
    assert(markdown.includes('**(cite:'), 'web citation was not rendered.');
    assert(markdown.includes('**(memory:'), 'memory citation was not rendered.');
    assert(markdown.includes('Waiting for sources.'), 'tether browsing content was not preserved.');
    assert(!markdown.includes(CG_INLINE_TOKEN_START), 'raw ChatGPT inline reference tokens leaked into Markdown.');
  }

  /**
   * Tests jump identifier resolution.
   *
   * @returns {void} No value is returned.
   */
  function testJumpIdentifierResolution() {
    const records = [
      { ordinal: 0, message_id: 'u1', role: 'user' },
      { ordinal: 1, message_id: 'a1', role: 'assistant' },
      { ordinal: 2, message_id: 'u2', role: 'user' },
      { ordinal: 3, message_id: 'a2', role: 'assistant' },
      { ordinal: 4, message_id: 'u3', role: 'user' },
      { ordinal: 5, message_id: 'a3', role: 'assistant' }
    ];
    const spine = { records };
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
      ['API pagination', testApiPaginationLogic],
      ['Stable API message IDs', testStableMessageIds],
      ['Multimodal User + chronological order', testMultimodalUserAndChronologicalOrder],
      ['AI-transcript renderer parity', testRendererParityFeatures],
      ['Generated sandbox download link', testGeneratedSandboxDownloadLink],
      ['Jump identifier resolution', testJumpIdentifierResolution],
      ['Conversation API access/schema', testConversationApiAccessAndSchema]
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
      return new Map(Object.entries(parsed).filter(([, value]) => value === 'PASS' || value === 'FAIL'));
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
    return result?.status || '—';
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
      await fn();
      testMatrixCurrentResults.set(name, { status: 'PASS', detail: '' });
      return `✅ ${name}`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
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
        return result.status === 'PASS' ? `✅ ${name}` : `❌ ${name}: ${result.detail}`;
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
      for (const [name, fn] of builtInTests()) {
        await executeBuiltInTest(name, fn);
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
   * @param {Object} options2.null - The null value required by this function.
   * @param {Object} options2.opener - The element that opened the modal.
   * @param {Object} options2.null - The null value required by this function.
   * @returns {void} No value is returned.
   */
  function installModalContract(overlay, { defaultButton = null, onClose = null, opener = null } = {}) {
    lastModalOpener = opener instanceof HTMLElement ? opener : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = overlay.querySelector('[role="dialog"]');
    if (!(dialog instanceof HTMLElement)) return;
    /**
     * Handles focusables.
     *
     * @returns {void} No value is returned.
     */
    const focusables = () => modalFocusableElements(dialog);
    /**
     * Handles close.
     *
     * @returns {void} No value is returned.
     */
    const close = () => {
      if (typeof onClose === 'function') onClose();
      const restore = lastModalOpener;
      lastModalOpener = null;
      if (restore?.isConnected) restore.focus({ preventScroll: true });
    };
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (testInProgress) return;
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab') {
        const items = focusables();
        if (!items.length) {
          event.preventDefault();
          return;
        }
        const current = document.activeElement;
        const index = items.indexOf(current);
        const next = event.shiftKey
          ? (index <= 0 ? items.length - 1 : index - 1)
          : (index < 0 || index === items.length - 1 ? 0 : index + 1);
        event.preventDefault();
        items[next].focus();
        return;
      }
      if (event.key === 'Enter') {
        if (document.activeElement instanceof HTMLTextAreaElement) return;
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement) return;
        const button = typeof defaultButton === 'function' ? defaultButton() : defaultButton;
        if (button instanceof HTMLButtonElement && !button.disabled) {
          event.preventDefault();
          button.click();
        }
      }
    });
    const initial = typeof defaultButton === 'function' ? defaultButton() : defaultButton;
    (initial instanceof HTMLElement ? initial : focusables()[0])?.focus({ preventScroll: true });
  }

  /**
   * Closes test matrix.
   *
   * @returns {void} No value is returned.
   */
  function closeTestMatrix() {
    document.getElementById(TEST_MATRIX_ID)?.remove();
  }

  /**
   * Opens test matrix.
   *
   * @param {Object|null} opener - The element that opened the modal.
   * @returns {void} No value is returned.
   */
  function openTestMatrix(opener = null) {
    if (document.getElementById(TEST_MATRIX_ID)) return;
    testMatrixPreviousResults = loadTestResultHistory();
    testMatrixCurrentResults = new Map();
    const tests = builtInTests();
    const overlay = document.createElement('div');
    overlay.id = TEST_MATRIX_ID;
    overlay.innerHTML = `
      <div class="tm-test-dialog" role="dialog" aria-modal="true" aria-labelledby="${TEST_MATRIX_ID}-title">
        <div class="tm-test-dialog-head">
          <strong id="${TEST_MATRIX_ID}-title">Built-in tests</strong>
          <button type="button" data-role="close-test-matrix" aria-label="Close tests">×</button>
        </div>
        <div class="tm-test-table-wrap">
          <table class="tm-test-table">
            <thead><tr><th>Test</th><th>Type</th><th>Previous Result</th><th>Current Result</th><th></th></tr></thead>
            <tbody>
              ${tests.map(([name]) => `
                <tr data-test-name="${escapeHtmlAttribute(name)}">
                  <td>${escapeHtmlText(name)}</td>
                  <td>Automatic</td>
                  <td data-role="previous-result">—</td>
                  <td data-role="current-result">—</td>
                  <td><button type="button" data-role="run-test">Run</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="tm-test-actions">
          <button type="button" data-role="run-all-tests">Run All</button>
          <button type="button" data-role="close-test-matrix">Close</button>
        </div>
      </div>`;
    overlay.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target === overlay || target.closest('[data-role="close-test-matrix"]')) {
        if (!testInProgress) { closeTestMatrix(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }
        return;
      }
      const row = target.closest('tr[data-test-name]');
      if (target.closest('[data-role="run-test"]') && row) {
        const name = row.getAttribute('data-test-name');
        /**
         * Handles test.
         */
        const test = tests.find(([candidate]) => candidate === name);
        if (test) void runOneTest(test[0], test[1]);
        return;
      }
      if (target.closest('[data-role="run-all-tests"]')) void runTests();
    });
    document.body.append(overlay);
    refreshTestMatrix();
    installModalContract(overlay, {
      defaultButton: () => overlay.querySelector('[data-role="run-all-tests"]'),
      onClose: closeTestMatrix,
      opener
    });
  }

  /**
   * Handles diagnostic enabled.
   *
   * @param {Object} level - The diagnostics severity level.
   * @returns {boolean} `true` when `diagnosticEnabled` succeeds or its predicate is satisfied; otherwise `false`.
   */
  function diagnosticEnabled(level) {
    return (DIAGNOSTIC_LEVELS[level] ?? 0) <= (DIAGNOSTIC_LEVELS[diagnosticsLevel] ?? 0);
  }

  /**
   * Persists the bounded tail of the diagnostic log to session storage.
   *
   * The larger in-memory capacity is retained for same-page live captures, while the
   * persisted tail is separately bounded to avoid making every browser session write
   * proportional to the full instrumentation history.
   *
   * @returns {void} No value is returned.
   */
  function persistDiagnosticLog() {
    try {
      sessionStorage.setItem(
        DIAGNOSTIC_LOG_STORAGE_KEY,
        JSON.stringify(diagnosticLog.slice(-MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS))
      );
    } catch {}
  }

  /**
   * Schedules a bounded diagnostic-log persistence write.
   *
   * @returns {void} No value is returned.
   */
  function schedulePersistDiagnosticLog() {
    if (diagnosticPersistTimer !== null) return;
    diagnosticPersistTimer = setTimeout(() => {
      diagnosticPersistTimer = null;
      persistDiagnosticLog();
    }, DIAGNOSTIC_PERSIST_DELAY_MS);
  }

  /**
   * Handles diagnostic log line.
   *
   * @param {Object} entry - The diagnostics entry to format.
   * @returns {string} The string produced by `diagnosticLogLine`.
   */
  function diagnosticLogLine(entry) {
    const suffix = entry.data === null || entry.data === undefined
      ? ''
      : ` ${JSON.stringify(entry.data)}`;
    return `${entry.timestamp} [${entry.level}] ${entry.message}${suffix}`;
  }

  /**
   * Handles copy icon markup.
   *
   * @returns {string} The string produced by `copyIconMarkup`.
   */
  function copyIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M15 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';
  }

  /**
   * Handles check icon markup.
   *
   * @returns {string} The string produced by `checkIconMarkup`.
   */
  function checkIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4 4L19 7"></path></svg>';
  }

  /**
   * Refreshes diagnostic log.
   *
   * Collapsed logs update only their count and controls. Thousands of hidden row
   * elements are not rebuilt on every diagnostic event during an instrumented export.
   *
   * @returns {void} No value is returned.
   */
  function refreshDiagnosticLog() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const count = panel.querySelector('[data-role="log-count"]');
    const output = panel.querySelector('[data-role="log-output"]');
    const toggle = panel.querySelector('[data-role="toggle-log"]');
    if (count) count.textContent = `Log: ${diagnosticLog.length} item${diagnosticLog.length === 1 ? '' : 's'}`;
    if (output && diagnosticLogExpanded) {
      output.replaceChildren(...diagnosticLog.map(entry => {
        const row = document.createElement('div');
        row.className = 'tm-log-row';
        row.textContent = diagnosticLogLine(entry);
        return row;
      }));
      output.scrollTop = output.scrollHeight;
    }
    if (output) output.hidden = !diagnosticLogExpanded;
    if (toggle instanceof HTMLButtonElement) {
      toggle.textContent = diagnosticLogExpanded ? '−' : '+';
      toggle.setAttribute('aria-expanded', String(diagnosticLogExpanded));
      toggle.setAttribute('aria-label', diagnosticLogExpanded ? 'Hide diagnostic log' : 'Show diagnostic log');
      toggle.title = diagnosticLogExpanded ? 'Hide log' : 'Show log';
    }
  }

  /**
   * Handles copy diagnostic log.
   *
   * @returns {void} No value is returned.
   */
  async function copyDiagnosticLog() {
    const text = diagnosticLog.map(diagnosticLogLine).join('\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    const button = document.querySelector(`#${PANEL_ID} [data-role="copy-log"]`);
    if (!(button instanceof HTMLButtonElement)) return;
    button.innerHTML = checkIconMarkup();
    button.classList.add('tm-copy-confirmed');
    button.setAttribute('aria-label', 'Copied');
    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.add('tm-copy-fade');
      setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove('tm-copy-confirmed');
        button.innerHTML = copyIconMarkup();
        button.setAttribute('aria-label', 'Copy diagnostic log');
        requestAnimationFrame(() => button.classList.remove('tm-copy-fade'));
      }, 200);
    }, 800);
  }

  /**
   * Redacts transient signed URL tokens from diagnostic payloads without mutating callers.
   *
   * @param {Object} value - The diagnostic value to sanitize.
   * @returns {Object} The sanitized diagnostic value.
   */
  function redactDiagnosticSignedTokens(value) {
    if (typeof value === 'string') {
      return value.replace(/([?&](?:sig|signature)=)[^&#\s]*/gi, '$1[redacted]');
    }
    if (Array.isArray(value)) return value.map(redactDiagnosticSignedTokens);
    if (value && typeof value === 'object' &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redactDiagnosticSignedTokens(item)])
      );
    }
    return value;
  }

  /**
   * Logs diagnostic.
   *
   * @param {Object} level - The diagnostics severity level.
   * @param {string} message - The assertion failure message.
   * @param {Object|null} data - The data value required by this function.
   * @returns {void} No value is returned.
   */
  function logDiagnostic(level, message, data = null) {
    if (!diagnosticEnabled(level)) return;
    const safeData = redactDiagnosticSignedTokens(data);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: safeData
    };
    diagnosticLog.push(entry);
    if (diagnosticLog.length > MAX_DIAGNOSTIC_LOG_ITEMS) {
      diagnosticLog.splice(0, diagnosticLog.length - MAX_DIAGNOSTIC_LOG_ITEMS);
    }
    schedulePersistDiagnosticLog();
    refreshDiagnosticLog();

    const args = [`[ChatGPT Recorder ${level}] ${message}`];
    if (safeData !== null) args.push(safeData);
    (level === 'errors' ? console.error : level === 'warnings' ? console.warn : console.log)(...args);
  }

  /**
   * Handles inject styles.
   *
   * @returns {void} No value is returned.
   */
  function injectStyles() {
    if (document.getElementById(`${PANEL_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${PANEL_ID}-style`;
    style.textContent = `
      #${LAUNCHER_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:36px;height:32px;box-sizing:border-box;border:1px solid #777;border-radius:9px;background:#242424;color:#fff;padding:0;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.35);cursor:pointer}
      #${LAUNCHER_ID}::before{content:'';width:16px;height:16px;border-radius:50%;background:#d0d0d0;display:block}
      #${PANEL_ID}{position:fixed;right:16px;bottom:54px;z-index:2147483647;width:300px;box-sizing:border-box;padding:12px;border:1px solid rgba(127,127,127,.55);border-radius:12px;background:rgba(24,24,24,.97);color:#f2f2f2;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px/1.35 system-ui,sans-serif}
      #${PANEL_ID} .tm-title{font-size:16px;margin:0 28px 8px 0}
      #${PANEL_ID} .tm-close{position:absolute;right:9px;top:7px;border:0;background:transparent;color:#fff;font-size:24px;cursor:pointer}
      #${PANEL_ID} .tm-status{white-space:pre-wrap;margin:10px 0 12px;min-height:24px}
      #${PANEL_ID} .tm-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
      #${PANEL_ID} select,#${PANEL_ID} button{border:1px solid #666;border-radius:9px;background:#292929;color:#fff;padding:9px 12px;font:inherit}
      #${PANEL_ID} select{flex:1;min-width:150px}
      #${PANEL_ID} button{cursor:pointer}
      #${PANEL_ID} button:disabled{opacity:.45;cursor:not-allowed}
      #${PANEL_ID} .tm-label{color:#ddd}
      #${TEST_MATRIX_ID}{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:24px;box-sizing:border-box}
      #${TEST_MATRIX_ID} .tm-test-dialog{width:min(920px,96vw);max-height:88vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid #666;border-radius:12px;background:#202020;color:#f2f2f2;box-shadow:0 10px 40px rgba(0,0,0,.5);font:13px/1.35 system-ui,sans-serif}
      #${TEST_MATRIX_ID} .tm-test-dialog-head,#${TEST_MATRIX_ID} .tm-test-actions{display:flex;align-items:center;gap:10px;padding:10px 12px}
      #${TEST_MATRIX_ID} .tm-test-dialog-head{justify-content:space-between;border-bottom:1px solid #555}
      #${TEST_MATRIX_ID} .tm-test-dialog-head strong{font-size:16px}
      #${TEST_MATRIX_ID} .tm-test-table-wrap{overflow:auto}
      #${TEST_MATRIX_ID} .tm-test-table{width:100%;border-collapse:collapse}
      #${TEST_MATRIX_ID} .tm-test-table th,#${TEST_MATRIX_ID} .tm-test-table td{padding:8px 10px;border-bottom:1px solid #444;text-align:left;vertical-align:top}
      #${TEST_MATRIX_ID} .tm-test-table th{position:sticky;top:0;background:#292929;z-index:1}
      #${TEST_MATRIX_ID} .tm-test-table td:nth-child(2),#${TEST_MATRIX_ID} .tm-test-table td:nth-child(3),#${TEST_MATRIX_ID} .tm-test-table td:nth-child(4){white-space:nowrap}
      #${TEST_MATRIX_ID} button{border:1px solid #666;border-radius:8px;background:#292929;color:#fff;padding:7px 10px;font:inherit;cursor:pointer}
      #${TEST_MATRIX_ID} button:disabled{opacity:.45;cursor:not-allowed}
      #${TEST_MATRIX_ID} .tm-test-actions{justify-content:flex-end;border-top:1px solid #555}
      #${PANEL_ID} .tm-log-head{display:flex;align-items:center;gap:6px;margin-top:4px}
      #${PANEL_ID} .tm-log-head [data-role="log-count"]{margin-right:auto}
      #${PANEL_ID} .tm-icon-button{width:30px;height:28px;padding:4px;display:grid;place-items:center}
      #${PANEL_ID} .tm-icon-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      #${PANEL_ID} .tm-icon-button{transition:opacity .2s ease}
      #${PANEL_ID} .tm-copy-fade{opacity:0}
      #${PANEL_ID} .tm-log-output{margin:6px 0 10px;max-height:190px;overflow:auto;border:1px solid #555;border-radius:8px;background:#111;font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;color:#ddd}
      #${PANEL_ID} .tm-log-row{padding:6px 8px;white-space:pre-wrap;overflow-wrap:anywhere}
      #${PANEL_ID} .tm-log-row:nth-child(even){background:rgba(255,255,255,.055)}
      #${PANEL_ID} .tm-switch{margin-left:auto;width:42px;height:24px;padding:2px;border-radius:999px;position:relative}
      #${PANEL_ID} .tm-switch-thumb{display:block;width:18px;height:18px;border-radius:50%;background:#aaa;transform:translateX(0);transition:transform .16s ease,background .16s ease}
      #${PANEL_ID} .tm-switch[aria-checked="true"] .tm-switch-thumb{transform:translateX(16px);background:#fff}
      #${PANEL_ID} .tm-extract-formats{display:grid;grid-template-columns:auto auto auto;gap:6px 12px;align-items:center}
      #${PANEL_ID} .tm-extract-formats label{display:flex;gap:5px;align-items:center}
    `;
    (document.head || document.documentElement).append(style);
  }

  /**
   * Updates UI.
   *
   * @returns {void} No value is returned.
   */
  function updateUi() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const title = panel.querySelector('[data-role="title"]');
    if (title) title.textContent = `ChatGPT Recorder v${VERSION}`;
    const extract = panel.querySelector('[data-role="extract"]');
    const jsonl = panel.querySelector('[data-role="format-jsonl"]');
    const md = panel.querySelector('[data-role="format-md"]');
    const timestamps = panel.querySelector('[data-role="show-timestamps"]');
    const recordNumbers = panel.querySelector('[data-role="show-record-numbers"]');
    const turnIds = panel.querySelector('[data-role="show-turn-ids"]');
    const test = panel.querySelector('[data-role="test"]');
    const jump = panel.querySelector('[data-role="jump"]');
    const formatsSelected = Boolean(jsonl?.checked || md?.checked);
    if (extract) {
      extract.disabled = exportInProgress || testInProgress || jumpInProgress || !formatsSelected;
      extract.textContent = exportInProgress ? 'Extracting…' : 'Extract';
    }
    if (jsonl) jsonl.disabled = exportInProgress || testInProgress || jumpInProgress;
    if (md) md.disabled = exportInProgress || testInProgress || jumpInProgress;
    const metadataDisabled = exportInProgress || testInProgress || jumpInProgress || !md?.checked;
    if (timestamps) timestamps.disabled = metadataDisabled;
    if (recordNumbers) recordNumbers.disabled = metadataDisabled;
    if (turnIds) turnIds.disabled = metadataDisabled;
    if (test) {
      test.disabled = exportInProgress || testInProgress || jumpInProgress;
      test.textContent = testInProgress ? 'Testing…' : 'Test';
    }
    if (jump) {
      jump.disabled = exportInProgress || testInProgress || jumpInProgress;
      jump.textContent = jumpInProgress ? 'Jumping…' : 'Jump';
    }
    const screen = panel.querySelector('[data-role="screen-on"]');
    if (screen) screen.setAttribute('aria-checked', String(screenOnWhenCapturing));
    refreshStatus();
  }

  /**
   * Summarizes one DOM node for launcher-lifecycle console diagnostics.
   *
   * @param {Node|null} node - The DOM node to summarize.
   * @returns {Object|null} A compact node summary, or null when unavailable.
   */
  function launcherNodeSummary(node) {
    if (!(node instanceof Node)) return null;
    if (!(node instanceof Element)) return { node_name: node.nodeName };
    return {
      node_name: node.nodeName,
      id: node.id || null,
      class_name: typeof node.className === 'string' ? node.className : null
    };
  }

  /**
   * Returns the current launcher lifecycle state for console diagnostics.
   *
   * @param {HTMLElement} launcher - The launcher element being observed.
   * @returns {Object} A compact lifecycle snapshot.
   */
  function launcherLifecycleState(launcher) {
    const style = launcher.isConnected ? getComputedStyle(launcher) : null;
    const rect = launcher.isConnected ? launcher.getBoundingClientRect() : null;
    return {
      connected: launcher.isConnected,
      parent: launcherNodeSummary(launcher.parentNode),
      document_body: launcherNodeSummary(document.body),
      display: style?.display ?? null,
      visibility: style?.visibility ?? null,
      opacity: style?.opacity ?? null,
      width: rect ? Math.round(rect.width) : null,
      height: rect ? Math.round(rect.height) : null
    };
  }

  /**
   * Summarizes one DOM mutation for launcher-lifecycle console diagnostics.
   *
   * @param {MutationRecord} record - The mutation record to summarize.
   * @param {HTMLElement} launcher - The launcher element being observed.
   * @param {HTMLElement} originalBody - The body that originally contained the launcher.
   * @returns {Object} A serializable mutation summary.
   */
  function launcherMutationSummary(record, launcher, originalBody) {
    const removedNodes = [...record.removedNodes];
    const addedNodes = [...record.addedNodes];
    return {
      type: record.type,
      target: launcherNodeSummary(record.target),
      attribute_name: record.attributeName || null,
      removed_nodes: removedNodes.map(launcherNodeSummary),
      added_nodes: addedNodes.map(launcherNodeSummary),
      removes_launcher: removedNodes.some(node =>
        node === launcher || (node instanceof Element && node.contains(launcher))),
      removes_original_body: removedNodes.some(node =>
        node === originalBody || (node instanceof Element && node.contains(originalBody))),
      target_is_original_body: record.target === originalBody
    };
  }

  /**
   * Watches one launcher instance until it disconnects or the startup observation window ends.
   *
   * @param {HTMLElement} launcher - The launcher element being observed.
   * @returns {void} No value is returned.
   */
  function watchLauncherLifecycle(launcher) {
    const originalBody = document.body;
    let previous = launcherLifecycleState(launcher);
    let mutationCount = 0;
    let disconnectedLogged = false;
    let timer = null;
    const relevantMutations = [];
    const recentMutations = [];
    console.log(`[DownloadConversation v${VERSION}] launcher appended`, previous);

    /**
     * Emits one complete, copyable JSON diagnostic when the launcher disconnects.
     *
     * @param {string} source - The detector that observed the disconnection.
     * @param {Object} current - The launcher state at disconnection.
     * @returns {void} No value is returned.
     */
    const logDisconnected = (source, current) => {
      if (disconnectedLogged) return;
      disconnectedLogged = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      const payload = {
        version: VERSION,
        source,
        mutation_count: mutationCount,
        original_body_is_current_body: originalBody === document.body,
        previous,
        current,
        relevant_mutations: relevantMutations,
        recent_mutations: recentMutations
      };
      console.warn(
        `[DownloadConversation v${VERSION}] launcher disconnected JSON\n${JSON.stringify(payload, null, 2)}`
      );
    };

    const observer = new MutationObserver(records => {
      mutationCount += records.length;
      for (const record of records) {
        const summary = launcherMutationSummary(record, launcher, originalBody);
        recentMutations.push(summary);
        if (recentMutations.length > 20) recentMutations.shift();
        if (summary.removes_launcher || summary.removes_original_body)
          relevantMutations.push(summary);
      }

      const current = launcherLifecycleState(launcher);
      const changed = current.connected !== previous.connected ||
        current.parent?.node_name !== previous.parent?.node_name ||
        current.parent?.id !== previous.parent?.id ||
        current.display !== previous.display ||
        current.visibility !== previous.visibility ||
        current.opacity !== previous.opacity ||
        current.width !== previous.width ||
        current.height !== previous.height;
      if (!changed) return;

      if (!current.connected) {
        logDisconnected('mutation-observer', current);
        previous = current;
        observer.disconnect();
        return;
      }

      console.warn(`[DownloadConversation v${VERSION}] launcher lifecycle changed`, {
        previous,
        current
      });
      previous = current;
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden']
    });

    const startedAt = performance.now();
    timer = setInterval(() => {
      const current = launcherLifecycleState(launcher);
      if (!current.connected) {
        logDisconnected('poll', current);
        observer.disconnect();
        previous = current;
        return;
      }
      if (current.parent?.node_name !== previous.parent?.node_name ||
          current.parent?.id !== previous.parent?.id ||
          current.display !== previous.display ||
          current.visibility !== previous.visibility ||
          current.opacity !== previous.opacity ||
          current.width !== previous.width ||
          current.height !== previous.height) {
        console.warn(`[DownloadConversation v${VERSION}] launcher lifecycle poll changed`, {
          previous,
          current
        });
        previous = current;
      }
      if (performance.now() - startedAt >= 15000) {
        clearInterval(timer);
        observer.disconnect();
        console.log(`[DownloadConversation v${VERSION}] launcher lifecycle watch ended`, current);
      }
    }, 100);
  }

  /** Stable page-local identities assigned to nodes observed by topology diagnostics. */
  const launcherTopologyNodeIds = new WeakMap();
  /** Initial direct-BODY index for each node present when topology observation begins. */
  const launcherTopologyInitialBodyIndexes = new WeakMap();
  /** Mutation and lifetime counters for direct-BODY children considered as mount candidates. */
  const launcherTopologyCandidateStats = new WeakMap();
  /** Next page-local node identity number assigned by topology diagnostics. */
  let launcherTopologyNextNodeId = 1;
  /** Performance timestamp when topology observation began. */
  let launcherTopologyStartedAt = performance.now();
  /** Performance timestamp of the most recent direct-BODY child mutation. */
  let launcherTopologyLastBodyMutationAt = launcherTopologyStartedAt;
  /** Pending timer that reports a 500 ms direct-BODY structural quiet interval. */
  let launcherTopologyQuietTimer = null;

  /**
   * Returns a stable diagnostics-only identity for a DOM node during this page lifetime.
   *
   * @param {Node|null} node - Node whose diagnostic identity is requested.
   * @returns {string|null} Stable page-local node identity, or null when unavailable.
   */
  function launcherTopologyNodeId(node) {
    if (!(node instanceof Node)) return null;
    let id = launcherTopologyNodeIds.get(node);
    if (!id) {
      id = `N${launcherTopologyNextNodeId++}`;
      launcherTopologyNodeIds.set(node, id);
    }
    return id;
  }

  /**
   * Returns one direct-BODY child description with stable identity and initial position.
   *
   * @param {Node} node - BODY child to summarize.
   * @param {number} index - Current direct-BODY child index.
   * @returns {Object} Serializable topology entry.
   */
  function launcherTopologyChildSummary(node, index) {
    return {
      index,
      node_id: launcherTopologyNodeId(node),
      initial_body_index: launcherTopologyInitialBodyIndexes.has(node)
        ? launcherTopologyInitialBodyIndexes.get(node)
        : null,
      node: launcherNodeSummary(node)
    };
  }

  /**
   * Captures current BODY topology and candidate-parent stability.
   *
   * @returns {Object} Serializable topology snapshot.
   */
  function launcherTopologyContext() {
    const body = document.body;
    const children = body ? [...body.childNodes] : [];
    return {
      elapsed_ms: Math.round(performance.now() - launcherTopologyStartedAt),
      ready_state: document.readyState,
      location: location.href,
      body_node_id: launcherTopologyNodeId(body),
      body_child_count: children.length,
      body_children: children.map(launcherTopologyChildSummary),
      quiet_for_ms: Math.round(performance.now() - launcherTopologyLastBodyMutationAt),
      candidates: children.map(node => {
        const stats = launcherTopologyCandidateStats.get(node);
        return {
          node_id: launcherTopologyNodeId(node),
          node: launcherNodeSummary(node),
          connected: node.isConnected,
          child_count: node.childNodes?.length ?? null,
          first_seen_ms: stats?.first_seen_ms ?? null,
          direct_child_mutations: stats?.direct_child_mutations ?? 0,
          removed_from_body_ms: stats?.removed_from_body_ms ?? null
        };
      })
    };
  }

  /**
   * Emits one copyable topology snapshot.
   *
   * @param {string} reason - Event that caused the snapshot.
   * @param {Object} [details={}] - Event-specific details.
   * @returns {void} No value is returned.
   */
  function logLauncherTopology(reason, details = {}) {
    const payload = {
      version: VERSION,
      reason,
      details,
      topology: launcherTopologyContext()
    };
    console.log(
      `[DownloadConversation v${VERSION}] launcher topology JSON\n${JSON.stringify(payload, null, 2)}`
    );
  }

  /**
   * Starts passive BODY topology, candidate-parent, and startup-timing diagnostics.
   *
   * No probe nodes are inserted and no removed nodes are restored. Stable WeakMap identities
   * allow one original server-DOM node to be followed even when its BODY index changes.
   *
   * @returns {void} No value is returned.
   */
  function installLauncherTopologyDiagnostics() {
    launcherTopologyStartedAt = performance.now();
    launcherTopologyLastBodyMutationAt = launcherTopologyStartedAt;

    /**
     * Begins topology observation for the BODY instance that exists during startup.
     *
     * @param {HTMLBodyElement} body - BODY element whose direct children are tracked.
     * @returns {void} No value is returned.
     */
    const startForBody = body => {
      const initialChildren = [...body.childNodes];
      initialChildren.forEach((node, index) => {
        launcherTopologyInitialBodyIndexes.set(node, index);
        launcherTopologyCandidateStats.set(node, {
          first_seen_ms: Math.round(performance.now() - launcherTopologyStartedAt),
          direct_child_mutations: 0,
          removed_from_body_ms: null
        });
        launcherTopologyNodeId(node);
      });
      launcherTopologyNodeId(body);
      logLauncherTopology('initial-body');

      const observer = new MutationObserver(records => {
        let bodyChanged = false;
        const bodyEvents = [];
        for (const record of records) {
          if (record.type !== 'childList') continue;
          if (record.target === body) {
            bodyChanged = true;
            launcherTopologyLastBodyMutationAt = performance.now();
            for (const node of record.addedNodes) {
              if (!launcherTopologyCandidateStats.has(node)) {
                launcherTopologyCandidateStats.set(node, {
                  first_seen_ms: Math.round(performance.now() - launcherTopologyStartedAt),
                  direct_child_mutations: 0,
                  removed_from_body_ms: null
                });
              }
            }
            for (const node of record.removedNodes) {
              const stats = launcherTopologyCandidateStats.get(node);
              if (stats) stats.removed_from_body_ms = Math.round(performance.now() - launcherTopologyStartedAt);
            }
            bodyEvents.push({
              removed: [...record.removedNodes].map(node => ({
                node_id: launcherTopologyNodeId(node),
                node: launcherNodeSummary(node),
                initial_body_index: launcherTopologyInitialBodyIndexes.has(node)
                  ? launcherTopologyInitialBodyIndexes.get(node)
                  : null
              })),
              added: [...record.addedNodes].map(node => ({
                node_id: launcherTopologyNodeId(node),
                node: launcherNodeSummary(node),
                initial_body_index: launcherTopologyInitialBodyIndexes.has(node)
                  ? launcherTopologyInitialBodyIndexes.get(node)
                  : null
              }))
            });
          }

          const target = record.target;
          if (target instanceof Node && target.parentNode === body) {
            const stats = launcherTopologyCandidateStats.get(target);
            if (stats) stats.direct_child_mutations += 1;
          }
        }
        if (!bodyChanged) return;
        logLauncherTopology('body-child-mutation', { events: bodyEvents });
        if (launcherTopologyQuietTimer !== null) clearTimeout(launcherTopologyQuietTimer);
        launcherTopologyQuietTimer = setTimeout(() => {
          launcherTopologyQuietTimer = null;
          logLauncherTopology('body-quiet-500ms');
        }, 500);
      });
      observer.observe(body, { childList: true, subtree: true });
    };

    if (document.body) startForBody(document.body);
    else {
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        observer.disconnect();
        startForBody(document.body);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    document.addEventListener('DOMContentLoaded', () => logLauncherTopology('DOMContentLoaded'), { once: true });
    window.addEventListener('load', () => logLauncherTopology('load'), { once: true });
    window.addEventListener('pageshow', () => logLauncherTopology('pageshow'));
    window.addEventListener('popstate', () => logLauncherTopology('popstate'));
    window.addEventListener('hashchange', () => logLauncherTopology('hashchange'));

    for (const delay of [2000, 5000, 10000, 15000]) {
      setTimeout(() => logLauncherTopology(`startup-${delay}ms`), delay);
    }

    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function(...args) {
        const result = Reflect.apply(original, this, args);
        queueMicrotask(() => logLauncherTopology(`history.${method}`));
        return result;
      };
    }
  }

  /**
   * Logs a DOM operation that is about to remove or replace the launcher.
   *
   * This is diagnostic-only.  It never restores, moves, or otherwise changes the launcher.
   * The stack is captured before the native DOM operation so the caller that initiated the
   * removal remains visible in DevTools.
   *
   * @param {string} operation - DOM operation being performed.
   * @param {Node|null} affectedNode - Node whose removal/replacement would affect the launcher.
   * @param {Object} [details={}] - Operation-specific diagnostic details.
   * @returns {void} No value is returned.
   */
  function logLauncherRemovalOperation(operation, affectedNode, details = {}) {
    const launcher = document.getElementById(LAUNCHER_ID);
    if (!(launcher instanceof HTMLElement) || !(affectedNode instanceof Node)) return;
    if (affectedNode !== launcher && !affectedNode.contains(launcher)) return;
    const body = document.body;
    const bodyChildren = body ? [...body.childNodes] : [];
    const bodyChildIndex = launcher.parentNode === body ? bodyChildren.indexOf(launcher) : -1;
    const payload = {
      version: VERSION,
      operation,
      stack: new Error(`launcher removal via ${operation}`).stack || null,
      affected_node: launcherNodeSummary(affectedNode),
      details,
      launcher: launcherLifecycleState(launcher),
      body_child_index: bodyChildIndex,
      body_child_count: bodyChildren.length,
      previous_body_sibling: bodyChildIndex > 0 ? launcherNodeSummary(bodyChildren[bodyChildIndex - 1]) : null,
      next_body_sibling: bodyChildIndex >= 0 && bodyChildIndex + 1 < bodyChildren.length
        ? launcherNodeSummary(bodyChildren[bodyChildIndex + 1])
        : null,
      topology: launcherTopologyContext()
    };
    console.warn(
      `[DownloadConversation v${VERSION}] launcher removal operation JSON\n${JSON.stringify(payload, null, 2)}`
    );
  }

  /**
   * Installs targeted DOM-operation wrappers used to identify who removes the launcher.
   *
   * Wrappers preserve the native return values and exceptions.  They only log when the exact
   * operation would remove the launcher or an ancestor that contains it.  No recovery behavior
   * is installed here.
   *
   * @returns {void} No value is returned.
   */
  function installLauncherRemovalDiagnostics() {
    const originalRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function(child) {
      logLauncherRemovalOperation('Node.removeChild', child, {
        parent: launcherNodeSummary(this),
        child_index: child instanceof Node ? [...this.childNodes].indexOf(child) : -1
      });
      return Reflect.apply(originalRemoveChild, this, [child]);
    };

    const originalReplaceChild = Node.prototype.replaceChild;
    Node.prototype.replaceChild = function(newChild, oldChild) {
      logLauncherRemovalOperation('Node.replaceChild', oldChild, {
        parent: launcherNodeSummary(this),
        old_child_index: oldChild instanceof Node ? [...this.childNodes].indexOf(oldChild) : -1,
        new_child: launcherNodeSummary(newChild)
      });
      return Reflect.apply(originalReplaceChild, this, [newChild, oldChild]);
    };

    const originalRemove = Element.prototype.remove;
    Element.prototype.remove = function() {
      logLauncherRemovalOperation('Element.remove', this, {
        parent: launcherNodeSummary(this.parentNode)
      });
      return Reflect.apply(originalRemove, this, []);
    };

    const originalReplaceWith = Element.prototype.replaceWith;
    Element.prototype.replaceWith = function(...nodes) {
      logLauncherRemovalOperation('Element.replaceWith', this, {
        parent: launcherNodeSummary(this.parentNode),
        replacement_count: nodes.length
      });
      return Reflect.apply(originalReplaceWith, this, nodes);
    };

    const originalReplaceChildren = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function(...nodes) {
      logLauncherRemovalOperation('Element.replaceChildren', this, {
        replacement_count: nodes.length
      });
      return Reflect.apply(originalReplaceChildren, this, nodes);
    };

    const innerHtml = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (innerHtml?.set) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        ...innerHtml,
        set(value) {
          logLauncherRemovalOperation('Element.innerHTML=', this, {
            replacement_length: typeof value === 'string' ? value.length : null
          });
          return Reflect.apply(innerHtml.set, this, [value]);
        }
      });
    }

    const textContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (textContent?.set) {
      Object.defineProperty(Node.prototype, 'textContent', {
        ...textContent,
        set(value) {
          logLauncherRemovalOperation('Node.textContent=', this, {
            replacement_length: typeof value === 'string' ? value.length : null
          });
          return Reflect.apply(textContent.set, this, [value]);
        }
      });
    }

    const outerHtml = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    if (outerHtml?.set) {
      Object.defineProperty(Element.prototype, 'outerHTML', {
        ...outerHtml,
        set(value) {
          logLauncherRemovalOperation('Element.outerHTML=', this, {
            replacement_length: typeof value === 'string' ? value.length : null
          });
          return Reflect.apply(outerHtml.set, this, [value]);
        }
      });
    }
  }

  /**
   * Handles make launcher.
   *
   * @returns {void} No value is returned.
   */
  function makeLauncher() {
    const existing = document.getElementById(LAUNCHER_ID);
    if (existing || !document.body) {
      console.log(`[DownloadConversation v${VERSION}] makeLauncher skipped`, {
        existing: launcherNodeSummary(existing),
        has_body: Boolean(document.body)
      });
      return;
    }
    injectStyles();
    /** Floating button that remains available to open the recorder panel. */
    const launcher = document.createElement('button');
    launcher.id = LAUNCHER_ID;
    launcher.type = 'button';
    /**
     * Opens recorder popup.
     *
     * @returns {void} No value is returned.
     */
    const openRecorderPopup = () => {
      makePanel();
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.style.display = 'block';
      updateUi();
    };
    launcher.addEventListener('click', openRecorderPopup);
    launcher.addEventListener('mouseenter', openRecorderPopup);
    launcher.addEventListener('focus', openRecorderPopup);
    document.body.append(launcher);
    if (DEEP_LAUNCHER_DIAGNOSTICS) watchLauncherLifecycle(launcher);
  }

  /**
   * Handles make panel.
   *
   * @returns {void} No value is returned.
   */
  function makePanel() {
    if (document.getElementById(PANEL_ID) || !document.body) return;
    injectStyles();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.display = 'none';
    panel.innerHTML = `
      <button class="tm-close" type="button" aria-label="Close">×</button>
      <div class="tm-title" data-role="title"></div>
      <div class="tm-log-head"><span class="tm-label" data-role="log-count">Log: 0 items</span><button class="tm-icon-button" data-role="copy-log" type="button" aria-label="Copy diagnostic log" title="Copy log"></button><button class="tm-icon-button" data-role="toggle-log" type="button" aria-label="Show diagnostic log" aria-expanded="false" title="Show log">+</button></div>
      <div class="tm-log-output" data-role="log-output" hidden></div>
      <div class="tm-status" data-role="status"></div>
      <div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><button data-role="test" type="button">Test</button></div>
      <div class="tm-row"><span class="tm-label">Screen on when extracting</span><button class="tm-switch" data-role="screen-on" type="button" role="switch" aria-checked="false" aria-label="Keep screen on while extracting"><span class="tm-switch-thumb"></span></button></div>
      <div class="tm-row"><button data-role="jump" type="button">Jump</button></div>
      <div class="tm-row tm-extract-formats"><button data-role="extract" type="button">Extract</button><label><input data-role="format-jsonl" type="checkbox"> JSONL</label><label><input data-role="format-md" type="checkbox" checked> MD</label></div>
      <div class="tm-row tm-md-metadata"><span class="tm-label">MD headings</span><label><input data-role="show-timestamps" type="checkbox"> Timestamp</label><label><input data-role="show-record-numbers" type="checkbox"> Record #</label><label><input data-role="show-turn-ids" type="checkbox"> Turn ID</label></div>
    `;
    panel.querySelector('.tm-close').addEventListener('click', () => {
      panel.style.display = 'none';
      const launcher = document.getElementById(LAUNCHER_ID);
      if (launcher) launcher.style.display = '';
    });
    const diagnostics = panel.querySelector('[data-role="diagnostics"]');
    diagnostics.value = diagnosticsLevel;
    diagnostics.addEventListener('change', () => {
      diagnosticsLevel = diagnostics.value;
      localStorage.setItem('tm-conversation-recorder-diagnostics', diagnosticsLevel);
      logDiagnostic('debug', 'diagnostics-level-changed', { diagnostics_level: diagnosticsLevel });
      refreshDiagnosticLog();
    });
    const copyLogButton = panel.querySelector('[data-role="copy-log"]');
    if (copyLogButton) copyLogButton.innerHTML = copyIconMarkup();
    panel.querySelector('[data-role="toggle-log"]').addEventListener('click', () => {
      diagnosticLogExpanded = !diagnosticLogExpanded;
      refreshDiagnosticLog();
    });
    panel.querySelector('[data-role="copy-log"]').addEventListener('click', () => {
      void copyDiagnosticLog().catch(error => {
        logDiagnostic('errors', 'diagnostic-log-copy-failure', {
          message: error instanceof Error ? error.message : String(error)
        });
      });
    });
    panel.querySelector('[data-role="test"]').addEventListener('click', event => openTestMatrix(event.currentTarget));
    panel.querySelector('[data-role="jump"]').addEventListener('click', () => void runJump());
    panel.querySelector('[data-role="screen-on"]').addEventListener('click', () => {
      screenOnWhenCapturing = !screenOnWhenCapturing;
      localStorage.setItem(SCREEN_ON_STORAGE_KEY, String(screenOnWhenCapturing));
      if (screenOnWhenCapturing) void acquireWakeLock();
      else void releaseWakeLock();
      updateUi();
    });
    const timestamps = panel.querySelector('[data-role="show-timestamps"]');
    const recordNumbers = panel.querySelector('[data-role="show-record-numbers"]');
    const turnIds = panel.querySelector('[data-role="show-turn-ids"]');
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
    /**
     * Handles run selected exports.
     *
     * @returns {void} No value is returned.
     */
    const runSelectedExports = async () => {
      const jsonl = panel.querySelector('[data-role="format-jsonl"]');
      const md = panel.querySelector('[data-role="format-md"]');
      if (jsonl?.checked) await runExport('jsonl');
      if (md?.checked) await runExport('md');
    };
    panel.querySelector('[data-role="extract"]').addEventListener('click', () => void runSelectedExports());
    panel.querySelector('[data-role="format-jsonl"]').addEventListener('change', updateUi);
    panel.querySelector('[data-role="format-md"]').addEventListener('change', updateUi);
    panel.addEventListener('mouseleave', () => {
      if (!panel.matches(':focus-within') && !exportInProgress && !testInProgress) {
        panel.style.display = 'none';
      }
    });
    document.body.append(panel);
    updateUi();
    refreshDiagnosticLog();
  }

  /**
   * Mounts the launcher only after the host has loaded and direct BODY reconciliation is quiet.
   *
   * Lightweight lifecycle logging stays enabled permanently.  Expensive topology and DOM-method
   * instrumentation remains available behind `DEEP_LAUNCHER_DIAGNOSTICS` for future regressions.
   *
   * @returns {void} No value is returned.
   */
  function bootstrapUi() {
    console.log(`[DownloadConversation v${VERSION}] bootstrap`, {
      ready_state: document.readyState,
      has_body: Boolean(document.body)
    });

    const quietMs = 1000;
    let loadReady = document.readyState === 'complete';
    let bodyObserver = null;
    let quietTimer = null;
    let launcherMountCount = 0;
    let launcherRemovalReported = false;

    /**
     * Schedules one launcher mount after the current direct-BODY quiet interval.
     *
     * @returns {void} No value is returned.
     */
    const scheduleLauncherMount = () => {
      if (!loadReady || !document.body) return;
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        quietTimer = null;
        if (!document.body || document.getElementById(LAUNCHER_ID)) return;
        const reason = launcherMountCount === 0 ? 'initial' : 'remount-after-body-reconciliation';
        makeLauncher();
        const launcher = document.getElementById(LAUNCHER_ID);
        if (!(launcher instanceof HTMLElement)) return;
        launcherMountCount += 1;
        launcherRemovalReported = false;
        const children = [...document.body.childNodes];
        console.log(`[DownloadConversation v${VERSION}] launcher mounted`, {
          reason,
          ready_state: document.readyState,
          quiet_ms: quietMs,
          body_child_count: children.length,
          body_child_index: children.indexOf(launcher)
        });
      }, quietMs);
    };

    /**
     * Observes the current BODY so host reconciliation resets the launcher quiet interval.
     *
     * @param {HTMLBodyElement} body - Current BODY whose direct children are observed.
     * @returns {void} No value is returned.
     */
    const observeBody = body => {
      bodyObserver?.disconnect();
      bodyObserver = new MutationObserver(records => {
        if (!records.some(record => record.type === 'childList' && record.target === body)) return;
        if (launcherMountCount > 0 && !document.getElementById(LAUNCHER_ID) && !launcherRemovalReported) {
          launcherRemovalReported = true;
          console.warn(`[DownloadConversation v${VERSION}] launcher disconnected; waiting for BODY quiet`, {
            ready_state: document.readyState,
            body_child_count: body.childNodes.length,
            quiet_ms: quietMs
          });
        }
        scheduleLauncherMount();
      });
      bodyObserver.observe(body, { childList: true });
      scheduleLauncherMount();
    };

    if (document.body) observeBody(document.body);
    else {
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        observer.disconnect();
        console.log(`[DownloadConversation v${VERSION}] BODY appeared`, {
          ready_state: document.readyState
        });
        observeBody(document.body);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    if (!loadReady) {
      window.addEventListener('load', () => {
        loadReady = true;
        console.log(`[DownloadConversation v${VERSION}] load complete; waiting for BODY quiet`, {
          quiet_ms: quietMs
        });
        scheduleLauncherMount();
      }, { once: true });
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquireWakeLock();
    else void releaseWakeLock();
  });

  document.addEventListener('click', captureConversationClickDiagnostic, true);
  window.addEventListener('pagehide', () => {
    finishConversationClickDiagnostic(activeClickDiagnostic, 'pagehide');
    if (diagnosticPersistTimer !== null) {
      clearTimeout(diagnosticPersistTimer);
      diagnosticPersistTimer = null;
    }
    persistDiagnosticLog();
  });
  if (DEEP_LAUNCHER_DIAGNOSTICS) {
    installLauncherRemovalDiagnostics();
    installLauncherTopologyDiagnostics();
  }
  installNetworkCapture();
  bootstrapUi();
})();
