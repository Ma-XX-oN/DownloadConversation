// ==UserScript==
// @name         ChatGPT Conversation Markdown Recorder
// @namespace    https://chatgpt.com/
// @version      0.6.130
// @description  Exports the current ChatGPT conversation directly from the Conversation API as Markdown or JSONL.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || 'unknown';
  const PANEL_ID = 'tm-conversation-recorder';
  const LAUNCHER_ID = 'tm-conversation-recorder-launcher';
  const DIAGNOSTIC_LEVELS = Object.freeze({ errors: 0, warnings: 1, debug: 2, verbose: 3 });
  const DEFAULT_DIAGNOSTICS = 'warnings';
  const PAGE_TURNS = 100;
  const MAX_PAGES = 10000;
  const SCREEN_ON_STORAGE_KEY = 'tm-conversation-recorder-screen-on-when-capturing';
  const DIAGNOSTIC_LOG_STORAGE_KEY = 'tm-conversation-recorder-diagnostic-log';
  const MAX_DIAGNOSTIC_LOG_ITEMS = 500;

  let originalPageFetch = null;
  let apiRequestContext = null;
  let captureInstalled = false;
  let diagnosticsLevel = localStorage.getItem('tm-conversation-recorder-diagnostics') || DEFAULT_DIAGNOSTICS;
  let screenOnWhenCapturing = localStorage.getItem(SCREEN_ON_STORAGE_KEY) !== 'false';
  let wakeLockSentinel = null;
  let exportInProgress = false;
  let exportKind = null;
  let statusText = 'Ready.';
  let statusTimer = null;
  let progressState = null;
  let testInProgress = false;
  let jumpInProgress = false;
  let clickDiagnosticSequence = 0;
  let activeClickDiagnostic = null;
  let diagnosticLog = [];
  try {
    const storedDiagnosticLog = JSON.parse(sessionStorage.getItem(DIAGNOSTIC_LOG_STORAGE_KEY) || '[]');
    if (Array.isArray(storedDiagnosticLog)) diagnosticLog = storedDiagnosticLog.slice(-MAX_DIAGNOSTIC_LOG_ITEMS);
  } catch {}

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

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

  function escapeHtmlText(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeHtmlAttribute(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function quoteMarkdown(markdown) {
    const text = String(markdown ?? '').replace(/\s+$/, '');
    if (!text) return '>';
    return text.split('\n').map(line => line.length ? `> ${line}` : '>').join('\n');
  }

  function conversationTitle() {
    const heading = document.querySelector('h1')?.textContent?.trim();
    const title = heading || document.title || 'ChatGPT conversation';
    return title.replace(/\s*[-–—]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT conversation';
  }

  function sanitizeFileName(name) {
    return String(name || 'ChatGPT conversation')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim() || 'ChatGPT conversation';
  }

  function currentConversationId() {
    return location.pathname.match(/\/c\/([^/?#]+)/)?.[1] ?? null;
  }

  function isConversationApiUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin) return false;
      return /^\/backend-api\/conversations\/[^/]+(?:\/messages)?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function rawHeadersToObject(headers) {
    const result = {};
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

  function clickDiagnosticTurnContext(target) {
    const section = target instanceof Element ? target.closest('section[data-turn-id]') : null;
    if (!(section instanceof HTMLElement)) return null;
    const message = section.querySelector('[data-message-id]');
    const clickedImage = target.closest('img');
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

  function recordClickDiagnosticNetworkRequest(url, initiatorType) {
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

  function installNetworkCapture() {
    if (captureInstalled) return;
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

  async function apiFetch(url) {
    const conversationId = currentConversationId();
    const context = apiRequestContext;
    if (!context?.headers?.authorization || context.conversation_id !== conversationId) {
      throw new Error('No authenticated Conversation API context is available. Reload this conversation, then try again.');
    }
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const fetchFn = originalPageFetch || pageWindow.fetch;
    return fetchFn.call(pageWindow, url, {
      method: 'GET',
      headers: { ...context.headers },
      credentials: 'include'
    });
  }

  function conversationSchemaOk(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.messages) &&
      !!data.page_info && typeof data.page_info === 'object';
  }

  function pageUrl(conversationId, cursor = null) {
    if (cursor === null) {
      return `${location.origin}/backend-api/conversations/${encodeURIComponent(conversationId)}?include_has_versions=true&num_turns=${PAGE_TURNS}`;
    }
    return `${location.origin}/backend-api/conversations/${encodeURIComponent(conversationId)}/messages?before=${encodeURIComponent(cursor)}&include_has_versions=true&num_turns=${PAGE_TURNS}`;
  }

  function boundedDiagnosticText(text, maxChars = 2000) {
    const value = typeof text === 'string' ? text : String(text ?? '');
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]`;
  }

  function diagnosticRequestPath(url) {
    try {
      const parsed = new URL(url, location.href);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return String(url);
    }
  }

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

  async function collectConversationPages(fetchPage, onProgress) {
    const pages = [];
    const seenCursors = new Set();
    let rawRecordCount = 0;
    let cursor = null;

    for (;;) {
      if (pages.length >= MAX_PAGES) {
        throw new Error(`Conversation pagination exceeded the ${MAX_PAGES}-page safety limit.`);
      }
      const previousPageInfo = pages.length ? pages[pages.length - 1].page_info : null;
      const data = await fetchPage(cursor, pages.length + 1, previousPageInfo);
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
        page_count: pages.length,
        raw_record_count: rawRecordCount
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

  function conversationSpineFromPages(pages) {
    const messageIndexById = new Map();
    const messages = [];
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

  function apiLinkageKeyIsIdentifierLike(key) {
    return /(?:^id$|_id$|_ids$|call|parent|source|reference|tool|exchange|working|request|response)/i
      .test(String(key ?? ''));
  }

  function apiLinkageScalarIsSafe(key, value) {
    if (value === null || value === undefined) return false;
    if (!['string', 'number'].includes(typeof value)) return false;
    if (/(?:authorization|cookie|token|secret|password)/i.test(String(key ?? ''))) return false;
    if (typeof value === 'string' && value.length > 256) return false;
    return true;
  }

  function apiRecordIdentifierScalars(record) {
    const raw = record?.message && typeof record.message === 'object' ? record.message : {};
    const result = [];
    const seen = new Set();
    const freeformKeys = new Set([
      'text', 'parts', 'thinking', 'summary', 'message', 'prompt', 'output', 'input', 'content'
    ]);
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

  function apiConversationUapGrouping(spine) {
    const anchors = spine?.uap_anchors ?? [];
    const records = spine?.records ?? [];
    const exchangeToAnchors = new Map();
    const workingToAnchors = new Map();
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

    const groups = anchors.map(anchor => ({
      ordinal: anchor.ordinal,
      user_message_id: anchor.user_message_id,
      user_record_ordinal: anchor.user_record_ordinal,
      record_ordinals: [],
      exact_record_ordinals: []
    }));
    const classifications = [];
    const counts = { exact: 0, fallback: 0, ungrouped: 0, conflict: 0 };

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

  function apiUnresolvedUapLinkageAnalysis(spine, primary) {
    const records = spine?.records ?? [];
    const exactMessageToUap = new Map();
    const exactIdentifierToUaps = new Map();
    const keyFor = value => `${typeof value}:${String(value)}`;
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

  function apiConversationUapFinalGrouping(spine) {
    const primary = apiConversationUapGrouping(spine);
    const linkage = apiUnresolvedUapLinkageAnalysis(spine, primary);
    const linkageByOrdinal = new Map(
      linkage.unresolved.map(item => [item.record_ordinal, item])
    );
    const records = spine?.records ?? [];
    const groups = (spine?.uap_anchors ?? []).map(anchor => ({
      ordinal: anchor.ordinal,
      user_message_id: anchor.user_message_id,
      record_ordinals: []
    }));
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

  function cgIsHidden(record) {
    return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
  }

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

  function cgCitationRoot(url) {
    try {
      const parsed = new URL(url);
      return parsed.host ? `${parsed.protocol}//${parsed.host}` : '';
    } catch {
      return '';
    }
  }

  function cgCitationHostname(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  }

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

  function cgShortenInlineText(text, maxChars = 200) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxChars) return clean;
    let clipped = clean.slice(0, maxChars - 1).trimEnd();
    if (clipped.includes(' ')) clipped = clipped.slice(0, clipped.lastIndexOf(' '));
    return `${clipped.replace(/[ ,;:-]+$/g, '')}…`;
  }

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

  function cgCitationFavicon(url) {
    const root = cgCitationRoot(url);
    return root ? `https://www.google.com/s2/favicons?domain=${root}&sz=32` : '';
  }

  function cgCollectWebCitationSources(reference, urlIndex = new Map()) {
    const sources = [];
    const seen = new Set();
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

  const CG_INLINE_TOKEN_START = '\ue200';
  const CG_INLINE_TOKEN_END = '\ue201';
  const CG_INLINE_TOKEN_SEP = '\ue202';
  const CG_INLINE_TOKEN_RX = /\ue200[^\ue201]*\ue201/g;

  function cgInlineTokenSegments(token) {
    if (typeof token !== 'string' ||
        !token.startsWith(CG_INLINE_TOKEN_START) ||
        !token.endsWith(CG_INLINE_TOKEN_END)) return [];
    return token.slice(1, -1).split(CG_INLINE_TOKEN_SEP);
  }

  function cgStripInlineTokens(text) {
    return typeof text === 'string' ? text.replace(CG_INLINE_TOKEN_RX, '') : '';
  }

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

  function cgBuildFileReferenceIndex(records) {
    const index = new Map();
    for (const record of records ?? []) cgRegisterFileReference(index, record);
    return index;
  }

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

  function cgRenderMemoryCitation(record) {
    const sources = cgCollectMemoryCitationSources(record);
    return sources.length ? cgRenderSourceCitation('memory', sources) : '**(memory context)**';
  }

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
      const rel = relative.map(segment => encodeURIComponent(segment)).join('/');
      return `https://github.com/${owner}/${repo}/${target}/${encodeURIComponent(ref)}/${rel}`;
    } catch {
      return cleaned;
    }
  }

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

  function cgRenderNamedFileReference(name, matchedText = '', url = '') {
    const shown = cgDisplayFileLabel(name, url);
    const { lineRef } = cgFileTokenSpec(matchedText);
    const label = `${shown}${lineRef ? ` ${lineRef}` : ''}`;
    const displayUrl = cgDisplayFileUrl(url);
    if (displayUrl) return `<a href="${escapeHtmlAttribute(displayUrl)}">${escapeHtmlText(label)}</a>`;
    return lineRef ? `\`${shown}\` ${lineRef}` : `\`${shown}\``;
  }

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

  function cgRenderUnstructuredInlineToken(token, record, fileRefIndex) {
    const segments = cgInlineTokenSegments(token);
    if (!segments.length) return '';
    if (segments[0] === 'memcite') return cgRenderMemoryCitation(record);
    if (segments[0] === 'filecite') return cgHiddenFileReference({ type: 'hidden', matched_text: token }, record, fileRefIndex);
    return '';
  }

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

  function cgRewriteGeneratedSandboxLinks(text, record) {
    if (!text || record?.author?.role !== 'assistant') return text;
    return String(text).replace(/(\[[^\]]*\]\()(sandbox:(?:\/\/)?\/mnt\/data\/[^)]+)(\))/gi,
      (whole, prefix, source, suffix) => {
        const url = cgGeneratedSandboxDownloadUrl(source, record);
        return url ? `${prefix}${url}${suffix}` : whole;
      });
  }

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

  function cgImagePointerSource(part) {
    if (!part || typeof part !== 'object') return '';
    const metadata = part.metadata && typeof part.metadata === 'object' ? part.metadata : {};
    for (const value of [metadata.asset_pointer_link, part.asset_pointer_link, part.asset_pointer]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function cgImageUnavailableMarkdown(source) {
    const clean = typeof source === 'string' ? source.trim() : '';
    return clean ? `[image not available](${clean})` : '[image not available]';
  }

  function cgImageFailureMarkdown(source, httpStatus = null) {
    if (httpStatus === 404 || httpStatus === 410) return '[image missing]';
    return cgImageUnavailableMarkdown(source);
  }

  async function cgResolveImagePointerMarkdown(part, recordId, imageOrdinal) {
    const source = cgImagePointerSource(part);
    if (!source) return '[image missing]';
    if (source.startsWith('data:image/')) return `![image-${recordId}-${imageOrdinal}](${source})`;
    let parsed = null;
    try { parsed = new URL(source, location.href); } catch {}
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return cgImageUnavailableMarkdown(source);
    try {
      const response = await fetch(source, { method: 'GET', credentials: 'include' });
      if (!response.ok) return cgImageFailureMarkdown(source, response.status);
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read conversational image blob.'));
        reader.readAsDataURL(blob);
      });
      return dataUrl ? `![image-${recordId}-${imageOrdinal}](${dataUrl})` : cgImageUnavailableMarkdown(source);
    } catch {
      return cgImageUnavailableMarkdown(source);
    }
  }

  function cgImagePointerFallback(part) {
    const source = cgImagePointerSource(part);
    return source ? cgImageUnavailableMarkdown(source) : '[image missing]';
  }

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

  function cgVisibleUserText(record, fileRefIndex = new Map(), recoveredImages = []) {
    if (cgIsHidden(record) || record?.author?.role !== 'user' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex, recoveredImages).join('\n\n').trim();
  }

  function cgVisibleAssistantText(record, fileRefIndex = new Map(), recoveredImages = []) {
    if (cgIsHidden(record) || record?.author?.role !== 'assistant' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex, recoveredImages).join('\n\n').trim();
  }

  function cgVisibleAssistantMarkdown(record, fileRefIndex = new Map(), recoveredImages = []) {
    return cgVisibleAssistantText(record, fileRefIndex, recoveredImages);
  }

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

  function cgCodeFence(text, language = '') {
    const body = String(text ?? '').replace(/\s+$/, '');
    const fence = body.includes('```') ? '````' : '```';
    return `${fence}${language || ''}\n${body}\n${fence}`;
  }

  function cgRenderDetail(summary, body) {
    return body ? `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>` : '';
  }

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

  function cgRenderThoughtBlock(items, fileRefIndex = new Map()) {
    const rendered = [];
    for (const record of items) {
      const body = cgRenderThoughtItem(record, fileRefIndex);
      if (body) rendered.push(body);
    }
    return rendered.length ? `<details>\n<summary>Thoughts</summary>\n\n${rendered.join('\n\n')}\n\n</details>` : '';
  }

  function transcriptHeading(record) {
    const id = typeof record?.id === 'string' ? record.id : '';
    if (record?.author?.role === 'user') {
      return `## User${id ? ` <!-- turn_id=${id} -->` : ''}`;
    }
    if (record?.author?.role === 'assistant' && record?.channel === 'commentary') {
      return `## ChatGPT Commentary${id ? ` <!-- turn_id=${id} -->` : ''}`;
    }
    if (record?.author?.role === 'assistant') {
      return `## ChatGPT${id ? ` <!-- turn_id=${id} -->` : ''}`;
    }
    return '';
  }

  function renderConversationMarkdown(spine, onProgress, recoveredImageMap = new Map()) {
    assert(Array.isArray(spine?.records), 'Conversation API Markdown export requires spine records.');
    const records = spine.records.map(item => item.message).filter(Boolean);
    const output = [];
    const fileRefIndex = cgBuildFileReferenceIndex(records);
    let pendingThoughts = [];

    const flushAssistantBlock = (body = '', record = null) => {
      if (!body && !pendingThoughts.length) return;
      const headingRecord = record ?? pendingThoughts[0];
      const parts = [transcriptHeading(headingRecord)];
      const thoughts = cgRenderThoughtBlock(pendingThoughts, fileRefIndex);
      if (thoughts) parts.push(thoughts);
      if (body) parts.push(quoteMarkdown(body));
      output.push(parts.join('\n\n'));
      pendingThoughts = [];
    };

    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      onProgress?.({
        stage: 'rendering',
        record_number: i + 1,
        record_count: records.length
      });
      const recoveredImages = recoveredImageMap.get(record.id) ?? [];
      const userText = cgVisibleUserText(record, fileRefIndex, recoveredImages);
      if (userText) {
        flushAssistantBlock();
        output.push(`${transcriptHeading(record)}\n\n${quoteMarkdown(userText)}`);
        continue;
      }
      const assistantText = cgVisibleAssistantMarkdown(record, fileRefIndex, recoveredImages);
      if (assistantText) {
        flushAssistantBlock(assistantText, record);
        continue;
      }
      if (cgRenderThoughtItem(record, fileRefIndex)) pendingThoughts.push(record);
    }
    flushAssistantBlock();
    return `${output.join('\n\n')}\n`;
}

  function apiRecordsJsonl(spine) {
    return `${spine.records.map(record => JSON.stringify(record.message)).join('\n')}\n`;
  }

  function progressStatus(prefix) {
    if (!progressState) return statusText;
    const now = performance.now();
    const elapsed = now - progressState.started_at;
    const stage = progressState.stage;

    if (stage === 'fetching') {
      return `${prefix}: fetched ${progressState.page_count} API page(s), ${progressState.raw_record_count} raw record(s)…\nElapsed: ${formatDuration(elapsed)}`;
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

  function refreshStatus() {
    const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
    if (!status) return;
    if (progressState) {
      status.textContent = progressStatus(exportKind === 'md' ? 'Extract MD' : 'Extract JSONL');
    } else {
      status.textContent = statusText;
    }
  }

  function setStatus(text) {
    statusText = text;
    refreshStatus();
  }

  function startStatusTimer() {
    if (statusTimer !== null) clearInterval(statusTimer);
    statusTimer = setInterval(refreshStatus, 1000);
  }

  function stopStatusTimer() {
    if (statusTimer !== null) clearInterval(statusTimer);
    statusTimer = null;
  }

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

  async function releaseWakeLock() {
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {}
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function jumpUserRecords(spine) {
    return (spine?.records ?? []).filter(record => record?.role === 'user');
  }

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

    const record = records.find(item => item?.message_id === value);
    assert(record, `Turn ID ${value} was not found in the Conversation API.`);
    assert(record.role === 'user' || record.role === 'assistant',
      `Turn ID ${value} belongs to role ${record.role ?? 'unknown'}, not User or Assistant.`);
    let uapIndex = -1;
    for (let index = 0; index < users.length; index += 1) {
      if (users[index].ordinal > record.ordinal) break;
      uapIndex = index;
    }
    assert(uapIndex >= 0, `Turn ID ${value} appears before the first User turn.`);
    return { uap_index: uapIndex, role: record.role, message_id: record.message_id };
  }

  function mountedTurnSection(messageId, role = null) {
    for (const section of document.querySelectorAll('section[data-turn-id]')) {
      if (role && section.getAttribute('data-turn') !== role) continue;
      if (section.getAttribute('data-turn-id') === messageId) return section;
      const message = section.querySelector('[data-message-id]');
      if (message?.getAttribute('data-message-id') === messageId) return section;
    }
    return null;
  }

  function conversationScrollRoot() {
    const thread = document.querySelector('#thread');
    for (let node = thread?.parentElement; node instanceof HTMLElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight + 1) return node;
    }
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
  }

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

  function jumpTocIndexControl(uapIndex) {
    return document.querySelector(`button[data-toc-item-index="${uapIndex}"]`);
  }

  async function populateJumpTocIndex(uapIndex, timeoutMs = 60000) {
    let toc = jumpTocIndexControl(uapIndex);
    if (toc instanceof HTMLElement) return toc;

    const scrollRoot = conversationScrollRoot();
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

  function userImagePointerCount(record) {
    if (record?.author?.role !== 'user' || !Array.isArray(record?.content?.parts)) return 0;
    return record.content.parts.filter(part =>
      part && typeof part === 'object' && part.content_type === 'image_asset_pointer'
    ).length;
  }

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

  function internalImagePointerProtocol(source) {
    const value = String(source ?? '').trim().toLowerCase();
    if (value.startsWith('sandbox://')) return 'sandbox';
    if (value.startsWith('sediment://')) return 'sediment';
    return null;
  }

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

  function imagePointerResourceEvidence(source, domCandidate) {
    const assetKey = internalImagePointerAssetKey(source);
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

  async function imageElementDataUrl(image) {
    const src = image.currentSrc || image.getAttribute('src') || '';
    assert(src, 'Conversational image has no source URL.');
    if (src.startsWith('data:')) return src;
    const response = await fetch(src, { credentials: 'include' });
    if (!response.ok) {
      const error = new Error(`Conversational image request returned HTTP ${response.status}.`);
      error.httpStatus = response.status;
      throw error;
    }
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read conversational image blob.'));
      reader.readAsDataURL(blob);
    });
  }

  async function recoverUserImages(spine) {
    const recovered = new Map();
    const scrollRoot = conversationScrollRoot();
    const originalScrollTop = scrollRoot.scrollTop;
    const records = (spine?.records ?? []).filter(record => userImagePointerCount(record?.message) > 0);
    try {
      for (const item of records) {
        const record = item.message;
        const expectedParts = record.content.parts.filter(part =>
          part && typeof part === 'object' && part.content_type === 'image_asset_pointer'
        );
        const expected = expectedParts.length;
        const images = expectedParts.map(part => cgImagePointerFallback(part));
        try {
          let section = mountedTurnSection(record.id, 'user');
          if (!(section instanceof HTMLElement)) {
            const target = resolveJumpIdentifier(spine, record.id);
            target.spine = spine;
            section = await jumpToResolvedTarget(target);
          }
          const candidates = mountedUserConversationImages(section);
          logInternalImagePointerEvidence(record, section, candidates);
          for (let index = 0; index < Math.min(expected, candidates.length); index += 1) {
            try {
              const dataUrl = await imageElementDataUrl(candidates[index]);
              if (dataUrl) images[index] = `![image-${record.id}-${index + 1}](${dataUrl})`;
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
            }
          }
          for (let index = candidates.length; index < expected; index += 1) {
            images[index] = await cgResolveImagePointerMarkdown(expectedParts[index], record.id, index + 1);
          }
        } catch (error) {
          logDiagnostic('warnings', 'conversation-image-turn-recovery-failure', {
            message_id: record.id,
            expected_image_count: expected,
            message: error instanceof Error ? error.message : String(error)
          });
        }
        recovered.set(record.id, images);
      }
    } finally {
      scrollRoot.scrollTop = originalScrollTop;
    }
    return recovered;
  }

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
      const fetched = await fetchConversationPages(conversationId, progress => {
        progressState.stage = 'fetching';
        progressState.page_count = progress.page_count;
        progressState.raw_record_count = progress.raw_record_count;
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
        setStatus('Recovering conversational images…');
        const recoveredImageMap = await recoverUserImages(spine);
        progressState.stage = 'rendering';
        progressState.render_started_at = performance.now();
        progressState.record_count = spine.records.length;
        const markdown = renderConversationMarkdown(spine, progress => {
          progressState.stage = 'rendering';
          progressState.record_number = progress.record_number;
          progressState.record_count = progress.record_count;
          refreshStatus();
        }, recoveredImageMap);
        const filename = `${sanitizeFileName(conversationTitle())}.md`;
        downloadBlob(
          new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
          filename
        );
        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);
      }
    } catch (error) {
      setStatus(
        `${kind === 'md' ? 'Markdown' : 'JSONL'} extraction failed: ` +
        `${error instanceof Error ? error.message : String(error)}`
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

  async function testMultimodalUserAndChronologicalOrder() {
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
    const userRecord = { id: 'user-test-id', author: { role: 'user' } };
    assert(cgRewriteGeneratedSandboxLinks(`[x](${source})`, userRecord) === `[x](${source})`,
      'sandbox link rewrite should not apply to User records.');
    assert(cgRewriteGeneratedSandboxLinks('[x](sediment://file_123)', record) === '[x](sediment://file_123)',
      'sandbox link rewrite must not rewrite sediment pointers.');
  }

  async function runTests() {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    testInProgress = true;
    updateUi();
    const results = [];
    const run = async (name, fn) => {
      try {
        await fn();
        results.push(`✅ ${name}`);
      } catch (error) {
        results.push(`❌ ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      setStatus(results.join('\n'));
    };
    try {
      await run('API pagination', testApiPaginationLogic);
      await run('Stable API message IDs', testStableMessageIds);
      await run('Multimodal User + chronological order', testMultimodalUserAndChronologicalOrder);
      await run('AI-transcript renderer parity', testRendererParityFeatures);
      await run('Generated sandbox download link', testGeneratedSandboxDownloadLink);
      await run('Jump identifier resolution', testJumpIdentifierResolution);
      await run('Conversation API access/schema', testConversationApiAccessAndSchema);
    } finally {
      testInProgress = false;
      updateUi();
    }
  }

  function diagnosticEnabled(level) {
    return (DIAGNOSTIC_LEVELS[level] ?? 0) <= (DIAGNOSTIC_LEVELS[diagnosticsLevel] ?? 0);
  }

  function persistDiagnosticLog() {
    try {
      sessionStorage.setItem(DIAGNOSTIC_LOG_STORAGE_KEY, JSON.stringify(diagnosticLog));
    } catch {}
  }

  function diagnosticLogLine(entry) {
    const suffix = entry.data === null || entry.data === undefined
      ? ''
      : ` ${JSON.stringify(entry.data)}`;
    return `${entry.timestamp} [${entry.level}] ${entry.message}${suffix}`;
  }

  function refreshDiagnosticLog() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const count = panel.querySelector('[data-role="log-count"]');
    const output = panel.querySelector('[data-role="log-output"]');
    if (count) count.textContent = `Log: ${diagnosticLog.length} item${diagnosticLog.length === 1 ? '' : 's'}`;
    if (output) {
      output.textContent = diagnosticLog.map(diagnosticLogLine).join('\n');
      output.scrollTop = output.scrollHeight;
    }
  }

  async function copyDiagnosticLog() {
    const text = diagnosticLog.map(diagnosticLogLine).join('\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
  }

  function logDiagnostic(level, message, data = null) {
    if (!diagnosticEnabled(level)) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data
    };
    diagnosticLog.push(entry);
    if (diagnosticLog.length > MAX_DIAGNOSTIC_LOG_ITEMS) {
      diagnosticLog.splice(0, diagnosticLog.length - MAX_DIAGNOSTIC_LOG_ITEMS);
    }
    persistDiagnosticLog();
    refreshDiagnosticLog();

    const args = [`[ChatGPT Recorder ${level}] ${message}`];
    if (data !== null) args.push(data);
    (level === 'errors' ? console.error : level === 'warnings' ? console.warn : console.log)(...args);
  }

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
      #${PANEL_ID} .tm-switch{margin-left:auto;border-radius:999px;padding:6px 13px;font-weight:600}
      #${PANEL_ID} .tm-label{color:#ddd}
      #${PANEL_ID} .tm-log-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}
      #${PANEL_ID} .tm-log-copy{padding:5px 9px}
      #${PANEL_ID} .tm-log-output{margin:6px 0 0;max-height:190px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #555;border-radius:8px;background:#111;padding:8px;font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;color:#ddd}
    `;
    (document.head || document.documentElement).append(style);
  }

  function updateUi() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const title = panel.querySelector('[data-role="title"]');
    if (title) title.textContent = `ChatGPT Recorder v${VERSION}`;
    const md = panel.querySelector('[data-role="extract-md"]');
    const jsonl = panel.querySelector('[data-role="extract-jsonl"]');
    const test = panel.querySelector('[data-role="test"]');
    const jump = panel.querySelector('[data-role="jump"]');
    if (md) {
      md.disabled = exportInProgress || testInProgress || jumpInProgress;
      md.textContent = exportInProgress && exportKind === 'md' ? 'Extracting…' : 'Extract MD';
    }
    if (jsonl) {
      jsonl.disabled = exportInProgress || testInProgress || jumpInProgress;
      jsonl.textContent = exportInProgress && exportKind === 'jsonl' ? 'Extracting…' : 'Extract JSONL';
    }
    if (test) {
      test.disabled = exportInProgress || testInProgress || jumpInProgress;
      test.textContent = testInProgress ? 'Testing…' : 'Test';
    }
    if (jump) {
      jump.disabled = exportInProgress || testInProgress || jumpInProgress;
      jump.textContent = jumpInProgress ? 'Jumping…' : 'Jump';
    }
    const screen = panel.querySelector('[data-role="screen-on"]');
    if (screen) screen.textContent = screenOnWhenCapturing ? 'ON' : 'OFF';
    refreshStatus();
  }

  function makeLauncher() {
  if (document.getElementById(LAUNCHER_ID) || !document.body) return;
  injectStyles();
  const launcher = document.createElement('button');
  launcher.id = LAUNCHER_ID;
  launcher.type = 'button';
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
}

  function makePanel() {
    if (document.getElementById(PANEL_ID) || !document.body) return;
    injectStyles();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.display = 'none';
    panel.innerHTML = `
      <button class="tm-close" type="button" aria-label="Close">×</button>
      <div class="tm-title" data-role="title"></div>
      <div class="tm-status" data-role="status"></div>
      <div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><button data-role="test" type="button">Test</button></div>
      <div class="tm-log-head"><span class="tm-label" data-role="log-count">Log: 0 items</span><button class="tm-log-copy" data-role="copy-log" type="button">Copy</button></div>
      <pre class="tm-log-output" data-role="log-output"></pre>
      <div class="tm-row"><span class="tm-label">Screen on when extracting</span><button class="tm-switch" data-role="screen-on" type="button"></button></div>
      <div class="tm-row"><button data-role="jump" type="button">Jump</button></div>
      <div class="tm-row"><button data-role="extract-jsonl" type="button">Extract JSONL</button><button data-role="extract-md" type="button">Extract MD</button></div>
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
    panel.querySelector('[data-role="copy-log"]').addEventListener('click', () => {
      void copyDiagnosticLog().catch(error => {
        logDiagnostic('errors', 'diagnostic-log-copy-failure', {
          message: error instanceof Error ? error.message : String(error)
        });
      });
    });
    panel.querySelector('[data-role="test"]').addEventListener('click', () => void runTests());
    panel.querySelector('[data-role="jump"]').addEventListener('click', () => void runJump());
    panel.querySelector('[data-role="screen-on"]').addEventListener('click', () => {
      screenOnWhenCapturing = !screenOnWhenCapturing;
      localStorage.setItem(SCREEN_ON_STORAGE_KEY, String(screenOnWhenCapturing));
      if (screenOnWhenCapturing) void acquireWakeLock();
      else void releaseWakeLock();
      updateUi();
    });
    panel.querySelector('[data-role="extract-jsonl"]').addEventListener('click', () => void runExport('jsonl'));
    panel.querySelector('[data-role="extract-md"]').addEventListener('click', () => void runExport('md'));
    panel.addEventListener('mouseleave', () => {
      if (!panel.matches(':focus-within') && !exportInProgress && !testInProgress) {
        panel.style.display = 'none';
      }
    });
    document.body.append(panel);
    updateUi();
    refreshDiagnosticLog();
  }

  function bootstrapUi() {
    if (document.body) {
      makeLauncher();
      makePanel();
      return;
    }
    new MutationObserver((_, observer) => {
      if (!document.body) return;
      observer.disconnect();
      makeLauncher();
      makePanel();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquireWakeLock();
    else void releaseWakeLock();
  });

  document.addEventListener('click', captureConversationClickDiagnostic, true);
  window.addEventListener('pagehide', () => finishConversationClickDiagnostic(activeClickDiagnostic, 'pagehide'));
  installNetworkCapture();
  bootstrapUi();
})();
