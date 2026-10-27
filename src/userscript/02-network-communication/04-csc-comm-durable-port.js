
  /**
   * Parent-owned correlated durable control adapter for the single COMM Worker.
   * Control acknowledgements are not a page-thread network/body queue.
   *
   * @param {Worker} worker - Existing #311/#317 dedicated COMM Worker.
   * @param {number} timeoutMs - Explicit, owner-selected control timeout.
   * @returns {Object} Exact #318 COMM port contract plus dispose().
   */
  function cscCommDurablePort(worker, timeoutMs) {
    assert(worker && typeof worker.postMessage === 'function' &&
      typeof worker.addEventListener === 'function' &&
      typeof worker.removeEventListener === 'function',
    'CSC COMM durable control requires an event-capable Worker.');
    assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0,
      'CSC COMM durable control timeout must be explicitly configured.');
    const session = crypto.randomUUID();
    let serial = 0;
    let disposed = false;
    const pending = new Map();

    /** Reject all outstanding requests on Worker failure or disposal. */
    function rejectAll(reason) {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error(reason));
      }
      pending.clear();
    }

    /** Only matching request IDs can satisfy a pending durable control. */
    function onMessage(event) {
      const value = event?.data;
      const request = typeof value?.request_id === 'string'
        ? pending.get(value.request_id) : null;
      if (!request) return;
      if (value.type !== request.expected && value.type !== 'csc-writer-error' &&
          value.type !== 'csc-comm-drain-failed') {
        return;
      }
      pending.delete(value.request_id);
      clearTimeout(request.timer);
      if (value.type === 'csc-writer-error' ||
          value.type === 'csc-comm-drain-failed') {
        request.reject(new Error(value.reason || 'csc-writer-control-failed'));
        return;
      }
      try {
        request.resolve(request.validate(value));
      } catch (error) {
        request.reject(error);
      }
    }

    /** A failed Worker cannot certify any outstanding control operation. */
    function onError() {
      rejectAll('csc-writer-control-worker-failed');
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onError);

    /**
     * Send one control request; never claim success until the Writer replies.
     * @param {string} type - Writer command.
     * @param {string} expected - Correlated Writer response.
     * @param {Object} payload - Public nonsecret control metadata.
     * @param {Function} validate - Strict response validator.
     * @returns {Promise<*>} Verified control result.
     */
    function request(type, expected, payload, validate) {
      if (disposed) return Promise.reject(new Error('csc-writer-control-disposed'));
      const request_id = 'csc-writer-control:' + session + ':' + ++serial;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(request_id);
          reject(new Error('csc-writer-control-timeout'));
        }, timeoutMs);
        pending.set(request_id, { expected, validate, resolve, reject, timer });
        try { worker.postMessage({ type, request_id, ...payload }); }
        catch (error) {
          pending.delete(request_id);
          clearTimeout(timer);
          reject(error);
        }
      });
    }

    /**
     * @returns {Promise<{durable:true}>} Drained physical write queue.
     */
    async function drain() {
      await request('csc-comm-drain', 'csc-comm-drained', {},
        ack => {
          if (ack.durable !== false) {
            throw Error('csc-comm-drain-ack-invalid');
          }
          return true;
        });
      return request('csc-writer-drain', 'csc-writer-drained', {},
        ack => {
          if (ack.durable !== true) throw Error('csc-writer-drain-unconfirmed');
          return Object.freeze({ durable: true });
        });
    }

    /**
     * @param {{version:string,key_restart:string}} header - Shared GEN/COMM header.
     * @returns {Promise<Object>} Physically read-back Writer boundary.
     */
    function beginKeyBoundary(header) {
      assert(header && typeof header.version === 'string' &&
        typeof header.key_restart === 'string',
      'CSC COMM boundary header required.');
      return request('csc-writer-begin-key-boundary',
        'csc-writer-key-boundary-ready', { header },
        ack => {
          if (ack.durable !== true || ack.key_restart !== header.key_restart) {
            throw Error('csc-writer-boundary-unconfirmed');
          }
          return Object.freeze({ durable: true, key_restart: ack.key_restart });
        });
    }

    /**
     * @param {Object} event - #313 nonsecret canonical committed cycle.
     * @returns {Promise<{durable:true,id:string}>} Durable Writer cycle ACK.
     */
    function writeCycle(event) {
      assert(event && typeof event.id === 'string',
        'CSC COMM committed cycle ID required.');
      return request('csc-writer-write-cycle', 'csc-writer-cycle-written',
        { event }, ack => {
          if (ack.durable !== true || ack.id !== event.id) {
            throw Error('csc-writer-cycle-unconfirmed');
          }
          return Object.freeze({ durable: true, id: ack.id });
        });
    }

    /**
     * @param {string} id - Canonical committed cycle identity.
     * @returns {Promise<boolean>} Recovered durable journal membership.
     */
    function hasCycle(id) {
      assert(typeof id === 'string' && id,
        'CSC COMM cycle lookup ID required.');
      return request('csc-writer-has-cycle', 'csc-writer-cycle-history',
        { id }, ack => {
          if (ack.id !== id || typeof ack.durable !== 'boolean') {
            throw Error('csc-writer-cycle-history-invalid');
          }
          return ack.durable;
        });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
      rejectAll('csc-writer-control-disposed');
    }
    return Object.freeze({ drain, beginKeyBoundary, writeCycle,
      hasCycle, dispose });
  }
