  /**
   * Keeps the human-readable manifest conversation name aligned with ChatGPT's
   * document title without polling or rewriting the manifest when it is unchanged.
   *
   * @returns {void} No value is returned.
   */
  function communicationLogInstallManifestTitleSync() {
    /** Starts observing once the document head exists. */
    const install = () => {
      if (!document.head) {
        requestAnimationFrame(install);
        return;
      }
      let lastTitle = conversationTitle();
      const observer = new MutationObserver(() => {
        const nextTitle = conversationTitle();
        if (nextTitle === lastTitle) return;
        lastTitle = nextTitle;
        if (!communicationLogSegmentManifest) return;
        const queued = communicationLogEnqueue('manifest-title-sync', async () => {
          await communicationLogSyncManifestConversationName();
        });
        void queued.operation.catch(() => {});
      });
      observer.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true
      });
    };
    install();
  }

  communicationLogInstallManifestTitleSync();
