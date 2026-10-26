  /**
   * Create the fail-closed CSC control plane without owning a Worker.
   * @param {Object} deps - Injected persistence, HMAC factory, version and origin
   * @returns {Object} Create the fail-closed CSC control plane without owning a Worker.
   */
  function cscCaptureControlPlane(deps) {
    const { store, serviceFactory, version, origin } = deps;
    let settings = CSC_CONTROL_DEFAULTS;
    let service = null;
    let worker = null;
    let comm = null;
    let gen = null;
    let applied = false;
    let state = 'pending';
    let keyState = 'unavailable';
    let publicKey = null;
    let expiry = null;
    let epoch = 0;
    let seq = 0;
    let initPromise = null;
    let settingsStorageAvailable = true;
    let confirmedSensitive = null;
    let unsubscribe = null;
    let chain = Promise.resolve();
    let lastError = null;
    const listeners = new Set();
    /**
     * Expose only nonsecret public state for the recorder panel.
     * @returns {Object} Expose only nonsecret public state for the recorder panel.
     */
    function snapshot() {
      return Object.freeze({
        settings, settings_state: state, settings_applied: applied,
        key_state: keyState, key_restart: publicKey, expires_at_ms: expiry,
        epoch, error: lastError,
        can_randomize: applied && keyState === 'open' && Boolean(worker && gen && comm)
      });
    }
    /**
     * Publish nonsecret state changes to registered UI subscribers.
     * @returns {void} Publish nonsecret state changes to registered UI subscribers.
     */
    function notify() {
      const value = snapshot();
      for (const listener of listeners) listener(value);
    }
    /**
     * Mark settings as unapplied and throw a deterministic failure.
     * @param {string} reason - Stable nonsecret failure identifier
     * @returns {never} Mark settings as unapplied and throw a deterministic failure.
     */
    function reject(reason) {
      lastError = reason;
      applied = false;
      state = 'failed';
      notify();
      throw new Error(reason);
    }
    /**
     * Pause COMM admission before changing capture policy or key scope.
     * @returns {Promise<void>} Pause COMM admission before changing capture policy or key scope.
     */
    async function pause() {
      applied = false;
      state = 'pending';
      notify();
      if (worker) await worker.pause();
    }
    /**
     * Apply persisted options and verify a correlated Worker acknowledgement.
     * @returns {Promise<boolean>} Apply persisted options and verify a correlated Worker acknowledgement.
     */
    async function apply() {
      if (!settingsStorageAvailable) {
        return reject('csc-settings-storage-unavailable');
      }
      const sensitive = settings.mode === 'everything' ||
        settings.binary || settings.cross_origin ||
        settings.auth_headers || settings.all;
      if (sensitive && (
        !confirmedSensitive ||
        JSON.stringify(confirmedSensitive) !== JSON.stringify(settings)
      )) {
        // Pause old capture pending consent.
        try { await pause(); }
        catch { return reject('csc-settings-pause-failed'); }
        state = 'pending';
        applied = false;
        lastError = 'csc-sensitive-reconfirmation-required';
        notify();
        return false;
      }
      if (keyState === 'draining' || keyState === 'DRAINING' ||
          keyState === 'failed') {
        try { await pause(); }
        catch { return reject('csc-settings-pause-failed'); }
        return keyState === 'failed' ? reject('csc-key-status-failed') : false;
      }
      if (!worker) {
        state = 'pending';
        applied = false;
        notify();
        return false;
      }
      try {
        await pause();
        const requestId = 'csc-options-' + ++seq;
        const payload = {
          type: 'csc-comm-configure', schema: CSC_CONTROL_SCHEMA,
          request_id: requestId, options: { ...settings, origin }
        };
        const ack = await worker.configure(payload);
        if (ack?.type !== 'csc-comm-configured' ||
            ack.schema !== CSC_CONTROL_SCHEMA ||
            ack.request_id !== requestId) return reject('csc-settings-ack-invalid');
        await worker.resume();
      } catch {
        return reject('csc-settings-apply-failed');
      }
      applied = true;
      state = 'applied';
      lastError = null;
      notify();
      return true;
    }
    /**
     * Serialize control mutations and recover the scheduling chain.
     * @param {Function} operation - Asynchronous control mutation to serialize
     * @returns {Promise<unknown>} Serialize control mutations and recover the scheduling chain.
     */
    function schedule(operation) {
      const result = chain.then(operation);
      chain = result.catch(() => undefined);
      return result;
    }
    /**
     * Load shared preferences and initialize the HMAC service once.
     * @returns {Promise<Object>} Load shared preferences and initialize the HMAC service once.
     */
    async function init() {
      if (initPromise) return initPromise;
      initPromise = (async () => {
      try {
        unsubscribe = store.subscribe(() => {
          void schedule(async () => {
            try {
              const latest = cscControlValidateOptions(await store.read());
              if (JSON.stringify(latest) !== JSON.stringify(settings)) {
                confirmedSensitive = null;
              }
              settings = latest;
              await apply();
            } catch {
              await pause().catch(() => {});
              state = 'failed';
              lastError = 'csc-remote-settings-invalid';
              notify();
            }
          });
        });
        const raw = await store.read();
        settings = raw == null ? CSC_CONTROL_DEFAULTS :
          cscControlValidateOptions(raw);
      } catch {
        settings = CSC_CONTROL_DEFAULTS;
        settingsStorageAvailable = false;
        state = 'failed';
        lastError = 'csc-settings-storage-unavailable';
      }
      try {
        if (typeof serviceFactory === 'function') service = serviceFactory();
        if (service) await refreshKey();
      } catch {
        keyState = 'failed';
        lastError = 'csc-key-service-unavailable';
      }
      notify();
      return snapshot();
      })();
      return initPromise;
    }
    /**
     * Persist confirmed options and request a Worker settings transition.
     * @param {Object} next - Versioned user-selected capture options
     * @param {boolean} confirmed - Explicit consent for expanded sensitive capture
     * @returns {Promise<boolean>} Persist confirmed options and request a Worker settings transition.
     */
    async function setOptions(next, confirmed) {
      const options = cscControlValidateOptions(next);
      const broadened = options.mode === 'everything' ||
        options.all || options.binary || options.cross_origin ||
        options.auth_headers;
      if (broadened && confirmed !== true) {
        throw new Error('csc-sensitive-capture-not-confirmed');
      }
      return schedule(async () => {
        await init();
        try { await pause(); }
        catch { return reject('csc-settings-pause-failed'); }
        try {
          await store.write(options);
        } catch {
          return reject('csc-settings-persist-failed');
        }
        settingsStorageAvailable = true;
        settings = options;
        confirmedSensitive = confirmed === true ? options : null;
        return apply();
      });
    }
    /**
     * Bind a concrete Worker control adapter and replay saved options.
     * @param {Object} adapter - Correlated Worker settings and key provisioning adapter
     * @returns {Promise<boolean>} Bind a concrete Worker control adapter and replay saved options.
     */
    async function bindWorker(adapter) {
      if (!adapter || !['pause', 'configure', 'resume', 'awaitKey']
        .every(name => typeof adapter[name] === 'function') ||
        !adapter.provisionTarget || typeof adapter.provisionTarget.postMessage !== 'function') {
        throw new Error('csc-worker-adapter-invalid');
      }
      return schedule(async () => {
        await init();
        worker = adapter;
        return apply();
      });
    }
    /**
     * Bind durable GEN and COMM event/boundary adapters.
     * @param {Object} ports - Required GEN and COMM sink ports
     * @returns {void} Bind durable GEN and COMM event/boundary adapters.
     */
    function bindSinks(ports) {
      if (!ports || !ports.gen || !ports.comm ||
          !['beginSegment', 'writeCycle', 'hasCycle'].every(key =>
            typeof ports.gen[key] === 'function') ||
          !['drain', 'beginKeyBoundary', 'writeCycle', 'hasCycle'].every(key =>
            typeof ports.comm[key] === 'function')) {
        throw new Error('csc-sinks-invalid');
      }
      gen = ports.gen;
      comm = ports.comm;
      notify();
    }
    /**
     * Read authoritative HMAC status without disclosing key bytes.
     * @returns {Promise<Object>} Read authoritative HMAC status without disclosing key bytes.
     */
    async function refreshKey() {
      if (!service) {
        keyState = 'unavailable';
        notify();
        return snapshot();
      }
      try {
        const status = await service.status();
        keyState = status.state;
        publicKey = status.key_restart || null;
        expiry = status.expires_at_ms ?? null;
        epoch = status.redaction_key_epoch ?? 0;
        if (keyState === 'draining' || keyState === 'DRAINING') await pause();
      } catch {
        keyState = 'failed';
        lastError = 'csc-key-status-failed';
        publicKey = null;
        expiry = null;
        await pause().catch(() => {});
      }
      notify();
      return snapshot();
    }
    /**
     * Reconcile committed key-cycle journal entries across both sinks.
     * @returns {Promise<number>} Reconcile committed key-cycle journal entries across both sinks.
     */
    async function reconcileCycles() {
      if (!service || !gen || !comm || !worker) {
        throw new Error('csc-cycle-ports-not-ready');
      }
      const events = await service.cycleEvents(0);
      for (const event of events) {
        if (event.type !== 'hmac-key-cycle' ||
            event.id !== 'hmac-key-cycle:' + event.key_restart ||
            !Number.isSafeInteger(event.epoch) ||
            Date.parse(event.key_restart) !== event.occurred_at_ms) {
          throw new Error('csc-cycle-invalid');
        }
        // Historical cycles are not replayed into a newer immutable fragment.
        const commExists = await comm.hasCycle(event.id);
        const genExists = await gen.hasCycle(event.id);
        if (commExists === true && genExists === true) continue;
        if (commExists !== false || genExists !== false) {
          throw new Error('csc-cycle-recovery-requires-parent');
        }
        // Never recreate an older key segment.
        if (event.key_restart !== publicKey) {
          throw new Error('csc-cycle-history-not-durable');
        }
        const header = Object.freeze({
          version, key_restart: event.key_restart
        });
        const drained = await comm.drain();
        if (drained?.durable !== true) throw new Error('csc-drain-not-durable');
        const boundary = await comm.beginKeyBoundary(header);
        if (boundary?.durable !== true ||
            boundary.key_restart !== event.key_restart) {
          throw new Error('csc-comm-boundary-unacknowledged');
        }
        const begin = await gen.beginSegment(header);
        if (begin?.durable !== true ||
            begin.key_restart !== event.key_restart) {
          throw new Error('csc-gen-boundary-unacknowledged');
        }
        for (const sink of [comm, gen]) {
          const ack = await sink.writeCycle(event);
          if (ack?.durable !== true || ack.id !== event.id) {
            throw new Error('csc-cycle-not-durable');
          }
        }
      }
      return events.length;
    }
    /**
     * Admit one capture only after settings and HMAC provisioning.
     * @returns {Promise<Object>} Admit one capture only after settings and HMAC provisioning.
     */
    async function prepareCapture() {
      if (!applied || !service || !worker || !gen || !comm) {
        throw new Error('csc-capture-not-ready');
      }
      await refreshKey();
      if (!applied || keyState === 'failed' ||
          keyState === 'draining' || keyState === 'DRAINING') {
        throw new Error('csc-capture-not-ready');
      }
      const admission = await service.admit();
      try {
        await refreshKey();
        if (!applied || keyState !== 'open' ||
            publicKey !== admission.metadata.key_restart) {
          throw new Error('csc-key-admission-scope-changed');
        }
        await reconcileCycles();
        service.provision(admission.token, worker.provisionTarget);
        const ack = await worker.awaitKey(admission.token);
        if (ack?.type !== 'csc-comm-key-ready' ||
            ack.token !== admission.token) {
          throw new Error('csc-key-provision-unacknowledged');
        }
        return admission;
      } catch (error) {
        try { await service.complete(admission.token); }
        catch {
          await pause().catch(() => {});
          return reject('csc-admission-release-failed');
        }
        await pause().catch(() => {});
        throw error;
      }
    }
    /**
     * Release one completed admission without discarding rotation fences.
     * @param {string} token - Producer-issued active admission token
     * @returns {Promise<void>} Release one completed admission without discarding rotation fences.
     */
    async function completeCapture(token) {
      if (!service) throw new Error('csc-key-service-unavailable');
      try {
        await service.complete(token);
        await refreshKey();
        if (keyState === 'open' && state === 'pending' &&
            worker && comm && gen) {
          await reconcileCycles();
          await apply();
        }
      } catch {
        await pause().catch(() => {});
        return reject('csc-key-completion-failed');
      }
    }
    /**
     * Rotate only after explicit consent and durable output drainage.
     * @param {boolean} confirmed - Explicit confirmation supplied by the UI
     * @returns {Promise<Object>} Rotate only after explicit consent and durable output drainage.
     */
    async function randomize(confirmed) {
      if (confirmed !== true) throw new Error('csc-randomize-unconfirmed');
      if (!service || !worker || !gen || !comm || !applied) {
        throw new Error('csc-randomize-ports-not-ready');
      }
      return schedule(async () => {
        try {
          await pause();
          // Persist the old key's journal BEFORE a new key can commit.
          await reconcileCycles();
          const drained = await comm.drain();
          if (drained?.durable !== true) throw new Error('csc-drain-not-durable');
          const result = await service.randomize(true);
          await refreshKey();
          if (result.state !== 'COMMITTED') {
            state = 'pending';
            notify();
            return result;
          }
          await reconcileCycles();
          await apply();
          return result;
        } catch {
          return reject('csc-randomize-failed');
        }
      });
    }
    /**
     * Subscribe to nonsecret control state changes.
     * @param {Function} listener - UI observer receiving snapshots
     * @returns {Function} Subscribe to nonsecret control state changes.
     */
    function onChange(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    }
    /**
     * Detach shared settings listeners and clear in-memory key handles.
     * @returns {void} Detach shared settings listeners and clear in-memory key handles.
     */
    function dispose() {
      unsubscribe?.();
      store.dispose?.();
      service?.dispose();
      applied = false;
      state = 'pending';
      listeners.clear();
    }
    return Object.freeze({
      init, snapshot, onChange, setOptions, bindWorker, bindSinks,
      refreshKey, reconcileCycles, prepareCapture, completeCapture,
      randomize, dispose
    });
  }
