
  // Reuse immutable CGP2 #9 producer; never a second interceptor.
  const nativeReceiptIngressV1 = nativeReceiptProducerV1.createChatGPTReceiptIngress();
  const nativeReceiptPageId = crypto.randomUUID();
  let nativeReceiptSequence = 0;
  let nativePendingReceipt = null;
  let nativePendingJson = null;

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

  function nativeJsonEntryCapture(trace) {
    const timestamp = trace?.incoming_received_epoch_ms;
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > Date.now()) return false;
    nativeReceiptDeliver(Object.freeze({
      type: 'received_json_entry', version: 1,
      clock_domain: 'unix_epoch_ms', timestamp_ms: timestamp
    }));
    return true;
  }

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
