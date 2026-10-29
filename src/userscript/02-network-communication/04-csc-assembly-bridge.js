  /**
   * #359 parent integration: exact #318 controller ports bound to one
   * dedicated #311+#317 Worker, one persistent #313 service and GEN disk.
   * No second interception or redaction, and no memory-only durability ACK.
   */
  function cscAssemblyBridge(root, namespace, version) {
    assert(root && typeof root.getDirectoryHandle === 'function' &&
      /^[A-Za-z0-9._-]{1,100}$/.test(namespace) &&
      typeof version === 'string' && Boolean(version),
    'csc-assembly-directory-invalid');
    const runtime = globalThis['__dcCompressor'];
    assert(typeof runtime?.wasmGzipBase64 === 'string',
      'csc-assembly-zstd-unavailable');
    const source = cscCommDiskWorkerSource();
    const objectUrl = URL.createObjectURL(new Blob([source], {
      type: 'text/javascript'
    }));
    let worker;
    try { worker = new Worker(objectUrl); }
    finally { URL.revokeObjectURL(objectUrl); }
    const pending = new Map();
    const keys = new Map();
    let opened = null;
    let openedRestart = null;
    let enabled = false;
    let disposed = false;
    let requestNumber = 0;
    const timeoutMs = 15000;
    function failClosed(reason) {
      const error = Error(reason);
      for (const [,item] of pending) {
        clearTimeout(item.timer);
        item.reject(error);
      }
      pending.clear();
      for (const [,item] of keys) {
        clearTimeout(item.timer);
        item.reject(error);
      }
      keys.clear();
      enabled = false;
      cscBindCommWorker(null);
    }
    function waitFor(match, message, key, expectedType) {
      assert(!disposed, 'csc-assembly-disposed');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          match.delete(key);
          reject(Error('csc-assembly-control-timeout'));
        }, timeoutMs);
        match.set(key, { resolve, reject, timer, expectedType });
        if (message) {
          try { worker.postMessage(message); }
          catch (error) {
            match.delete(key);
            clearTimeout(timer);
            reject(error);
          }
        }
      });
    }
    function onMessage(event) {
      const message = event.data;
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'csc-writer-ready') {
        const item = pending.get('open');
        if (!item) return;
        pending.delete('open'); clearTimeout(item.timer);
        if (message.durable !== true ||
            message.key_restart !== openedRestart) {
          item.reject(Error('csc-assembly-writer-open-invalid'));
        } else item.resolve(message);
      } else if (message.type === 'csc-comm-configured' ||
                 message.type === 'csc-comm-configuration-failed') {
        const item = pending.get(message.request_id);
        if (!item) return;
        pending.delete(message.request_id); clearTimeout(item.timer);
        if (message.type !== item.expectedType) {
          item.reject(Error('csc-assembly-configure-failed'));
        } else item.resolve(message);
      } else if (message.type === 'csc-comm-key-ready') {
        const item = keys.get(message.token);
        if (!item) return;
        keys.delete(message.token); clearTimeout(item.timer);
        item.resolve(message);
      } else if (message.type === 'csc-comm-provision-failed' ||
                 message.type === 'csc-writer-error') {
        failClosed('csc-assembly-worker-operation-failed');
      }
    }
    function onError() {
      failClosed('csc-assembly-worker-crashed');
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onError);
    async function ensureOpen(restart) {
      assert(typeof restart === 'string' &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(restart),
      'csc-assembly-key-restart-invalid');
      if (opened) {
        assert(restart >= openedRestart, 'csc-assembly-stale-open');
        return opened;
      }
      openedRestart = restart;
      opened = waitFor(pending, {
        type: 'csc-writer-open', handle: root, namespace, version,
        key_restart: restart, wasm_gzip_base64: runtime.wasmGzipBase64
      }, 'open', 'csc-writer-ready');
      try { return await opened; }
      catch (error) { opened = null; throw error; }
    }
    const durable = cscCommDurablePort(worker, timeoutMs);
    const comm = Object.freeze({
      async hasCycle(id) {
        assert(typeof id === 'string' &&
          id.startsWith('hmac-key-cycle:'), 'csc-assembly-cycle-id-invalid');
        if (opened) await opened;
        else await ensureOpen(id.slice('hmac-key-cycle:'.length));
        // Historical membership is read-only; it never reopens an old key.
        return durable.hasCycle(id);
      },
      async drain() {
        assert(opened, 'csc-assembly-writer-not-open');
        await opened;
        return durable.drain();
      },
      async beginKeyBoundary(header) {
        await ensureOpen(header?.key_restart);
        return durable.beginKeyBoundary(header);
      },
      async writeCycle(event) {
        assert(opened, 'csc-assembly-writer-not-open');
        await opened;
        return durable.writeCycle(event);
      }
    });
    const controllerWorker = Object.freeze({
      provisionTarget: worker,
      pause: async () => {
        enabled = false;
        cscBindCommWorker(null);
      },
      resume: async () => {
        assert(opened && !disposed, 'csc-assembly-writer-not-ready');
        await opened;
        enabled = true;
        cscBindCommWorker(worker);
      },
      configure: payload => {
        assert(payload && typeof payload.request_id === 'string',
          'csc-assembly-configure-invalid');
        return waitFor(pending, payload, payload.request_id,
          'csc-comm-configured');
      },
      awaitKey: token => {
        assert(typeof token === 'string' && token.length > 0,
          'csc-assembly-key-token-invalid');
        return waitFor(keys, null, token, 'csc-comm-key-ready');
      }
    });
    async function openGen() {
      const directory = await root.getDirectoryHandle(
        'dc-gen-' + namespace, { create: true });
      const gen = cscGenDurablePort(directory, version);
      await gen.recover();
      return gen;
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      failClosed('csc-assembly-disposed');
      durable.dispose();
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
      worker.terminate();
    }
    return Object.freeze({
      comm, controllerWorker, openGen, dispose,
      get worker() { return worker; },
      get enabled() { return enabled; }
    });
  }
