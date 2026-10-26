  // #297 TEST-ONLY. The #309/#310 host and queue remain sole owners.
  /** #297-only AICC127_ARMED_KEY state; no private payload is persisted. */
  const AICC127_ARMED_KEY = 'dc-issue127-live-armed';
  /** #297-only AICC127_EVIDENCE_KEY state; no private payload is persisted. */
  const AICC127_EVIDENCE_KEY = 'dc-issue127-live-observations-v2';
  /** #297-only AICC127_NAV_KEY state; no private payload is persisted. */
  const AICC127_NAV_KEY = 'dc-issue127-live-nav-v2';
  /** #297-only AICC127_PROVIDER_SHA state; no private payload is persisted. */
  const AICC127_PROVIDER_SHA = 'b9aa20df9d109b79022e5062e788758d2dbd3cc3';
  /** #297-only AICC127_PROVIDER_BLOB state; no private payload is persisted. */
  const AICC127_PROVIDER_BLOB = 'ba2f0c2571a56cdf005f59da6e248496fa725925';
  /** #297-only AICC127_CORE_SHA state; no private payload is persisted. */
  const AICC127_CORE_SHA = '629c86284b7db5fb412bb083178eaee8c06f796c';
  /** #297-only AICC127_SOURCE_SHA state; no private payload is persisted. */
  const AICC127_SOURCE_SHA = null; // Git SHA is not provable at runtime.
  /** #297-only aicc127Runtime state; no private payload is persisted. */
  let aicc127Runtime = null;
  /** #297-only aicc127StartPending state; no private payload is persisted. */
  let aicc127StartPending = null;

  /**
   * aicc127Fingerprint for the #297 test-only observer.
   * @param {string} value - Input to this read-only witness operation.
   * @param {string} salt - Input to this read-only witness operation.
   * @returns {string} Observer operation result.
   */
  function aicc127Fingerprint(value, salt) {
    let hash = 2166136261;
    for (const char of salt + String(value ?? ''))
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16);
  }

  /**
   * aicc127Checkpoint for the #297 test-only observer.
   * @returns {Object} Observer operation result.
   */
  function aicc127Checkpoint() {
    try {
      const prior = JSON.parse(sessionStorage.getItem(AICC127_NAV_KEY) || 'null');
      if (prior?.schema === 'aicc127-queued-nav-v2'
          && Array.isArray(prior.steps) && prior.steps.length <= 20
          && typeof prior.salt === 'string') return prior;
    } catch {}
    return { schema: 'aicc127-queued-nav-v2', salt: crypto.randomUUID(),
      steps: [], reload_count: 0, page: null };
  }

  /**
   * aicc127Public Step for the #297 test-only observer.
   * @param {Object} step - Input to this read-only witness operation.
   * @returns {Object} Observer operation result.
   */
  function aicc127PublicStep(step) {
    return {
      slot: step.slot, first_capture_order: step.first_capture_order,
      first_capture_epoch_ms: step.first_capture_epoch_ms,
      first_capture_mono_ms: step.first_capture_mono_ms,
      last_capture_order: step.last_capture_order,
      last_capture_epoch_ms: step.last_capture_epoch_ms,
      last_capture_mono_ms: step.last_capture_mono_ms,
      conversation_requests: step.conversation_requests || 0,
      conversation_responses: step.conversation_responses || 0,
      observer_updates: step.observer_updates || 0,
      navigation_dispatched: step.navigation_dispatched === true,
      backend_observed: step.backend_observed === true,
      backend_explicit_gizmo_null: step.backend_explicit_gizmo_null === true,
      backend_project_membership: step.backend_project_membership === true,
      backend_source: step.reused_verified_backend
        ? 'verified-session-cache' : step.backend_observed ? 'network-response' : 'unresolved',
      observer_matches_backend: step.observer_matches_backend === true,
      visible_conversation_match: step.visible_conversation_match ?? null,
      visible_project_match: step.visible_project_match ?? null,
      stale_responses: step.stale_responses || 0,
      group_one_enabled: step.group_one_enabled === true,
      group_one_ready: step.group_one_ready === true,
      group_one_same: step.group_one_same ?? null
    };
  }

  /**
   * aicc127Save for the #297 test-only observer.
   * @returns {void} Observer operation result.
   */
  function aicc127Save() {
    const s = aicc127Runtime;
    if (!s) return;
    s.evidence.navigation_steps = s.nav.steps.map(aicc127PublicStep);
    s.evidence.reload_count = s.nav.reload_count;
    s.evidence.observer_callbacks = s.callbacks;
    try {
      sessionStorage.setItem(AICC127_NAV_KEY, JSON.stringify(s.nav));
      sessionStorage.setItem(AICC127_EVIDENCE_KEY, JSON.stringify(s.evidence));
    } catch {}
  }

  /**
   * aicc127Group One for the #297 test-only observer.
   * @param {Object} step - Input to this read-only witness operation.
   * @returns {void} Observer operation result.
   */
  function aicc127GroupOne(step) {
    if (typeof recordingGroupState !== 'function') return;
    const group = recordingGroupState();
    step.group_one_enabled = group.enabled === true;
    step.group_one_ready = group.ready === true;
    if (group.enabled && typeof group.uuid === 'string') {
      const key = aicc127Fingerprint(group.uuid, aicc127Runtime.nav.salt);
      if (aicc127Runtime.nav.group_key)
        step.group_one_same = aicc127Runtime.nav.group_key === key;
      aicc127Runtime.nav.group_key = key;
    }
  }

  /**
   * aicc127Visit for the #297 test-only observer.
   * @param {string} route - Input to this read-only witness operation.
   * @param {Object} event - Input to this read-only witness operation.
   * @returns {Object|null} Observer operation result.
   */
  function aicc127Visit(route, event) {
    if (!route || !aicc127Runtime) return null;
    const s = aicc127Runtime, nav = s.nav;
    const key = aicc127Fingerprint(route, nav.salt);
    const last = nav.steps.at(-1);
    if (last?.key === key) return last;
    const slot = !nav.steps.length ? 'A'
      : nav.steps.length === 1 ? 'B'
        : key === nav.steps[0].key ? 'A-return' : 'other';
    const step = { key, slot, first_capture_order: event.capture_order,
      first_capture_epoch_ms: event.captured_at_epoch_ms,
      first_capture_mono_ms: event.captured_at_mono_ms,
      last_capture_order: event.capture_order,
      last_capture_epoch_ms: event.captured_at_epoch_ms,
      last_capture_mono_ms: event.captured_at_mono_ms, conversation_requests: 0,
      conversation_responses: 0, observer_updates: 0,
      navigation_dispatched: false, backend_observed: false,
      observer_matches_backend: false, visible_conversation_match: null,
      visible_project_match: null, stale_responses: 0 };
    aicc127GroupOne(step);
    nav.steps.push(step);
    if (nav.steps.length > 20) nav.steps.shift();
    aicc127Save();
    return step;
  }

  /**
   * aicc127On Ingress for the #297 test-only observer.
   * @param {Object} event - Input to this read-only witness operation.
   * @returns {void} Observer operation result.
   */
  function aicc127OnIngress(event) {
    const s = aicc127Runtime;
    if (!s) return;
    if (event.kind === 'navigation') {
      aicc127Visit(event.route, event);
      return;
    }
    const step = s.nav.steps.find(entry =>
      entry.key === aicc127Fingerprint(event.route, s.nav.salt)
      && entry.first_capture_order <= event.capture_order);
    // On A->B->A, prefer the latest visit to the same route.
    const selected = s.nav.steps.filter(entry =>
      entry.key === aicc127Fingerprint(event.route, s.nav.salt)
      && entry.first_capture_order <= event.capture_order).at(-1) ?? step;
    if (!selected) return;
    selected.last_capture_order = event.capture_order;
    selected.last_capture_epoch_ms = event.captured_at_epoch_ms;
    selected.last_capture_mono_ms = event.captured_at_mono_ms;
    if (event.direction === 'request') {
      s.requests.set(event.connection_id, { step: selected, kind: event.kind });
      if (event.kind === 'conversation') selected.conversation_requests++;
    } else if (event.direction === 'response') {
      if (event.kind === 'conversation') {
        // Count at original wire capture time, not at asynchronous queue drain.
        const current = s.nav.steps.at(-1);
        if (current) current.conversation_responses++;
      }
    }
    aicc127Save();
  }

  /**
   * aicc127Visible for the #297 test-only observer.
   * @param {Object} subject - Input to this read-only witness operation.
   * @returns {Object} Observer operation result.
   */
  function aicc127Visible(subject) {
    if (typeof document === 'undefined') return { conversation: null, project: null };
    const id = aicc127EarlyRoute;
    const sidebar = [...document.querySelectorAll('a[href]')].find(anchor => {
      try {
        return id && new URL(anchor.href, location.href).pathname.split('/').includes(id)
          && anchor.getAttribute('aria-current') === 'page';
      } catch { return false; }
    });
    /**
     * Normalizes labels for visual comparison only.
     * @param {unknown} value - A visible DOM label.
     * @returns {string} Normalized label.
     */
    const normal = value => String(value || '').trim().toLocaleLowerCase();
    const title = normal(document.title);
    const sidebarTitle = normal(sidebar?.textContent);
    const name = normal(subject?.conversation?.name);
    const conversation = !name || (!title && !sidebarTitle) ? null
      : (!sidebarTitle || sidebarTitle === name) &&
        (!title || title === name || title.startsWith(name + ' - '));
    const breadcrumb = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] a[href]')]
      .find(anchor => {
        try { return new URL(anchor.href, location.href).pathname.includes('/project'); }
        catch { return false; }
      });
    const project = normal(breadcrumb?.textContent);
    const observedProject = normal(subject?.project?.name);
    return { conversation, project: subject?.project?.status === 'none'
      ? !project : !project || !observedProject ? null : project === observedProject };
  }

  /**
   * aicc127Refresh for the #297 test-only observer.
   * @returns {void} Observer operation result.
   */
  function aicc127Refresh() {
    const s = aicc127Runtime, step = s?.nav.steps.at(-1);
    if (!step || !s.observed) return;
    const initial = s.nav.steps[0];
    if (step.slot === 'A-return' && !step.backend_observed
        && initial?.observer_matches_backend && initial.backend_observed) {
      step.backend_observed = true;
      step.reused_verified_backend = true;
      step.backend_conversation_key = initial.backend_conversation_key;
      step.backend_title_key = initial.backend_title_key;
      step.backend_project_key = initial.backend_project_key;
      step.backend_project_name_key = initial.backend_project_name_key;
      step.backend_explicit_gizmo_null = initial.backend_explicit_gizmo_null;
      step.backend_project_membership = initial.backend_project_membership;
    }
    if (!step.backend_observed || step.observer_updates === 0) return;
    const subject = s.observed, salt = s.nav.salt;
    const conversation = subject?.conversation?.status === 'identified'
      && aicc127Fingerprint(subject.conversation.id, salt) === step.backend_conversation_key
      && aicc127Fingerprint(subject.conversation.name, salt) === step.backend_title_key;
    const project = step.backend_explicit_gizmo_null
      ? subject?.project?.status === 'none'
      : step.backend_project_membership &&
        subject?.project?.status === 'identified' &&
        aicc127Fingerprint(subject.project.id, salt) === step.backend_project_key &&
        typeof subject.project.name === 'string' &&
        (!step.backend_project_name_key ||
          aicc127Fingerprint(subject.project.name, salt) === step.backend_project_name_key);
    step.observer_matches_backend = Boolean(conversation && project);
    const visual = aicc127Visible(subject);
    step.visible_conversation_match = visual.conversation;
    step.visible_project_match = visual.project;
    aicc127Save();
  }

