  /** V1 per-page secret-redaction identity. Neither key nor CryptoKey is serialized. */
  const communicationMarkerV1ScopeBytes = crypto.getRandomValues(new Uint8Array(16));
  const communicationMarkerV1Secret = crypto.getRandomValues(new Uint8Array(32));
  const communicationMarkerV1Scope = Array.from(communicationMarkerV1ScopeBytes,
    byte => byte.toString(16).padStart(2, '0')).join('');
  const communicationMarkerV1Key = crypto.subtle.importKey(
    'raw', communicationMarkerV1Secret, { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  ).then(key => {
    communicationMarkerV1Secret.fill(0);
    return key;
  });
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
    if (!matches.some(item => item.type === 'U' || item.type === 'P') &&
        /^[A-Za-z0-9_-]{4,256}$/.test(value) && value.length % 4 !== 1) {
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
  async function communicationMarkerV1Make(value, context, classified = false, enabledTypes = null) {
    if (typeof value !== 'string' || /[\ud800-\udfff]/u.test(
      value.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''))) {
      throw new Error('redaction-invalid-unicode');
    }
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
    if (flush && (state.quoted || state.stack.length > 0)) {
      throw new Error('redaction-incomplete-json');
    }
    return out.join('');
  }

  /** Keep incomplete protocol framing private until one complete SSE event. */
  function communicationMarkerV1BodyState(contentType, transport) {
    const media = String(contentType ?? '').split(';', 1)[0].trim().toLowerCase();
    const kind = media === 'text/event-stream' ? 'sse' :
      /(?:^application\/(?:json|[^/]+\+json|x-component)$)/.test(media) ||
      (transport === 'websocket' && media === 'application/json') ? 'json' : null;
    return {
      kind,
      context: kind === 'sse' ? 'sse.data.json.string' :
        transport === 'websocket' ? 'ws.text.json.string' : 'json.string',
      json: kind === 'json'
        ? communicationMarkerV1JsonState(transport === 'websocket'
          ? 'ws.text.json.string' : 'json.string') : null,
      pendingEvent: ''
    };
  }

  /** Perform a single forward scan without returning unsupported body bytes. */
  async function communicationMarkerV1BodyFeed(state, input, flush = false) {
    if (state.kind === 'json') return communicationMarkerV1JsonFeed(state.json, input, flush);
    if (state.kind !== 'sse') throw new Error('redaction-unsupported-content-type');
    state.pendingEvent += String(input ?? '');
    if (state.pendingEvent.length > COMMUNICATION_MARKER_MAX_VALUE) {
      throw new Error('redaction-event-too-long');
    }
    let output = '';
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(state.pendingEvent);
      if (!boundary) break;
      const event = state.pendingEvent.slice(0, boundary.index);
      state.pendingEvent = state.pendingEvent.slice(boundary.index + boundary[0].length);
      const lines = event.split(/\r?\n/);
      const dataIndices = lines.map((line, index) =>
        /^data:/.test(line) ? index : -1).filter(index => index >= 0);
      if (dataIndices.length === 1) {
        const index = dataIndices[0];
        const line = lines[index];
        const prefix = /^data: ?/.exec(line)[0];
        const body = line.slice(prefix.length);
        if (!body.trimStart().startsWith('{') && !body.trimStart().startsWith('[')) {
          throw new Error('redaction-unsupported-sse-data');
        }
        const encoder = communicationMarkerV1JsonState('sse.data.json.string');
        lines[index] = prefix + await communicationMarkerV1JsonFeed(encoder, body, true);
      } else if (dataIndices.length > 1) {
        throw new Error('redaction-unsupported-multiline-sse');
      }
      output += lines.join(event.includes('\r\n') ? '\r\n' : '\n') + boundary[0];
    }
    if (flush && state.pendingEvent) throw new Error('redaction-incomplete-sse-event');
    return output;
  }

  /** Encode URL query values by context, never storing a failed sensitive URL. */
  async function communicationMarkerV1SafeUrl(url) {
    try {
      const parsed = new URL(String(url ?? ''), location.href);
      for (const [name, original] of parsed.searchParams) {
        const classified = /(?:token|secret|auth|key|jwt|signature|session|cookie|password)/i
          .test(name);
        communicationMarkerV1RejectCollision(original);
        const marker = await communicationMarkerV1Make(
          original, 'http.query.value', classified
        );
        if (marker !== null) parsed.searchParams.set(name, marker);
      }
      parsed.username = '';
      parsed.password = '';
      return parsed.href;
    } catch {
      return '[redaction-failed-url]';
    }
  }
