from pathlib import Path

script_path = Path('chatgpt-conversation-markdown-export.user.js')
text = script_path.read_text(encoding='utf-8')


def replace_once(old, new, label):
  global text
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  text = text.replace(old, new, 1)


replace_once('// @version      0.6.158', '// @version      0.6.159', 'userscript version')

anchor = '''  /**\n   * Logs a DOM operation that is about to remove or replace the launcher.\n'''
diagnostics = r'''  const launcherTopologyNodeIds = new WeakMap();
  const launcherTopologyInitialBodyIndexes = new WeakMap();
  const launcherTopologyCandidateStats = new WeakMap();
  let launcherTopologyNextNodeId = 1;
  let launcherTopologyStartedAt = performance.now();
  let launcherTopologyLastBodyMutationAt = launcherTopologyStartedAt;
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
    console.log(
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

'''
replace_once(anchor, diagnostics + anchor, 'insert topology diagnostics')

replace_once('''      next_body_sibling: bodyChildIndex >= 0 && bodyChildIndex + 1 < bodyChildren.length
        ? launcherNodeSummary(bodyChildren[bodyChildIndex + 1])
        : null
''', '''      next_body_sibling: bodyChildIndex >= 0 && bodyChildIndex + 1 < bodyChildren.length
        ? launcherNodeSummary(bodyChildren[bodyChildIndex + 1])
        : null,
      topology: launcherTopologyContext()
''', 'include topology in removal operation')

replace_once('''  installLauncherRemovalDiagnostics();
  installNetworkCapture();
  bootstrapUi();''', '''  installLauncherRemovalDiagnostics();
  installLauncherTopologyDiagnostics();
  installNetworkCapture();
  bootstrapUi();''', 'install topology diagnostics before bootstrap')

script_path.write_text(text, encoding='utf-8')

heading_path = Path('tests/heading-metadata-controls.test.mjs')
heading = heading_path.read_text(encoding='utf-8')
old = "assert.match(userscript, /\\/\\/ @version      0\\.6\\.158/);"
new = "assert.match(userscript, /\\/\\/ @version      0\\.6\\.159/);"
if heading.count(old) != 1:
  raise SystemExit(f'heading version expectation: expected exactly one match, found {heading.count(old)}')
heading_path.write_text(heading.replace(old, new, 1), encoding='utf-8')

panel_path = Path('tests/recorder-panel-ui.test.mjs')
panel = panel_path.read_text(encoding='utf-8')
marker = """  assert.match(userscript, /installLauncherRemovalDiagnostics\\(\\);\\n  installNetworkCapture\\(\\);\\n  bootstrapUi\\(\\);/,
    'Removal diagnostics must be installed before UI bootstrap.');
"""
replacement = """  assert.match(userscript, /function installLauncherTopologyDiagnostics\\(\\)/,
    'Topology diagnostics must monitor BODY structure and startup timing.');
  assert.match(userscript, /launcherTopologyInitialBodyIndexes = new WeakMap\\(\\)/,
    'Topology diagnostics must retain stable identity-to-initial-index mapping.');
  assert.match(userscript, /logLauncherTopology\\('body-child-mutation'/,
    'Direct BODY child mutations must be logged.');
  assert.match(userscript, /logLauncherTopology\\('body-quiet-500ms'\\)/,
    'Topology diagnostics must report an empirically quiet BODY interval.');
  assert.match(userscript, /topology: launcherTopologyContext\\(\\)/,
    'Removal diagnostics must include the full BODY topology at removal time.');
  assert.match(userscript, /installLauncherRemovalDiagnostics\\(\\);\\n  installLauncherTopologyDiagnostics\\(\\);\\n  installNetworkCapture\\(\\);\\n  bootstrapUi\\(\\);/,
    'Removal and topology diagnostics must be installed before UI bootstrap.');
"""
if panel.count(marker) != 1:
  raise SystemExit(f'panel diagnostics marker: expected exactly one match, found {panel.count(marker)}')
panel_path.write_text(panel.replace(marker, replacement, 1), encoding='utf-8')
