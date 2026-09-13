// ==UserScript==
// @name         ChatGPT Final-Turn State Logger
// @namespace    https://chatgpt.com/
// @version      0.1.0
// @description  Passively records bounded startup, network, and final-turn DOM state for DownloadConversation issue diagnostics.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// ==/UserScript==

(() => {
  'use strict';

  /** Global name used to expose explicit snapshot/download controls without injecting UI. */
  const PUBLIC_API_NAME = '__CHATGPT_FINAL_TURN_LOGGER__';
  /** Global flag used by the Node regression harness to suppress browser startup side effects. */
  const TEST_MODE_NAME = '__FINAL_TURN_LOGGER_TEST_MODE__';
  /** Global name used by the Node regression harness to access pure observer helpers. */
  const TEST_API_NAME = '__FINAL_TURN_LOGGER_TEST_API__';
  /** Maximum retained network observations. */
  const MAX_NETWORK_ITEMS = 120;
  /** Maximum retained distinct DOM-tail states. */
  const MAX_DOM_STATES = 200;
  /** Maximum retained bootstrap/hydration script observations. */
  const MAX_HYDRATION_ITEMS = 80;
  /** Maximum retained event/error records. */
  const MAX_EVENT_ITEMS = 120;
  /** Maximum text characters retained for one network/bootstrap snapshot. */
  const MAX_NETWORK_SNAPSHOT_CHARS = 65536;
  /** Maximum text characters retained for one DOM turn snapshot. */
  const MAX_DOM_TEXT_CHARS = 32768;
  /** Maximum HTML characters retained for one DOM turn snapshot. */
  const MAX_DOM_HTML_CHARS = 65536;
  /** Number of final mounted turn sections retained in each DOM observation. */
  const DOM_TAIL_TURNS = 3;
  /** Quiet-period delay used to coalesce high-frequency transcript mutations. */
  const DOM_CAPTURE_DELAY_MS = 500;

  /**
   * Returns a monotonic timestamp when available.
   *
   * @returns {number} Milliseconds from the page performance clock or Date fallback.
   */
  function monotonicNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  /**
   * Returns the current wall-clock time as an ISO string.
   *
   * @returns {string} Current UTC wall-clock timestamp.
   */
  function wallTime() {
    return new Date().toISOString();
  }

  /**
   * Calculates a compact deterministic FNV-1a hash for a string.
   *
   * @param {string} text - Text whose exact current representation is being fingerprinted.
   * @returns {string} Eight-digit hexadecimal FNV-1a fingerprint prefixed with its algorithm name.
   */
  function hashText(text) {
    const value = String(text ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
  }

  /**
   * Updates an FNV-1a byte hash with one byte array.
   *
   * @param {number} state - Current unsigned FNV-1a state.
   * @param {Uint8Array} bytes - Bytes to fold into the running fingerprint.
   * @returns {number} Updated unsigned FNV-1a state.
   */
  function updateByteHash(state, bytes) {
    let hash = state >>> 0;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }

  /**
   * Calculates a compact deterministic FNV-1a hash for bytes.
   *
   * @param {Uint8Array} bytes - Bytes whose exact representation is being fingerprinted.
   * @returns {string} Eight-digit hexadecimal FNV-1a fingerprint prefixed with its algorithm name.
   */
  function hashBytes(bytes) {
    const hash = updateByteHash(0x811c9dc5, bytes);
    return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
  }

  /**
   * Retains a bounded head and tail representation of text.
   *
   * @param {string} text - Source text to retain without allowing an unbounded diagnostic artifact.
   * @param {number} limit - Maximum returned character count.
   * @returns {string} Original text when short enough, otherwise a head/tail snapshot within the limit.
   */
  function boundedText(text, limit) {
    const value = String(text ?? '');
    const max = Math.max(32, Math.floor(Number(limit) || 0));
    if (value.length <= max) return value;
    const omitted = value.length - max;
    const marker = `\n… ${omitted} chars omitted …\n`;
    const available = Math.max(2, max - marker.length);
    const head = Math.ceil(available / 2);
    const tail = Math.floor(available / 2);
    return value.slice(0, head) + marker + value.slice(value.length - tail);
  }

  /**
   * Creates an ordered bounded store that collapses only consecutive duplicate states.
   *
   * @param {number} maxItems - Maximum number of retained state objects.
   * @returns {{items: Array<Object>, push: function(string, Object): boolean}} Bounded state store and push operation.
   */
  function createDistinctStore(maxItems) {
    const items = [];
    const limit = Math.max(1, Math.floor(Number(maxItems) || 1));
    let lastKey = null;
    return {
      items,
      push(key, item) {
        const normalizedKey = String(key);
        if (normalizedKey === lastKey) return false;
        lastKey = normalizedKey;
        items.push(item);
        if (items.length > limit) items.splice(0, items.length - limit);
        return true;
      }
    };
  }

  /**
   * Extracts a usable request URL string from fetch input.
   *
   * @param {string|URL|Request|Object} input - Fetch request input supplied by the page.
   * @returns {string} Request URL text, or an empty string when it cannot be determined.
   */
  function fetchInputUrl(input) {
    if (typeof input === 'string') return input;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
    if (input && typeof input.url === 'string') return input.url;
    try {
      return String(input ?? '');
    } catch {
      return '';
    }
  }

  /**
   * Extracts the effective request method from fetch arguments.
   *
   * @param {string|URL|Request|Object} input - Fetch request input supplied by the page.
   * @param {Object|undefined} init - Optional fetch initialization object.
   * @returns {string} Uppercase HTTP method.
   */
  function fetchMethod(input, init) {
    return String(init?.method || input?.method || 'GET').toUpperCase();
  }

  /**
   * Determines whether a request can carry the active ChatGPT conversation representation.
   *
   * @param {string} url - Request URL to classify.
   * @returns {boolean} True for ChatGPT conversation API routes that the diagnostic should inspect.
   */
  function isRelevantConversationUrl(url) {
    const value = String(url ?? '');
    return /\/backend-api\/conversations?\//.test(value);
  }

  /**
   * Installs a fetch observer that returns the page's exact original Promise and inspects only a response clone.
   *
   * @param {Object} target - Page-realm object containing the fetch function to wrap.
   * @param {function(Object): void} onObservation - Callback receiving one completed relevant fetch observation.
   * @param {function(): number} clock - Monotonic clock used for request timing.
   * @returns {function(): void} Restore function that reinstates the original fetch implementation.
   */
  function installFetchObserver(target, onObservation, clock = monotonicNow) {
    const originalFetch = target?.fetch;
    if (typeof originalFetch !== 'function') return () => {};
    target.fetch = function(...args) {
      const url = fetchInputUrl(args[0]);
      const method = fetchMethod(args[0], args[1]);
      const relevant = isRelevantConversationUrl(url);
      const startedAt = clock();
      const promise = originalFetch.apply(this, args);
      if (relevant && promise && typeof promise.then === 'function') {
        promise.then(
          response => {
            let clone = null;
            try {
              clone = typeof response?.clone === 'function' ? response.clone() : null;
            } catch {}
            onObservation({
              transport: 'fetch',
              method,
              url,
              startedAt,
              endedAt: clock(),
              status: Number.isFinite(response?.status) ? response.status : null,
              contentType: response?.headers?.get?.('content-type') ?? null,
              contentLength: response?.headers?.get?.('content-length') ?? null,
              response: clone,
              error: null
            });
          },
          error => {
            onObservation({
              transport: 'fetch',
              method,
              url,
              startedAt,
              endedAt: clock(),
              status: null,
              contentType: null,
              contentLength: null,
              response: null,
              error: String(error?.message || error || 'fetch rejected')
            });
          }
        );
      }
      return promise;
    };
    return () => {
      target.fetch = originalFetch;
    };
  }

  /**
   * Installs passive XMLHttpRequest open/send observers without replacing response data or event delivery.
   *
   * @param {Object} target - Page-realm object containing the XMLHttpRequest constructor to wrap.
   * @param {function(Object): void} onObservation - Callback receiving one completed relevant XHR observation.
   * @param {function(): number} clock - Monotonic clock used for request timing.
   * @returns {function(): void} Restore function that reinstates original XHR prototype methods.
   */
  function installXhrObserver(target, onObservation, clock = monotonicNow) {
    const Xhr = target?.XMLHttpRequest;
    const prototype = Xhr?.prototype;
    if (!prototype || typeof prototype.open !== 'function' || typeof prototype.send !== 'function') return () => {};
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    const requestState = new WeakMap();

    prototype.open = function(method, url, ...rest) {
      requestState.set(this, {
        method: String(method || 'GET').toUpperCase(),
        url: String(url ?? ''),
        startedAt: null
      });
      return originalOpen.call(this, method, url, ...rest);
    };

    prototype.send = function(...args) {
      const state = requestState.get(this);
      if (state && isRelevantConversationUrl(state.url)) {
        state.startedAt = clock();
        this.addEventListener('loadend', () => {
          let contentType = null;
          let contentLength = null;
          try { contentType = this.getResponseHeader('content-type'); } catch {}
          try { contentLength = this.getResponseHeader('content-length'); } catch {}
          onObservation({
            transport: 'xhr',
            method: state.method,
            url: state.url,
            startedAt: state.startedAt,
            endedAt: clock(),
            status: Number.isFinite(this.status) ? this.status : null,
            contentType,
            contentLength,
            xhr: this,
            error: null
          });
        }, { once: true });
      }
      return originalSend.apply(this, args);
    };

    return () => {
      prototype.open = originalOpen;
      prototype.send = originalSend;
    };
  }

  /**
   * Returns the active conversation id encoded in the current route.
   *
   * @returns {string|null} ChatGPT conversation id, or null outside a conversation route.
   */
  function currentConversationId() {
    if (typeof location === 'undefined') return null;
    return location.pathname.match(/\/c\/([^/?#]+)/)?.[1] ?? null;
  }

  /**
   * Produces a diagnostic-safe URL that retains routing/cursor evidence while redacting likely secrets.
   *
   * @param {string} rawUrl - Original request URL.
   * @returns {string} Same-origin-style URL text with sensitive query values redacted.
   */
  function safeDiagnosticUrl(rawUrl) {
    try {
      const base = typeof location !== 'undefined' ? location.href : 'https://chatgpt.com/';
      const parsed = new URL(rawUrl, base);
      for (const [name] of parsed.searchParams) {
        if (/(?:sig|signature|token|authorization|auth|key)/i.test(name)) {
          parsed.searchParams.set(name, '[redacted]');
        }
      }
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return boundedText(String(rawUrl ?? ''), 2048);
    }
  }

  /**
   * Extracts bounded stable-id evidence from retained response/bootstrap text.
   *
   * @param {string} text - Bounded text snapshot to scan.
   * @returns {{conversationIds: string[], messageIds: string[], ids: string[]}} Deduplicated identifiers found in encounter order.
   */
  function extractIdentifiers(text) {
    const value = String(text ?? '');
    const result = { conversationIds: [], messageIds: [], ids: [] };
    const seen = {
      conversationIds: new Set(),
      messageIds: new Set(),
      ids: new Set()
    };
    const patterns = [
      ['conversationIds', /["']conversation_id["']\s*:\s*["']([^"']+)["']/g],
      ['messageIds', /["']message_id["']\s*:\s*["']([^"']+)["']/g],
      ['ids', /["']id["']\s*:\s*["']([^"']+)["']/g]
    ];
    for (const [bucket, pattern] of patterns) {
      for (const match of value.matchAll(pattern)) {
        const id = match[1];
        if (!id || seen[bucket].has(id)) continue;
        seen[bucket].add(id);
        result[bucket].push(id);
        if (result[bucket].length >= 12) break;
      }
    }
    return result;
  }

  /**
   * Reads a cloned fetch Response stream while retaining only a bounded textual head/tail snapshot.
   *
   * @param {Response|Object|null} response - Cloned fetch response; never the page's original response object.
   * @param {string|null} contentType - Response content type used to decide whether bytes are decoded as text.
   * @returns {Promise<Object|null>} Bounded body summary with observed size/hash and optional text snapshot.
   */
  async function summarizeFetchClone(response, contentType) {
    if (!response) return null;
    const textual = /(?:json|text|javascript|html|event-stream)/i.test(String(contentType || ''));
    const decoder = textual && typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
    let byteHash = 0x811c9dc5;
    let observedBytes = 0;
    let headText = '';
    let tailText = '';

    /**
     * Folds one response chunk into the bounded diagnostic body summary.
     *
     * @param {Uint8Array} bytes - Response bytes from the clone stream.
     * @param {boolean} stream - Whether TextDecoder should preserve an incomplete trailing code point.
     * @returns {void} No value is returned.
     */
    function acceptChunk(bytes, stream) {
      byteHash = updateByteHash(byteHash, bytes);
      observedBytes += bytes.byteLength;
      if (!decoder) return;
      const decoded = decoder.decode(bytes, { stream });
      if (headText.length < 4096) headText += decoded.slice(0, 4096 - headText.length);
      tailText = (tailText + decoded).slice(-Math.max(4096, MAX_NETWORK_SNAPSHOT_CHARS - 4096));
    }

    try {
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          const bytes = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value);
          acceptChunk(bytes, true);
        }
        if (decoder) {
          const finalText = decoder.decode();
          if (headText.length < 4096) headText += finalText.slice(0, 4096 - headText.length);
          tailText = (tailText + finalText).slice(-Math.max(4096, MAX_NETWORK_SNAPSHOT_CHARS - 4096));
        }
      } else if (typeof response.arrayBuffer === 'function') {
        const bytes = new Uint8Array(await response.arrayBuffer());
        acceptChunk(bytes, false);
      } else if (typeof response.text === 'function') {
        const text = await response.text();
        const encoder = new TextEncoder();
        for (let index = 0; index < text.length; index += 65536) {
          acceptChunk(encoder.encode(text.slice(index, index + 65536)), false);
        }
      } else {
        return { unavailable: 'clone body is not readable' };
      }
    } catch (error) {
      return { unavailable: String(error?.message || error || 'response clone read failed') };
    }

    let snapshot = null;
    if (decoder) {
      const marker = observedBytes > 0 && headText && tailText && headText !== tailText
        ? '\n… bounded response middle omitted …\n'
        : '';
      snapshot = boundedText(headText + marker + tailText, MAX_NETWORK_SNAPSHOT_CHARS);
    }
    return {
      observedBytes,
      bodyHash: `fnv1a32:${byteHash.toString(16).padStart(8, '0')}`,
      snapshot,
      identifiers: snapshot ? extractIdentifiers(snapshot) : null
    };
  }

  /**
   * Summarizes an XHR response after loadend without modifying its response data.
   *
   * @param {XMLHttpRequest|Object} xhr - Completed page XHR instance.
   * @returns {Object} Bounded XHR body summary suitable for the trace artifact.
   */
  function summarizeXhr(xhr) {
    try {
      const type = xhr.responseType || 'text';
      if (type === '' || type === 'text') {
        const text = String(xhr.responseText ?? '');
        const snapshot = boundedText(text, MAX_NETWORK_SNAPSHOT_CHARS);
        return {
          observedCharacters: text.length,
          bodyHash: hashText(text),
          snapshot,
          identifiers: extractIdentifiers(snapshot)
        };
      }
      if (type === 'json') {
        const text = JSON.stringify(xhr.response ?? null);
        const snapshot = boundedText(text, MAX_NETWORK_SNAPSHOT_CHARS);
        return {
          observedCharacters: text.length,
          bodyHash: hashText(text),
          snapshot,
          identifiers: extractIdentifiers(snapshot)
        };
      }
      if (type === 'arraybuffer' && xhr.response instanceof ArrayBuffer) {
        const bytes = new Uint8Array(xhr.response);
        return {
          observedBytes: bytes.byteLength,
          bodyHash: hashBytes(bytes),
          snapshot: null,
          identifiers: null
        };
      }
      return { unavailable: `unsupported responseType ${String(type)}` };
    } catch (error) {
      return { unavailable: String(error?.message || error || 'XHR response read failed') };
    }
  }

  /**
   * Creates one bounded snapshot of a mounted ChatGPT turn section.
   *
   * @param {Element|Object} section - Mounted final-tail section carrying a stable turn id.
   * @param {number} sourceOrder - Current mounted-section ordinal used only as local ordering evidence.
   * @returns {Object} Bounded turn snapshot with stable ids, hashes, lengths, and retained head/tail text.
   */
  function snapshotTurnSection(section, sourceOrder) {
    const turnId = section.getAttribute?.('data-turn-id') ?? null;
    const messageElement = section.matches?.('[data-message-id]')
      ? section
      : section.querySelector?.('[data-message-id]');
    const messageId = messageElement?.getAttribute?.('data-message-id') ?? null;
    const role = section.getAttribute?.('data-turn') ?? section.getAttribute?.('data-message-author-role') ?? null;
    const text = String(section.innerText ?? section.textContent ?? '');
    const html = String(section.outerHTML ?? '');
    return {
      sourceOrder,
      turnId,
      messageId,
      role,
      textLength: text.length,
      textHash: hashText(text),
      textSnapshot: boundedText(text, MAX_DOM_TEXT_CHARS),
      htmlLength: html.length,
      htmlHash: hashText(html),
      htmlSnapshot: boundedText(html, MAX_DOM_HTML_CHARS)
    };
  }

  /**
   * Determines whether a script node can contain active-conversation bootstrap or hydration state.
   *
   * @param {Element|Object} script - Script element whose text is being classified.
   * @param {string|null} conversationId - Current route conversation id.
   * @returns {boolean} True when the script text carries the active conversation id.
   */
  function isRelevantHydrationScript(script, conversationId) {
    if (!conversationId) return false;
    const text = String(script?.textContent ?? '');
    return text.includes(conversationId);
  }

  /**
   * Starts the passive browser logger and exposes explicit snapshot/download controls.
   *
   * @returns {Object} Public logger API exposed under the documented global name.
   */
  function startLogger() {
    const networkStore = createDistinctStore(MAX_NETWORK_ITEMS);
    const domStore = createDistinctStore(MAX_DOM_STATES);
    const hydrationStore = createDistinctStore(MAX_HYDRATION_ITEMS);
    const eventStore = createDistinctStore(MAX_EVENT_ITEMS);
    const conversationIds = new Set();
    let sequence = 0;
    let domTimer = null;

    /**
     * Allocates the next monotonically increasing trace sequence number.
     *
     * @returns {number} Next trace sequence number.
     */
    function nextSequence() {
      sequence += 1;
      return sequence;
    }

    /**
     * Records the current route conversation id when one is available.
     *
     * @returns {string|null} Current route conversation id.
     */
    function rememberConversationId() {
      const id = currentConversationId();
      if (id) conversationIds.add(id);
      return id;
    }

    /**
     * Records a bounded internal diagnostic event.
     *
     * @param {string} kind - Event category.
     * @param {Object} details - Bounded event details.
     * @returns {void} No value is returned.
     */
    function recordEvent(kind, details = {}) {
      const event = {
        sequence: nextSequence(),
        time: wallTime(),
        kind,
        ...details
      };
      eventStore.push(hashText(JSON.stringify(event)), event);
    }

    /**
     * Captures one relevant bootstrap/hydration script without retaining unbounded page state.
     *
     * @param {Element|Object} script - Script element to inspect.
     * @returns {void} No value is returned.
     */
    function captureHydrationScript(script) {
      const conversationId = rememberConversationId();
      if (!isRelevantHydrationScript(script, conversationId)) return;
      const text = String(script.textContent ?? '');
      const snapshot = boundedText(text, MAX_NETWORK_SNAPSHOT_CHARS);
      const observation = {
        sequence: nextSequence(),
        time: wallTime(),
        conversationId,
        type: script.getAttribute?.('type') ?? null,
        src: script.getAttribute?.('src') ?? null,
        textLength: text.length,
        textHash: hashText(text),
        snapshot,
        identifiers: extractIdentifiers(snapshot)
      };
      hydrationStore.push(`${observation.textHash}|${observation.src || ''}`, observation);
    }

    /**
     * Scans currently present script nodes for active-conversation hydration state.
     *
     * @returns {void} No value is returned.
     */
    function captureExistingHydration() {
      if (typeof document === 'undefined') return;
      for (const script of document.querySelectorAll?.('script') ?? []) captureHydrationScript(script);
    }

    /**
     * Captures the final mounted turn tail as one deduplicated chronological state.
     *
     * @returns {void} No value is returned.
     */
    function captureDomTail() {
      if (typeof document === 'undefined') return;
      const conversationId = rememberConversationId();
      const sections = Array.from(document.querySelectorAll?.('section[data-turn-id]') ?? []);
      const start = Math.max(0, sections.length - DOM_TAIL_TURNS);
      const turns = sections.slice(start).map((section, offset) => snapshotTurnSection(section, start + offset));
      if (!turns.length) return;
      const signature = hashText(JSON.stringify(turns.map(turn => ({
        sourceOrder: turn.sourceOrder,
        turnId: turn.turnId,
        messageId: turn.messageId,
        textLength: turn.textLength,
        textHash: turn.textHash,
        htmlLength: turn.htmlLength,
        htmlHash: turn.htmlHash
      }))));
      domStore.push(signature, {
        sequence: nextSequence(),
        time: wallTime(),
        conversationId,
        mountedTurnCount: sections.length,
        turns
      });
    }

    /**
     * Coalesces high-frequency DOM mutations into one delayed final-tail capture.
     *
     * @returns {void} No value is returned.
     */
    function scheduleDomCapture() {
      if (domTimer !== null) clearTimeout(domTimer);
      domTimer = setTimeout(() => {
        domTimer = null;
        captureDomTail();
      }, DOM_CAPTURE_DELAY_MS);
    }

    /**
     * Records a completed relevant network observation after asynchronously summarizing its body clone.
     *
     * @param {Object} observation - Low-level fetch/XHR observation from the installed wrappers.
     * @returns {Promise<void>} Promise resolved after the bounded body summary is retained.
     */
    async function recordNetworkObservation(observation) {
      try {
        rememberConversationId();
        const body = observation.transport === 'fetch'
          ? await summarizeFetchClone(observation.response, observation.contentType)
          : summarizeXhr(observation.xhr);
        const item = {
          sequence: nextSequence(),
          time: wallTime(),
          transport: observation.transport,
          method: observation.method,
          url: safeDiagnosticUrl(observation.url),
          status: observation.status,
          contentType: observation.contentType,
          declaredContentLength: observation.contentLength,
          elapsedMs: Math.max(0, Number(observation.endedAt) - Number(observation.startedAt)),
          error: observation.error,
          body
        };
        const key = hashText(JSON.stringify({
          transport: item.transport,
          method: item.method,
          url: item.url,
          status: item.status,
          bodyHash: body?.bodyHash ?? null,
          error: item.error
        }));
        networkStore.push(key, item);
      } catch (error) {
        recordEvent('network-observation-error', { message: String(error?.message || error) });
      }
    }

    /**
     * Observes added script nodes and transcript changes without writing to transcript DOM.
     *
     * @param {MutationRecord[]} mutations - Mutation batch supplied by MutationObserver.
     * @returns {void} No value is returned.
     */
    function handleMutations(mutations) {
      let transcriptPossiblyChanged = false;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' || mutation.type === 'attributes') transcriptPossiblyChanged = true;
        for (const node of mutation.addedNodes ?? []) {
          if (node?.nodeType !== 1) continue;
          if (node.matches?.('script')) captureHydrationScript(node);
          for (const script of node.querySelectorAll?.('script') ?? []) captureHydrationScript(script);
          if (node.matches?.('section[data-turn-id]') || node.querySelector?.('section[data-turn-id]')) {
            transcriptPossiblyChanged = true;
          }
        }
      }
      if (transcriptPossiblyChanged) scheduleDomCapture();
    }

    /**
     * Creates a serializable snapshot of all retained bounded evidence.
     *
     * @returns {Object} Compact diagnostic artifact object.
     */
    function snapshot() {
      captureExistingHydration();
      captureDomTail();
      return {
        schema: 'chatgpt-final-turn-state-trace/v1',
        generatedAt: wallTime(),
        page: {
          href: typeof location !== 'undefined' ? safeDiagnosticUrl(location.href) : null,
          conversationIds: Array.from(conversationIds)
        },
        limits: {
          networkItems: MAX_NETWORK_ITEMS,
          domStates: MAX_DOM_STATES,
          hydrationItems: MAX_HYDRATION_ITEMS,
          networkSnapshotChars: MAX_NETWORK_SNAPSHOT_CHARS,
          domTextChars: MAX_DOM_TEXT_CHARS,
          domHtmlChars: MAX_DOM_HTML_CHARS,
          domTailTurns: DOM_TAIL_TURNS
        },
        network: networkStore.items.slice(),
        hydration: hydrationStore.items.slice(),
        domStates: domStore.items.slice(),
        events: eventStore.items.slice()
      };
    }

    /**
     * Downloads the current bounded diagnostic artifact after an explicit caller action.
     *
     * @returns {Object} Same serializable snapshot written to the downloaded JSON file.
     */
    function download() {
      const artifact = snapshot();
      const json = JSON.stringify(artifact, null, 2) + '\n';
      const blob = new Blob([json], { type: 'application/json' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const conversationId = currentConversationId() || 'unknown';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = objectUrl;
      link.download = `chatgpt-final-turn-trace-${conversationId}-${stamp}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      return artifact;
    }

    installFetchObserver(globalThis, observation => { void recordNetworkObservation(observation); });
    installXhrObserver(globalThis, observation => { void recordNetworkObservation(observation); });

    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      const observer = new MutationObserver(handleMutations);
      observer.observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-turn-id', 'data-message-id', 'data-turn', 'data-message-author-role']
      });
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', () => {
        captureExistingHydration();
        scheduleDomCapture();
      }, { once: true });
    }

    rememberConversationId();
    recordEvent('logger-started', {
      routeConversationId: currentConversationId(),
      instruction: `${PUBLIC_API_NAME}.download()`
    });
    console.info(`[FinalTurnLogger] Passive trace active. Export with ${PUBLIC_API_NAME}.download()`);

    return Object.freeze({
      snapshot,
      download
    });
  }

  const testApi = Object.freeze({
    boundedText,
    createDistinctStore,
    hashText,
    hashBytes,
    installFetchObserver,
    installXhrObserver,
    isRelevantConversationUrl
  });

  if (globalThis?.[TEST_MODE_NAME]) {
    globalThis[TEST_API_NAME] = testApi;
    return;
  }

  if (!globalThis[PUBLIC_API_NAME]) {
    globalThis[PUBLIC_API_NAME] = startLogger();
  }
})();
