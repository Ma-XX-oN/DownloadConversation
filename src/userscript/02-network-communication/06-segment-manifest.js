
  /** Current private communication-segment storage schema. */
  const COMMUNICATION_LOG_SEGMENT_SCHEMA = 3;

  /**
   * Creates a fresh small control/recovery manifest for the current schema.
   *
   * @returns {Object} New current-schema manifest.
   */
  function communicationLogCreateSegmentManifest() {
    return {
      schema: COMMUNICATION_LOG_SEGMENT_SCHEMA,
      logical_log_id: currentConversationId() || crypto.randomUUID(),
      conversation_name: communicationLogConversationName() ?? null,
      project_name: conversationProjectName() ?? null,
      active_committed_eof: 0
    };
  }

  /**
   * Preserves the exact corrupt manifest before reconstructing recoverable control state.
   * Historical archives and the two active JSONL files remain on disk.
   *
   * @param {Object} directory - The existing private segment directory.
   * @param {File} original - The unreadable manifest file snapshot.
   * @returns {Promise<Object>} Reconstructed control state after exact backup verification.
   */
  async function communicationLogQuarantineMalformedManifest(directory, original) {
    if (original.size > 1024 * 1024) {
      throw new Error('Malformed manifest exceeds the safe one-megabyte backup limit.');
    }
    const originalBytes = new Uint8Array(await original.arrayBuffer());
    const backupName = `manifest.corrupt-${Date.now()}-${crypto.randomUUID()}.json`;
    const backupHandle = await directory.getFileHandle(backupName, { create: true });
    const writer = await backupHandle.createWritable();
    try {
      await writer.write(originalBytes);
      await writer.close();
    } catch (error) {
      await abortWritableQuietly(writer);
      throw error;
    }
    const copied = new Uint8Array(await (await backupHandle.getFile()).arrayBuffer());
    if (copied.byteLength !== originalBytes.byteLength ||
        copied.some((byte, index) => byte !== originalBytes[index])) {
      throw new Error('Damaged segment manifest backup could not be verified.');
    }
    // Refuse to overwrite a manifest another restored tab replaced in the meantime.
    const current = await (await directory.getFileHandle('manifest.json', { create: false })).getFile();
    const now = new Uint8Array(await current.arrayBuffer());
    if (now.byteLength !== originalBytes.byteLength ||
        now.some((byte, index) => byte !== originalBytes[index])) {
      throw new Error('Segment manifest changed during quarantine; reload to retry.');
    }
    logDiagnostic('warnings', 'communication-log-manifest-quarantined', {
      backup_name: backupName,
      preserved_bytes: originalBytes.byteLength,
      recovery: 'rebuild control metadata from surviving segment files'
    });
    return communicationLogCreateSegmentManifest();
  }

  /**
   * Loads the small control/recovery manifest.
   *
   * Historical segment membership is filesystem-derived and is never catalogued
   * here. A missing or different schema returns null so startup can wipe and
   * recreate the private segment directory as one format-consistent unit.
   *
   * @returns {Promise<Object|null>} Current control/recovery manifest, or null when reset is required.
   */
  async function communicationLogReadSegmentManifest() {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory) throw new Error('Communication segment directory is not ready.');
    try {
      const handle = await directory.getFileHandle('manifest.json', { create: false });
      const file = await handle.getFile();
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return communicationLogQuarantineMalformedManifest(directory, file);
      }
      if (parsed?.schema !== COMMUNICATION_LOG_SEGMENT_SCHEMA) return null;
      if (typeof parsed.logical_log_id !== 'string') {
        throw new Error('Invalid communication segment manifest.');
      }
      delete parsed.active_last_timestamp;
      const conversationName = communicationLogConversationName();
      const projectName = conversationProjectName();
      const inProject = /^\/g\/[^/]+(?:\/|$)/.test(location.pathname);
      parsed.conversation_name = conversationName
        ?? (typeof parsed.conversation_name === 'string' ? parsed.conversation_name : null);
      parsed.project_name = projectName
        ?? (inProject && typeof parsed.project_name === 'string' ? parsed.project_name : null);
      return parsed;
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  /**
   * Commits the current small control/recovery manifest.
   *
   * @returns {Promise<void>} Resolves after manifest commit.
   */
  async function communicationLogWriteSegmentManifest() {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory || !communicationLogSegmentManifest) {
      throw new Error('Communication segment manifest is not ready.');
    }
    const handle = await directory.getFileHandle('manifest.json', { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(JSON.stringify(communicationLogSegmentManifest, null, 2) + '\n');
      await writable.close();
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }
  }

  /**
   * Refreshes human-readable project/conversation identity in the durable manifest.
   *
   * @returns {Promise<boolean>} True when changed identity was committed.
   */
  async function communicationLogSyncManifestConversationName() {
    if (!communicationLogSegmentManifest) return false;
    const conversationName = communicationLogConversationName();
    const projectName = conversationProjectName();
    const inProject = /^\/g\/[^/]+(?:\/|$)/.test(location.pathname);
    let changed = false;
    if (conversationName
        && communicationLogSegmentManifest.conversation_name !== conversationName) {
      communicationLogSegmentManifest.conversation_name = conversationName;
      changed = true;
    }
    if (projectName
        && communicationLogSegmentManifest.project_name !== projectName) {
      communicationLogSegmentManifest.project_name = projectName;
      changed = true;
    } else if (!inProject && communicationLogSegmentManifest.project_name !== null) {
      communicationLogSegmentManifest.project_name = null;
      changed = true;
    }
    if (!changed) return false;
    await communicationLogWriteSegmentManifest();
    return true;
  }
