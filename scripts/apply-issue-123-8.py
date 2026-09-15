from pathlib import Path

SOURCE = Path('chatgpt-conversation-markdown-export.user.js')
DESIGN = Path('DESIGN.md')


def replace_once(text: str, old: str, new: str, label: str) -> str:
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


source = SOURCE.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      1.0.1-issue.123.7',
  '// @version      1.0.1-issue.123.8',
  'version'
)
source = replace_once(
  source,
  "  /** Lookahead retained across body chunks so credential redaction can span ordinary boundaries. */\n"
  "  const COMMUNICATION_LOG_REDACTION_CARRY_CHARS = 4096;\n",
  '',
  'obsolete redaction carry'
)

old_redact = r'''  /**
   * Redacts common credential forms from persisted textual request/response data.
   *
   * @param {string} value - Raw textual communication data.
   * @returns {string} Redacted text suitable for disk persistence.
   */
  function communicationLogRedactText(value) {
    return String(redactDiagnosticSignedTokens(String(value ?? '')))
      .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [redacted]')
      .replace(/([?&](?:access_token|refresh_token|token|key|secret|auth|authorization|session|jwt|api_key)=)[^&#\s]*/gi, '$1[redacted]')
      .replace(/((?:\"|')?(?:access_token|refresh_token|authorization|cookie|session|jwt|api[_-]?key|secret)(?:\"|')?\s*:\s*(?:\"|'))[^\"'\r\n]*/gi, '$1[redacted]');
  }
'''

new_redact = r'''  /**
   * Finds the earliest sensitive-value prefix in uncommitted communication text.
   *
   * @param {string} text - Uncommitted text held by the streaming redactor.
   * @returns {Object|null} Trigger descriptor, or null when no complete prefix is present.
   */
  function communicationLogFindSecretTrigger(text) {
    const candidates = [];
    const query = /[?&](?:sig|signature|access_token|refresh_token|token|key|secret|auth|authorization|session|jwt|api_key)=/i.exec(text);
    if (query) candidates.push({ index: query.index, prefix: query[0], kind: 'query', terminator: null });
    const bearer = /\bBearer\s+/i.exec(text);
    if (bearer) candidates.push({ index: bearer.index, prefix: bearer[0], kind: 'bearer', terminator: null });
    const quoted = /(?:\"|')?(?:access_token|refresh_token|authorization|cookie|session|jwt|api[_-]?key|secret)(?:\"|')?\s*:\s*(\"|')/i.exec(text);
    if (quoted) candidates.push({ index: quoted.index, prefix: quoted[0], kind: 'quoted', terminator: quoted[1] });
    if (!candidates.length) return null;
    candidates.sort((left, right) => left.index - right.index || right.prefix.length - left.prefix.length);
    return candidates[0];
  }

  /**
   * Creates independent state for one request/response body redaction stream.
   *
   * @returns {Object} Mutable streaming-redaction state.
   */
  function communicationLogCreateRedactionState() {
    return {
      pending: '',
      mode: null,
      terminator: null,
      escaped: false
    };
  }

  /**
   * Redacts sensitive values while preserving arbitrary input chunk boundaries.
   *
   * Possible secret prefixes are withheld until they can be classified. Once a secret
   * prefix is recognized, every value character is suppressed until its protocol
   * delimiter arrives; the secret therefore cannot leak merely because it is longer
   * than an input or output chunk.
   *
   * @param {Object} state - State returned by `communicationLogCreateRedactionState`.
   * @param {string} text - Next decoded textual body fragment.
   * @param {boolean} flush - Whether no more source text will arrive.
   * @returns {string} Safe text that can be committed immediately.
   */
  function communicationLogRedactStreamFeed(state, text, flush) {
    state.pending += String(text ?? '');
    let output = '';
    for (;;) {
      if (state.mode === 'quoted') {
        let closeIndex = -1;
        let escaped = state.escaped;
        for (let index = 0; index < state.pending.length; index += 1) {
          const character = state.pending[index];
          if (escaped) {
            escaped = false;
            continue;
          }
          if (character === '\\') {
            escaped = true;
            continue;
          }
          if (character === state.terminator) {
            closeIndex = index;
            break;
          }
        }
        if (closeIndex < 0) {
          state.escaped = escaped;
          state.pending = '';
          if (flush) {
            state.mode = null;
            state.terminator = null;
            state.escaped = false;
          }
          return output;
        }
        output += state.terminator;
        state.pending = state.pending.slice(closeIndex + 1);
        state.mode = null;
        state.terminator = null;
        state.escaped = false;
        continue;
      }

      if (state.mode === 'query' || state.mode === 'bearer') {
        const delimiter = state.mode === 'query'
          ? /[&#\s\"'<>]/.exec(state.pending)
          : /[^A-Za-z0-9._~+\/-=]/.exec(state.pending);
        if (!delimiter) {
          state.pending = '';
          if (flush) state.mode = null;
          return output;
        }
        output += delimiter[0];
        state.pending = state.pending.slice(delimiter.index + delimiter[0].length);
        state.mode = null;
        continue;
      }

      const trigger = communicationLogFindSecretTrigger(state.pending);
      if (trigger) {
        output += state.pending.slice(0, trigger.index);
        output += `${trigger.prefix}[redacted]`;
        state.pending = state.pending.slice(trigger.index + trigger.prefix.length);
        state.mode = trigger.kind;
        state.terminator = trigger.terminator;
        state.escaped = false;
        continue;
      }

      if (flush) {
        output += state.pending;
        state.pending = '';
        return output;
      }

      // Sensitive prefixes are short; retaining 128 trailing characters prevents a
      // prefix split across source chunks from being committed before classification.
      if (state.pending.length <= 128) return output;
      const safeLength = state.pending.length - 128;
      output += state.pending.slice(0, safeLength);
      state.pending = state.pending.slice(safeLength);
      return output;
    }
  }

  /**
   * Redacts common credential forms from one complete textual value.
   *
   * @param {string} value - Raw textual communication data.
   * @returns {string} Redacted text suitable for disk persistence.
   */
  function communicationLogRedactText(value) {
    const state = communicationLogCreateRedactionState();
    return communicationLogRedactStreamFeed(state, String(value ?? ''), true);
  }
'''
source = replace_once(source, old_redact, new_redact, 'streaming redactor')

