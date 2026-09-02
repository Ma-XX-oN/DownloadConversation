from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')

old = '// @version      0.6.153'
new = '// @version      0.6.154'
assert text.count(old) == 1, f'expected one {old!r}'
text = text.replace(old, new, 1)

replacement = '''  /**
   * Summarizes one DOM mutation for launcher-lifecycle console diagnostics.
   *
   * @param {MutationRecord} record - The mutation record to summarize.
   * @param {HTMLElement} launcher - The launcher element being observed.
   * @param {HTMLElement} originalBody - The body that originally contained the launcher.
   * @returns {Object} A serializable mutation summary.
   */
  function launcherMutationSummary(record, launcher, originalBody) {
    const removedNodes = [...record.removedNodes];
    const addedNodes = [...record.addedNodes];
    return {
      type: record.type,
      target: launcherNodeSummary(record.target),
      attribute_name: record.attributeName || null,
      removed_nodes: removedNodes.map(launcherNodeSummary),
      added_nodes: addedNodes.map(launcherNodeSummary),
      removes_launcher: removedNodes.some(node =>
        node === launcher || (node instanceof Element && node.contains(launcher))),
      removes_original_body: removedNodes.some(node =>
        node === originalBody || (node instanceof Element && node.contains(originalBody))),
      target_is_original_body: record.target === originalBody
    };
  }

  /**
   * Watches one launcher instance until it disconnects or the startup observation window ends.
   *
   * @param {HTMLElement} launcher - The launcher element being observed.
   * @returns {void} No value is returned.
   */
  function watchLauncherLifecycle(launcher) {
    const originalBody = document.body;
    let previous = launcherLifecycleState(launcher);
    let mutationCount = 0;
    const relevantMutations = [];
    console.log(`[DownloadConversation v${VERSION}] launcher appended`, previous);

    /**
     * Emits one complete, copyable JSON diagnostic when the launcher disconnects.
     *
     * @param {string} source - The detector that observed the disconnection.
     * @param {Object} current - The launcher state at disconnection.
     * @returns {void} No value is returned.
     */
    const logDisconnected = (source, current) => {
      const payload = {
        version: VERSION,
        source,
        mutation_count: mutationCount,
        original_body_is_current_body: originalBody === document.body,
        previous,
        current,
        relevant_mutations: relevantMutations
      };
      console.warn(
        `[DownloadConversation v${VERSION}] launcher disconnected JSON\\n${JSON.stringify(payload, null, 2)}`
      );
    };

    const observer = new MutationObserver(records => {
      mutationCount += records.length;
      for (const record of records) {
        const summary = launcherMutationSummary(record, launcher, originalBody);
        if (summary.removes_launcher || summary.removes_original_body ||
            summary.target_is_original_body) relevantMutations.push(summary);
      }

      const current = launcherLifecycleState(launcher);
      const changed = current.connected !== previous.connected ||
        current.parent?.node_name !== previous.parent?.node_name ||
        current.parent?.id !== previous.parent?.id ||
        current.display !== previous.display ||
        current.visibility !== previous.visibility ||
        current.opacity !== previous.opacity ||
        current.width !== previous.width ||
        current.height !== previous.height;
      if (!changed) return;

      if (!current.connected) {
        logDisconnected('mutation-observer', current);
        previous = current;
        observer.disconnect();
        return;
      }

      console.warn(`[DownloadConversation v${VERSION}] launcher lifecycle changed`, {
        previous,
        current
      });
      previous = current;
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden']
    });

    const startedAt = performance.now();
    const timer = setInterval(() => {
      const current = launcherLifecycleState(launcher);
      if (!current.connected) {
        logDisconnected('poll', current);
        clearInterval(timer);
        observer.disconnect();
        previous = current;
        return;
      }
      if (current.parent?.node_name !== previous.parent?.node_name ||
          current.parent?.id !== previous.parent?.id ||
          current.display !== previous.display ||
          current.visibility !== previous.visibility ||
          current.opacity !== previous.opacity ||
          current.width !== previous.width ||
          current.height !== previous.height) {
        console.warn(`[DownloadConversation v${VERSION}] launcher lifecycle poll changed`, {
          previous,
          current
        });
        previous = current;
      }
      if (performance.now() - startedAt >= 15000) {
        clearInterval(timer);
        observer.disconnect();
        console.log(`[DownloadConversation v${VERSION}] launcher lifecycle watch ended`, current);
      }
    }, 100);
  }
'''

start_marker = '''  /**
   * Watches one launcher instance until it disconnects or the startup observation window ends.
'''
end_marker = '''
  /**
   * Handles make launcher.
'''
start = text.index(start_marker)
end = text.index(end_marker, start)
text = text[:start] + replacement + text[end:]

path.write_text(text, encoding='utf-8')
