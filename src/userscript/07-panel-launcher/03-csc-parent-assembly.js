  /** Original #359 parent owns the page's non-release physical CSC assembly. */
  let cscParentAssembly = null;
  let cscParentAssemblyHandle = null;

  /**
   * Connect the accepted #313/#318 controller to real GEN and COMM disk ports.
   * The folder is the same already authorized GEN recording destination.
   * A failure leaves CSC capture stopped; it must never silently fall back.
   * @param {FileSystemDirectoryHandle} handle - User-approved root.
   * @returns {Promise<Object>} Confirmed non-release port registration.
   */
  async function cscAttachPhysicalDirectory(handle) {
    assert(handle && typeof handle.getDirectoryHandle === 'function',
      'csc-assembly-root-invalid');
    const raw = String(currentConversationId() ||
      communicationLogConversationName() || 'conversation');
    const namespace = raw.replace(/[^A-Za-z0-9._-]/g, '-')
      .slice(0, 72).replace(/^-+/, '') || 'conversation';
    if (cscParentAssembly &&
        cscParentAssemblyHandle === handle) {
      return Object.freeze({ attached: true, namespace });
    }
    if (cscParentAssembly) {
      cscParentAssembly.dispose();
      cscParentAssembly = null;
      cscParentAssemblyHandle = null;
    }
    const bridge = cscAssemblyBridge(handle, namespace, VERSION);
    try {
      const controller = cscControlsCurrent();
      await controller.init();
      const gen = await bridge.openGen();
      const current = controller.snapshot();
      if (current.key_restart) {
        await bridge.comm.hasCycle('hmac-key-cycle:' + current.key_restart);
      }
      controller.bindSinks({ gen, comm: bridge.comm });
      await controller.bindWorker(bridge.controllerWorker);
      cscParentAssembly = bridge;
      cscParentAssemblyHandle = handle;
      return Object.freeze({ attached: true, namespace });
    } catch (error) {
      bridge.dispose();
      throw error;
    }
  }

  /** Prevent the old Worker from retaining activity after the page exits. */
  function cscDisposePhysicalDirectory() {
    cscParentAssembly?.dispose();
    cscParentAssembly = null;
    cscParentAssemblyHandle = null;
  }
