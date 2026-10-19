    /**
     * Serializes one selected COMM envelope without an unsanitized intermediate.
     * @param {Object} event - Input event for process.
     * @returns {Promise<void>} Output from process.
     */
    async function process(event) {
      const counts = { source: 0, emitted: 0 }; const choice = selected(event);
      if (choice.status !== 'selected') {
        if (event.body?.cancel) await event.body.cancel().catch(() => {});
        sendStatus(event, choice.status, choice.reason, counts); return;
      }
      let reader;
      try {
        if (event.hmac_token != null) {
          if (typeof event.hmac_token !== 'string' ||
              !stagedKeys.has(event.hmac_token)) fail('csc-key-token-unavailable');
          key = stagedKeys.get(event.hmac_token);
          scopeId = event.redaction_scope;
          keyGeneration = event.redaction_key_generation;
        }
        if (!key || !scopeId || event.redaction_scope !== scopeId ||
            event.redaction_key_generation !== keyGeneration ||
            event.redaction_scope !== event.redaction_key_generation ||
            !Number.isSafeInteger(event.redaction_key_epoch) ||
            event.redaction_key_epoch < 1 ||
            event.redaction_key_storage !== 'tampermonkey-script-installation' ||
            event.redaction_format !== 'dc-secret-marker/2') fail('csc-key-scope-mismatch'); const url = await safeUrl(String(event.url ?? event.request_url ??
          event.response_url ?? '')); const headers = await safeHeaders(event.headers); await writeFrame({
          kind: 'csc-comm-start', schema: 1, capture_id: String(event.capture_id),
          page_instance_id: String(event.page_instance_id ?? ''),
          connection_id: String(event.connection_id ?? ''),
          network_sequence: event.network_sequence, capture_order: event.capture_order,
          captured_at_epoch_ms: event.captured_at_epoch_ms,
          captured_at_mono_ms: event.captured_at_mono_ms,
          clock_domain: String(event.clock_domain ?? ''),
          transport: String(event.transport ?? ''),
          direction: String(event.direction ?? ''), url,
          headers: headers.safe, omitted_headers: headers.omitted,
          redaction_format: event.redaction_format,
          redaction_scope: scopeId,
          redaction_key_generation: keyGeneration,
          redaction_key_epoch: event.redaction_key_epoch,
          redaction_key_storage: event.redaction_key_storage,
          binary_encoding: choice.kind === 'binary' ? 'base64' : 'utf8'
        }, counts); const context = event.transport === 'websocket' ? 'ws.text.json.string' : 'json.string'; const state = jsonState(context); let decoder = choice.kind === 'binary' ? null :
          new TextDecoder('utf-8', { fatal: true }); let ssePending = '';
        /**
         * Serializes one text fragment with the selected transport codec.
         * @param {string} value - Input value for serializeText.
         * @param {boolean} flush - Input flush for serializeText.
         * @returns {Promise<string>} Output from serializeText.
         */
        async function serializeText(value, flush) {
          if (choice.kind === 'json') {
            return jsonFeed(state, value, flush);
          }
          ssePending += value; let output = '';
          for (;;) {
            const delimiter = /\r?\n\r?\n/.exec(ssePending);
            if (!delimiter) break; const data = ssePending.slice(0, delimiter.index);
            ssePending = ssePending.slice(delimiter.index + delimiter[0].length); const lines = data.split(/\r?\n/); const selectedLines = lines.filter(line => line.startsWith('data:'));
            if (selectedLines.length !== 1) fail('csc-unsupported-sse-shape'); const idx = lines.findIndex(line => line.startsWith('data:')); const prefix = /^data: ?/.exec(lines[idx])[0]; const payload = lines[idx].slice(prefix.length);
            if (payload !== '[DONE]') {
              const sseState = jsonState('sse.data.json.string');
              lines[idx] = prefix + await jsonFeed(sseState, payload, true);
            }
            output += lines.join(data.includes('\r\n') ? '\r\n' : '\n') + delimiter[0];
          }
          if (ssePending.length > maxValue) fail('csc-sse-event-too-long');
          if (flush && ssePending) fail('csc-incomplete-sse'); return output;
        }
        /**
         * Emits one sanitized or binary-safe body fragment.
         * @param {string} part - Input part for chunkRecord.
         * @param {string} encoding - Input encoding for chunkRecord.
         * @returns {Promise<void>} Output from chunkRecord.
         */
        async function chunkRecord(part, encoding) {
          if (!part) return; await writeFrame({
            kind: 'csc-comm-body', capture_id: String(event.capture_id),
            encoding, data: part
          }, counts);
        }
        if (event.body?.getReader) reader = event.body.getReader();
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!(value instanceof Uint8Array)) fail('csc-invalid-stream-chunk'); counts.source += value.byteLength;
            for (let i = 0; i < value.byteLength; i += maxChunk) {
              const part = value.subarray(i, i + maxChunk);
              if (choice.kind === 'binary') await chunkRecord(base64(part), 'base64');
              else await chunkRecord(await serializeText(decoder.decode(part, { stream: true }), false), 'utf8');
            }
          }
        } else if (event.value != null) {
          const value = event.value; const binary = value instanceof ArrayBuffer || ArrayBuffer.isView(value);
          if (binary) {
            const bytes = value instanceof ArrayBuffer
              ? new Uint8Array(value) :
              new Uint8Array(value.buffer, value.byteOffset, value.byteLength); counts.source = bytes.byteLength;
            if (choice.kind !== 'binary') fail('csc-binary-type-mismatch');
            for (let i = 0; i < bytes.byteLength; i += maxChunk) {
              await chunkRecord(base64(bytes.subarray(i, i + maxChunk)), 'base64');
            }
          } else if (typeof value === 'string') {
            const bytes = encoder.encode(value); counts.source = bytes.byteLength;
            for (let i = 0; i < bytes.byteLength; i += maxChunk) {
              await chunkRecord(await serializeText(
                decoder.decode(bytes.subarray(i, i + maxChunk), { stream: true }), false), 'utf8');
            }
          } else fail('csc-unsupported-body-value');
        } else if (event.body_available === true) fail('csc-missing-body');
        if (choice.kind !== 'binary') {
          await chunkRecord(await serializeText(decoder.decode(), true), 'utf8');
        }
        if (event.complete === false) fail('csc-source-incomplete'); await writeFrame({
          kind: 'csc-comm-end', capture_id: String(event.capture_id),
          status: 'completed', source_bytes: counts.source,
          emitted_bytes_before_end: counts.emitted,
          source_complete: true
        }, counts);
        sendStatus(event, 'completed', 'csc-processing-complete-not-durable', counts);
      } catch (error) {
        if (reader) {
          try { await reader.cancel(); } catch {}
        } else if (event.body?.cancel) {
          try { await event.body.cancel(); } catch {}
        }
        // The failure record carries NO original sensitive value or exception text.
        try {
          await writeFrame({
            kind: 'csc-comm-end', capture_id: String(event.capture_id),
            status: 'failed', reason: safeError(error),
            source_bytes_observed: counts.source,
            emitted_bytes_before_end: counts.emitted,
            source_complete: false
          }, counts);
        } catch {}
        sendStatus(event, 'failed', safeError(error), counts);
      } finally {
        if (reader) reader.releaseLock();
        if (typeof event.hmac_token === 'string') {
          stagedKeys.delete(event.hmac_token);
          key = null; scopeId = null; keyGeneration = null;
        }
      }
    }
    /**
     * Drains the Worker queue in preserved insertion order.
     * @returns {Promise<void>} Output from drain.
     */
    async function drain() {
      if (working) return;
      working = true;
      try {
        while (records.length) await process(records.shift());
      } finally { working = false; }
    }
    /**
     * Adds a validated message to the bounded Worker-owned queue.
     * @param {Object} event - Input event for enqueue.
     * @returns {void} No value is returned.
     */
    function enqueue(event) {
      if (!event || typeof event.capture_id !== 'string' ||
          !/^[A-Za-z0-9:._-]{1,160}$/.test(event.capture_id)) {
        scope.postMessage({ type: 'csc-comm-invalid-envelope' });
        return;
      }
      if (records.length >= maxQueue) {
        if (event.body?.cancel) void event.body.cancel().catch(() => {});
        sendStatus(event, 'rejected', 'csc-worker-queue-full', { source: 0, emitted: 0 }); return;
      }
      // No await before insertion: this is the first COMM queue.
      records.push(event);
      void drain();
    }
    /**
     * Imports private HMAC material and zeroes its transferable buffer.
     * @param {Object} message - Input message for provision.
     * @returns {Promise<void>} Output from provision.
     */
    async function provision(message) {
      if (!(message.key_bytes instanceof Uint8Array) ||
          message.key_bytes.byteLength !== 32 ||
          (message.type !== 'dc-hmac-key-v2' &&
            !/^[0-9a-f]{32}$/.test(message.redaction_scope ?? '')) ||
          (message.type !== 'dc-hmac-key-v2' &&
            message.redaction_key_generation !== message.redaction_scope)) {
        fail('csc-invalid-key-provision');
      }
      const staged = message.type === 'dc-hmac-key-v2';
      if (staged && (typeof message.token !== 'string' ||
          !/^[0-9a-zA-Z._:-]{8,160}$/.test(message.token) ||
          stagedKeys.has(message.token) || stagedKeys.size >= maxQueue)) {
        fail('csc-invalid-key-token');
      }
      const bytes = message.key_bytes;
      try {
        const imported = await crypto.subtle.importKey('raw', bytes,
          { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        if (staged) stagedKeys.set(message.token, imported);
        else {
          key = imported;
          scopeId = message.redaction_scope;
          keyGeneration = message.redaction_key_generation;
        }
      } finally { bytes.fill(0); }
      scope.postMessage(staged
        ? { type: 'csc-comm-key-ready', token: message.token }
        : { type: 'csc-comm-key-ready',
          redaction_scope: scopeId, redaction_key_generation: keyGeneration });
    }
    scope.addEventListener('message', event => {
      const value = event.data;
      if (!value || typeof value.type !== 'string') return;
      if (value.type === 'csc-comm-capture') enqueue(value.envelope);
      else if (value.type === 'csc-comm-configure') {
        try { options(value.options); scope.postMessage({ type: 'csc-comm-configured' }); }
        catch { scope.postMessage({ type: 'csc-comm-configuration-failed' }); }
      } else if (value.type === 'csc-comm-provision' ||
                 value.type === 'dc-hmac-key-v2') {
        void provision(value).catch(() => {
          scope.postMessage({ type: 'csc-comm-provision-failed' });
        });
      }
    }); return Object.freeze({ enqueue, drain, options, marker, selected, safeUrl,
      safeHeaders, get queued() { return records.length; } });
  }

  /**
   * Returns the source of the isolated Worker processor.
   * @returns {string} Output from cscCommProcessingWorkerSource.
   */

  function cscCommProcessingWorkerSource() {
    return '(' + cscCommWorkerProcessing.toString() +
      ')(self, { write: async bytes => {' +
      'if (typeof self.cscCommWriteChunk !== "function")' +
      'throw new Error("csc-writer-unavailable");' +
      'await self.cscCommWriteChunk(bytes);' +
      '}});';
  }
