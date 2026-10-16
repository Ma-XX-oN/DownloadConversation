  /** V1 per-page secret-redaction identity. Neither key nor CryptoKey is serialized. */
  /** Public random scope label bytes; never derive these from the secret key. */
  const communicationMarkerV1ScopeBytes = typeof crypto === 'undefined'
    ? null : crypto.getRandomValues(new Uint8Array(16));
  /** Ephemeral 256-bit HMAC key material; cleared after import. */
  const communicationMarkerV1Secret = typeof crypto === 'undefined'
    ? null : crypto.getRandomValues(new Uint8Array(32));
  /** Lowercase public recorder-instance identity label. */
  const communicationMarkerV1Scope = communicationMarkerV1ScopeBytes && Array.from(communicationMarkerV1ScopeBytes,
    byte => byte.toString(16).padStart(2, '0')).join('');
  /** Nonextractable in-memory HMAC signing key promise. */
  const communicationMarkerV1Key = communicationMarkerV1Secret && crypto.subtle.importKey(
    'raw', communicationMarkerV1Secret, { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  ).then(key => {
    communicationMarkerV1Secret.fill(0);
    return key;
  });
  /** Explicit marker format negotiated by each recording segment. */
  const COMMUNICATION_MARKER_FORMAT = 'dc-secret-marker/1';
  /** Upper bound on one withheld logical candidate in UTF-8 bytes. */
  const COMMUNICATION_MARKER_MAX_VALUE = 1024 * 1024;
  /** Maximum staged encoded body size before the entire body is withheld. */
  const COMMUNICATION_MARKER_MAX_STAGED_CHARS = 16 * 1024 * 1024;
  /** Reusable strict UTF-8 encoder for canonical marker inputs. */
  const communicationMarkerEncoder = typeof TextEncoder === 'undefined' ? null : new TextEncoder();

  /** Shared V1 application contexts; absent means a detector is inapplicable. */
  const communicationMarkerV1Contexts = Object.freeze({
    'http.header.value': true, 'http.query.value': true,
    'json.string': true, 'sse.data.json.string': true,
    'ws.text.json.string': true
  });
  /**
   * Explicit type/context registry for secret value recognition.
   * Synthetic reconstruction belongs to the separate RWF decoder.
   */
  const communicationMarkerV1Registry = Object.freeze(
    Object.fromEntries(['U', 'H', 'B', 'P', 'J', 'O'].map(type => [
      type, Object.freeze({
        contexts: communicationMarkerV1Contexts,
        identify(text, context) {
          const contextId = typeof context === 'string' ? context : context?.id;
          const explicitlySecret = typeof context === 'object' && context?.secret_span === true;
          return communicationMarkerV1Candidates(text, contextId, explicitlySecret)
            .find(item => item.type === type) ?? null;
        },
        reconstruct() {
          throw new Error('redaction-decoder-only');
        }
      })
    ]))
  );

  /**
   * Convert a digest prefix into canonical lowercase hexadecimal.
   *
   * @param {ArrayBuffer|Uint8Array} bytes - Hash or HMAC result bytes.
   * @param {number} count - Number of digest bytes to retain.
   * @returns {string} Lowercase hexadecimal digest prefix.
   */
  function communicationMarkerV1Hex(bytes, count) {
    return Array.from(new Uint8Array(bytes).slice(0, count),
      byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Identify complete values only in explicitly supported contexts.
   *
   * @param {string} value - Complete unescaped logical value.
   * @param {string} context - Registered transport-specific value context.
   * @param {boolean} classified - Whether an explicit sensitive span allows opaque values.
   * @returns {Array<Object>} All matching canonical type descriptors.
   */
  function communicationMarkerV1Candidates(value, context, classified = false) {
    const allowed = ['http.header.value', 'http.query.value', 'json.string',
      'sse.data.json.string', 'ws.text.json.string'];
    if (!allowed.includes(context)) return [];
    const matches = [];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
      matches.push({ type: 'U', params: null });
    }
    if (/^g-p-[0-9a-f]{32}$/.test(value)) {
      matches.push({ type: 'P', params: null });
    }
    if (/^[0-9a-f]{2,256}$/.test(value) && value.length % 2 === 0) {
      matches.push({ type: 'H', params: String(value.length) });
    }
    if (!matches.some(item => item.type === 'U' || item.type === 'P') &&
        /^[A-Za-z0-9_-]{4,256}$/.test(value) && value.length % 4 !== 1) {
      try {
        const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') +
          '='.repeat((4 - value.length % 4) % 4));
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        const last = alphabet.indexOf(value.at(-1));
        const padBits = value.length % 4 === 2 ? 15 : value.length % 4 === 3 ? 3 : 0;
        if (raw.length > 0 && (last & padBits) === 0) {
          matches.push({ type: 'B', params: String(value.length) });
        }
      } catch {}
    }
    const parts = value.split('.');
    const jwtAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    if (parts.length === 3 && parts.every(part => {
      const mod = part.length % 4;
      const padMask = mod === 2 ? 15 : mod === 3 ? 3 : 0;
      return /^[A-Za-z0-9_-]{4,512}$/.test(part) && mod !== 1 &&
        (jwtAlphabet.indexOf(part.at(-1)) & padMask) === 0;
    })) {
      try {
        const decoded = parts.slice(0, 2).map(part =>
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
            Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/') +
              '='.repeat((4 - part.length % 4) % 4)), char => char.charCodeAt(0))
          )));
        if (decoded.every(part => part !== null && typeof part === 'object' &&
            !Array.isArray(part)) && parts.join('').length <= 1024) {
          matches.push({ type: 'J', params: parts.map(part => part.length).join(',') });
        }
      } catch {}
    }
    if (classified && matches.length === 0 && value.length > 0) {
      const scalars = Array.from(value);
      if (scalars.length <= 128 && scalars.every(character =>
        !/[\u0000-\u001f\u007f]/u.test(character) &&
        !/[\ud800-\udfff]/u.test(character))) {
        matches.push({
          type: 'O',
          params: scalars.map(character =>
            String(communicationMarkerEncoder.encode(character).length)).join('')
        });
      }
    }
    return matches.filter(item =>
      communicationMarkerV1Registry[item.type]?.contexts[context] === true
    );
  }

  /**
   * Derive a checked synthetic marker without returning the source value.
   *
   * @param {string} value - Complete unescaped logical value.
   * @param {string} context - Registered inspection context.
   * @param {boolean} classified - Whether this value has explicit secret-span metadata.
   * @param {Array<string>|null} enabledTypes - Optional strict type selection for a registered context.
   * @returns {Promise<string|null>} Checked marker or null for an ordinary unclassified value.
   */
  async function communicationMarkerV1Make(value, context, classified = false, enabledTypes = null) {
    if (typeof value !== 'string' || /[\ud800-\udfff]/u.test(
      value.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''))) {
      throw new Error('redaction-invalid-unicode');
    }
    if (!communicationMarkerV1Key || !communicationMarkerEncoder) throw new Error('redaction-crypto-unavailable');
    const choices = communicationMarkerV1Candidates(value, context, classified)
      .filter(item => enabledTypes === null || enabledTypes.includes(item.type));
    if (choices.length > 1) throw new Error('redaction-ambiguous-type');
    if (choices.length === 0) {
      if (classified) throw new Error('redaction-unsupported-sensitive-value');
      return null;
    }
    const bytes = communicationMarkerEncoder.encode(value);
    if (bytes.length > COMMUNICATION_MARKER_MAX_VALUE) {
      throw new Error('redaction-candidate-too-long');
    }
    const size = new Uint8Array(4);
    new DataView(size.buffer).setUint32(0, bytes.length, false);
    const prefix = communicationMarkerEncoder.encode('DC-SECRET-ID-V1\0');
    const message = new Uint8Array(prefix.length + size.length + bytes.length);
    message.set(prefix);
    message.set(size, prefix.length);
    message.set(bytes, prefix.length + size.length);
    const id = communicationMarkerV1Hex(
      await crypto.subtle.sign('HMAC', await communicationMarkerV1Key, message), 24
    );
    const { type, params } = choices[0];
    const body = type + '/' + id + (params === null ? '' : '/' + params);
    const checksum = communicationMarkerEncoder.encode('DC-SECRET-MARKER-V1\0' + body);
    const check = communicationMarkerV1Hex(await crypto.subtle.digest('SHA-256', checksum), 16);
    return '[' + check + '/' + body + ']';
  }

  /**
   * Reject only fully checksum-validated marker syntax as a literal collision.
   *
   * @param {string} value - Complete source string to examine.
   * @returns {Promise<void>} Rejects reserved syntax, not ordinary brackets.
   */
  async function communicationMarkerV1RejectCollision(value) {
    const pattern = /\[([0-9a-f]{32})\/([UHBPJO]\/[0-9a-f]{48}(?:\/[a-z0-9,]{1,256})?)\]/g;
    for (const match of String(value).matchAll(pattern)) {
      const expected = communicationMarkerV1Hex(
        await crypto.subtle.digest('SHA-256',
          communicationMarkerEncoder.encode('DC-SECRET-MARKER-V1\0' + match[2])), 16
      );
      if (match[1] === expected) throw new Error('redaction-literal-marker-collision');
    }
  }

