
  /**
   * Installs the isolated COMM processor on a dedicated Worker scope.
   * @param {Object} scope - Worker message target.
   * @param {Object} sink - Worker-local output writer.
   * @returns {Object} Output from cscCommWorkerProcessing.
   */

  function cscCommWorkerProcessing(scope, sink) {
    const encoder = new TextEncoder(); const maxQueue = 16; const maxChunk = 32768; const maxValue = 1024 * 1024; const allowedModes = ['replay-essentials', 'everything']; const records = []; const stagedKeys = new Map();
    let working = false; let key = null; let keyGeneration = null; let scopeId = null; let policy = Object.freeze({
      mode: 'replay-essentials', binary: false,
      cross_origin: false, auth_headers: false, all: false,
      origin: 'https://chatgpt.com'
    }); const statuses = new Set([
      'selected', 'unselected', 'unsupported', 'inaccessible',
      'rejected', 'failed', 'completed'
    ]);
    /**
     * Rejects an invariant violation without leaking source content.
     * @param {string} reason - Input reason for fail.
     * @returns {never} Output from fail.
     */
    function fail(reason) {
      throw new Error(reason);
    }
    /**
     * Validates and freezes Worker capture options.
     * @param {Object} next - Input next for options.
     * @returns {void} No value is returned.
     */
    function options(next) {
      if (!next || !allowedModes.includes(next.mode) ||
          typeof next.origin !== 'string' ||
          !/^https?:\/\/[^/]+$/.test(next.origin)) fail('csc-invalid-policy');
      for (const flag of ['binary', 'cross_origin', 'auth_headers', 'all']) {
        if (typeof next[flag] !== 'boolean') fail('csc-invalid-policy');
      }
      policy = Object.freeze({
        mode: next.mode, origin: next.origin,
        binary: next.binary || next.all,
        cross_origin: next.cross_origin || next.all,
        auth_headers: next.auth_headers || next.all,
        all: next.all
      });
    }
    /**
     * Reports only nonsecret processing provenance to the page.
     * @param {Object} event - Input event for sendStatus.
     * @param {string} status - Input status for sendStatus.
     * @param {string} reason - Input reason for sendStatus.
     * @param {Object} counts - Input counts for sendStatus.
     * @returns {void} No value is returned.
     */
    function sendStatus(event, status, reason, counts) {
      if (!statuses.has(status)) fail('csc-invalid-status');
      // Only nonsecret identifiers and counts cross back to the page.
      scope.postMessage({
        type: 'csc-comm-status', capture_id: String(event.capture_id ?? ''),
        network_sequence: Number(event.network_sequence ?? 0),
        status, reason, source_bytes: counts?.source_known === false ? null : counts?.source ?? 0,
        derived_json_utf8_bytes: counts?.source_known === false ? counts.derived : null,
        emitted_bytes: counts?.emitted ?? 0,
        durable: false
      });
    }
    /**
     * Maps private error values onto public nonsecret failure classes.
     * @param {unknown} error - Input error for safeError.
     * @returns {string} Output from safeError.
     */
    function safeError(error) {
      const name = String(error?.message ?? ''); return /^csc-[a-z0-9-]+$/.test(name) ? name : 'csc-processing-error';
    }
    /**
     * Identifies explicitly authentication-bearing header names.
     * @param {string} name - Input name for isAuth.
     * @returns {boolean} Output from isAuth.
     */
    function isAuth(name) {
      return /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i.test(name);
    }
    /**
     * Encodes a fixed digest prefix in lower-case hexadecimal.
     * @param {Uint8Array} bytes - Input bytes for toHex.
     * @param {number} count - Input count for toHex.
     * @returns {string} Output from toHex.
     */
    function toHex(bytes, count) {
      return Array.from(new Uint8Array(bytes).slice(0, count),
        byte => byte.toString(16).padStart(2, '0')).join('');
    }
    /**
     * Checks the canonical unpadded Base64URL alphabet and length.
     * @param {string} value - Input value for isBase64Url.
     * @returns {boolean} Output from isBase64Url.
     */
    function isBase64Url(value) {
      if (!/^[A-Za-z0-9_-]{4,256}$/.test(value) || value.length % 4 === 1) return false; const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; const mask = value.length % 4 === 2 ? 15 : value.length % 4 === 3 ? 3 : 0;
      if ((alphabet.indexOf(value.at(-1)) & mask) !== 0) return false;
      try { return atob(value.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - value.length % 4) % 4)).length > 0; }
      catch { return false; }
    }
    /**
     * Identifies known V1 secret shapes within a specific context.
     * @param {string} value - Input value for candidate.
     * @param {string} context - Input context for candidate.
     * @param {boolean} classified - Input classified for candidate.
     * @returns {Array} Output from candidate.
     */
    function candidate(value, context, classified) {
      const supported = ['json.string', 'sse.data.json.string',
        'ws.text.json.string', 'http.header.value', 'http.query.value'];
      if (!supported.includes(context)) fail('csc-unsupported-context'); const found = [];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
        found.push({ type: 'U', params: null });
      } else if (/^g-p-[0-9a-f]{32}$/.test(value)) {
        found.push({ type: 'P', params: null });
      } else {
        if (/^[0-9a-f]{2,256}$/.test(value) && value.length % 2 === 0) {
          found.push({ type: 'H', params: String(value.length) });
        }
        if (isBase64Url(value)) found.push({ type: 'B', params: String(value.length) }); const parts = value.split('.');
        if (parts.length === 3 && parts.every(part => part.length >= 4 &&
            part.length <= 512 && isBase64Url(part)) &&
            parts.join('').length <= 1024) {
          try {
            const parsed = parts.slice(0, 2).map(part =>
              JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
                Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/') +
                  '='.repeat((4 - part.length % 4) % 4)), ch => ch.charCodeAt(0))
              )));
            if (parsed.every(p => p !== null && typeof p === 'object' && !Array.isArray(p))) {
              found.push({ type: 'J', params: parts.map(p => p.length).join(',') });
            }
          } catch {}
        }
      }
      if (classified && found.length === 0 && value.length > 0) {
        const points = Array.from(value);
        if (points.length <= 128 && points.every(ch =>
          !/[\u0000-\u001f\u007f]/u.test(ch) &&
          !/[\ud800-\udfff]/u.test(ch))) {
          found.push({
            type: 'O', params: points.map(ch => encoder.encode(ch).length).join('')
          });
        }
      }
      return found;
    }
    /**
     * Encodes a versioned checked HMAC secret marker.
     * @param {string} value - Input value for marker.
     * @param {string} context - Input context for marker.
     * @param {boolean} classified - Input classified for marker.
     * @returns {Promise<string|null>} Output from marker.
     */
    async function marker(value, context, classified = false) {
      if (!key) fail('csc-key-unavailable');
      if (typeof value !== 'string' ||
          /[\ud800-\udfff]/u.test(value.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''))) {
        fail('csc-invalid-unicode');
      }
      if (/\[[0-9a-f]{32}\/[UHBPJO]\/[0-9a-f]{48}/.test(value)) fail('csc-marker-collision'); const bytes = encoder.encode(value);
      if (bytes.length > maxValue) fail('csc-candidate-too-long'); const found = candidate(value, context, classified);
      if (found.length > 1) fail('csc-ambiguous-secret-type');
      if (!found.length) {
        if (classified) fail('csc-unsupported-sensitive-value'); return null;
      }
      const length = new Uint8Array(4);
      new DataView(length.buffer).setUint32(0, bytes.length, false); const prefix = encoder.encode('DC-SECRET-ID-V1\0'); const message = new Uint8Array(prefix.length + 4 + bytes.length);
      message.set(prefix); message.set(length, prefix.length);
      message.set(bytes, prefix.length + 4); const id = toHex(await crypto.subtle.sign('HMAC', key, message), 24); const chosen = found[0]; const body = chosen.type + '/' + id +
        (chosen.params === null ? '' : '/' + chosen.params); const check = toHex(await crypto.subtle.digest('SHA-256',
        encoder.encode('DC-SECRET-MARKER-V1\0' + body)), 16); return '[' + check + '/' + body + ']';
    }
    /**
     * Transforms URL query values without persisting credentials.
     * @param {string} value - Input value for safeUrl.
     * @returns {Promise<string>} Output from safeUrl.
     */
    async function safeUrl(value) {
      let url;
      try { url = new URL(value, policy.origin); }
      catch { fail('csc-invalid-url'); }
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
        fail('csc-unsupported-url-scheme');
      }
      // URLSearchParams canonicalises escaping; source counts remain distinct.
      for (const [name, val] of url.searchParams) {
        const classified = /(?:auth|cookie|session|token|secret|password|key|signature)/i.test(name); const replacement = await marker(val, 'http.query.value', classified);
        if (replacement !== null) url.searchParams.set(name, replacement);
      }
      url.username = ''; url.password = ''; url.hash = ''; return url.href;
    }
    /**
     * Filters headers by explicit risk and option policy.
     * @param {Array|String} source - Input source for safeHeaders.
     * @returns {Promise<Object>} Output from safeHeaders.
     */
    async function safeHeaders(source) {
      const pairs = Array.isArray(source) ? source :
        typeof source === 'string' ? source.split(/\r?\n/).filter(Boolean)
          .map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()])
          : []; const safe = []; const omitted = [];
      for (const pair of pairs) {
        if (!Array.isArray(pair) || pair.length !== 2 ||
            typeof pair[0] !== 'string' || typeof pair[1] !== 'string' ||
            !/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(pair[0])) {
          fail('csc-malformed-header');
        }
        const name = pair[0].toLowerCase();
        if (isAuth(name)) {
          if (!policy.auth_headers) {
            omitted.push(name);
          } else {
            safe.push([name, await marker(pair[1], 'http.header.value', true)]);
          }
          continue;
        }
        // Only known structural headers are safe without inspecting a secret.
        if (!['content-type', 'content-length', 'content-encoding',
          'accept', 'accept-encoding', 'cache-control',
          'transfer-encoding'].includes(name)) {
          omitted.push(name);
          continue;
        }
        if (/[\r\n]/.test(pair[1])) fail('csc-malformed-header');
        safe.push([name, pair[1]]);
      }
      return { safe, omitted };
    }
    /**
     * Selects a capture outcome and transport codec.
     * @param {Object} event - Input event for selected.
     * @returns {Object} Output from selected.
     */
    function selected(event) {
      if (event.body_state === 'unavailable' ||
          (event.body_available === false && event.value == null)) {
        return { status: 'inaccessible', reason: 'csc-body-inaccessible' };
      }
      const url = String(event.url ?? event.request_url ?? event.response_url ?? ''); let parsed;
      try { parsed = new URL(url, policy.origin); }
      catch { return { status: 'rejected', reason: 'csc-invalid-url' }; }
      const comparableOrigin = parsed.protocol === 'wss:' ? 'https://' + parsed.host :
        parsed.protocol === 'ws:' ? 'http://' + parsed.host : parsed.origin;
      if (comparableOrigin !== policy.origin && !policy.cross_origin) {
        return { status: 'unselected', reason: 'csc-cross-origin-not-selected' };
      }
      const type = String(event.body_type ?? event.response_type ??
        (Array.isArray(event.headers) ? event.headers.find(h =>
          String(h[0]).toLowerCase() === 'content-type')?.[1] : '') ?? '').toLowerCase(); const isJson = /(?:^|\/)(?:json|[^/;]+\+json)(?:;|$)/.test(type) ||
        (event.transport === 'websocket' && typeof event.value === 'string' &&
          /^[\s]*[\[{]/.test(event.value)); const isSse = type.startsWith('text/event-stream'); const raw = event.value;
      const binaryValue = Object.prototype.toString.call(raw) === '[object ArrayBuffer]' ||
        Object.prototype.toString.call(raw) === '[object Blob]' ||
        ArrayBuffer.isView(raw);
      const binary = binaryValue || type.includes('octet-stream') ||
        type.includes('image/') || type.includes('audio/') ||
        type.includes('video/') || event.body_type === 'binary' ||
        event.response_type === 'arraybuffer';
      if (binary && !policy.binary) {
        return { status: 'unselected', reason: 'csc-binary-not-selected' };
      }
      if (binary) return { status: 'selected', kind: 'binary' };
      if (isSse) return { status: 'selected', kind: 'sse' };
      if (isJson) return { status: 'selected', kind: 'json' };
      if (policy.mode === 'everything') {
        return { status: 'unsupported', reason: 'csc-unsupported-text-format' };
      }
      return { status: 'unselected', reason: 'csc-outside-replay-scope' };
    }
    /**
     * Creates a fresh bounded lexical parser state.
     * @param {string} context - Input context for jsonState.
     * @returns {Object} Output from jsonState.
     */
