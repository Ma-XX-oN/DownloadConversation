  /**
   * #311: dedicated COMM Worker processor. No DOM, page-side COMM queue,
   * compressor or file writer lives here. The injected sink is a Worker-local
   * #317 interface; a missing sink fails closed, never sends raw bytes to page.
   *
   * This function is deliberately self-contained for Blob Worker bootstrap.
   * The #313 producer supplies generation-bound key material separately.
   *
   * @param {DedicatedWorkerGlobalScope|Object} scope - Worker message target.
   * @param {Object} sink - Worker-local writer; write(bytes) must acknowledge.
   * @returns {Object} Queue/fixture API (not an archive writer).
   */
  function cscCommWorkerProcessing(scope, sink) {
    const encoder = new TextEncoder();
    const maxQueue = 16;
    const maxChunk = 32768;
    const maxValue = 1024 * 1024;
    const allowedModes = ['replay-essentials', 'everything'];
    const records = [];
    let working = false;
    let key = null;
    let keyGeneration = null;
    let scopeId = null;
    let policy = Object.freeze({
      mode: 'replay-essentials', binary: false,
      cross_origin: false, auth_headers: false, all: false,
      origin: 'https://chatgpt.com'
    });
    const statuses = new Set([
      'selected', 'unselected', 'unsupported', 'inaccessible',
      'rejected', 'failed', 'completed'
    ]);
    function fail(reason) {
      throw new Error(reason);
    }
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
    function sendStatus(event, status, reason, counts) {
      if (!statuses.has(status)) fail('csc-invalid-status');
      // Only nonsecret identifiers and counts cross back to the page.
      scope.postMessage({
        type: 'csc-comm-status', capture_id: String(event.capture_id ?? ''),
        network_sequence: Number(event.network_sequence ?? 0),
        status, reason, source_bytes: counts?.source ?? 0,
        emitted_bytes: counts?.emitted ?? 0,
        durable: false
      });
    }
    function safeError(error) {
      const name = String(error?.message ?? '');
      return /^csc-[a-z0-9-]+$/.test(name) ? name : 'csc-processing-error';
    }
    function isAuth(name) {
      return /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i.test(name);
    }
    function toHex(bytes, count) {
      return Array.from(new Uint8Array(bytes).slice(0, count),
        byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function isBase64Url(value) {
      if (!/^[A-Za-z0-9_-]{4,256}$/.test(value) || value.length % 4 === 1) return false;
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const mask = value.length % 4 === 2 ? 15 : value.length % 4 === 3 ? 3 : 0;
      if ((alphabet.indexOf(value.at(-1)) & mask) !== 0) return false;
      try { return atob(value.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - value.length % 4) % 4)).length > 0; }
      catch { return false; }
    }
    function candidate(value, context, classified) {
      const supported = ['json.string', 'sse.data.json.string',
        'ws.text.json.string', 'http.header.value', 'http.query.value'];
      if (!supported.includes(context)) fail('csc-unsupported-context');
      const found = [];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
        found.push({ type: 'U', params: null });
      } else if (/^g-p-[0-9a-f]{32}$/.test(value)) {
        found.push({ type: 'P', params: null });
      } else {
        if (/^[0-9a-f]{2,256}$/.test(value) && value.length % 2 === 0) {
          found.push({ type: 'H', params: String(value.length) });
        }
        if (isBase64Url(value)) found.push({ type: 'B', params: String(value.length) });
        const parts = value.split('.');
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
    async function marker(value, context, classified = false) {
      if (!key) fail('csc-key-unavailable');
      if (typeof value !== 'string' ||
          /[\ud800-\udfff]/u.test(value.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''))) {
        fail('csc-invalid-unicode');
      }
      const bytes = encoder.encode(value);
      if (bytes.length > maxValue) fail('csc-candidate-too-long');
      const found = candidate(value, context, classified);
      if (found.length > 1) fail('csc-ambiguous-secret-type');
      if (!found.length) {
        if (classified) fail('csc-unsupported-sensitive-value');
        return null;
      }
      const length = new Uint8Array(4);
      new DataView(length.buffer).setUint32(0, bytes.length, false);
      const prefix = encoder.encode('DC-SECRET-ID-V1\0');
      const message = new Uint8Array(prefix.length + 4 + bytes.length);
      message.set(prefix); message.set(length, prefix.length);
      message.set(bytes, prefix.length + 4);
      const id = toHex(await crypto.subtle.sign('HMAC', key, message), 24);
      const chosen = found[0];
      const body = chosen.type + '/' + id +
        (chosen.params === null ? '' : '/' + chosen.params);
      const check = toHex(await crypto.subtle.digest('SHA-256',
        encoder.encode('DC-SECRET-MARKER-V1\0' + body)), 16);
      return '[' + check + '/' + body + ']';
    }
    async function safeUrl(value) {
      let url;
      try { url = new URL(value, policy.origin); }
      catch { fail('csc-invalid-url'); }
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
        fail('csc-unsupported-url-scheme');
      }
      // URLSearchParams canonicalises escaping; source counts remain distinct.
      for (const [name, val] of url.searchParams) {
        const classified = /(?:auth|cookie|session|token|secret|password|key|signature)/i.test(name);
        const replacement = await marker(val, 'http.query.value', classified);
        if (replacement !== null) url.searchParams.set(name, replacement);
      }
      url.username = ''; url.password = ''; url.hash = '';
      return url.href;
    }
    async function safeHeaders(source) {
      const pairs = Array.isArray(source) ? source :
        typeof source === 'string' ? source.split(/\r?\n/).filter(Boolean)
          .map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()])
          : [];
      const safe = [];
      const omitted = [];
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
    function selected(event) {
      if (event.body_state === 'unavailable' ||
          (event.body_available === false && event.value == null)) {
        return { status: 'inaccessible', reason: 'csc-body-inaccessible' };
      }
      const url = String(event.url ?? event.request_url ?? event.response_url ?? '');
      let parsed;
      try { parsed = new URL(url, policy.origin); }
      catch { return { status: 'rejected', reason: 'csc-invalid-url' }; }
      if (parsed.origin !== policy.origin && !policy.cross_origin) {
        return { status: 'unselected', reason: 'csc-cross-origin-not-selected' };
      }
      const type = String(event.body_type ?? event.response_type ??
        (Array.isArray(event.headers) ? event.headers.find(h =>
          String(h[0]).toLowerCase() === 'content-type')?.[1] : '') ?? '').toLowerCase();
      const isJson = /(?:^|\/)(?:json|[^/;]+\+json)(?:;|$)/.test(type);
      const isSse = type.startsWith('text/event-stream');
      const binary = type.includes('octet-stream') || type.includes('image/') ||
        type.includes('audio/') || type.includes('video/') ||
        event.body_type === 'binary' || event.response_type === 'arraybuffer';
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
    function jsonState(context) {
      return { context, stack: [], root: 'value', quoted: false, escaped: false,
        token: '', role: null, primitive: '' };
    }
    function expectsValue(state) {
      const frame = state.stack.at(-1);
      return frame ? frame.phase === 'value' || frame.phase === 'valueOrEnd'
        : state.root === 'value';
    }
    function complete(state) {
      const frame = state.stack.at(-1);
      if (!frame) {
        if (state.root !== 'value') fail('csc-invalid-json');
        state.root = 'done';
      } else {
        if (!['value', 'valueOrEnd'].includes(frame.phase)) fail('csc-invalid-json');
        frame.phase = 'commaOrEnd';
      }
    }
    function primitive(state, result) {
      try {
        const parsed = JSON.parse(state.primitive);
        if (parsed !== null && typeof parsed !== 'boolean' &&
            (typeof parsed !== 'number' || !Number.isFinite(parsed))) fail('csc-invalid-json');
      } catch { fail('csc-invalid-json'); }
      result.push(state.primitive); state.primitive = ''; complete(state);
    }
    async function jsonFeed(state, input, flush = false) {
      const result = [];
      for (const ch of input) {
        if (state.quoted) {
          state.token += ch;
          if (encoder.encode(state.token).length > maxValue) fail('csc-candidate-too-long');
          if (state.escaped) state.escaped = false;
          else if (ch === '\\') state.escaped = true;
          else if (ch === '"') {
            let value;
            try { value = JSON.parse(state.token); } catch { fail('csc-invalid-json'); }
            if (state.role === 'key') {
              state.stack.at(-1).key = value;
              state.stack.at(-1).phase = 'colon';
              result.push(state.token);
            } else {
              const frame = state.stack.at(-1);
              const classified = /(?:authorization|cookie|session|jwt|secret|token|api[_-]?key|password|credential)/i
                .test(String(frame?.key ?? ''));
              const replacement = await marker(value, state.context, classified);
              result.push(replacement === null ? state.token : JSON.stringify(replacement));
              complete(state);
            }
            state.quoted = false; state.token = ''; state.role = null;
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
          if (!keyRole && !expectsValue(state)) fail('csc-invalid-json');
          state.quoted = true; state.role = keyRole ? 'key' : 'value';
          state.token = '"';
        } else if (ch === '{' || ch === '[') {
          if (!expectsValue(state)) fail('csc-invalid-json');
          state.stack.push(ch === '{'
            ? { kind: 'object', phase: 'keyOrEnd', key: null }
            : { kind: 'array', phase: 'valueOrEnd' });
          result.push(ch);
        } else if (ch === '}' || ch === ']') {
          const kind = ch === '}' ? 'object' : 'array';
          if (!frame || frame.kind !== kind ||
              !['keyOrEnd', 'valueOrEnd', 'commaOrEnd'].includes(frame.phase)) fail('csc-invalid-json');
          state.stack.pop(); complete(state); result.push(ch);
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
    async function writeFrame(record, counters) {
      if (!sink || typeof sink.write !== 'function') fail('csc-writer-unavailable');
      const bytes = encoder.encode(JSON.stringify(record) + '\n');
      await sink.write(bytes);
      counters.emitted += bytes.byteLength;
    }
    function base64(bytes) {
      let result = '';
      for (const b of bytes) result += String.fromCharCode(b);
      return btoa(result);
    }
    async function process(event) {
      const counts = { source: 0, emitted: 0 };
      const choice = selected(event);
      if (choice.status !== 'selected') {
        if (event.body?.cancel) await event.body.cancel().catch(() => {});
        sendStatus(event, choice.status, choice.reason, counts);
        return;
      }
      let reader;
      try {
        if (!key || !scopeId || event.redaction_scope !== scopeId ||
            event.redaction_key_generation !== keyGeneration ||
            event.redaction_format !== 'dc-secret-marker/2') fail('csc-key-scope-mismatch');
        const url = await safeUrl(String(event.url ?? event.request_url ??
          event.response_url ?? ''));
        const headers = await safeHeaders(event.headers);
        await writeFrame({
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
        }, counts);
        const context = event.transport === 'websocket' ? 'ws.text.json.string' : 'json.string';
        const state = jsonState(context);
        let decoder = choice.kind === 'binary' ? null :
          new TextDecoder('utf-8', { fatal: true });
        let ssePending = '';
        async function serializeText(value, flush) {
          if (choice.kind === 'json') {
            return jsonFeed(state, value, flush);
          }
          ssePending += value;
          let output = '';
          for (;;) {
            const delimiter = /\r?\n\r?\n/.exec(ssePending);
            if (!delimiter) break;
            const data = ssePending.slice(0, delimiter.index);
            ssePending = ssePending.slice(delimiter.index + delimiter[0].length);
            const lines = data.split(/\r?\n/);
            const selectedLines = lines.filter(line => line.startsWith('data:'));
            if (selectedLines.length !== 1) fail('csc-unsupported-sse-shape');
            const idx = lines.findIndex(line => line.startsWith('data:'));
            const prefix = /^data: ?/.exec(lines[idx])[0];
            const payload = lines[idx].slice(prefix.length);
            if (payload !== '[DONE]') {
              const sseState = jsonState('sse.data.json.string');
              lines[idx] = prefix + await jsonFeed(sseState, payload, true);
            }
            output += lines.join(data.includes('\r\n') ? '\r\n' : '\n') + delimiter[0];
          }
          if (ssePending.length > maxValue) fail('csc-sse-event-too-long');
          if (flush && ssePending) fail('csc-incomplete-sse');
          return output;
        }
        async function chunkRecord(part, encoding) {
          if (!part) return;
          await writeFrame({
            kind: 'csc-comm-body', capture_id: String(event.capture_id),
            encoding, data: part
          }, counts);
        }
        if (event.body?.getReader) reader = event.body.getReader();
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!(value instanceof Uint8Array)) fail('csc-invalid-stream-chunk');
            counts.source += value.byteLength;
            for (let i = 0; i < value.byteLength; i += maxChunk) {
              const part = value.subarray(i, i + maxChunk);
              if (choice.kind === 'binary') await chunkRecord(base64(part), 'base64');
              else await chunkRecord(await serializeText(decoder.decode(part, { stream: true }), false), 'utf8');
            }
          }
        } else if (event.value != null) {
          const value = event.value;
          const binary = value instanceof ArrayBuffer || ArrayBuffer.isView(value);
          if (binary) {
            const bytes = value instanceof ArrayBuffer
              ? new Uint8Array(value) :
              new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            counts.source = bytes.byteLength;
            if (choice.kind !== 'binary') fail('csc-binary-type-mismatch');
            for (let i = 0; i < bytes.byteLength; i += maxChunk) {
              await chunkRecord(base64(bytes.subarray(i, i + maxChunk)), 'base64');
            }
          } else if (typeof value === 'string') {
            const bytes = encoder.encode(value);
            counts.source = bytes.byteLength;
            for (let i = 0; i < bytes.byteLength; i += maxChunk) {
              await chunkRecord(await serializeText(
                decoder.decode(bytes.subarray(i, i + maxChunk), { stream: true }), false), 'utf8');
            }
          } else fail('csc-unsupported-body-value');
        } else if (event.body_available === true) fail('csc-missing-body');
        if (choice.kind !== 'binary') {
          await chunkRecord(await serializeText(decoder.decode(), true), 'utf8');
        }
        await writeFrame({
          kind: 'csc-comm-end', capture_id: String(event.capture_id),
          status: 'completed', source_bytes: counts.source,
          emitted_bytes_before_end: counts.emitted,
          source_complete: event.complete !== false
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
      }
    }
    async function drain() {
      if (working) return;
      working = true;
      try {
        while (records.length) await process(records.shift());
      } finally { working = false; }
    }
    function enqueue(event) {
      if (records.length >= maxQueue) {
        if (event.body?.cancel) void event.body.cancel().catch(() => {});
        sendStatus(event, 'rejected', 'csc-worker-queue-full', { source: 0, emitted: 0 });
        return;
      }
      // No await before insertion: this is the first COMM queue.
      records.push(event);
      void drain();
    }
    async function provision(message) {
      if (!(message.key_bytes instanceof Uint8Array) ||
          message.key_bytes.byteLength !== 32 ||
          !/^[0-9a-f]{32}$/.test(message.redaction_scope ?? '') ||
          typeof message.redaction_key_generation !== 'string') {
        fail('csc-invalid-key-provision');
      }
      const bytes = message.key_bytes;
      try {
        key = await crypto.subtle.importKey('raw', bytes,
          { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        scopeId = message.redaction_scope;
        keyGeneration = message.redaction_key_generation;
      } finally { bytes.fill(0); }
      scope.postMessage({ type: 'csc-comm-key-ready',
        redaction_scope: scopeId, redaction_key_generation: keyGeneration });
    }
    scope.addEventListener('message', event => {
      const value = event.data;
      if (!value || typeof value.type !== 'string') return;
      if (value.type === 'csc-comm-capture') enqueue(value.envelope);
      else if (value.type === 'csc-comm-configure') {
        try { options(value.options); scope.postMessage({ type: 'csc-comm-configured' }); }
        catch { scope.postMessage({ type: 'csc-comm-configuration-failed' }); }
      } else if (value.type === 'csc-comm-provision') {
        void provision(value).catch(() => {
          scope.postMessage({ type: 'csc-comm-provision-failed' });
        });
      }
    });
    return Object.freeze({ enqueue, drain, options, marker, selected, safeUrl,
      safeHeaders, get queued() { return records.length; } });
  }

  /**
   * #317 must supply a Worker-local sink before this is activated. Neither
   * the page nor the test harness receives raw or encoded production chunks.
   *
   * @returns {string} Self-contained Worker bootstrap source.
   */
  function cscCommProcessingWorkerSource() {
    return '(' + cscCommWorkerProcessing.toString() +
      ')(self, { write: async bytes => {' +
      'if (typeof self.cscCommWriteChunk !== "function")' +
      'throw new Error("csc-writer-unavailable");' +
      'await self.cscCommWriteChunk(bytes);' +
      '}});';
  }
