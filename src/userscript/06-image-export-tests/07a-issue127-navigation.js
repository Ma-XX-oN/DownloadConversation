  // Test-only navigation checkpoint.  The salt and fingerprints never export.
  const AICC127_NAV_KEY = 'dc-issue127-navigation-checkpoint';
  /** Hashes a local label with a per-tab salt; raw names never export. */
  function aicc127Fingerprint(value, salt) {
    let hash = 2166136261;
    for (const char of salt + String(value ?? '')) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
    return (hash >>> 0).toString(16);
  }
  /** Restores a bounded same-tab checkpoint after reload. */
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
  /** Persists private fingerprints separately from the redacted export. */
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
  /** Captures SPA navigation when the route changes. */
  function aicc127NavigationChanged() {
    aicc127BeginForCurrentConversation();
  }
  /** Records the A, B and restored A navigation slots. */
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
  /** Compares current observer names with browser-visible labels. */
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
    /** Normalizes a transient visible label for comparison. */
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
    return { conversationMatch, projectMatch };
  }
  /** Correlates a backend response, observer update and visible labels. */
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
  /** Reports whether the A to B to A sequence is fully verified. */
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