old_stream = r'''  async function communicationLogStreamBody(body, recordType, context) {
    if (!body) return { byte_count: 0, chunk_count: 0 };
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let byteCount = 0;
    let chunkCount = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        if (!result.value?.byteLength) continue;
        byteCount += result.value.byteLength;
        pending += decoder.decode(result.value, { stream: true });
        while (pending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS + COMMUNICATION_LOG_REDACTION_CARRY_CHARS) {
          const chunk = pending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          pending = pending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          chunkCount += 1;
          await communicationLogRecord(recordType, {
            ...context,
            chunk_ordinal: chunkCount,
            data: communicationLogRedactText(chunk)
          });
        }
      }
      pending += decoder.decode();
      if (pending) {
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: communicationLogRedactText(pending)
        });
      }
      return { byte_count: byteCount, chunk_count: chunkCount };
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }
'''
new_stream = r'''  async function communicationLogStreamBody(body, recordType, context) {
    if (!body) return { byte_count: 0, chunk_count: 0 };
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const redactionState = communicationLogCreateRedactionState();
    let safePending = '';
    let byteCount = 0;
    let chunkCount = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        if (!result.value?.byteLength) continue;
        byteCount += result.value.byteLength;
        safePending += communicationLogRedactStreamFeed(
          redactionState,
          decoder.decode(result.value, { stream: true }),
          false
        );
        while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
          const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          chunkCount += 1;
          await communicationLogRecord(recordType, {
            ...context,
            chunk_ordinal: chunkCount,
            data: chunk
          });
        }
      }
      safePending += communicationLogRedactStreamFeed(redactionState, decoder.decode(), true);
      while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
        const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: chunk
        });
      }
      if (safePending) {
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: safePending
        });
      }
      return { byte_count: byteCount, chunk_count: chunkCount };
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }
'''
source = replace_once(source, old_stream, new_stream, 'stream body')

old_text = r'''  async function communicationLogTextBody(text, recordType, context) {
    const value = String(text ?? '');
    let chunkCount = 0;
    for (let offset = 0; offset < value.length; offset += COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
      chunkCount += 1;
      await communicationLogRecord(recordType, {
        ...context,
        chunk_ordinal: chunkCount,
        data: communicationLogRedactText(value.slice(offset, offset + COMMUNICATION_LOG_BODY_CHUNK_CHARS))
      });
    }
    return { character_count: value.length, chunk_count: chunkCount };
  }
'''
new_text = r'''  async function communicationLogTextBody(text, recordType, context) {
    const value = String(text ?? '');
    const redactionState = communicationLogCreateRedactionState();
    let safePending = '';
    let chunkCount = 0;
    for (let offset = 0; offset < value.length; offset += COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
      safePending += communicationLogRedactStreamFeed(
        redactionState,
        value.slice(offset, offset + COMMUNICATION_LOG_BODY_CHUNK_CHARS),
        false
      );
      while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
        const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: chunk
        });
      }
    }
    safePending += communicationLogRedactStreamFeed(redactionState, '', true);
    while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
      const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
      safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
      chunkCount += 1;
      await communicationLogRecord(recordType, {
        ...context,
        chunk_ordinal: chunkCount,
        data: chunk
      });
    }
    if (safePending) {
      chunkCount += 1;
      await communicationLogRecord(recordType, {
        ...context,
        chunk_ordinal: chunkCount,
        data: safePending
      });
    }
    return { character_count: value.length, chunk_count: chunkCount };
  }
'''
source = replace_once(source, old_text, new_text, 'materialized text body')
SOURCE.write_text(source, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
section = r'''

## Issue #123 stateful communication-body redaction correction

The first disk-recorder implementation redacted each output chunk independently.  A
credential whose prefix/value crossed that arbitrary boundary could therefore expose a
partial value before the following chunk made the complete pattern visible.  The
corrected recorder treats redaction as streaming protocol state rather than a property
of storage chunking.

Possible sensitive prefixes are retained briefly instead of being committed at a
source-chunk boundary.  Once a query token, signed URL value, Bearer credential, or
quoted sensitive JSON-style field is recognized, its value remains suppressed until
its actual delimiter arrives, even when that value spans arbitrarily many input and
output chunks.  Fetch/SSE streams and already-materialized XHR/WebSocket text use the
same state machine; disk chunk size no longer defines the privacy boundary.
'''
if '## Issue #123 stateful communication-body redaction correction' in design:
  raise SystemExit('DESIGN redaction-correction section already exists')
DESIGN.write_text(design.rstrip() + section.rstrip() + '\n', encoding='utf-8')
