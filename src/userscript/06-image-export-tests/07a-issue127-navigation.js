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
   * Records only whether the private provider accepted a changed route and
   * the status of its resulting subject snapshot. No URLs/IDs/names persist.
   * @param {boolean} accepted - Result of provider navigation({url}).
   * @param {Object|null} snapshot - Provider canonical identity state.
   * @returns {void} No value is returned.
   */
  function aicc127NavigationTransportObserved(accepted, snapshot) {
    const step = aicc127Runtime?.navigation?.steps?.at(-1);
    if (!step) return;
    step.navigation_events = (step.navigation_events || 0) + 1;
    step.navigation_accepted = accepted === true;
    const valid = new Set(['identified', 'unresolved', 'none']);
    const conversation = snapshot?.conversation?.status;
    const project = snapshot?.project?.status;
    step.provider_conversation_status = valid.has(conversation)
      ? conversation : 'unknown';
    step.provider_project_status = valid.has(project)
      ? project : 'unknown';
    aicc127SaveNavigation();
  }
  /** Test-only checkpoint key; salt and fingerprints never export. */
  const AICC127_NAV_KEY = 'dc-issue127-navigation-checkpoint';
  /**
   * Hashes a local label with a per-tab salt.
   * @param {string} value - Identity or display label.
   * @param {string} salt - Tab-scoped salt.
   * @returns {string} Nonreversible local fingerprint.
   */
  function aicc127Fingerprint(value, salt) {
    let hash = 2166136261;
    for (const char of salt + String(value ?? '')) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
    return (hash >>> 0).toString(16);
  }
  /**
   * Restores a bounded same-tab checkpoint after reload.
   * @returns {Object} Existing checkpoint or new state.
   */
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
  /**
   * Persists fingerprints apart from redacted export.
   * @returns {void} No value.
   */
  function aicc127SaveNavigation() {
    const state = aicc127Runtime;
    if (!state?.navigation) return;
    try {
      sessionStorage.setItem(AICC127_NAV_KEY, JSON.stringify(state.navigation));
    } catch {}
    state.evidence.navigation_steps = state.navigation.steps.map(step => ({
      slot: step.slot, backend_observed: step.backend_observed,
      backend_source: (step.conversation_responses || 0) > 0 ? 'network-response'
        : step.reused_verified_backend ? 'verified-session-cache'
          : step.backend_observed ? 'network-response' : 'unresolved',
      conversation_requests: step.conversation_requests || 0,
      conversation_responses: step.conversation_responses || 0,
      observer_updates: step.observer_updates || 0,
      navigation_events: step.navigation_events || 0,
      navigation_accepted: step.navigation_accepted === true,
      provider_conversation_status: step.provider_conversation_status || 'unknown',
      provider_project_status: step.provider_project_status || 'unknown',
      project_visual_reason: step.project_visual_reason || 'unresolved',
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
  /**
   * Captures SPA navigation on route change.
   * @returns {void} No value.
   */
  function aicc127NavigationChanged() {
    aicc127BeginForCurrentConversation();
  }
  /**
   * Records A, B and restored A slots.
   * @param {string} id - Current conversation ID (local only).
   * @returns {void} No value.
   */
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
      conversation_requests: 0, conversation_responses: 0, observer_updates: 0,
      observer_matches_backend: false, visible_conversation_match: null,
      visible_project_match: null, changed_from_previous: null });
    if (nav.steps.length > 20) nav.steps.shift();
    aicc127SaveNavigation();
    aicc127NavigationRefreshFromObserver();
    // The observer may publish before ChatGPT paints the new breadcrumb.
    // Recheck visible labels only, never infer identity from those labels.
    // Each callback is tied to this exact step to reject later navigation.
    if (typeof setTimeout === 'function') {
      const step = nav.steps.at(-1);
      for (const delay of [350, 1100]) {
        setTimeout(() => {
          if (aicc127Runtime === state && nav.steps.at(-1) === step)
            aicc127NavigationRefreshFromObserver();
        }, delay);
      }
    }
  }
  /**
   * Compares observer values with visible labels.
   * @param {Object} snapshot - Current observer state.
   * @returns {Object} Comparison flags without private labels.
   */
  function aicc127VisibleComparison(snapshot) {
    const conversation = snapshot?.conversation?.name;
    const project = snapshot?.project?.name;
    const currentId = aicc127Runtime?.conversationId;
    if (typeof document === 'undefined') return {
      conversationMatch: null, projectMatch: null
    };
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
    /**
     * Normalizes a transient visible label for comparison.
     * @param {string} text - Display label.
     * @returns {string} Normalized label.
     */
    const normalized = text => String(text).trim().toLocaleLowerCase();
    const visibleSidebarMatch = !visibleConversation ||
      normalized(visibleConversation) === normalized(conversation);
    const visibleTitleMatch = !visibleTitle ||
      normalized(visibleTitle) === normalized(conversation) ||
      normalized(visibleTitle).startsWith(normalized(conversation) + ' - ');
    const conversationMatch = !conversation ? null :
      !visibleConversation && !visibleTitle ? null :
        visibleSidebarMatch && visibleTitleMatch;
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
    return { conversationMatch, projectMatch,
      projectReason: !visibleProject ? 'breadcrumb-absent'
        : !project ? 'observer-project-name-absent'
          : projectMatch ? 'match' : 'breadcrumb-name-mismatch' };
  }
  /**
   * Correlates backend, observer and visible labels.
   * @param {string} kind - Endpoint classification.
   * @param {Object} body - Ephemeral identity payload.
   * @param {boolean} accepted - Whether the provider accepted the event.
   * @param {number} before - Previous snapshot count.
   * @returns {void} No value.
   */
  function aicc127NavigationObserved(kind, body, accepted, before) {
    const state = aicc127Runtime;
    if (!state?.navigation) return;
    const step = state.navigation.steps.at(-1);
    if (!step) return;
    const salt = state.navigation.salt;
    if (kind === 'conversation' && accepted) {
      step.backend_observed = true;
      step.reused_verified_backend = false;
      step.backend_conversation_key = aicc127Fingerprint(body.conversation_id, salt);
      step.backend_title_key = aicc127Fingerprint(body.title, salt);
      step.backend_project_key = aicc127Fingerprint(body.gizmo_id, salt);
      step.backend_standalone = body.gizmo_id === null;
    }
    if (kind !== 'conversation' && kind !== 'project') return;
    if (!step.backend_observed || state.snapshots <= before) return;
    const subject = state.observed;
    const matchedConversation = subject?.conversation?.status === 'identified' &&
      aicc127Fingerprint(subject.conversation.id, salt) === step.backend_conversation_key &&
      aicc127Fingerprint(subject.conversation.name, salt) === step.backend_title_key;
    const matchedProject = step.backend_standalone
      ? subject?.project?.status === 'none'
      : subject?.project?.status === 'identified' &&
        aicc127Fingerprint(subject.project.id, salt) === step.backend_project_key &&
        typeof subject.project.name === 'string';
    step.observer_matches_backend = Boolean(matchedConversation && matchedProject);
    const visual = aicc127VisibleComparison(subject);
    step.visible_conversation_match = visual.conversationMatch;
    step.visible_project_match = visual.projectMatch;
    step.project_visual_reason = visual.projectReason;
    step.name_key = aicc127Fingerprint(subject?.conversation?.name, salt);
    step.project_key = aicc127Fingerprint(subject?.project?.name, salt);
    const prior = state.navigation.steps.at(-2);
    if (prior?.name_key) step.changed_from_previous =
      step.name_key !== prior.name_key && step.project_key !== prior.project_key;
    aicc127SaveNavigation();
    if (state.sharedHost) aicc127NavigationRefreshFromObserver();
  }
  /**
   * Verifies actual Core observer publication against backend-verified A,
   * including a cache-only return with no fresh request. Never invents data.
   * @returns {void} No value.
   */
  function aicc127NavigationRefreshFromObserver() {
    const state = aicc127Runtime;
    if (!state?.navigation?.steps.length || !state.observed) return;
    const step = state.navigation.steps.at(-1);
    const initial = state.navigation.steps[0];
    const salt = state.navigation.salt;
    if (step.slot === 'A-return' && initial?.observer_matches_backend &&
        initial.backend_observed && !step.backend_observed) {
      step.backend_conversation_key = initial.backend_conversation_key;
      step.backend_title_key = initial.backend_title_key;
      step.backend_project_key = initial.backend_project_key;
      step.backend_standalone = initial.backend_standalone;
      step.backend_observed = true;
      step.reused_verified_backend = true;
    }
    if (!step.backend_observed || !step.observer_updates) return;
    const subject = state.observed;
    const matchesConversation = subject?.conversation?.status === 'identified' &&
      aicc127Fingerprint(subject.conversation.id, salt) === step.backend_conversation_key &&
      aicc127Fingerprint(subject.conversation.name, salt) === step.backend_title_key;
    const matchesProject = step.backend_standalone
      ? subject?.project?.status === 'none'
      : subject?.project?.status === 'identified' &&
        aicc127Fingerprint(subject.project.id, salt) === step.backend_project_key &&
        typeof subject.project.name === 'string';
    step.observer_matches_backend = Boolean(matchesConversation && matchesProject);
    const visual = aicc127VisibleComparison(subject);
    step.visible_conversation_match = visual.conversationMatch;
    step.visible_project_match = visual.projectMatch;
    step.project_visual_reason = visual.projectReason;
    step.name_key = aicc127Fingerprint(subject?.conversation?.name, salt);
    step.project_key = aicc127Fingerprint(subject?.project?.name, salt);
    const prior = state.navigation.steps.at(-2);
    if (prior?.name_key) step.changed_from_previous =
      step.name_key !== prior.name_key && step.project_key !== prior.project_key;
    aicc127SaveNavigation();
  }
  /**
   * Checks the A to B to A navigation test.
   * @returns {Promise<Object|undefined>} Incomplete detail or PASS.
   */
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
