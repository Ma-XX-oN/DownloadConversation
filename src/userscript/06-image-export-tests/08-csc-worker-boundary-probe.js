
  /**
   * Synthetic-only classic Worker for CSC stream and directory capability tests.
   * No intercepted traffic, credentials, or production archives enter this Worker.
   *
   * @returns {void} Installs the independent test task receiver.
   */
  function cscProbeWorkerEntrypoint() {
    /**
     * Synthetic fixture octet at one absolute offset.
     *
     * @param {number} offset - Byte position.
     * @returns {number} The deterministic byte value.
     */
    const expectedByte = offset => (Math.imul(offset, 29) + 7) & 255;

    /**
     * Verify a transferred stream or exercise explicit cancellation.
     *
     * @param {Object} task - Stream fixture options and ownership-transferred body.
     * @returns {Promise<Object>} Exact count and stream lifecycle evidence.
     */
    async function readTransferred(task) {
      const reader = task.body.getReader();
      let position = 0;
      let chunks = 0;
      try {
        if (task.delay_ms) {
          self.postMessage({ progress: 'delaying' });
          await new Promise(resolve => setTimeout(resolve, task.delay_ms));
        }
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks += 1;
          if (!(value instanceof Uint8Array)) {
            throw new Error('Transferred body yielded a non-byte chunk.');
          }
          for (let i = 0; i < value.byteLength; i += 1) {
            if (value[i] !== expectedByte(position + i)) {
              throw new Error('Stream byte mismatch at ' + (position + i));
            }
          }
          position += value.byteLength;
          if (task.cancel_after_first) {
            await reader.cancel('CSC synthetic abort probe');
            return { bytes: position, chunks, cancelled: true };
          }
        }
        if (position !== task.expected_bytes) {
          throw new Error('Stream length mismatch: ' + position
            + ' != ' + task.expected_bytes);
        }
        return { bytes: position, chunks, cancelled: false };
      } finally {
        reader.releaseLock();
      }
    }

    /**
     * Prove a transferred directory handle supports Worker-side durable writes.
     *
     * @param {Object} task - User-authorized directory and unique temporary name.
     * @returns {Promise<Object>} Verified file byte count and cleanup state.
     */
    async function verifyDirectory(task) {
      const directory = task.directory;
      if (!directory || typeof directory.getFileHandle !== 'function'
        || typeof directory.removeEntry !== 'function') {
        throw new Error('FileSystemDirectoryHandle unavailable in Worker.');
      }
      if (typeof directory.queryPermission === 'function') {
        const permission = await directory.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
          throw new Error('Worker directory readwrite permission: ' + permission);
        }
      }
      let existing = false;
      try {
        await directory.getFileHandle(task.name);
        existing = true;
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
      if (existing) throw new Error('Temporary probe filename already exists.');
      let created = false;
      let writable = null;
      let failure = null;
      let complete = false;
      const length = 257 * 1024 + 17;
      try {
        const fileHandle = await directory.getFileHandle(task.name, { create: true });
        created = true;
        writable = await fileHandle.createWritable();
        for (let offset = 0; offset < length; offset += 16384) {
          const n = Math.min(16384, length - offset);
          const chunk = new Uint8Array(n);
          for (let i = 0; i < n; i += 1) chunk[i] = expectedByte(offset + i);
          await writable.write(chunk);
        }
        await writable.close();
        writable = null;
        const readBack = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
        if (readBack.byteLength !== length) throw new Error('File length mismatch.');
        for (let i = 0; i < length; i += 1) {
          if (readBack[i] !== expectedByte(i)) {
            throw new Error('File byte mismatch at ' + i);
          }
        }
        complete = true;
      } catch (error) {
        failure = error;
      } finally {
        if (writable) {
          try { await writable.abort(); }
          catch (error) { failure ??= error; }
        }
        if (created) {
          try { await directory.removeEntry(task.name); }
          catch (error) { failure ??= error; }
        }
      }
      if (failure) throw failure;
      if (!complete || !created) throw new Error('Worker write did not finish.');
      try {
        await directory.getFileHandle(task.name);
        throw new Error('Temporary test file still exists after deletion.');
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
      return { bytes: length, written: true, read_back_verified: true, deleted: true };
    }

    /** Worker-local event envelopes; the page never queues COMM probe work. */
    const eventQueue = [];
    /** True while the Worker drains its own queue in arrival order. */
    let draining = false;

    /**
     * Serially execute queued synthetic stream/file event envelopes.
     *
     * @returns {Promise<void>} Resolves when this Worker queue is idle.
     */
    async function drainEventQueue() {
      if (draining) return;
      draining = true;
      try {
        while (eventQueue.length) {
          const envelope = eventQueue.shift();
          const task = envelope.task;
          try {
            const result = envelope.kind === 'stream'
              ? await readTransferred(task)
              : envelope.kind === 'directory' ? await verifyDirectory(task)
                : (() => { throw new Error('Unknown CSC probe task.'); })();
            self.postMessage({ ok: true, ...result });
          } catch (error) {
            self.postMessage({
              ok: false,
              name: String(error?.name || 'Error'),
              message: String(error?.message ?? error).slice(0, 500)
            });
          }
        }
      } finally {
        draining = false;
      }
    }

    self.onmessage = event => {
      const task = event.data;
      eventQueue.push({
        kind: task.kind,
        metadata: task.metadata ?? null,
        task
      });
      void drainEventQueue();
    };
  }

  /**
   * Create a fixed-pattern byte stream without materialising its entire body.
   *
   * @param {number} length - Total synthetic bytes.
   * @returns {ReadableStream} New finite synthetic stream.
   */
  function cscProbeByteStream(length) {
    let offset = 0;
    return new ReadableStream({
      pull(controller) {
        if (offset === length) { controller.close(); return; }
        const size = Math.min(16384, length - offset);
        const chunk = new Uint8Array(size);
        for (let i = 0; i < size; i += 1) {
          chunk[i] = (Math.imul(offset + i, 29) + 7) & 255;
        }
        offset += size;
        controller.enqueue(chunk);
      }
    }, { highWaterMark: 1 });
  }

  /**
   * Execute one synthetic Worker task with ownership transfer and final cleanup.
   *
   * @param {Window} realm - Candidate Worker realm.
   * @param {Object} task - Cloneable task envelope.
   * @param {Array} transfer - Stream transfer list (never stock buffers).
   * @returns {Promise<Object>} Worker-acknowledged result.
   */
  async function cscProbeWorkerTask(realm, task, transfer = []) {
    assert(typeof realm?.Worker === 'function', 'Worker constructor unavailable.');
    const url = realm.URL.createObjectURL(new realm.Blob(
      [["'use strict';", '(' + cscProbeWorkerEntrypoint.toString() + ')();'].join('\n')],
      { type: 'text/javascript' }
    ));
    let worker = null;
    let timeout = null;
    try {
      worker = new realm.Worker(url);
      return await new Promise((resolve, reject) => {
        let finished = false;
        /**
         * Settle a Worker task exactly once.
         *
         * @param {Error|null} error - Terminal failure, if any.
         * @param {Object} result - Worker result, if successful.
         * @returns {void} Settles the task Promise.
         */
        const finish = (error, result) => {
          if (finished) return;
          finished = true;
          if (error) reject(error);
          else resolve(result);
        };
        worker.addEventListener('message', event => {
          if (event.data?.progress) return;
          if (event.data?.ok) finish(null, event.data);
          else finish(new Error((event.data?.name || 'WorkerError') + ': '
            + (event.data?.message || 'No Worker result.')));
        });
        worker.addEventListener('error', event => {
          finish(new Error('Worker/CSP error: ' + (event.message || 'startup failure')));
        });
        worker.addEventListener('messageerror', () => {
          finish(new Error('Worker message deserialization failed.'));
        });
        timeout = setTimeout(() => finish(new Error('Worker probe timeout (30s).')), 30000);
        try { worker.postMessage(task, transfer); }
        catch (error) { finish(new Error('postMessage transfer failed: ' + error)); }
      });
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      worker?.terminate();
      realm.URL.revokeObjectURL(url);
    }
  }

  /**
   * Verify synthetic Request/Response clone streams in the Worker and original.
   *
   * @param {Window} realm - Worker realm under test.
   * @param {string} kind - request or response.
   * @returns {Promise<string>} Verified transfer and stock-integrity evidence.
   */
  async function cscProbeClonedStream(realm, kind) {
    const length = 512 * 1024 + 11;
    const stream = cscProbeByteStream(length);
    const original = kind === 'request'
      ? new Request('https://example.invalid/csc-synthetic', {
        method: 'POST', body: stream, duplex: 'half'
      })
      : new Response(stream, { status: 200 });
    const clone = cloneSafely(original);
    assert(clone?.body instanceof ReadableStream,
      'One existing native clone did not yield a transferable body.');
    const body = clone.body;
    const transferred = cscProbeWorkerTask(realm, {
      kind: 'stream', transport: kind,
      metadata: { url: 'https://example.invalid/csc-synthetic', status: 200 },
      body, expected_bytes: length, delay_ms: 120
    }, [body]);
    const lockedAfterTransfer = body.locked;
    // Observe both promises at once: immediate Worker errors cannot leak.
    const [workerOutcome, stockOutcome] = await Promise.allSettled([
      transferred, original.arrayBuffer()
    ]);
    if (workerOutcome.status === 'rejected') throw workerOutcome.reason;
    if (stockOutcome.status === 'rejected') throw stockOutcome.reason;
    assert(lockedAfterTransfer, 'Stream was not locked on transfer.');
    const originalBytes = new Uint8Array(stockOutcome.value);
    assert(originalBytes.byteLength === length, 'Original ' + kind + ' lost bytes.');
    for (let i = 0; i < originalBytes.length; i += 1) {
      assert(originalBytes[i] === ((Math.imul(i, 29) + 7) & 255),
        'Original ' + kind + ' changed at byte ' + i);
    }
    const result = workerOutcome.value;
    assert(result.bytes === length && !result.cancelled,
      'Worker did not confirm exact transferred stream.');
    return result.bytes + ' bytes exact/stock intact';
  }

  /**
   * One opt-in built-in Test row. Picker opens synchronously on the Run gesture.
   * Each capability reports independently; no real ChatGPT request is issued.
   *
   * @returns {Promise<string>} All stream/filesystem results or explicit failures.
   */
  function testCscWorkerBoundary() {
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const pickerRealm = typeof page.showDirectoryPicker === 'function'
      ? page : window;
    let directoryPromise;
    try {
      if (typeof pickerRealm.showDirectoryPicker !== 'function') {
        throw new Error('showDirectoryPicker unavailable in this browser/realm.');
      }
      directoryPromise = Promise.resolve(
        pickerRealm.showDirectoryPicker({ mode: 'readwrite' })
      ).then(handle => ({ handle }), error => ({ error }));
    } catch (error) {
      directoryPromise = Promise.resolve({ error });
    }
    return (async () => {
      const outcomes = [];
      const failures = [];
      const realms = [['page', page], ['userscript', window]];
      let streamRealm = null;
      for (const [label, realm] of realms) {
        if (label === 'userscript' && realm === page) continue;
        if (typeof realm.Worker !== 'function') {
          failures.push(label + ' Worker constructor unavailable');
          continue;
        }
        try {
          outcomes.push('Response: ' + await cscProbeClonedStream(realm, 'response'));
          outcomes.push('Request: ' + await cscProbeClonedStream(realm, 'request'));
          streamRealm = realm;
          outcomes.push('Stream realm: ' + label);
          break;
        } catch (error) {
          failures.push(label + ': ' + errorMessage(error));
          // A transferred body is spent; synthetic retry creates a new one.
        }
      }
      if (!streamRealm) failures.push('stream transfer: FAIL');
      else {
        try {
          const aborted = cscProbeByteStream(32768);
          const cancelled = await cscProbeWorkerTask(streamRealm, {
            kind: 'stream', body: aborted, expected_bytes: 32768,
            cancel_after_first: true
          }, [aborted]);
          assert(cancelled.cancelled === true && cancelled.chunks === 1,
            'Worker cancellation was not acknowledged.');
          outcomes.push('Stream abort: PASS');
        } catch (error) {
          failures.push('Stream abort: ' + errorMessage(error));
        }
      }
      const permission = await directoryPromise;
      const directory = permission.handle;
      if (permission.error) {
        const error = permission.error;
        failures.push('Directory picker/permission: '
          + String(error?.name || 'Error') + ': ' + errorMessage(error));
      }
      if (directory) {
        const name = '.dc-csc-probe-' + crypto.randomUUID() + '.tmp';
        const workerRealm = streamRealm || page;
        try {
          const result = await cscProbeWorkerTask(workerRealm, {
            kind: 'directory', directory, name
          });
          assert(result.deleted && result.written && result.read_back_verified,
            'Worker directory write/read/delete was not confirmed.');
          outcomes.push('Directory: ' + result.bytes + ' bytes write/read/delete PASS');
        } catch (error) {
          failures.push('Directory Worker: ' + errorMessage(error));
          // Emergency cleanup is a failure path, not a Worker-side PASS.
          try { await directory.removeEntry(name); }
          catch (cleanupError) {
            if (cleanupError?.name !== 'NotFoundError') {
              failures.push('Cleanup: ' + errorMessage(cleanupError));
            }
          }
        }
      }
      if (failures.length) {
        throw new Error('PASS [' + outcomes.join('; ') + ']; FAIL ['
          + failures.join(' | ') + ']');
      }
      return outcomes.join('; ');
    })();
  }
