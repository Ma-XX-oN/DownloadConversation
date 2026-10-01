
  /**
   * Waits for a matching userscript value-change notification.
   *
   * @param {string} responseKey - Shared response key.
   * @param {string} requestId - Request identity to match.
   * @param {(value: Object) => void} callback - Matching-value callback.
   * @returns {number} Tampermonkey listener identifier.
   */
  function addAgentPluginResponseListener(responseKey, requestId, callback) {
    return GM_addValueChangeListener(
      responseKey,
      (_name, _oldValue, value) => {
        if (!value || value.request_id !== requestId) return;
        callback(value);
      }
    );
  }
