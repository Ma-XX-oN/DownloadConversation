
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
