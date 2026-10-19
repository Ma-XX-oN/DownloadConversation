    function jsonState(context) {
      return { context, stack: [], root: 'value', quoted: false, escaped: false,
        token: '', tokenBytes: 0, role: null, primitive: '' };
    }
    /**
     * Determines whether a JSON value is currently legal.
     * @param {Object} state - Input state for expectsValue.
     * @returns {boolean} Output from expectsValue.
     */
    function expectsValue(state) {
      const frame = state.stack.at(-1); return frame ? frame.phase === 'value' || frame.phase === 'valueOrEnd'
        : state.root === 'value';
    }
    /**
     * Finalises one JSON value within its containing frame.
     * @param {Object} state - Input state for complete.
     * @returns {void} No value is returned.
     */
    function complete(state) {
      const frame = state.stack.at(-1);
      if (!frame) {
        if (state.root !== 'value') fail('csc-invalid-json'); state.root = 'done';
      } else {
        if (!['value', 'valueOrEnd'].includes(frame.phase)) fail('csc-invalid-json');
        frame.phase = 'commaOrEnd';
      }
    }
    /**
     * Validates a completed JSON primitive token.
     * @param {Object} state - Input state for primitive.
     * @param {Array} result - Input result for primitive.
     * @returns {void} No value is returned.
     */
    function primitive(state, result) {
      try {
        const parsed = JSON.parse(state.primitive);
        if (parsed !== null && typeof parsed !== 'boolean' &&
            (typeof parsed !== 'number' || !Number.isFinite(parsed))) fail('csc-invalid-json');
      } catch { fail('csc-invalid-json'); }
      result.push(state.primitive); state.primitive = ''; complete(state);
    }
    /**
     * Sanitizes one incrementally decoded JSON fragment.
     * @param {Object} state - Input state for jsonFeed.
     * @param {string} input - Input input for jsonFeed.
     * @param {boolean} flush - Input flush for jsonFeed.
     * @returns {Promise<string>} Output from jsonFeed.
     */
    async function jsonFeed(state, input, flush = false) {
      const result = [];
      for (const ch of input) {
        if (state.quoted) {
          state.token += ch; state.tokenBytes += encoder.encode(ch).byteLength;
          if (state.tokenBytes > maxValue) fail('csc-candidate-too-long');
          if (state.escaped) state.escaped = false;
          else if (ch === '\\') state.escaped = true;
          else if (ch === '"') {
            let value;
            try { value = JSON.parse(state.token); } catch { fail('csc-invalid-json'); }
            if (state.role === 'key') {
              state.stack.at(-1).key = value; state.stack.at(-1).phase = 'colon'; result.push(state.token);
            } else {
              const frame = state.stack.at(-1); const classified = /(?:authorization|cookie|session|jwt|secret|token|api[_-]?key|password|credential)/i
                .test(String(frame?.key ?? '')); const replacement = await marker(value, state.context, classified); result.push(replacement === null ? state.token : JSON.stringify(replacement));
              complete(state);
            }
            state.quoted = false; state.token = ''; state.tokenBytes = 0; state.role = null;
          }
          continue;
        }
        if (state.primitive) {
          if (!/[\s,\]\}]/.test(ch)) {
            state.primitive += ch;
            if (state.primitive.length > 128) fail('csc-invalid-json');
            continue;
          }
          primitive(state, result);
        }
        if (/\s/.test(ch)) { result.push(ch); continue; }
        const frame = state.stack.at(-1);
        if (ch === '"') {
          const keyRole = frame?.kind === 'object' &&
            ['keyOrEnd', 'key'].includes(frame.phase);
          if (!keyRole && !expectsValue(state)) fail('csc-invalid-json'); state.quoted = true; state.role = keyRole ? 'key' : 'value'; state.token = '"'; state.tokenBytes = 1;
        } else if (ch === '{' || ch === '[') {
          if (!expectsValue(state)) fail('csc-invalid-json'); state.stack.push(ch === '{'
            ? { kind: 'object', phase: 'keyOrEnd', key: null }
            : { kind: 'array', phase: 'valueOrEnd' }); result.push(ch);
        } else if (ch === '}' || ch === ']') {
          const kind = ch === '}' ? 'object' : 'array';
          if (!frame || frame.kind !== kind ||
              !['keyOrEnd', 'valueOrEnd', 'commaOrEnd'].includes(frame.phase)) fail('csc-invalid-json'); state.stack.pop(); complete(state); result.push(ch);
        } else if (ch === ':') {
          if (!frame || frame.kind !== 'object' || frame.phase !== 'colon') fail('csc-invalid-json');
          frame.phase = 'value'; result.push(ch);
        } else if (ch === ',') {
          if (!frame || frame.phase !== 'commaOrEnd') fail('csc-invalid-json');
          frame.phase = frame.kind === 'object' ? 'key' : 'value';
          frame.key = null; result.push(ch);
        } else if (/[-0-9tfn]/.test(ch) && expectsValue(state)) {
          state.primitive = ch;
        } else fail('csc-invalid-json');
      }
      if (flush) {
        if (state.primitive) primitive(state, result);
        if (state.quoted || state.stack.length || state.root !== 'done') fail('csc-incomplete-json');
      }
      return result.join('');
    }
    /**
     * Writes one safe, framed JSONL record to the Worker sink.
     * @param {Object} record - Input record for writeFrame.
     * @param {Object} counters - Input counters for writeFrame.
     * @returns {Promise<void>} Output from writeFrame.
     */
    async function writeFrame(record, counters) {
      if (!sink || typeof sink.write !== 'function') fail('csc-writer-unavailable'); const bytes = encoder.encode(JSON.stringify(record) + '\n'); await sink.write(bytes);
      counters.emitted += bytes.byteLength;
    }
    /**
     * Converts a bounded binary chunk into transport-safe Base64.
     * @param {Uint8Array} bytes - Input bytes for base64.
     * @returns {string} Output from base64.
     */
    function base64(bytes) {
      let result = '';
      for (const b of bytes) result += String.fromCharCode(b); return btoa(result);
    }
