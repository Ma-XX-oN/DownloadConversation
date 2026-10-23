
  /** DC #318.  Versioned UI policy and HMAC orchestration; no Worker code. */
  const CSC_CONTROL_SETTINGS_KEY = 'dc-csc-capture-options-v1';
  const CSC_CONTROL_SCHEMA = 1;
  const CSC_CONTROL_DEFAULTS = Object.freeze({
    schema: CSC_CONTROL_SCHEMA, mode: 'replay-essentials',
    binary: false, cross_origin: false, auth_headers: false, all: false
  });

  /** Validate untrusted persisted options without enabling extra capture. */
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
    let initialized = false;
    let unsubscribe = null;
    let chain = Promise.resolve();
    let lastError = null;
    const listeners = new Set();

    function snapshot() {
      return Object.freeze({
        settings, settings_state: state, settings_applied: applied,
        key_state: keyState, key_restart: publicKey, expires_at_ms: expiry,
        epoch, error: lastError
      });
    }
    function notify() {
      const value = snapshot();
      for (const listener of listeners) listener(value);
    }
    function reject(reason) {
      lastError = reason;
      applied = false;
      state = 'failed';
      notify();
      throw new Error(reason);
    }
    async function pause() {
      applied = false;
      state = 'pending';
      notify();
      if (worker) await worker.pause();
    }
    /** Apply settings only after versioned positive Worker acknowledgment. */
    async function apply() {
      if (!worker) {
        state = 'pending';
        applied = false;
        notify();
        return false;
      }
      await pause();
      const requestId = 'csc-options-' + ++seq;
      const payload = {
        type: 'csc-comm-configure', schema: CSC_CONTROL_SCHEMA,
        request_id: requestId, options: { ...settings, origin }
      };
      try {
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
    function schedule(operation) {
      const result = chain.then(operation);
      chain = result.catch(() => undefined);
      return result;
    }
    async function init() {
      if (initialized) return snapshot();
      initialized = true;
      try {
        const raw = await store.read();
        settings = raw == null ? CSC_CONTROL_DEFAULTS :
          cscControlValidateOptions(raw);
        unsubscribe = store.subscribe(rawValue => {
          void schedule(async () => {
            try {
              settings = cscControlValidateOptions(rawValue);
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
    }
    async function setOptions(next, confirmed) {
      const options = cscControlValidateOptions(next);
      const broadened = options.mode === 'everything' ||
        options.all || options.binary || options.cross_origin ||
        options.auth_headers;
      if (broadened && confirmed !== true) {
        throw new Error('csc-sensitive-capture-not-confirmed');
      }
      return schedule(async () => {
        await pause();
        try {
          await store.write(options);
        } catch {
          return reject('csc-settings-persist-failed');
        }
        settings = options;
        return apply();
      });
    }
    async function bindWorker(adapter) {
      if (!adapter || !['pause', 'configure', 'resume', 'awaitKey']
        .every(name => typeof adapter[name] === 'function') ||
        !adapter.provisionTarget || typeof adapter.provisionTarget.postMessage !== 'function') {
        throw new Error('csc-worker-adapter-invalid');
      }
      return schedule(async () => {
        worker = adapter;
        return apply();
      });
    }
    function bindSinks(ports) {
      if (!ports || !ports.gen || !ports.comm ||
          !['beginSegment', 'writeCycle'].every(key =>
            typeof ports.gen[key] === 'function') ||
          !['drain', 'beginKeyBoundary', 'writeCycle'].every(key =>
            typeof ports.comm[key] === 'function')) {
        throw new Error('csc-sinks-invalid');
      }
      gen = ports.gen;
      comm = ports.comm;
    }
    /** Obtain only the authoritative nonsecret producer identity. */
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
        publicKey = null;
        expiry = null;
        await pause().catch(() => {});
      }
      notify();
      return snapshot();
    }
    /** Require each journal event to be durable in BOTH sinks before cursor. */
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
    async function prepareCapture() {
      if (!applied || !service || !worker || !gen || !comm) {
        throw new Error('csc-capture-not-ready');
      }
      await refreshKey();
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
        await service.complete(admission.token);
        await pause().catch(() => {});
        throw error;
      }
    }
    async function completeCapture(token) {
      if (!service) throw new Error('csc-key-service-unavailable');
      await service.complete(token);
      await refreshKey();
    }
    async function randomize(confirmed) {
      if (confirmed !== true) throw new Error('csc-randomize-unconfirmed');
      if (!service || !worker || !gen || !comm) {
        throw new Error('csc-randomize-ports-not-ready');
      }
      return schedule(async () => {
        await pause();
        const drained = await comm.drain();
        if (drained?.durable !== true) return reject('csc-drain-not-durable');
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
      });
    }
    function onChange(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    }
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

  /** Singleton control owner; #359 binds real Worker/GEN/COMM ports. */
  let cscCaptureControls = null;
  function cscControlsCurrent() {
    if (!cscCaptureControls) {
      cscCaptureControls = cscCaptureControlPlane({
        store: cscControlSharedStore(),
        serviceFactory: typeof communicationPersistentHmacCurrentTabService ===
          'function' ? communicationPersistentHmacCurrentTabService : null,
        version: VERSION,
        origin: location.origin
      });
    }
    return cscCaptureControls;
  }
