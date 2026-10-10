
  /**
   * Converts bytes to lowercase hexadecimal text.
   *
   * @param {Uint8Array} bytes - Bytes to format.
   * @returns {string} Lowercase hexadecimal text.
   */
  function agentPluginHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Verifies private plugin bytes against build-owned Git object metadata.
   *
   * @param {Object} descriptor - Plugin selector and integrity metadata.
   * @param {string} source - Retrieved self-contained ESM source.
   * @returns {Promise<Uint8Array>} Exact verified UTF-8 source bytes.
   */
  async function verifyAgentPluginSource(descriptor, source) {
    const bytes = new TextEncoder().encode(source);
    assert(bytes.byteLength === descriptor.byte_length,
      `ChatGPT plugin byte length ${bytes.byteLength} differs from pinned ${descriptor.byte_length}.`);
    const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
    const gitObject = new Uint8Array(header.byteLength + bytes.byteLength);
    gitObject.set(header, 0);
    gitObject.set(bytes, header.byteLength);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', gitObject));
    assert(agentPluginHex(digest) === descriptor.git_blob_sha1,
      'ChatGPT plugin Git blob integrity check failed.');
    return bytes;
  }
