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

    /** Committed cycle IDs emitted during this Worker lifetime. */
    const emittedCycleIds = new Set();
    /** Committed cycle IDs awaiting Worker-local sink processing. */
    const pendingCycleIds = new Set();
    /**
     * Validates the exact nonsecret committed producer journal shape.
     * @param {Object} item - DC #313 producer event.
     * @returns {boolean} Whether the event matches the contract.
     */
    function validCycle(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const fields = ['type', 'id', 'key_restart', 'epoch',
        'occurred_at_ms', 'reason'];
      return Object.keys(item).length === fields.length &&
        Object.keys(item).every(name => fields.includes(name)) &&
        item.type === 'hmac-key-cycle' &&
        typeof item.key_restart === 'string' &&
        Number.isSafeInteger(item.epoch) && item.epoch > 0 &&
        Number.isSafeInteger(item.occurred_at_ms) && item.occurred_at_ms > 0 &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.key_restart) &&
        Number.isFinite(Date.parse(item.key_restart)) &&
        Date.parse(item.key_restart) === item.occurred_at_ms &&
        new Date(item.occurred_at_ms).toISOString() === item.key_restart &&
        item.id === 'hmac-key-cycle:' + item.key_restart &&
        ['initial', 'scheduled', 'overdue', 'manual'].includes(item.reason);
    }
    /**
     * Reports controlled nonsecret processing status, never durability.
     * @param {string} id - Valid canonical ID or empty.
     * @param {string} status - Controlled status.
     * @param {string} reason - Controlled reason.
     * @returns {void} No value is returned.
     */
    function cycleStatus(id, status, reason) {
      scope.postMessage({
        type: 'csc-comm-cycle-status', id, status, reason, durable: false
      });
    }
    /**
     * Queues one committed event with the ordinary COMM descriptors.
     * @param {Object} item - Nonsecret producer event.
     * @returns {void} No value is returned.
     */
    function enqueueCycle(item) {
      if (!validCycle(item)) {
        cycleStatus('', 'rejected', 'csc-invalid-key-cycle'); return;
      }
      if (emittedCycleIds.has(item.id) || pendingCycleIds.has(item.id)) {
        cycleStatus(item.id, 'duplicate', 'csc-cycle-memory-duplicate'); return;
      }
      if (records.length >= maxQueue) {
        cycleStatus(item.id, 'rejected', 'csc-worker-queue-full'); return;
      }
      pendingCycleIds.add(item.id);
      records.push({ cycle_record: true, event: {
        type: item.type, id: item.id, key_restart: item.key_restart,
        epoch: item.epoch, occurred_at_ms: item.occurred_at_ms,
        reason: item.reason
      } });
      void drain();
    }
    /**
     * Writes one committed cycle through the existing serializer sink.
     * @param {Object} item - Valid canonical nonsecret event.
     * @returns {Promise<void>} Resolves after Worker-sink acceptance.
     */
    async function processCycle(item) {
      try {
        await writeFrame({
          kind: 'hmac-key-cycle', type: item.type, id: item.id,
          key_restart: item.key_restart, epoch: item.epoch,
          occurred_at_ms: item.occurred_at_ms, reason: item.reason
        }, { emitted: 0 });
        emittedCycleIds.add(item.id);
        cycleStatus(item.id, 'completed', 'csc-cycle-written-not-durable');
      } catch {
        cycleStatus(item.id, 'failed', 'csc-cycle-write-failed');
      } finally {
        pendingCycleIds.delete(item.id);
      }
    }
