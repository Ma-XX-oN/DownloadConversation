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

  /**
   * Reports whether a content type represents textual communication worth persisting verbatim.
   *
   * @param {string} contentType - HTTP content type.
   * @returns {boolean} True for text, JSON, SSE, JavaScript, XML, form, or component text.
   */
  function communicationLogIsTextContentType(contentType) {
    return String(contentType ?? '').toLowerCase().startsWith('text/') ||
      /(?:application\/json|event-stream|javascript|xml|x-www-form-urlencoded|x-component)/i.test(String(contentType ?? ''));
  }

  /**
   * Reports whether the given URL/content type may persist a textual body.
   *
   * Cross-origin payloads remain metadata-only. Binary same-origin payloads also remain metadata-only.
   *
   * @param {string} url - Communication URL.
   * @param {string} contentType - Declared content type.
   * @returns {boolean} True when body text may be written to disk.
   */
  function communicationLogShouldCaptureBody(url, contentType) {
    try {
      const parsed = new URL(String(url ?? ''), location.href);
      if (parsed.origin !== location.origin) return false;
      const normalizedContentType = String(contentType ?? '').split(';', 1)[0].trim().toLowerCase();
      if (communicationLogIsTextContentType(normalizedContentType)) return true;
      if (normalizedContentType) return false;
      return parsed.pathname.startsWith('/backend-api/');
    } catch {
      return false;
    }
  }

  /**
   * Compares bounded byte ranges without loading whole files into memory.
   *
   * @param {Blob} left - First file/blob.
   * @param {Blob} right - Second file/blob.
   * @param {number} leftOffset - First byte offset.
   * @param {number} rightOffset - Second byte offset.
   * @param {number} length - Number of bytes to compare.
   * @returns {Promise<boolean>} True only when every compared byte matches.
   */
  async function communicationLogBlobsEqual(left, right, leftOffset, rightOffset, length) {
    for (let offset = 0; offset < length; offset += COMMUNICATION_LOG_COMPARE_CHUNK_BYTES) {
      const count = Math.min(COMMUNICATION_LOG_COMPARE_CHUNK_BYTES, length - offset);
      const leftBytes = new Uint8Array(await left.slice(leftOffset + offset, leftOffset + offset + count).arrayBuffer());
      const rightBytes = new Uint8Array(await right.slice(rightOffset + offset, rightOffset + offset + count).arrayBuffer());
      if (leftBytes.length !== rightBytes.length) return false;
      for (let index = 0; index < leftBytes.length; index += 1) {
        if (leftBytes[index] !== rightBytes[index]) return false;
      }
    }
    return true;
  }

  /**
   * Reacquires the active log file from its parent directory and reads fresh on-disk state.
   *
   * @returns {Promise<Object>} Fresh file handle and File snapshot.
   */
  async function communicationLogRefreshedFileSnapshot() {
    if (!communicationLogDirectoryHandle || !communicationLogFileName) {
      throw new Error('Communication log directory/file is not ready.');
    }
    const handle = await communicationLogDirectoryHandle.getFileHandle(communicationLogFileName, { create: true });
    const file = await handle.getFile();
    return { handle, file };
  }

  /**
   * Identifies Chromium's stale File System Access interface-state failure.
   *
   * @param {Object} error - Write failure.
   * @returns {boolean} True only for the observed stale-state InvalidStateError class.
   */
  function communicationLogIsStaleFileStateError(error) {
    return error?.name === 'InvalidStateError' || /state.*changed.*disk|cached.*interface object/i.test(String(error?.message ?? ''));
  }

  /**
   * Appends bytes using fresh EOF state and verifies ambiguous stale-handle outcomes before retrying.
   *
   * This is the Issue-44 append invariant: reacquire from the directory, derive the append
   * offset from the current file, open/seek/write/close, and never duplicate bytes when Chromium
   * reports InvalidStateError after a write actually committed.
   *
   * @param {string|Blob} data - Bytes to append.
   * @returns {Promise<number>} Byte offset at which the append committed.
   */
  async function communicationLogAppendData(data) {
    const desired = data instanceof Blob ? data : new Blob([data]);
    for (let attempt = 1; attempt <= COMMUNICATION_LOG_WRITE_RETRY_LIMIT; attempt += 1) {
      const refreshed = await communicationLogRefreshedFileSnapshot();
      const currentHandle = refreshed.handle;
      const before = await currentHandle.getFile();
      let writable = null;
      try {
        writable = await currentHandle.createWritable({ keepExistingData: true });
        await writable.seek(before.size);
        await writable.write(data);
        await writable.close();
        return before.size;
      } catch (error) {
        await abortWritableQuietly(writable);
        if (!communicationLogIsStaleFileStateError(error) || attempt >= COMMUNICATION_LOG_WRITE_RETRY_LIMIT) throw error;
        const afterSnapshot = await communicationLogRefreshedFileSnapshot();
        const after = afterSnapshot.file;
        if (after.size >= before.size + desired.size &&
            await communicationLogBlobsEqual(after, desired, before.size, 0, desired.size)) {
          return before.size;
        }
        const originalPrefixStillMatches = after.size >= before.size &&
          await communicationLogBlobsEqual(after, before, 0, 0, before.size);
        if (after.size !== before.size || !originalPrefixStillMatches) {
          throw new Error(`'${communicationLogFileName}' changed on disk while the recorder was appending; the append was not retried.`);
        }
        await new Promise(resolve => setTimeout(resolve, 50 * attempt));
      }
    }
    throw new Error(`Appending to '${communicationLogFileName}' exhausted the filesystem retry limit.`);
  }

  /**
   * Recovers complete compatible JSONL bytes from Chromium communication-log swap files.
