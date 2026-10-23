
  /** DC #318.  Versioned UI policy and HMAC orchestration; no Worker code. */
  const CSC_CONTROL_SETTINGS_KEY = 'dc-csc-capture-options-v1';
  /** Versioned capture settings schema used at the Worker boundary. */
  const CSC_CONTROL_SCHEMA = 1;
  /** Default minimal recording policy, with all sensitive options disabled. */
  const CSC_CONTROL_DEFAULTS = Object.freeze({
    schema: CSC_CONTROL_SCHEMA, mode: 'replay-essentials',
    binary: false, cross_origin: false, auth_headers: false, all: false
  });
  /**
   * Validate and freeze untrusted stored COMM capture options.
   * @param {Object} input - Untrusted stored or proposed option object
   * @returns {Object} Validate and freeze untrusted stored COMM capture options.
   */
  function cscControlValidateOptions(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        input.schema !== CSC_CONTROL_SCHEMA ||
        !['replay-essentials', 'everything'].includes(input.mode)) {
      throw new Error('csc-options-invalid');
    }
    const keys = ['binary', 'cross_origin', 'auth_headers', 'all'];
    if (keys.some(key => typeof input[key] !== 'boolean')) {
      throw new Error('csc-options-invalid');
    }
    return Object.freeze({
      schema: CSC_CONTROL_SCHEMA, mode: input.mode,
      binary: input.binary, cross_origin: input.cross_origin,
      auth_headers: input.auth_headers, all: input.all
    });
  }
  /** Construct the Tampermonkey shared-options adapter (not localStorage). */
  /**
   * Construct the Tampermonkey shared settings persistence adapter.
   * @returns {Object} Construct the Tampermonkey shared settings persistence adapter.
   */
  function cscControlSharedStore() {
    return Object.freeze({
      read: () => Promise.resolve(GM_getValue(CSC_CONTROL_SETTINGS_KEY, null)),
      write: value => Promise.resolve(GM_setValue(CSC_CONTROL_SETTINGS_KEY, value)),
      subscribe: callback => {
        if (typeof GM_addValueChangeListener !== 'function') return () => {};
        const id = GM_addValueChangeListener(CSC_CONTROL_SETTINGS_KEY,
          (_name, _old, value, remote) => {
            if (remote) callback(value);
          });
        return () => {
          if (typeof GM_removeValueChangeListener === 'function') {
            GM_removeValueChangeListener(id);
          }
        };
      }
    });
  }
  /**
   * Explicit LEGO interfaces:
   * worker: {pause, configure, resume, provisionTarget, awaitKey}
   * comm: {drain, beginKeyBoundary, writeCycle}
   * gen: {beginSegment, writeCycle}
   * All acknowledgements must identify the current operation and durability.
   * This leaf does not manufacture the integration adapters owned by #359.
   */
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
        const raw = await store.read();
        settings = raw == null ? CSC_CONTROL_DEFAULTS :
          cscControlValidateOptions(raw);
        unsubscribe = store.subscribe(() => {
          void schedule(async () => {
            try {
              settings = cscControlValidateOptions(await store.read());
              await apply();
            } catch {
              await pause().catch(() => {});
              state = 'failed';
              lastError = 'csc-remote-settings-invalid';
              notify();
            }
          });
        });
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
    /** Require each journal event to be durable in BOTH sinks before cursor. */
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
        // Never resurrect an old key's segment after a newer scope exists.
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
  /** Shared control owner retained for the lifetime of this document. */
  let cscCaptureControls = null;
  /** Factory registered by the authorised #359 assembled producer bridge. */
  let cscRegisteredHmacFactory = null;
  /**
   * Register the #313 HMAC factory before any controller construction.
   * @param {Function} factory - Factory supplied by the accepted producer.
   * @returns {void} Installs only a callable unclaimed source dependency.
   */
  function cscControlsRegisterHmacFactory(factory) {
    if (typeof factory !== 'function' || cscCaptureControls) {
      throw new Error('csc-hmac-factory-invalid-or-late');
    }
    cscRegisteredHmacFactory = factory;
  }
  /**
   * Return the singleton control port shared by startup and the UI.
   * @returns {Object} Return the singleton control port shared by startup and the UI.
   */
  function cscControlsCurrent() {
    if (!cscCaptureControls) {
      cscCaptureControls = cscCaptureControlPlane({
        store: cscControlSharedStore(),
        serviceFactory: cscRegisteredHmacFactory,
        version: VERSION,
        origin: location.origin
      });
    }
    return cscCaptureControls;
  }
