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
