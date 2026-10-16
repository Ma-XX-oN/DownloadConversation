  /** V1 per-page secret-redaction identity. Neither key nor CryptoKey is serialized. */
  const communicationMarkerV1ScopeBytes = crypto.getRandomValues(new Uint8Array(16));
  const communicationMarkerV1Secret = crypto.getRandomValues(new Uint8Array(32));
  const communicationMarkerV1Scope = Array.from(communicationMarkerV1ScopeBytes,
    byte => byte.toString(16).padStart(2, '0')).join('');
  const communicationMarkerV1Key = crypto.subtle.importKey(
    'raw', communicationMarkerV1Secret, { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  communicationMarkerV1Secret.fill(0);
  const COMMUNICATION_MARKER_FORMAT = 'dc-secret-marker/1';
  const COMMUNICATION_MARKER_MAX_VALUE = 1024 * 1024;
  const communicationMarkerEncoder = new TextEncoder();

  /** Convert digest bytes to lowercase hexadecimal. */
  function communicationMarkerV1Hex(bytes, count) {
    return Array.from(new Uint8Array(bytes).slice(0, count),
      byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /** Restrict recognition to canonical complete logical values. */
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
    if (/^[A-Za-z0-9_-]{4,256}$/.test(value) && value.length % 4 !== 1) {
      try {
        const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') +
          '='.repeat((4 - value.length % 4) % 4));
        const canonical = btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        if (canonical === value) matches.push({ type: 'B', params: String(value.length) });
      } catch {}
    }
    const parts = value.split('.');
    if (parts.length === 3 && parts.every(part =>
      /^[A-Za-z0-9_-]{4,512}$/.test(part) && part.length % 4 !== 1)) {
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
    return matches;
  }

  /** Produce one contract-exact checked marker, never returning the secret itself. */
  async function communicationMarkerV1Make(value, context, classified = false) {
    if (typeof value !== 'string' || /[\ud800-\udfff]/u.test(
      value.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''))) {
      throw new Error('redaction-invalid-unicode');
    }
    const choices = communicationMarkerV1Candidates(value, context, classified);
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

  /** Explicitly reject already checked markers as ambiguous literal user data. */
  function communicationMarkerV1RejectCollision(value) {
    if (/\[[0-9a-f]{32}\/[UHBPJO]\/[0-9a-f]{48}(?:\/[a-z0-9,]{1,256})?\]/.test(value)) {
      throw new Error('redaction-literal-marker-collision');
    }
  }

  /** Read exactly one JSON string token without exposing an unfinished value. */
  async function communicationMarkerV1JsonString(state, source) {
    let decoded;
    try { decoded = JSON.parse(source); } catch { throw new Error('redaction-invalid-json-string'); }
    if (state.expectKey) {
      state.key = decoded;
      state.expectKey = false;
      return source;
    }
    const sensitive = /(?:authorization|cookie|session|jwt|secret|token|api[_-]?key|password|credential)/i
      .test(String(state.key ?? ''));
    communicationMarkerV1RejectCollision(decoded);
    const marker = await communicationMarkerV1Make(decoded, state.context, sensitive);
    return marker === null ? source : JSON.stringify(marker);
  }

  /** Create a bounded streaming JSON-token encoder; no persisted secret buffers. */
  function communicationMarkerV1JsonState(context = 'json.string') {
    return {
      context, quoted: false, escaped: false, token: '', stack: [],
      key: null, expectKey: false
    };
  }

  /** Encode original JSON in one left-to-right pass over arbitrary chunks. */
  async function communicationMarkerV1JsonFeed(state, input, flush = false) {
    const out = [];
    let plain = '';
    for (const char of String(input ?? '')) {
      if (state.quoted) {
        state.token += char;
        if (state.token.length > COMMUNICATION_MARKER_MAX_VALUE) {
          throw new Error('redaction-candidate-too-long');
        }
        if (state.escaped) state.escaped = false;
        else if (char === '\\') state.escaped = true;
        else if (char === '"') {
          out.push(plain);
          plain = '';
          out.push(await communicationMarkerV1JsonString(state, state.token));
          state.token = '';
          state.quoted = false;
        }
        continue;
      }
      if (char === '"') {
        state.quoted = true;
        state.token = '"';
        continue;
      }
      plain += char;
      if (char === '{') state.stack.push({ kind: 'object', key: null });
      else if (char === '[') state.stack.push({ kind: 'array' });
      else if (char === '}' || char === ']') state.stack.pop();
      else if (char === ',' && state.stack.at(-1)?.kind === 'object') {
        state.stack.at(-1).key = null;
      }
      state.expectKey = state.stack.at(-1)?.kind === 'object' &&
        state.stack.at(-1).key === null &&
        !/:\s*$/.test(plain);
      if (char === ':' && state.stack.at(-1)?.kind === 'object') {
        state.stack.at(-1).key = state.key;
        state.expectKey = false;
      }
      if (state.stack.at(-1)?.kind === 'object' &&
          state.stack.at(-1).key !== null) state.key = state.stack.at(-1).key;
    }
    out.push(plain);
    if (flush && state.quoted) throw new Error('redaction-incomplete-json-string');
    return out.join('');
  }
