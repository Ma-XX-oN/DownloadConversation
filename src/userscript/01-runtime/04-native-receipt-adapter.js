
  // Reuse immutable CGP2 #9 producer; never a second interceptor.
  /** Exact source-owned CGP2 V1 synchronous receipt normalizer. */
  const nativeReceiptIngressV1 = nativeReceiptProducerV1.createChatGPTReceiptIngress();
  /** Unique browser page observation identity. */
  const nativeReceiptPageId = crypto.randomUUID();
  /** Independent monotonically increasing metadata identity. */
  let nativeReceiptSequence = 0;
  /** Newest normalized receipt pending registered agent creation. */
  let nativePendingReceipt = null;
  /** Newest parsed JSON-entry stamp pending registered agent creation. */
  let nativePendingJson = null;

  /**
   * Deliver one already-normalized CGP2 V1 event without restamping.
   * @param {Object} event - Source-owned receipt or JSON-entry metadata.
   * @returns {void} Delivery is synchronous or retained for agent creation.
   */
  function nativeReceiptDeliver(event) {
    try {
      if (chatGPTAgent && typeof chatGPTAgent.commTraffic === 'function') {
        chatGPTAgent.commTraffic(event);
        return;
      }
      if (event.type === 'server_receipt') {
        if (!nativePendingReceipt || event.receipt.timestamp_ms >= nativePendingReceipt.timestamp_ms) {
          nativePendingReceipt = event.receipt;
        }
      } else if (event.type === 'received_json_entry') {
        if (!nativePendingJson || event.timestamp_ms >= nativePendingJson.timestamp_ms) {
          nativePendingJson = event;
        }
      }
    } catch (error) {
      logDiagnostic('warnings', 'last-native-ingress-delivery-failed', {
        reason: String(error?.message ?? error)
      });
    }
  }

  /**
   * Capture a body-free native event through the pinned provider normalizer.
   * @param {Object} envelope - Original transport metadata at native observation.
   * @returns {Object|null} Accepted immutable receipt or null for non-incoming.
   */
  function nativeReceiptCapture(envelope = {}) {
    try {
      const observation = Object.freeze({
        ...envelope,
        page_instance_id: nativeReceiptPageId,
        network_sequence: ++nativeReceiptSequence
      });
      const receipt = nativeReceiptIngressV1.capture(observation);
      if (receipt) nativeReceiptDeliver({ type: 'server_receipt', receipt });
      return receipt;
    } catch (error) {
      logDiagnostic('warnings', 'last-native-ingress-capture-failed', {
        reason: String(error?.message ?? error)
      });
      return null;
    }
  }

  /**
   * Preserve the earlier response epoch for independently parsed JSON entries.
   * @param {Object} trace - Native correlation state with received epoch.
   * @returns {boolean} True when the source observation has a valid epoch.
   */
  function nativeJsonEntryCapture(trace) {
    const timestamp = trace?.incoming_received_epoch_ms;
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > Date.now()) return false;
    nativeReceiptDeliver(Object.freeze({
      type: 'received_json_entry', version: 1,
      clock_domain: 'unix_epoch_ms', timestamp_ms: timestamp
    }));
    return true;
  }

  /**
   * Replay bounded pending V1 metadata after registered agent initialization.
   * @returns {boolean} True when a live agent accepted replay attempts.
   */
  function nativeReceiptFlush() {
    if (!chatGPTAgent || typeof chatGPTAgent.commTraffic !== 'function') return false;
    const events = [];
    if (nativePendingReceipt) events.push({type:'server_receipt',receipt:nativePendingReceipt});
    if (nativePendingJson) events.push(nativePendingJson);
    events.sort((a,b)=>(a.receipt?.timestamp_ms??a.timestamp_ms)-
      (b.receipt?.timestamp_ms??b.timestamp_ms));
    nativePendingReceipt = null;
    nativePendingJson = null;
    for(const event of events) nativeReceiptDeliver(event);
    return true;
  }
