
  /**
   * Loads or initializes the small control/recovery manifest.
   *
   * Historical segment membership is filesystem-derived and is never catalogued
   * here. Legacy active_last_timestamp cache fields are discarded on read.
   *
   * @returns {Promise<Object>} Current control/recovery manifest.
   */
  async function communicationLogReadSegmentManifest() {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory) throw new Error('Communication segment directory is not ready.');
    try {
      const handle = await directory.getFileHandle('manifest.json', { create: false });
      const parsed = JSON.parse(await (await handle.getFile()).text());
      if (parsed?.schema !== 2 || typeof parsed.logical_log_id !== 'string') {
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
      if (error?.name !== 'NotFoundError') throw error;
      return {
        schema: 2,
        logical_log_id: currentConversationId() || crypto.randomUUID(),
        conversation_name: communicationLogConversationName() ?? null,
        project_name: conversationProjectName() ?? null,
        active_committed_eof: 0
      };
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
