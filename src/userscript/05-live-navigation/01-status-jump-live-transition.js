      requestAnimationFrame(refreshCommunicationLogNameOverflow);
    }
    if (renameCommunicationLogButton) {
      renameCommunicationLogButton.disabled = !communicationLogAvailable || communicationLogUiActionInProgress;
    }
    if (duplicateCommunicationLogButton) {
      duplicateCommunicationLogButton.disabled = !communicationLogAvailable || communicationLogUiActionInProgress;
    }
    if (resetCommunicationLogButton) resetCommunicationLogButton.disabled = communicationLogUiActionInProgress;
    if (progressState) {
      status.textContent = progressStatus(exportKind === 'md' ? 'Extract MD' : 'Extract JSONL');
    } else {
      status.textContent = statusText;
    }
  }

  /**
   * Sets status.
   *
   * @param {string} text - The text to process.
   * @returns {void} No value is returned.
   */
  function setStatus(text) {
    statusText = text;
    refreshStatus();
  }

  /**
   * Handles start status timer.
   *
   * @returns {void} No value is returned.
   */
  function startStatusTimer() {
    if (statusTimer !== null) clearInterval(statusTimer);
    statusTimer = setInterval(refreshStatus, 1000);
  }

  /**
   * Handles stop status timer.
   *
   * @returns {void} No value is returned.
   */
  function stopStatusTimer() {
    if (statusTimer !== null) clearInterval(statusTimer);
    statusTimer = null;
  }

  /**
   * Handles acquire wake lock.
   *
   * @returns {void} No value is returned.
   */
  async function acquireWakeLock() {
    if (!screenOnWhenCapturing || !exportInProgress ||
        document.visibilityState !== 'visible' || !navigator.wakeLock?.request) return;
    if (wakeLockSentinel) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      }, { once: true });
    } catch {}
  }

  /**
   * Handles release wake lock.
   *
   * @returns {void} No value is returned.
   */
  async function releaseWakeLock() {
    // Detach the current wake-lock handle before awaiting release to avoid stale global state.
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {}
    }
  }

  /**
   * Handles download blob.
   *
   * @param {Blob} blob - The Blob to download.
   * @param {Object} filename - The filename to use for the download.
   * @returns {void} No value is returned.
   */
  function downloadBlob(blob, filename) {
    logDiagnostic('debug', 'conversation-download-triggered', {
      filename: String(filename ?? ''),
      blob_size: Number.isFinite(blob?.size) ? blob.size : null,
      blob_type: typeof blob?.type === 'string' ? blob.type : null
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Handles conversation jump user records.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @returns {Array<unknown>} The ordered values produced by `jumpUserRecords`.
   */
  function jumpUserRecords(spine) {
    return (spine?.records ?? []).filter(record => record?.role === 'user');
  }

  /**
   * Resolves jump identifier.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @param {Object} identifier - The identifier value required by this function.
   * @returns {Object} The Object value produced by `resolveJumpIdentifier`.
   */
  function resolveJumpIdentifier(spine, identifier) {
    const value = String(identifier ?? '').trim();
    assert(value, 'A User/Assistant turn ID or numeric UAP index is required.');
    const records = spine?.records ?? [];
    const users = jumpUserRecords(spine);
    assert(users.length > 0, 'The conversation contains no User turns.');

    if (/^-?\d+$/.test(value)) {
      const requested = Number(value);
      assert(Number.isSafeInteger(requested), `UAP index ${value} is not a safe integer.`);
      const index = requested >= 0 ? requested : users.length + requested;
      assert(index >= 0 && index < users.length,
        `UAP index ${requested} is out of range for ${users.length} UAPs.`);
      return { uap_index: index, role: 'user', message_id: users[index].message_id };
    }

    /**
     * Handles record.
     */
    const record = records.find(item => item?.message_id === value);
    assert(record, `Turn ID ${value} was not found in the Conversation API.`);
    assert(record.role === 'user' || record.role === 'assistant',
      `Turn ID ${value} belongs to role ${record.role ?? 'unknown'}, not User or Assistant.`);
    // Tracks the latest User anchor at or before the requested source record.
    let uapIndex = -1;
    for (let index = 0; index < users.length; index += 1) {
      if (users[index].ordinal > record.ordinal) break;
      uapIndex = index;
    }
    assert(uapIndex >= 0, `Turn ID ${value} appears before the first User turn.`);
    return { uap_index: uapIndex, role: record.role, message_id: record.message_id };
  }

  /**
   * Returns mounted turn section.
   *
   * @param {string} messageId - The provider/source message identifier.
   * @param {Object|null} role - The message role to match.
   * @returns {null} The null value produced by `mountedTurnSection`.
   */
  function mountedTurnSection(messageId, role = null) {
    for (const section of document.querySelectorAll('section[data-turn-id]')) {
      if (role && section.getAttribute('data-turn') !== role) continue;
      if (section.getAttribute('data-turn-id') === messageId) return section;
      const message = section.querySelector('[data-message-id]');
      if (message?.getAttribute('data-message-id') === messageId) return section;
    }
    return null;
  }

  /**
   * Handles conversation scroll root.
   *
   * @returns {Element} The Element value produced by `conversationScrollRoot`.
   */
  function conversationScrollRoot() {
    const thread = document.querySelector('#thread');
    for (let node = thread?.parentElement; node instanceof HTMLElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight + 1) return node;
    }
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
  }

  // BEGIN Issue #123 live-tail consistency
  /**
   * Normalizes visible text for bounded live/API tail comparison without changing export content.
   *
   * @param {Object} value - Text-like value to normalize.
   * @returns {string} Whitespace-normalized comparison text.
   */
  function normalizeLiveTailText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Produces a compact deterministic fingerprint for diagnostics-only live-tail evidence.
   *
   * @param {string} text - Normalized text to fingerprint.
   * @returns {string} Eight-character hexadecimal FNV-1a fingerprint.
   */
  function liveTailFingerprint(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * Resets live-tail state when entering a different conversation or starting a fresh tracking lifetime.
   *
   * @param {string|null} conversationId - Conversation identity associated with the new tracking state.
   * @returns {void} No value is returned.
   */
  function resetLiveTailTrackingState(conversationId = null) {
    liveTailConversationId = conversationId;
    liveTailMarkers = [];
    liveTailHistoricalNavigation = false;
    liveTailPromptAdvancePending = false;
    liveTailLastScrollTop = null;
  }

  /**
   * Tests whether two live-tail markers describe the same mounted/source message identity.
   *
   * @param {Object|null} left - First marker.
   * @param {Object|null} right - Second marker.
   * @returns {boolean} True when a stable message or DOM turn identity matches.
   */
  function liveTailMarkerIdentityMatches(left, right) {
    if (!left || !right) return false;
    if (left.message_id && right.message_id && left.message_id === right.message_id) return true;
    return Boolean(left.dom_turn_id && right.dom_turn_id && left.dom_turn_id === right.dom_turn_id);
  }

  /**
   * Captures one mounted User/Assistant section as independent DOM/source identity evidence.
   *
   * @param {Element} section - Mounted `section[data-turn-id]` element.
   * @returns {Object|null} Bounded live-tail marker, or null for unsupported sections.
   */
  function liveTailSectionMarker(section) {
