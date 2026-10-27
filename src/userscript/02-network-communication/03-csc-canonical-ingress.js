// BEGIN #309 canonical CSC ingress. The COMM Worker is registered by #311.
  /** Identity of the current page/clock domain, never reused after reload. */
  const cscPageInstanceId = crypto.randomUUID();
  /** Order of network interceptions, independent of delivery completion. */
  let cscCaptureOrder = 0;
  /** COMM Worker receiver, or null until the downstream Worker is ready. */
  let cscCommWorker = null;
  /** Main-thread plugin-queue ingress supplied by #310, not a COMM queue. */
  let cscPluginIngress = null;
  /** Separate early metadata observer; never receives native body owners. */
  let cscMetadataIngress = null;

  /**
   * Attach one synchronous metadata-only observer, independent of plugin/COMM.
   * @param {Function|null} listener - Null unregisters the observer.
   */
  function cscBindMetadataIngress(listener) {
    assert(listener === null || typeof listener === 'function',
      'CSC metadata ingress must be a function.');
    cscMetadataIngress = listener;
  }

  /**
   * Attaches the dedicated COMM Worker without changing the main-thread plugin.
   *
   * @param {Worker|null} worker - Worker owning the receiving COMM queue.
   * @returns {void} No value is returned.
   */
  function cscBindCommWorker(worker) {
    assert(worker === null || typeof worker?.postMessage === 'function',
      'CSC COMM receiver must implement Worker.postMessage.');
    cscCommWorker = worker;
  }

  /**
   * Registers synchronous delivery to the independently owned plugin queue.
   *
   * @param {Function|null} publish - Plugin ingress or null on disposal.
   * @returns {void} No value is returned.
   */
  function cscBindPluginIngress(publish) {
    assert(publish === null || typeof publish === 'function',
      'CSC plugin ingress must be a function.');
    cscPluginIngress = publish;
  }

  /**
   * Capture clocks before any asynchronous work, body clone or queueing.
   * network_sequence is shared with existing provider-host network correlation.
   *
   * @param {string} transport - fetch, xhr or websocket.
   * @param {string} direction - request, response, incoming, outgoing or event.
   * @param {string|null} connectionId - Stable connection/request identifier.
   * @param {Object|null} parent - Earlier event for the same exchange.
   * @returns {Object} Frozen original-time event identity.
   */
  function cscCaptureNow(transport, direction, connectionId = null, parent = null) {
    const captured_at_epoch_ms = Date.now();
    const captured_at_mono_ms = performance.now();
    const network_sequence = ++stockNetworkSequence;
    const capture_order = ++cscCaptureOrder;
    return Object.freeze({
      page_instance_id: cscPageInstanceId,
      clock_domain: cscPageInstanceId,
      connection_id: connectionId ?? crypto.randomUUID(),
      capture_id: cscPageInstanceId + ':' + network_sequence,
      parent_capture_id: parent?.capture_id ?? null,
      request_capture_id: parent?.request_capture_id ?? parent?.capture_id ?? null,
      network_sequence,
      capture_order,
      captured_at_epoch_ms,
      captured_at_mono_ms,
      transport,
      direction
    });
  }

  /**
   * Convert headers to an unsanitized, structured-cloneable snapshot.
   * Redaction belongs exclusively to the Worker, never to the plugin branch.
   *
   * @param {Object|null} headers - Native Headers or XHR header map.
   * @returns {Array} Raw name/value pairs without a native Headers instance.
   */
  function cscRawHeaderEntries(headers) {
    if (!headers) return [];
    if (typeof headers.entries === 'function') {
      try { return Array.from(headers.entries(), ([key, value]) => [key, value]); }
      catch { return []; }
    }
    return Object.entries(headers).map(([key, value]) => [key, String(value)]);
  }

  /**
   * Report a transport failure without logging body, credential or raw headers.
   *
   * @param {Object} stamp - Original event identity.
   * @param {string} stage - Failed stage.
   * @param {unknown} error - Failure cause.
   * @returns {void} No value is returned.
   */
  function cscIngressFailure(stamp, stage, error) {
    logDiagnostic('warnings', 'csc-ingress-incomplete', {
      capture_id: stamp.capture_id,
      network_sequence: stamp.network_sequence,
      stage,
      error: boundedDiagnosticText(errorMessage(error), 500)
    });
  }

  /**
   * Publish one captured event to two independently owned body branches.
   * The plugin owns one native clone; the COMM Worker owns another native
   * clone whose stream is transferred, not cloned again at postMessage().
   * Neither consumer can read or mutate the stock page-owned Request/Response.
   *
   * @param {Object} stamp - Captured event identity.
   * @param {Object} meta - Cloneable transport metadata.
   * @param {Object|null} nativeBodyOwner - Stock Request/Response, never shared.
   * @param {unknown} availableValue - Already available XHR/WS body, if any.
   * @returns {void} No value is returned.
   */
  function cscFanOut(stamp, meta, nativeBodyOwner = null, availableValue = null) {
    const envelope = Object.freeze({ ...stamp, ...meta });
    // Original capture-time envelope precedes all body cloning and queues.
    if (cscMetadataIngress) {
      try {
        const { headers, body, value, ...metadataOnly } = envelope;
        cscMetadataIngress(Object.freeze(metadataOnly));
      } catch (error) {
        cscIngressFailure(stamp, 'metadata-delivery', error);
      }
    }
    if (cscCommWorker) {
      let cloned = null;
      try {
        if (nativeBodyOwner) {
          cloned = cloneSafely(nativeBodyOwner);
          if (!cloned) throw new Error('Native Request/Response clone unavailable.');
        }
        const body = cloned?.body ?? null;
        const body_state = nativeBodyOwner
          ? (body ? 'stream-transferred' : 'unavailable')
          : (availableValue === null ? 'none-or-unavailable' : 'cloneable-value');
        // Never transfer a page-owned ArrayBuffer. postMessage clones XHR/WS data.
        cscCommWorker.postMessage({
          type: 'csc-comm-capture',
          envelope: { ...envelope, body_state, body, value: availableValue }
        }, body ? [body] : []);
      } catch (error) {
        cscIngressFailure(stamp, 'worker-transfer', error);
        if (cloned?.body && !cloned.body.locked) {
          void cancelReadableBodyQuietly(cloned.body);
        }
      }
    }
    if (cscPluginIngress) {
      let source = null;
      let sourceAvailable = false;
      let sourceIncomplete = false;
      try {
        if (nativeBodyOwner) {
          // This is the plugin-owned native clone, independent of COMM.
          // Never expose the original one-shot page-owned body to #310.
          source = cloneSafely(nativeBodyOwner);
          if (!source) throw new Error('Plugin Request/Response clone unavailable.');
        } else if (availableValue && typeof availableValue === 'object') {
          // XHR/WS page-owned mutable bytes must never alias the plugin.
          source = structuredClone(availableValue);
        } else {
          source = availableValue;
        }
        sourceAvailable = source !== null;
      } catch (error) {
        sourceIncomplete = true;
        cscIngressFailure(stamp, 'plugin-payload-clone', error);
      }
      try {
        cscPluginIngress(Object.freeze({
          envelope, source, source_available: sourceAvailable,
          source_incomplete: sourceIncomplete
        }));
      } catch (error) {
        cscIngressFailure(stamp, 'plugin-delivery', error);
      }
    }
  }

  /**
   * Call stock fetch unchanged while recording synchronous dispatch failures.
   *
   * @param {Function} nativeFetch - Original page fetch implementation.
   * @param {Object} receiver - Original this value.
   * @param {Array} args - Original fetch arguments.
   * @param {Object} requestStamp - Earliest request capture.
   * @param {Object} trace - Shared stock-network correlation.
   * @param {string} url - Original request URL.
   * @returns {Promise<Response>} Unmodified native fetch result.
   */
  function cscDispatchObservedFetch(nativeFetch, receiver, args, requestStamp, trace, url) {
    try {
      return nativeFetch.apply(receiver, args);
    } catch (error) {
      const stamp = cscCaptureNow('fetch', 'error',
        requestStamp.connection_id, requestStamp);
      cscPublishValue(stamp, {
        method: trace.method, request_url: url,
        error_name: String(error?.name ?? 'Error'),
        body_available: false, complete: false
      });
      throw error;
    }
  }

  /**
   * Preserve native WebSocket send/throw semantics and report rejected attempts.
   *
   * @param {Function} nativeSend - Original WebSocket send.
   * @param {WebSocket} socket - Stock page socket.
   * @param {unknown} data - Original frame bytes or text.
   * @param {Object} connection - WebSocket connection capture.
   * @param {Object} attempt - Original send-attempt capture.
   * @param {string} url - WebSocket endpoint.
   * @returns {unknown} Original native send return value.
   */
  function cscDispatchSocketSend(nativeSend, socket, data, connection, attempt, url) {
    let result;
    try {
      result = nativeSend.call(socket, data);
    } catch (error) {
      const failure = cscCaptureNow('websocket', 'error',
        connection.connection_id, attempt);
      cscPublishValue(failure, {
        url, event: 'send-rejected',
        error_name: String(error?.name ?? 'Error'),
        body_available: false, complete: false
      });
      throw error;
    }
    if (!cscCommWorker) {
      void communicationLogWebSocketSend(url, data)
        .catch(error => communicationLogReportFailure('websocket-send', error));
    }
    return result;
  }

  /**
   * Snapshot an XHR body without reading a stream or altering page-owned bytes.
   *
   * @param {XMLHttpRequest} xhr - Observed XHR.
   * @returns {Object} Available value and explicit body availability.
   */
  function cscXhrBodySnapshot(xhr) {
    try {
      const type = xhr.responseType || 'text';
      if (type === 'text') {
        return { value: xhr.responseText, body_type: 'text', body_available: true };
      }
      if (type === 'json') {
        return { value: xhr.response, body_type: 'json', body_available: true };
      }
      if (type === 'arraybuffer' && xhr.response &&
          Object.prototype.toString.call(xhr.response) === '[object ArrayBuffer]') {
        return { value: xhr.response, body_type: 'binary', body_available: true };
      }
      if (type === 'blob' && xhr.response &&
          Object.prototype.toString.call(xhr.response) === '[object Blob]') {
        return { value: xhr.response, body_type: 'blob', body_available: true };
      }
      return { value: null, body_type: type, body_available: false };
    } catch {
      return { value: null, body_type: 'unavailable', body_available: false };
    }
  }

  /**
   * Publish a fetch request/response through the canonical ingress.
   *
   * @param {Object} stamp - Event identity from the earliest observation.
   * @param {Request|Response|null} value - Unmodified stock network object.
   * @param {Object} metadata - Method, URL, status and other raw metadata.
   * @returns {void} No value is returned.
   */
  function cscPublishFetch(stamp, value, metadata) {
    cscFanOut(stamp, {
      ...metadata,
      headers: cscRawHeaderEntries(value?.headers),
      body_type: value?.headers?.get?.('content-type') ?? null,
      body_available: Boolean(value?.body),
      response_type: value?.type ?? null
    }, value);
  }

  /**
   * Publish already available XHR/WS data by structured clone, never transfer.
   *
   * @param {Object} stamp - Earliest synchronous observation.
   * @param {Object} metadata - Transport event metadata.
   * @param {unknown} data - Page-owned data or explicitly unavailable null.
   * @returns {void} No value is returned.
   */
  function cscPublishValue(stamp, metadata, data = null) {
    cscFanOut(stamp, metadata, null, data);
  }
  // END #309 canonical CSC ingress.
