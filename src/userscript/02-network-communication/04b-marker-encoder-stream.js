  /**
   * Encode one complete JSON string token, preserving object-key identity.
   *
   * @param {Object} state - Current JSON lexical state.
   * @param {string} token - Complete JSON string token.
   * @param {string} role - Whether token is object key or value.
   * @returns {Promise<string>} Safe JSON token.
   */
  async function communicationMarkerV1JsonString(state, token, role) {
    let value;
    try { value = JSON.parse(token); }
    catch { throw new Error('redaction-invalid-json-string'); }
    if (role === 'key') return token;
    const frame = state.stack.at(-1);
    const key = frame?.kind === 'object' ? frame.key : null;
    await communicationMarkerV1RejectCollision(value);
    const marker = await communicationMarkerV1Make(value, state.context);
    if (marker !== null) return JSON.stringify(marker);
    if (/(?:authorization|cookie|session|jwt|secret|token|api[_-]?key|password|credential)/i
      .test(String(key ?? ''))) {
      throw new Error('redaction-unsupported-sensitive-value');
    }
    return token;
  }

  /**
   * Create strict incremental JSON container state.
   *
   * @param {string} context - Registered transport context.
   * @returns {Object} Mutable token and container state.
   */
  function communicationMarkerV1JsonState(context = 'json.string') {
    return {
      context, stack: [], root: 'value', quoted: false, escaped: false,
      token: '', tokenBytes: 0, role: null, primitive: ''
    };
  }

  /**
   * Identify where a JSON value is legal in the current container.
   *
   * @param {Object} state - Incremental JSON parser state.
   * @returns {boolean} Whether a value can begin.
   */
  function communicationMarkerV1JsonExpectsValue(state) {
    const frame = state.stack.at(-1);
    return frame ? frame.phase === 'value' || frame.phase === 'valueOrEnd'
      : state.root === 'value';
  }

  /**
   * Complete a value within its immediate parent, never changing outer keys.
   *
   * @param {Object} state - Incremental JSON parser state.
   * @returns {void} No return value.
   */
  function communicationMarkerV1JsonComplete(state) {
    const frame = state.stack.at(-1);
    if (!frame) {
      if (state.root !== 'value') throw new Error('redaction-invalid-json');
      state.root = 'done';
    } else {
      if (frame.phase !== 'value' && frame.phase !== 'valueOrEnd') {
        throw new Error('redaction-invalid-json');
      }
      frame.phase = 'commaOrEnd';
    }
  }

  /**
   * Parse a complete primitive without accepting invalid literals or numbers.
   *
   * @param {Object} state - Mutable JSON parser state.
   * @param {Array<string>} output - Safe emitted-token fragments.
   * @returns {void} No return value.
   */
  function communicationMarkerV1JsonPrimitive(state, output) {
    try {
      const parsed = JSON.parse(state.primitive);
      if (parsed !== null && typeof parsed !== 'boolean' &&
          (typeof parsed !== 'number' || !Number.isFinite(parsed))) {
        throw new Error('invalid');
      }
    } catch { throw new Error('redaction-invalid-json-primitive'); }
    output.push(state.primitive);
    state.primitive = '';
    communicationMarkerV1JsonComplete(state);
  }

  /**
   * Incrementally validate JSON and encode complete strings across splits.
   *
   * @param {Object} state - Mutable lexical state.
   * @param {string} input - Next UTF-16 fragment from a decoder.
   * @param {boolean} flush - True only at logical EOF.
   * @returns {Promise<string>} Safe completed JSON prefix.
   */
  async function communicationMarkerV1JsonFeed(state, input, flush = false) {
    const output = [];
    const source = String(input ?? '');
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (state.quoted) {
        state.token += char;
        state.tokenBytes += communicationMarkerEncoder.encode(char).length;
        if (state.tokenBytes > COMMUNICATION_MARKER_MAX_VALUE) {
          throw new Error('redaction-candidate-too-long');
        }
        if (state.escaped) state.escaped = false;
        else if (char === '\\') state.escaped = true;
        else if (char === '"') {
          let parsed;
          try { parsed = JSON.parse(state.token); }
          catch { throw new Error('redaction-invalid-json-string'); }
          if (state.role === 'key') {
            state.stack.at(-1).key = parsed;
            state.stack.at(-1).phase = 'colon';
          }
          output.push(await communicationMarkerV1JsonString(state, state.token, state.role));
          if (state.role === 'value') communicationMarkerV1JsonComplete(state);
          state.quoted = false;
          state.token = '';
          state.tokenBytes = 0;
          state.role = null;
        }
        continue;
      }
      if (state.primitive) {
        if (!/[\s,\]\}]/.test(char)) {
          state.primitive += char;
          if (state.primitive.length > 128) throw new Error('redaction-invalid-json-primitive');
          continue;
        }
        communicationMarkerV1JsonPrimitive(state, output);
      }
      if (/\s/.test(char)) { output.push(char); continue; }
      const frame = state.stack.at(-1);
      if (char === '"') {
        const key = frame?.kind === 'object' && ['keyOrEnd', 'key'].includes(frame.phase);
        if (!key && !communicationMarkerV1JsonExpectsValue(state)) {
          throw new Error('redaction-invalid-json');
        }
        state.quoted = true;
        state.role = key ? 'key' : 'value';
        state.token = '"';
        state.tokenBytes = 1;
      } else if (char === '{' || char === '[') {
        if (!communicationMarkerV1JsonExpectsValue(state)) {
          throw new Error('redaction-invalid-json');
        }
        state.stack.push(char === '{'
          ? { kind: 'object', phase: 'keyOrEnd', key: null }
          : { kind: 'array', phase: 'valueOrEnd' });
        output.push(char);
      } else if (char === '}' || char === ']') {
        const kind = char === '}' ? 'object' : 'array';
        if (!frame || frame.kind !== kind ||
            !['keyOrEnd', 'valueOrEnd', 'commaOrEnd'].includes(frame.phase)) {
          throw new Error('redaction-invalid-json');
        }
        state.stack.pop();
        communicationMarkerV1JsonComplete(state);
        output.push(char);
      } else if (char === ':') {
        if (!frame || frame.kind !== 'object' || frame.phase !== 'colon') {
          throw new Error('redaction-invalid-json');
        }
        frame.phase = 'value';
        output.push(char);
      } else if (char === ',') {
        if (!frame || frame.phase !== 'commaOrEnd') {
          throw new Error('redaction-invalid-json');
        }
        frame.phase = frame.kind === 'object' ? 'key' : 'value';
        frame.key = null;
        output.push(char);
      } else if (/[-0-9tfn]/.test(char) &&
                 communicationMarkerV1JsonExpectsValue(state)) {
        state.primitive = char;
      } else {
        throw new Error('redaction-invalid-json');
      }
    }
    if (flush) {
      if (state.primitive) communicationMarkerV1JsonPrimitive(state, output);
      if (state.quoted || state.stack.length || state.root !== 'done') {
        throw new Error('redaction-incomplete-json');
      }
    }
    return output.join('');
  }

  /**
   * Select the protocol parser from the actual transport and media type.
   *
   * @param {string} contentType - Declared HTTP media type.
   * @param {string} transport - Source network transport.
   * @returns {Object} Scoped bounded streaming-body encoder state.
   */
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

  /**
   * Process JSON or complete SSE events, rejecting unsupported bodies.
   *
   * @param {Object} state - Mutable transport-aware encoding state.
   * @param {string} input - Next source body text fragment.
   * @param {boolean} flush - Whether the source body reached terminal EOF.
   * @returns {Promise<string>} Safely checked marker-bearing text for disk storage.
   */
  async function communicationMarkerV1BodyFeed(state, input, flush = false) {
    if (!communicationMarkerV1Key || !communicationMarkerEncoder) throw new Error('redaction-crypto-unavailable');
    if (state.kind === 'json') return communicationMarkerV1JsonFeed(state.json, input, flush);
    if (state.kind !== 'sse') throw new Error('redaction-unsupported-content-type');
    state.pendingEvent += String(input ?? '');
    let output = '';
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(state.pendingEvent);
      if (!boundary) {
        if (state.pendingEvent.length > COMMUNICATION_MARKER_MAX_VALUE) {
          throw new Error('redaction-event-too-long');
        }
        break;
      }
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
        if (body === '[DONE]') {
          lines[index] = line;
        } else {
          if (!body.trimStart().startsWith('{') && !body.trimStart().startsWith('[')) {
            throw new Error('redaction-unsupported-sse-data');
          }
          const encoder = communicationMarkerV1JsonState('sse.data.json.string');
          lines[index] = prefix + await communicationMarkerV1JsonFeed(encoder, body, true);
        }
      } else if (dataIndices.length > 1) {
        throw new Error('redaction-unsupported-multiline-sse');
      }
      output += lines.join(event.includes('\r\n') ? '\r\n' : '\n') + boundary[0];
    }
    if (flush && state.pendingEvent) throw new Error('redaction-incomplete-sse-event');
    return output;
  }

  /**
   * Replace supported URL query values with checked synthetic markers.
   *
   * @param {string} url - Untrusted original request or response URL.
   * @returns {Promise<string>} Sanitized URL or a constant fail-closed placeholder.
   */
  async function communicationMarkerV1SafeUrl(url) {
    try {
      const parsed = new URL(String(url ?? ''), location.href);
      for (const [name, original] of parsed.searchParams) {
        const classified = /(?:token|secret|auth|key|jwt|signature|session|cookie|password)/i
          .test(name);
        await communicationMarkerV1RejectCollision(original);
        const marker = await communicationMarkerV1Make(
          original, 'http.query.value'
        );
        if (classified && marker === null) throw new Error('redaction-unsupported-query');
        if (marker !== null) parsed.searchParams.set(name, marker);
      }
      parsed.username = '';
      parsed.password = '';
      return parsed.href;
    } catch {
      return '[redaction-failed-url]';
    }
  }
