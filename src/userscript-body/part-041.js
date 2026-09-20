   * @returns {Object|null} A compact node summary, or null when unavailable.
   */
  function launcherNodeSummary(node) {
    if (!(node instanceof Node)) return null;
    if (!(node instanceof Element)) return { node_name: node.nodeName };
    return {
      node_name: node.nodeName,
      id: node.id || null,
      class_name: typeof node.className === 'string' ? node.className : null
    };
  }

  /**
   * Returns the current launcher lifecycle state for console diagnostics.
   *
   * @param {HTMLElement} launcher - The launcher element being observed.
   * @returns {Object} A compact lifecycle snapshot.
   */
  function launcherLifecycleState(launcher) {
    const style = launcher.isConnected ? getComputedStyle(launcher) : null;
    const rect = launcher.isConnected ? launcher.getBoundingClientRect() : null;
    return {
      connected: launcher.isConnected,
      parent: launcherNodeSummary(launcher.parentNode),
      document_body: launcherNodeSummary(document.body),
      display: style?.display ?? null,
      visibility: style?.visibility ?? null,
      opacity: style?.opacity ?? null,
      width: rect ? Math.round(rect.width) : null,
      height: rect ? Math.round(rect.height) : null
    };
  }

  /**
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
    let disconnectedLogged = false;
    let timer = null;
    const relevantMutations = [];
    const recentMutations = [];
    logConsoleDiagnostic('debug', `[DownloadConversation v${VERSION}] launcher appended`, previous);

    /**
     * Emits one complete, copyable JSON diagnostic when the launcher disconnects.
     *
     * @param {string} source - The detector that observed the disconnection.
     * @param {Object} current - The launcher state at disconnection.
     * @returns {void} No value is returned.
     */
    const logDisconnected = (source, current) => {
      if (disconnectedLogged) return;
      disconnectedLogged = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      const payload = {
        version: VERSION,
        source,
        mutation_count: mutationCount,
        original_body_is_current_body: originalBody === document.body,
        previous,
        current,
        relevant_mutations: relevantMutations,
        recent_mutations: recentMutations
      };
      logConsoleDiagnostic('warnings',
        `[DownloadConversation v${VERSION}] launcher disconnected JSON\n${JSON.stringify(payload, null, 2)}`
      );
    };

    const observer = new MutationObserver(records => {
      mutationCount += records.length;
      for (const record of records) {
        const summary = launcherMutationSummary(record, launcher, originalBody);
        recentMutations.push(summary);
        if (recentMutations.length > 20) recentMutations.shift();
        if (summary.removes_launcher || summary.removes_original_body)
          relevantMutations.push(summary);
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

      logConsoleDiagnostic('warnings', `[DownloadConversation v${VERSION}] launcher lifecycle changed`, {
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
    timer = setInterval(() => {
      const current = launcherLifecycleState(launcher);
      if (!current.connected) {
        logDisconnected('poll', current);
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
        logConsoleDiagnostic('warnings', `[DownloadConversation v${VERSION}] launcher lifecycle poll changed`, {
          previous,
          current
        });
        previous = current;
      }
      if (performance.now() - startedAt >= 15000) {
        clearInterval(timer);
        observer.disconnect();
        logConsoleDiagnostic('debug', `[DownloadConversation v${VERSION}] launcher lifecycle watch ended`, current);
      }
    }, 100);
  }

  /** Stable page-local identities assigned to nodes observed by topology diagnostics. */
  const launcherTopologyNodeIds = new WeakMap();
  /** Initial direct-BODY index for each node present when topology observation begins. */
  const launcherTopologyInitialBodyIndexes = new WeakMap();
  /** Mutation and lifetime counters for direct-BODY children considered as mount candidates. */
  const launcherTopologyCandidateStats = new WeakMap();
  /** Next page-local node identity number assigned by topology diagnostics. */
  let launcherTopologyNextNodeId = 1;
  /** Performance timestamp when topology observation began. */
  let launcherTopologyStartedAt = performance.now();
  /** Performance timestamp of the most recent direct-BODY child mutation. */
  let launcherTopologyLastBodyMutationAt = launcherTopologyStartedAt;
  /** Pending timer that reports a 500 ms direct-BODY structural quiet interval. */
  let launcherTopologyQuietTimer = null;

  /**
   * Returns a stable diagnostics-only identity for a DOM node during this page lifetime.
   *
   * @param {Node|null} node - Node whose diagnostic identity is requested.
   * @returns {string|null} Stable page-local node identity, or null when unavailable.
   */
  function launcherTopologyNodeId(node) {
    if (!(node instanceof Node)) return null;
    let id = launcherTopologyNodeIds.get(node);
    if (!id) {
      id = `N${launcherTopologyNextNodeId++}`;
      launcherTopologyNodeIds.set(node, id);
    }
    return id;
  }

  /**
   * Returns one direct-BODY child description with stable identity and initial position.
   *
   * @param {Node} node - BODY child to summarize.
   * @param {number} index - Current direct-BODY child index.
   * @returns {Object} Serializable topology entry.
   */
  function launcherTopologyChildSummary(node, index) {
    return {
      index,
      node_id: launcherTopologyNodeId(node),
      initial_body_index: launcherTopologyInitialBodyIndexes.has(node)
        ? launcherTopologyInitialBodyIndexes.get(node)
        : null,
      node: launcherNodeSummary(node)
    };
  }

  /**
   * Captures current BODY topology and candidate-parent stability.
   *
   * @returns {Object} Serializable topology snapshot.
   */
  function launcherTopologyContext() {
    const body = document.body;
    const children = body ? [...body.childNodes] : [];
    return {
      elapsed_ms: Math.round(performance.now() - launcherTopologyStartedAt),
      ready_state: document.readyState,
      location: location.href,
      body_node_id: launcherTopologyNodeId(body),
      body_child_count: children.length,
      body_children: children.map(launcherTopologyChildSummary),
      quiet_for_ms: Math.round(performance.now() - launcherTopologyLastBodyMutationAt),
      candidates: children.map(node => {
        const stats = launcherTopologyCandidateStats.get(node);
        return {
          node_id: launcherTopologyNodeId(node),
          node: launcherNodeSummary(node),
          connected: node.isConnected,
