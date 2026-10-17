  // #127 staging-only browser verification. No production identity or filenames.
  // The source is the page's EXISTING observed fetch/XHR, not new API requests.
  /** Session-scoped redacted evidence storage key. */
  const AICC127_EVIDENCE_KEY = 'dc-issue127-live-observations';
  /** Exact immutable provider commit required by the #127 witness. */
  const AICC127_PROVIDER_SHA = 'cf521202e78dede9152840193dc5ca140703b240';
  /** Exact immutable staged Core commit required by the #127 witness. */
  const AICC127_CORE_SHA = '1a70e7df14a0648c8e144ce3ef0da5e02bc90cd4';
  /** Expected Git blob of the certified private provider artifact. */
  const AICC127_BLOB_SHA = '32182498480ba061367ce60dbb4104c0c0d55fe7';
  /** Memory-only observer and host bridge enabled explicitly by the test button. */
  let aicc127Runtime = null;
  /** Tab-scoped explicit opt-in retained across ChatGPT page reloads. */
  const AICC127_ARMED_KEY = 'dc-issue127-live-armed';

  /**
   * Constructs the redacted per-tab witness record without names or IDs.
   *
   * @returns {Object} Returns the aicc127MinimalEvidence result.
   */
  function aicc127MinimalEvidence() {
    try {
      const item = JSON.parse(sessionStorage.getItem(AICC127_EVIDENCE_KEY) || 'null');
      if (item?.schema === 'aicc127-live-browser-v1' &&
          item.core_sha === AICC127_CORE_SHA &&
          item.provider_sha === AICC127_PROVIDER_SHA) return item;
    } catch {}
    return {
      schema: 'aicc127-live-browser-v1', core_sha: AICC127_CORE_SHA,
      provider_sha: AICC127_PROVIDER_SHA, provider_blob_sha1: AICC127_BLOB_SHA,
      origin: location.origin, started_at: new Date().toISOString(),
      project_backend_and_observer: false, standalone_backend_and_observer: false,
      captures: [], navigation_count: 0, notes: 'Existing page traffic only; names, IDs, messages and credentials omitted'
    };
  }

  /**
   * Persists the bounded privacy-minimized witness across test invocations.
   *
   * @returns {void} No value is returned.
   */
  function aicc127SaveEvidence() {
    if (!aicc127Runtime) return;
    try {
      sessionStorage.setItem(AICC127_EVIDENCE_KEY,
        JSON.stringify(aicc127Runtime.evidence));
    } catch {}
  }


  // Test-only navigation checkpoint.  The salt and fingerprints never export.
  const AICC127_NAV_KEY = 'dc-issue127-navigation-checkpoint';
  function aicc127Fingerprint(value, salt) {
    let hash = 2166136261;
    for (const char of salt + String(value ?? '')) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function aicc127NavigationCheckpoint() {
    try {
      const prior = JSON.parse(sessionStorage.getItem(AICC127_NAV_KEY) || 'null');
      if (prior?.schema === 'aicc127-navigation-v1' &&
          Array.isArray(prior.steps) && prior.steps.length <= 20 &&
          typeof prior.salt === 'string') return prior;
    } catch {}
    return { schema: 'aicc127-navigation-v1',
      salt: Math.random().toString(36).slice(2) + Date.now().toString(36),
      steps: [], reload_count: 0 };
  }

  function aicc127SaveNavigation() {
    const state = aicc127Runtime;
    if (!state?.navigation) return;
    try {
      sessionStorage.setItem(AICC127_NAV_KEY, JSON.stringify(state.navigation));
    } catch {}
    state.evidence.navigation_steps = state.navigation.steps.map(step => ({
      slot: step.slot, backend_observed: step.backend_observed,
      observer_matches_backend: step.observer_matches_backend,
      visible_conversation_match: step.visible_conversation_match,
      visible_project_match: step.visible_project_match,
      changed_from_previous: step.changed_from_previous,
      resumed_after_reload: Boolean(step.resumed_after_reload)
    }));
    state.evidence.reload_count = state.navigation.reload_count;
    aicc127SaveEvidence();
  }

  // Navigation API is the primary SPA signal; request ingress is the fallback.
  function aicc127NavigationChanged() {
    aicc127BeginForCurrentConversation();
  }

  function aicc127NavigationVisit(id) {
    const state = aicc127Runtime;
    if (!state?.navigation) return;
    const nav = state.navigation;
    const key = aicc127Fingerprint(id, nav.salt);
    const previous = nav.steps.at(-1);
    if (previous?.key === key) return;
    const slot = nav.steps.length === 0 ? 'A'
      : nav.steps.length === 1 ? 'B'
      : key === nav.steps[0].key ? 'A-return' : 'other';
    nav.steps.push({ slot, key, backend_observed: false,
      observer_matches_backend: false, visible_conversation_match: null,
      visible_project_match: null, changed_from_previous: null });
    if (nav.steps.length > 20) nav.steps.shift();
    aicc127SaveNavigation();
  }

  function aicc127VisibleComparison(snapshot) {
    const conversation = snapshot?.conversation?.name;
    const project = snapshot?.project?.name;
    const currentId = aicc127Runtime?.conversationId;
    const visibleTitle = String(document.title || '').trim();
    const sidebar = [...document.querySelectorAll('a[href]')].find(anchor => {
      try {
        const url = new URL(anchor.href, location.href);
        return currentId && url.origin === location.origin &&
          url.pathname.split('/').includes(currentId) &&
          anchor.getAttribute('aria-current') === 'page';
      } catch { return false; }
    });
    const visibleConversation = String(sidebar?.textContent || '').trim();
    const normalized = text => String(text).trim().toLocaleLowerCase();
    const conversationMatch = !conversation ? null :
      (visibleConversation ? normalized(visibleConversation) === normalized(conversation)
        : visibleTitle ? normalized(visibleTitle) === normalized(conversation) ||
          normalized(visibleTitle).startsWith(normalized(conversation) + ' - ')
          : null);
    const breadcrumb = [...document.querySelectorAll(
      'nav[aria-label="Breadcrumb"] a[href]')].find(anchor => {
      try {
        return new URL(anchor.href, location.href).pathname.includes('/project');
      } catch { return false; }
    });
    const visibleProject = String(breadcrumb?.textContent || '').trim();
    const projectMatch = snapshot?.project?.status === 'none'
      ? (visibleProject ? false : true)
      : !project || !visibleProject ? null :
        normalized(project) === normalized(visibleProject);
    return { conversationMatch, projectMatch };
  }

  function aicc127NavigationObserved(kind, body, accepted, before) {
    const state = aicc127Runtime;
    if (!state?.navigation || kind !== 'conversation') return;
    const step = state.navigation.steps.at(-1);
    if (!step || !accepted || state.snapshots <= before) return;
    const subject = state.observed;
    const matchedConversation = subject?.conversation?.id === body.conversation_id &&
      subject?.conversation?.name === body.title;
    const matchedProject = body.gizmo_id === null
      ? subject?.project?.status === 'none'
      : typeof body.gizmo_id === 'string' &&
        subject?.project?.status === 'identified' &&
        subject?.project?.id === body.gizmo_id &&
        typeof subject?.project?.name === 'string';
    step.backend_observed = true;
    step.observer_matches_backend = Boolean(matchedConversation && matchedProject);
    const visual = aicc127VisibleComparison(subject);
    step.visible_conversation_match = visual.conversationMatch;
    step.visible_project_match = visual.projectMatch;
    step.name_key = aicc127Fingerprint(subject?.conversation?.name, state.navigation.salt);
    step.project_key = aicc127Fingerprint(subject?.project?.name, state.navigation.salt);
    const prior = state.navigation.steps.at(-2);
    if (prior?.name_key) step.changed_from_previous =
      step.name_key !== prior.name_key && step.project_key !== prior.project_key;
    aicc127SaveNavigation();
  }

  async function testAicc127Navigation() {
    await aicc127Start();
    const steps = aicc127Runtime.navigation.steps;
    const valid = steps.length >= 3 &&
      steps[0].slot === 'A' && steps[1].slot === 'B' &&
      steps[2].slot === 'A-return';
    const all = valid && steps.slice(0, 3).every(step =>
      step.backend_observed && step.observer_matches_backend &&
      step.visible_conversation_match === true &&
      step.visible_project_match === true);
    const changed = valid && steps[1].changed_from_previous === true;
    const restored = valid && steps[0].name_key === steps[2].name_key &&
      steps[0].project_key === steps[2].project_key;
    if (all && changed && restored) return undefined;
    const reason = !valid ? 'Navigate A → B (another project or standalone) → A.'
      : !all ? 'Await backend/observer and visible title/project agreement at all three stops.'
        : !changed ? 'B must have different conversation AND project names.'
          : 'A identity was not restored.';
    return { status: 'INCOMPLETE', detail: reason +
      ' This same-tab session also resumes after reload.' };
  }

  /**
   * Connects the staged Core-owned agent to a test-only subject observer.
   *
   * @returns {Promise<Object>} Returns the aicc127Start result.
   */
  async function aicc127Start() {
    if (aicc127Runtime) return aicc127Runtime;
    const core = canonicalCore();
    assert(core.getVersion() === '1.1.0-issue.127.19',
      'AICC #127 test branch must load Core .127.19');
    const descriptor = core.getAgentPluginArtifact('chatgpt-web');
    assert(descriptor.commit === AICC127_PROVIDER_SHA &&
      descriptor.gitBlobSha1 === AICC127_BLOB_SHA,
    'AICC catalogue does not pin the certified private provider');
    const agent = await ensureChatGPTCanonicalAgent();
    assert(agent.version().version === '0.1.0-issue.1.21',
      'Wrong provider version loaded');
    const module = await importAgentPluginModule(descriptor);
    assert(typeof module.connectChatGPTSubjectHost === 'function',
      'Provider does not expose host traffic bridge');
    const evidence = aicc127MinimalEvidence();
    const navigation = aicc127NavigationCheckpoint();
    if (sessionStorage.getItem(AICC127_ARMED_KEY) === 'true') navigation.reload_count++;
    const state = { agent, evidence, navigation, host: null, conversationId: null,
      observed: null, snapshots: 0, pending: new Set(), module, unsubscribe: null };
    aicc127Runtime = state;
    state.unsubscribe = agent.observeState(snapshot => {
      state.observed = snapshot;
      state.snapshots += 1;
    }, 'subject-identification');
    aicc127BeginForCurrentConversation();
    const navEvent = window.navigation?.addEventListener ? 'currententrychange' : 'popstate';
    (window.navigation?.addEventListener ? window.navigation : window)
      .addEventListener(navEvent, aicc127NavigationChanged);
    state.navigationEvent = navEvent;
    sessionStorage.setItem(AICC127_ARMED_KEY, 'true');
    aicc127SaveEvidence();
    return state;
  }

  /**
   * Rejects previous navigation epochs before correlated responses arrive.
   *
   * @returns {void} No value is returned.
   */
  function aicc127BeginForCurrentConversation() {
    const state = aicc127Runtime;
    if (!state) return;
    const id = currentConversationId();
    if (!id || id === state.conversationId) return;
    state.conversationId = id;
    aicc127NavigationVisit(id);
    state.pending.clear();
    if (state.host) state.host.begin(id);
    else state.host = state.module.connectChatGPTSubjectHost({
      agent: state.agent, origin: location.origin, conversationId: id
    });
    state.evidence.navigation_count += 1;
    aicc127SaveEvidence();
  }

  /**
   * Classifies only allowed same-origin backend identity GET requests.
   *
   * @param {Object} trace - A network request observed by DC.
   * @returns {string|null} Returns the aicc127LiveRequestKind result.
   */
  function aicc127LiveRequestKind(trace) {
    if (trace?.method !== 'GET') return null;
    try {
      const url = new URL(trace.url, location.href);
      if (url.origin !== location.origin) return null;
      if (/^\/backend-api\/conversations\/[^/]+\/?$/.test(url.pathname))
        return 'conversation';
      if (/^\/backend-api\/gizmos\/g-p-[^/]+\/?$/.test(url.pathname))
        return 'project';
    } catch {}
    return null;
  }

  /**
   * Observes a request already captured by DownloadConversation.
   *
   * @param {Object} trace - A network request observed by DC.
   * @returns {void} No value is returned.
   */
  function aicc127LiveOnRequest(trace) {
    const state = aicc127Runtime;
    if (!state) return;
    aicc127BeginForCurrentConversation();
    if (!state.host || !aicc127LiveRequestKind(trace)) return;
    if (state.host.request({
      network_sequence: trace.sequence, method: trace.method,
      request_url: trace.url
    })) state.pending.add(trace.sequence);
  }

  /**
   * Correlates genuine backend identity JSON with observer publication.
   *
   * @param {Object} trace - Correlated network request.
   * @param {number} status - Actual HTTP status.
   * @param {Object} bounded - Bounded existing response body.
   * @returns {void} No value is returned.
   */
  function aicc127LiveAcceptResponse(trace, status, bounded) {
    const state = aicc127Runtime;
    if (!state || !state.pending.delete(trace.sequence)) return;
    // Never store raw body, IDs, names, headers, cookies or URL parameters.
    if (status !== 200 || bounded.truncated || bounded.text.length > 1048576) return;
    let body;
    try { body = JSON.parse(bounded.text); } catch { return; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const kind = aicc127LiveRequestKind(trace);
    const before = state.snapshots;
    const accepted = state.host.response({
      network_sequence: trace.sequence, status, body
    });
    const after = state.observed;
    aicc127NavigationObserved(kind, body, accepted, before);
    const correlated = accepted && state.snapshots > before;
    const record = {
      kind, network_sequence: trace.sequence, status,
      time: new Date().toISOString(), accepted: accepted === true,
      observer_published: correlated,
      observer_readiness: after?.readiness ?? null,
      observer_project_status: after?.project?.status ?? null,
      observer_has_conversation_name: Boolean(after?.conversation?.name),
      observer_has_project_name: Boolean(after?.project?.name),
      backend_explicit_gizmo_null: kind === 'conversation' &&
        Object.hasOwn(body, 'gizmo_id') && body.gizmo_id === null,
      backend_project_membership: kind === 'conversation' &&
        typeof body.gizmo_id === 'string' && body.gizmo_id.startsWith('g-p-')
    };
    state.evidence.captures.push(record);
    if (state.evidence.captures.length > 100) state.evidence.captures.shift();
    if (record.backend_explicit_gizmo_null &&
        record.observer_published && record.observer_project_status === 'none')
      state.evidence.standalone_backend_and_observer = true;
    if (record.observer_published && record.observer_project_status === 'identified' &&
        record.observer_has_conversation_name && record.observer_has_project_name)
      state.evidence.project_backend_and_observer = true;
    aicc127SaveEvidence();
  }

  /**
   * Observes a cloned existing fetch response without new network requests.
   *
   * @param {Object} trace - Original request correlation.
   * @param {number} status - Actual HTTP status.
   * @param {Object} bounded - Existing cloned response body.
   * @returns {void} No value is returned.
   */
  function aicc127LiveOnFetchResponse(trace, status, bounded) {
    if (!aicc127Runtime?.pending.has(trace.sequence)) return;
    aicc127LiveAcceptResponse(trace, status, bounded);
  }

  /**
   * Reports whether the staged witness is awaiting this fetch response.
   * @param {Object} trace - Request correlation record.
   * @returns {boolean} True for an armed and tracked identity response.
   */
  function aicc127LiveWantsFullFetchResponse(trace) {
    return Boolean(aicc127Runtime?.pending.has(trace.sequence));
  }

  /**
   * Extracts only backend-authoritative subject fields from parsed JSON.
   * The complete conversation is never stored in witness evidence.
   * @param {Object} trace - Correlated request.
   * @param {Object} value - Ephemeral parsed response.
   * @returns {Object|null} Minimum provider input or null.
   */
  function aicc127LiveIdentityProjection(trace, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const kind = aicc127LiveRequestKind(trace);
    if (kind === 'conversation') {
      if (typeof value.conversation_id !== 'string') return null;
      const item = { conversation_id: value.conversation_id };
      if (Object.hasOwn(value, 'title')) item.title = value.title;
      if (Object.hasOwn(value, 'gizmo_id')) item.gizmo_id = value.gizmo_id;
      return item;
    }
    if (kind === 'project' && value.gizmo &&
        typeof value.gizmo.id === 'string') {
      return { gizmo: {
        id: value.gizmo.id, display: { name: value.gizmo.display?.name }
      } };
    }
    return null;
  }

  /**
   * Reads an already-cloned authenticated response without the diagnostic
   * truncation limit, then forwards only identity fields. No HTTP request.
   * @param {Object} trace - Existing network correlation.
   * @param {Response} response - Dedicated cloned response.
   * @returns {Promise<boolean>} True if handled, including cached metadata.
   */
  async function aicc127LiveOnFullFetchResponse(trace, response) {
    if (!aicc127LiveWantsFullFetchResponse(trace)) return false;
    try {
      const parsed = await response.json();
      const identity = aicc127LiveIdentityProjection(trace, parsed);
      if (!identity) return false;
      aicc127LiveAcceptResponse(trace, response.status, {
        text: JSON.stringify(identity), truncated: false
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Observes a completed existing XHR without new network requests.
   *
   * @param {Object} xhr - Completed page XHR instance.
   * @param {Object} trace - Original request correlation.
   * @returns {void} No value is returned.
   */
  function aicc127LiveOnXhrResponse(xhr, trace) {
    if (!aicc127Runtime?.pending.has(trace.sequence)) return;
    try {
      const body = xhr.responseType === 'json'
        ? JSON.stringify(xhr.response)
        : (!xhr.responseType || xhr.responseType === 'text' ?
          String(xhr.responseText || '') : '');
      aicc127LiveAcceptResponse(trace, xhr.status, {
        text: body.slice(0, 1048576), truncated: body.length > 1048576
      });
    } catch {}
  }

  /**
   * Verifies that the current test build matches exact Core and provider identities.
   *
   * @returns {Promise<void>} Returns the testAicc127StagedArtifact result.
   */
  async function testAicc127StagedArtifact() {
    await aicc127Start();
  }

  /**
   * Reports PASS only after backend project data reaches the observer.
   *
   * @returns {Promise<Object|undefined>} Returns the testAicc127LiveProject result.
   */
  async function testAicc127LiveProject() {
    const state = await aicc127Start();
    return state.evidence.project_backend_and_observer ? undefined :
      { status: 'INCOMPLETE', detail: 'Await authenticated project metadata. Navigate to a project conversation and rerun.' };
  }

  /**
   * Reports PASS only after backend explicit null reaches the observer.
   *
   * @returns {Promise<Object|undefined>} Returns the testAicc127LiveStandalone result.
   */
  async function testAicc127LiveStandalone() {
    const state = await aicc127Start();
    return state.evidence.standalone_backend_and_observer ? undefined :
      { status: 'INCOMPLETE', detail: 'Await observed backend gizmo_id:null. Navigate to standalone chat and rerun.' };
  }

  /**
   * Exports the redacted local evidence on user click.
   *
   * @returns {void} No value is returned.
   */
  function aicc127ExportEvidence() {
    const evidence = aicc127Runtime?.evidence || aicc127MinimalEvidence();
    const blob = new Blob([JSON.stringify(evidence, null, 2) + '\n'],
      { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aicc127-live-evidence.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sessionStorage.removeItem(AICC127_ARMED_KEY);
    aicc127Runtime?.unsubscribe?.();
    if (aicc127Runtime?.navigationEvent) {
      const listener = aicc127Runtime.navigationEvent === 'currententrychange'
        ? window.navigation : window;
      listener.removeEventListener(aicc127Runtime.navigationEvent, aicc127NavigationChanged);
    }
    sessionStorage.removeItem(AICC127_NAV_KEY);
    aicc127Runtime = null;
  }

  // Only continue an already user-armed witness across a same-tab reload.
  if (sessionStorage.getItem(AICC127_ARMED_KEY) === 'true') {
    Promise.resolve().then(() => aicc127Start()).catch(error => {
      logDiagnostic('warnings', 'aicc127-live-witness-rearm-failed', {
        message: boundedDiagnosticText(errorMessage(error), 500)
      });
    });
  }
