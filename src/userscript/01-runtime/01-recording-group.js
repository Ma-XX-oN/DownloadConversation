
  /** Session-storage key for the per-tab single recording-group preference. */
  const RECORDING_GROUP_ENABLED_KEY = 'tm-downloadconversation-one-group-enabled';
  /** Session-storage key for the stable per-tab recording-group UUID. */
  const RECORDING_GROUP_UUID_KEY = 'tm-downloadconversation-one-group-uuid';
  /** Origin-scoped cross-document channel for live recording-group ownership. */
  const RECORDING_GROUP_CHANNEL = 'tm-downloadconversation-recording-group-ownership-v1';
  /** Startup claim-response window, in milliseconds. */
  const RECORDING_GROUP_CLAIM_MS = 450;
  /** Grace period allowing a replaced page document to emit pagehide. */
  const RECORDING_GROUP_RELEASE_GRACE_MS = 150;
  /** Wall-clock creation time used to preserve the older live tab on collision. */
  const recordingGroupDocumentStartedAt = performance.timeOrigin || Date.now();
  /** Fresh identity for this document only; never persisted with the tab. */
  const recordingGroupInstanceId = crypto.randomUUID();
  /** Currently active recording-group UUID, or null when disabled. */
  let recordingGroupUuid = null;
  /** Ownership channel, retained only while one-group recording is enabled. */
  let recordingGroupChannel = null;
  /** Whether this document has exclusive asserted group ownership. */
  let recordingGroupReady = false;
  /** Epoch invalidating pending asynchronous ownership claims. */
  let recordingGroupClaimEpoch = 0;
  /** Competing instance identities observed during the current claim. */
  let recordingGroupPeers = new Map();
  /** Current claim timer, cleared when a claim is cancelled. */
  let recordingGroupClaimTimer = null;

  /**
   * Publishes a bounded ownership message; payloads contain no log data.
   *
   * @param {string} kind - Protocol message type.
   * @param {string|null} group - Recording-group UUID.
   * @returns {void} Nothing.
   */
  function recordingGroupSend(kind, group = recordingGroupUuid) {
    if (!recordingGroupChannel || !group) return;
    recordingGroupChannel.postMessage({
      kind, group, instance: recordingGroupInstanceId,
      started_at: recordingGroupDocumentStartedAt,
      ready: recordingGroupReady
    });
  }

  /**
   * Returns the current one-group ownership state without exposing its writer.
   *
   * @returns {Object} Enabled state, identifier, and claim readiness.
   */
  function recordingGroupState() {
    return {
      enabled: sessionStorage.getItem(RECORDING_GROUP_ENABLED_KEY) === 'true',
      uuid: recordingGroupUuid,
      ready: recordingGroupReady
    };
  }

  /**
   * Clears one pending ownership claim and invalidates its callback.
   *
   * @returns {void} Nothing.
   */
  function recordingGroupCancelClaim() {
    recordingGroupClaimEpoch += 1;
    if (recordingGroupClaimTimer !== null) clearTimeout(recordingGroupClaimTimer);
    recordingGroupClaimTimer = null;
    recordingGroupReady = false;
    recordingGroupPeers.clear();
  }

  /**
   * Commits a newly generated group identity for this tab.
   *
   * @returns {string} Fresh group UUID.
   */
  function recordingGroupNewUuid() {
    const next = crypto.randomUUID();
    sessionStorage.setItem(RECORDING_GROUP_UUID_KEY, next);
    recordingGroupUuid = next;
    return next;
  }

  /**
   * Resolves another live claim without ever allowing shared group writers.
   *
   * Lower lexical instance UUID wins symmetric startup conflicts. A ready
   * incumbent also wins against a verifying newcomer. A stale document's
   * pagehide release is honored during the claim grace period.
   *
   * @param {MessageEvent} event - Ownership channel message.
   * @returns {void} Nothing.
   */
  function recordingGroupOnMessage(event) {
    const message = event?.data;
    if (!message || !['probe', 'owner', 'release'].includes(message.kind)
      || typeof message.group !== 'string'
      || typeof message.instance !== 'string'
      || message.instance === recordingGroupInstanceId
      || message.group !== recordingGroupUuid) return;

    if (message.kind === 'release') {
      recordingGroupPeers.delete(message.instance);
      return;
    }
    recordingGroupPeers.set(message.instance, {
      ready: message.ready === true,
      started_at: Number.isFinite(message.started_at)
        ? message.started_at : Number.POSITIVE_INFINITY
    });
    if (message.kind === 'probe' && recordingGroupReady) recordingGroupSend('owner');
    if (recordingGroupReady && message.ready === true) {
      // Retain the older live document on collision, even when its UUID sorts later.
      const otherIsOlder = message.started_at < recordingGroupDocumentStartedAt
        || (message.started_at === recordingGroupDocumentStartedAt
          && message.instance < recordingGroupInstanceId);
      if (otherIsOlder) {
        recordingGroupReady = false;
        recordingGroupNewUuid();
        void recordingGroupClaim();
      }
    }
  }

  /**
   * Verifies live group ownership before allowing any group-specific writer.
   *
   * @returns {Promise<boolean>} True only after this instance owns a group.
   */
  async function recordingGroupClaim() {
    recordingGroupCancelClaim();
    if (sessionStorage.getItem(RECORDING_GROUP_ENABLED_KEY) !== 'true') return false;
    if (!recordingGroupUuid) recordingGroupNewUuid();
    if (typeof BroadcastChannel !== 'function') {
      logConsoleDiagnostic('warnings',
        '[DownloadConversation] One-group mode unavailable: BroadcastChannel unsupported.');
      return false;
    }
    if (!recordingGroupChannel) {
      recordingGroupChannel = new BroadcastChannel(RECORDING_GROUP_CHANNEL);
      recordingGroupChannel.onmessage = recordingGroupOnMessage;
    }
    const epoch = recordingGroupClaimEpoch;
    recordingGroupSend('probe');
    await new Promise(resolve => {
      recordingGroupClaimTimer = setTimeout(resolve,
        RECORDING_GROUP_CLAIM_MS + RECORDING_GROUP_RELEASE_GRACE_MS);
    });
    recordingGroupClaimTimer = null;
    if (epoch !== recordingGroupClaimEpoch) return false;
    const competitor = [...recordingGroupPeers.entries()].some(([instance, peer]) =>
      peer.ready && (peer.started_at < recordingGroupDocumentStartedAt
        || (peer.started_at === recordingGroupDocumentStartedAt
          && instance < recordingGroupInstanceId))
    );
    if (competitor) {
      recordingGroupNewUuid();
      return recordingGroupClaim();
    }
    recordingGroupReady = true;
    recordingGroupSend('owner');
    return true;
  }

  /**
   * Starts a new tab-scoped recording group at the user's explicit request.
   *
   * @returns {Promise<boolean>} Whether new-group ownership was established.
   */
  function recordingGroupEnable() {
    sessionStorage.setItem(RECORDING_GROUP_ENABLED_KEY, 'true');
    recordingGroupNewUuid();
    return recordingGroupClaim();
  }

  /**
   * Ends the active one-group mode without deleting any retained log data.
   *
   * @returns {void} Nothing.
   */
  function recordingGroupDisable() {
    recordingGroupSend('release');
    recordingGroupCancelClaim();
    sessionStorage.removeItem(RECORDING_GROUP_ENABLED_KEY);
    sessionStorage.removeItem(RECORDING_GROUP_UUID_KEY);
    recordingGroupUuid = null;
    if (recordingGroupChannel) recordingGroupChannel.close();
    recordingGroupChannel = null;
  }

  /** Release live ownership before this document unloads or is replaced. */
  window.addEventListener('pagehide', () => {
    recordingGroupSend('release');
    recordingGroupCancelClaim();
    if (recordingGroupChannel) recordingGroupChannel.close();
    recordingGroupChannel = null;
  });

  // A restored tab retains its UUID, but must revalidate live ownership.
  if (sessionStorage.getItem(RECORDING_GROUP_ENABLED_KEY) === 'true') {
    recordingGroupUuid = sessionStorage.getItem(RECORDING_GROUP_UUID_KEY);
    void recordingGroupClaim();
  }
