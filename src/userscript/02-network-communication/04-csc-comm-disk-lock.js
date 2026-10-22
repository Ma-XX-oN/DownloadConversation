
  /**
   * Holds a Web Lock for the entire open COMM writer session.
   * @param {Object} scope - Dedicated Worker scope.
   * @returns {Object} Exclusive lock lease controls.
   */
  function cscCommWriterLease(scope) {
    let releaseHeld = null;
    let held = false;
    let completion = Promise.resolve();
    /**
     * Claims the unique logical log without awaiting the lease's closure.
     * @param {string} namespace - One logical recording identity.
     * @returns {Promise<void>} Resolves only after exclusive acquisition.
     */
    async function acquire(namespace) {
      if (held || releaseHeld) throw new Error('csc-writer-lock-already-held');
      const locks = scope.navigator?.locks;
      if (typeof locks?.request !== 'function') {
        throw new Error('csc-writer-lock-unavailable');
      }
      let pass; let fail;
      const acquired = new Promise((resolve, reject) => {
        pass = resolve; fail = reject;
      });
      const task = locks.request('dc-csc-writer:' + namespace,
        { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (!lock) { pass(false); return; }
          held = true;
          const lifetime = new Promise(resolve => {
            releaseHeld = resolve;
          });
          pass(true);
          await lifetime;
          held = false;
          releaseHeld = null;
        });
      completion = Promise.resolve(task);
      void completion.catch(fail);
      if (!(await acquired)) throw new Error('csc-writer-lock-contended');
    }
    /**
     * Relinquishes the exclusive lock on graceful close or failed startup.
     * @returns {Promise<void>} Unlock completed.
     */
    async function release() {
      if (releaseHeld) releaseHeld();
      await completion;
    }
    return Object.freeze({ acquire, release, get held() { return held; } });
  }
