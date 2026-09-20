          child_count: node.childNodes?.length ?? null,
          first_seen_ms: stats?.first_seen_ms ?? null,
          direct_child_mutations: stats?.direct_child_mutations ?? 0,
          removed_from_body_ms: stats?.removed_from_body_ms ?? null
        };
      })
    };
  }

  /**
   * Emits one copyable topology snapshot.
   *
   * @param {string} reason - Event that caused the snapshot.
   * @param {Object} [details={}] - Event-specific details.
   * @returns {void} No value is returned.
   */
  function logLauncherTopology(reason, details = {}) {
    const payload = {
      version: VERSION,
      reason,
      details,
      topology: launcherTopologyContext()
    };
    logConsoleDiagnostic('debug',
      `[DownloadConversation v${VERSION}] launcher topology JSON\n${JSON.stringify(payload, null, 2)}`
    );
  }

  /**
   * Starts passive BODY topology, candidate-parent, and startup-timing diagnostics.
   *
   * No probe nodes are inserted and no removed nodes are restored. Stable WeakMap identities
   * allow one original server-DOM node to be followed even when its BODY index changes.
   *
   * @returns {void} No value is returned.
   */
  function installLauncherTopologyDiagnostics() {
    launcherTopologyStartedAt = performance.now();
    launcherTopologyLastBodyMutationAt = launcherTopologyStartedAt;

    /**
     * Begins topology observation for the BODY instance that exists during startup.
     *
     * @param {HTMLBodyElement} body - BODY element whose direct children are tracked.
     * @returns {void} No value is returned.
     */
    const startForBody = body => {
      const initialChildren = [...body.childNodes];
      initialChildren.forEach((node, index) => {
        launcherTopologyInitialBodyIndexes.set(node, index);
        launcherTopologyCandidateStats.set(node, {
          first_seen_ms: Math.round(performance.now() - launcherTopologyStartedAt),
          direct_child_mutations: 0,
          removed_from_body_ms: null
        });
        launcherTopologyNodeId(node);
      });
      launcherTopologyNodeId(body);
      logLauncherTopology('initial-body');

      const observer = new MutationObserver(records => {
        let bodyChanged = false;
        const bodyEvents = [];
        for (const record of records) {
          if (record.type !== 'childList') continue;
          if (record.target === body) {
            bodyChanged = true;
            launcherTopologyLastBodyMutationAt = performance.now();
            for (const node of record.addedNodes) {
              if (!launcherTopologyCandidateStats.has(node)) {
                launcherTopologyCandidateStats.set(node, {
                  first_seen_ms: Math.round(performance.now() - launcherTopologyStartedAt),
                  direct_child_mutations: 0,
                  removed_from_body_ms: null
                });
              }
            }
            for (const node of record.removedNodes) {
              const stats = launcherTopologyCandidateStats.get(node);
              if (stats) stats.removed_from_body_ms = Math.round(performance.now() - launcherTopologyStartedAt);
            }
            bodyEvents.push({
              removed: [...record.removedNodes].map(node => ({
                node_id: launcherTopologyNodeId(node),
                node: launcherNodeSummary(node),
                initial_body_index: launcherTopologyInitialBodyIndexes.has(node)
                  ? launcherTopologyInitialBodyIndexes.get(node)
                  : null
              })),
              added: [...record.addedNodes].map(node => ({
                node_id: launcherTopologyNodeId(node),
                node: launcherNodeSummary(node),
                initial_body_index: launcherTopologyInitialBodyIndexes.has(node)
                  ? launcherTopologyInitialBodyIndexes.get(node)
                  : null
              }))
            });
          }

          const target = record.target;
          if (target instanceof Node && target.parentNode === body) {
            const stats = launcherTopologyCandidateStats.get(target);
            if (stats) stats.direct_child_mutations += 1;
          }
        }
        if (!bodyChanged) return;
        logLauncherTopology('body-child-mutation', { events: bodyEvents });
        if (launcherTopologyQuietTimer !== null) clearTimeout(launcherTopologyQuietTimer);
        launcherTopologyQuietTimer = setTimeout(() => {
          launcherTopologyQuietTimer = null;
          logLauncherTopology('body-quiet-500ms');
        }, 500);
      });
      observer.observe(body, { childList: true, subtree: true });
    };

    if (document.body) startForBody(document.body);
    else {
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        observer.disconnect();
        startForBody(document.body);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    document.addEventListener('DOMContentLoaded', () => logLauncherTopology('DOMContentLoaded'), { once: true });
    window.addEventListener('load', () => logLauncherTopology('load'), { once: true });
    window.addEventListener('pageshow', () => logLauncherTopology('pageshow'));
    window.addEventListener('popstate', () => logLauncherTopology('popstate'));
    window.addEventListener('hashchange', () => logLauncherTopology('hashchange'));

    for (const delay of [2000, 5000, 10000, 15000]) {
      setTimeout(() => logLauncherTopology(`startup-${delay}ms`), delay);
    }

    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function(...args) {
        const result = Reflect.apply(original, this, args);
        queueMicrotask(() => logLauncherTopology(`history.${method}`));
        return result;
      };
    }
  }

  /**
   * Logs a DOM operation that is about to remove or replace the launcher.
   *
   * This is diagnostic-only.  It never restores, moves, or otherwise changes the launcher.
   * The stack is captured before the native DOM operation so the caller that initiated the
   * removal remains visible in DevTools.
   *
   * @param {string} operation - DOM operation being performed.
   * @param {Node|null} affectedNode - Node whose removal/replacement would affect the launcher.
   * @param {Object} [details={}] - Operation-specific diagnostic details.
   * @returns {void} No value is returned.
   */
  function logLauncherRemovalOperation(operation, affectedNode, details = {}) {
    const launcher = document.getElementById(LAUNCHER_ID);
    if (!(launcher instanceof HTMLElement) || !(affectedNode instanceof Node)) return;
    if (affectedNode !== launcher && !affectedNode.contains(launcher)) return;
    const body = document.body;
    const bodyChildren = body ? [...body.childNodes] : [];
    const bodyChildIndex = launcher.parentNode === body ? bodyChildren.indexOf(launcher) : -1;
    const payload = {
      version: VERSION,
      operation,
      stack: new Error(`launcher removal via ${operation}`).stack || null,
      affected_node: launcherNodeSummary(affectedNode),
      details,
      launcher: launcherLifecycleState(launcher),
      body_child_index: bodyChildIndex,
      body_child_count: bodyChildren.length,
      previous_body_sibling: bodyChildIndex > 0 ? launcherNodeSummary(bodyChildren[bodyChildIndex - 1]) : null,
      next_body_sibling: bodyChildIndex >= 0 && bodyChildIndex + 1 < bodyChildren.length
        ? launcherNodeSummary(bodyChildren[bodyChildIndex + 1])
        : null,
      topology: launcherTopologyContext()
    };
    logConsoleDiagnostic('warnings',
      `[DownloadConversation v${VERSION}] launcher removal operation JSON\n${JSON.stringify(payload, null, 2)}`
    );
  }

  /**
   * Installs targeted DOM-operation wrappers used to identify who removes the launcher.
   *
   * Wrappers preserve the native return values and exceptions.  They only log when the exact
   * operation would remove the launcher or an ancestor that contains it.  No recovery behavior
   * is installed here.
   *
   * @returns {void} No value is returned.
   */
  function installLauncherRemovalDiagnostics() {
    const originalRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function(child) {
      logLauncherRemovalOperation('Node.removeChild', child, {
        parent: launcherNodeSummary(this),
        child_index: child instanceof Node ? [...this.childNodes].indexOf(child) : -1
      });
      return Reflect.apply(originalRemoveChild, this, [child]);
    };

    const originalReplaceChild = Node.prototype.replaceChild;
    Node.prototype.replaceChild = function(newChild, oldChild) {
      logLauncherRemovalOperation('Node.replaceChild', oldChild, {
        parent: launcherNodeSummary(this),
        old_child_index: oldChild instanceof Node ? [...this.childNodes].indexOf(oldChild) : -1,
        new_child: launcherNodeSummary(newChild)
      });
      return Reflect.apply(originalReplaceChild, this, [newChild, oldChild]);
    };

    const originalRemove = Element.prototype.remove;
    Element.prototype.remove = function() {
      logLauncherRemovalOperation('Element.remove', this, {
        parent: launcherNodeSummary(this.parentNode)
      });
      return Reflect.apply(originalRemove, this, []);
    };

    const originalReplaceWith = Element.prototype.replaceWith;
    Element.prototype.replaceWith = function(...nodes) {
      logLauncherRemovalOperation('Element.replaceWith', this, {
        parent: launcherNodeSummary(this.parentNode),
        replacement_count: nodes.length
      });
      return Reflect.apply(originalReplaceWith, this, nodes);
    };

    const originalReplaceChildren = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function(...nodes) {
      logLauncherRemovalOperation('Element.replaceChildren', this, {
        replacement_count: nodes.length
      });
      return Reflect.apply(originalReplaceChildren, this, nodes);
    };

    const innerHtml = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (innerHtml?.set) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        ...innerHtml,
        set(value) {
          logLauncherRemovalOperation('Element.innerHTML=', this, {
            replacement_length: typeof value === 'string' ? value.length : null
