
  /**
   * Verify the deterministic original/independent-clone payload byte pattern.
   * This test never uses a real ChatGPT request or response.
   *
   * @param {Request|Response} owner - Synthetic page/plugin body owner.
   * @param {number} length - Expected synthetic byte count.
   * @returns {Promise<number>} Independently verified byte count.
   */
  async function cscProbeDualVerifyBody(owner, length) {
    const bytes = new Uint8Array(await owner.arrayBuffer());
    assert(bytes.byteLength === length,
      'Synthetic body length mismatch: ' + bytes.byteLength + ' != ' + length);
    for (let i = 0; i < length; i += 1) {
      assert(bytes[i] === ((Math.imul(i, 29) + 7) & 255),
        'Synthetic body byte mismatch at offset ' + i);
    }
    return bytes.byteLength;
  }

  /**
   * Exercise two independent native body clones and a Worker stream transfer.
   * The page original and plugin clone remain independently readable.
   *
   * @param {Window} realm - Worker creation realm.
   * @param {string} kind - 'request' or 'response'.
   * @param {string} readFirst - 'plugin' or 'stock'.
   * @returns {Promise<string>} Exact synthetic outcome.
   */
  async function cscProbeDualBodyCase(realm, kind, readFirst) {
    const length = 512 * 1024 + 11;
    const originalStream = cscProbeByteStream(length);
    const original = kind === 'request'
      ? new Request('https://example.invalid/csc-dual-fixture', {
        method: 'POST', body: originalStream, duplex: 'half'
      })
      : new Response(originalStream);
    const plugin = cloneSafely(original);
    const comm = cloneSafely(original);
    assert(plugin && comm && plugin !== original && comm !== original
      && plugin !== comm, 'Independent native Request/Response clones unavailable.');
    assert(comm.body instanceof ReadableStream,
      'Native COMM clone did not expose a transferable ReadableStream.');

    // This transfers the second clone's body, not the stock or plugin body.
    const transferred = comm.body;
    const pendingWorker = cscProbeWorkerTask(realm, {
      kind: 'stream', body: transferred,
      expected_bytes: length, delay_ms: 120,
      metadata: { route: 'synthetic', capture_order: 1 }
    }, [transferred]);
    const locked = transferred.locked;
    const firstOwner = readFirst === 'plugin' ? plugin : original;
    const secondOwner = readFirst === 'plugin' ? original : plugin;
    // Observe every started promise to avoid an unhandled Worker rejection.
    const outcomes = await Promise.allSettled([
      pendingWorker,
      (async () => {
        const first = await cscProbeDualVerifyBody(firstOwner, length);
        const second = await cscProbeDualVerifyBody(secondOwner, length);
        return [first, second];
      })()
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') throw outcome.reason;
    }
    const worker = outcomes[0].value;
    const [first, second] = outcomes[1].value;
    assert(locked, 'COMM clone stream was not locked after transfer.');
    assert(worker.bytes === length && worker.cancelled === false,
      'Worker did not verify every byte of transferred COMM clone.');
    assert(first === length && second === length,
      'Stock and plugin failed independent byte verification.');
    return kind + '/' + readFirst + ': stock/plugin/Worker '
      + length + ' bytes exact';
  }

  /**
   * Opt-in real browser capability test, using only artificial body streams.
   * Tests native Request/Response clone ownership without altering either
   * active recorder queue, installing hooks or requesting a directory.
   *
   * @returns {Promise<string>} Independent browser Worker witness or error.
   */
  async function testCscDualCloneOwnership() {
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const realms = [['page', page], ['userscript', window]];
    const failures = [];
    for (const [label, realm] of realms) {
      if (label === 'userscript' && page === realm) continue;
      if (typeof realm.Worker !== 'function') {
        failures.push(label + ': Worker constructor unavailable');
        continue;
      }
      try {
        const results = [];
        for (const kind of ['request', 'response']) {
          for (const order of ['plugin', 'stock']) {
            results.push(await cscProbeDualBodyCase(realm, kind, order));
          }
        }
        return label + ' Worker; ' + results.join('; ');
      } catch (error) {
        failures.push(label + ': ' + errorMessage(error));
      }
    }
    throw new Error('CSC dual-clone witness FAIL: ' + failures.join(' | '));
  }
