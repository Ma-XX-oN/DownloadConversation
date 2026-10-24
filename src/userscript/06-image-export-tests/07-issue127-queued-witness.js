  // #297 TEST-ONLY. The #309/#310 host and queue remain sole owners.
  const AICC127_ARMED_KEY = 'dc-issue127-live-armed';
  const AICC127_EVIDENCE_KEY = 'dc-issue127-live-observations-v2';
  const AICC127_NAV_KEY = 'dc-issue127-live-nav-v2';
  const AICC127_PROVIDER_SHA = 'db7e3450aac94eb2990fba0de54d090e377dafa3';
  const AICC127_PROVIDER_BLOB = 'c731721005aefbc14a61bfc97270d7270aa80ea0';
  const AICC127_CORE_SHA = '80b3e1354005e381c4fc1a81a26be3c45b45dd30';
  const AICC127_SOURCE_SHA = 'bff52f9996365e996e3dbe1a56b0c5fcb7a231b2';
  let aicc127Runtime = null;
  let aicc127StartPending = null;

  function aicc127Fingerprint(value, salt) {
    let hash = 2166136261;
    for (const char of salt + String(value ?? ''))
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16);
  }

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

  function aicc127PublicStep(step) {
    return {
      slot: step.slot, first_capture_order: step.first_capture_order,
      first_capture_epoch_ms: step.first_capture_epoch_ms,
      last_capture_order: step.last_capture_order,
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

  function aicc127GroupOne(step) {
    if (typeof recordingGroupState !== 'function') return;
    const group = recordingGroupState();
    step.group_one_enabled = group.enabled === true;
    step.group_one_ready = group.ready === true;
    if (group.enabled && typeof group.uuid === 'string') {
      const key = aicc127Fingerprint(group.uuid, aicc127Runtime.nav.salt);
      if (aicc127Runtime.groupKey)
        step.group_one_same = aicc127Runtime.groupKey === key;
      aicc127Runtime.groupKey = key;
    }
  }

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
      last_capture_order: event.capture_order, conversation_requests: 0,
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

  function aicc127Visible(subject) {
    if (typeof document === 'undefined') return { conversation: null, project: null };
    const id = aicc127EarlyRoute;
    const sidebar = [...document.querySelectorAll('a[href]')].find(anchor => {
      try {
        return id && new URL(anchor.href, location.href).pathname.split('/').includes(id)
          && anchor.getAttribute('aria-current') === 'page';
      } catch { return false; }
    });
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

  function aicc127AttachAgentEarly(agent) {
    if (sessionStorage.getItem(AICC127_ARMED_KEY) !== 'true') return;
    const s = aicc127Prepare();
    if (s.agent === agent && s.unsubscribe) return;
    s.unsubscribe?.();
    s.agent = agent;
    s.unsubscribe = agent.observeState(snapshot => {
      s.callbacks++;
      s.observed = snapshot;
      const step = s.nav.steps.at(-1);
      // An initial replay before navigation dispatch does not prove restoration.
      if (step?.navigation_dispatched) step.observer_updates++;
      aicc127Refresh();
    }, 'subject-identification');
  }

  function aicc127Prepare() {
    if (aicc127Runtime) return aicc127Runtime;
    const nav = aicc127Checkpoint();
    const resumed = nav.page && nav.page !== cscPageInstanceId;
    if (resumed) nav.reload_count++;
    nav.page = cscPageInstanceId;
    let evidence = null;
    try {
      evidence = JSON.parse(sessionStorage.getItem(AICC127_EVIDENCE_KEY) || 'null');
      if (evidence?.schema !== 'aicc127-queued-witness-v2') evidence = null;
    } catch {}
    evidence ??= { schema: 'aicc127-queued-witness-v2',
      source_sha: AICC127_SOURCE_SHA, core_sha: AICC127_CORE_SHA,
      provider_sha: AICC127_PROVIDER_SHA, provider_blob_sha1: AICC127_PROVIDER_BLOB,
      started_at: new Date().toISOString(), navigation_steps: [],
      notes: 'No names, IDs, URLs, headers, credentials or messages exported' };
    const s = { evidence, nav, agent: null, unsubscribe: null, callbacks: 0,
      observed: null, requests: new Map(), groupKey: null };
    aicc127Runtime = s;
    aicc127WitnessSink = aicc127OnIngress;
    for (const event of aicc127EarlyEvents) aicc127OnIngress(event);
    aicc127Save();
    return s;
  }

  async function aicc127Start() {
    sessionStorage.setItem(AICC127_ARMED_KEY, 'true');
    aicc127Prepare();
    if (!aicc127StartPending) aicc127StartPending = (async () => {
      const core = canonicalCore();
      assert(core.getVersion() === '1.1.0-issue.127.22',
        'AICC Core .127.22 is required.');
      const descriptor = core.getAgentPluginArtifact('chatgpt-web');
      assert(descriptor.commit === AICC127_PROVIDER_SHA &&
        descriptor.gitBlobSha1 === AICC127_PROVIDER_BLOB,
      'Core catalogue must pin the exact private provider artifact.');
      const agent = await ensureChatGPTCanonicalAgent();
      aicc127AttachAgentEarly(agent);
      assert(agent.version().version === '0.1.0-issue.1.29',
        'Private provider version mismatch.');
      assert(chatGPTSubjectHost, 'No shared canonical provider host.');
      return aicc127Runtime;
    })();
    try { return await aicc127StartPending; }
    finally { aicc127StartPending = null; }
  }

  function aicc127WitnessNavigationDispatch(event) {
    const s = aicc127Runtime;
    if (!s) return;
    const route = aicc127RouteIdentity(event.url);
    const key = aicc127Fingerprint(route, s.nav.salt);
    const step = s.nav.steps.filter(item =>
      item.key === key && item.first_capture_order <= event.capture_order).at(-1);
    if (!step) return;
    step.navigation_dispatched = true;
    aicc127Save();
  }

  function aicc127WitnessParsed(request, response, body) {
    const s = aicc127Runtime;
    if (!s || !body || typeof body !== 'object' || Array.isArray(body)) return;
    const correlation = s.requests.get(request.connection_id);
    if (!correlation || response.status !== 200) return;
    s.requests.delete(request.connection_id);
    const step = correlation.step, current = s.nav.steps.at(-1);
    if (step !== current) {
      if (current) { current.stale_responses++; aicc127Save(); }
      return;
    }
    const salt = s.nav.salt;
    if (correlation.kind === 'conversation') {
      if (typeof body.conversation_id !== 'string' ||
          typeof body.title !== 'string' || !Object.hasOwn(body, 'gizmo_id')) return;
      if (aicc127Fingerprint(body.conversation_id, salt) !== step.key) return;
      step.backend_observed = true;
      step.reused_verified_backend = false;
      step.backend_conversation_key = aicc127Fingerprint(body.conversation_id, salt);
      step.backend_title_key = aicc127Fingerprint(body.title, salt);
      step.backend_project_key = aicc127Fingerprint(body.gizmo_id, salt);
      step.backend_explicit_gizmo_null = body.gizmo_id === null;
      step.backend_project_membership = typeof body.gizmo_id === 'string' &&
        body.gizmo_id.startsWith('g-p-');
    } else if (correlation.kind === 'project'
      && typeof body.gizmo?.id === 'string'
      && typeof body.gizmo?.display?.name === 'string') {
      if (aicc127Fingerprint(body.gizmo.id, salt) === step.backend_project_key)
        step.backend_project_name_key = aicc127Fingerprint(body.gizmo.display.name, salt);
    }
    aicc127Refresh();
    aicc127Save();
  }

  function aicc127Incomplete(detail) { return { status: 'INCOMPLETE', detail }; }
  async function testAicc127StagedArtifact() { await aicc127Start(); }
  async function testAicc127LiveProject() {
    const s = await aicc127Start();
    return s.nav.steps.some(step => step.backend_observed &&
      step.backend_project_membership && step.observer_matches_backend &&
      step.visible_project_match === true) ? undefined :
      aicc127Incomplete('Await genuine project backend, actual Core publication and matching breadcrumb.');
  }
  async function testAicc127LiveStandalone() {
    const s = await aicc127Start();
    return s.nav.steps.some(step => step.backend_observed &&
      step.backend_explicit_gizmo_null && step.observer_matches_backend &&
      step.visible_project_match === true) ? undefined :
      aicc127Incomplete('Await backend explicit gizmo_id:null and Core project.status=none.');
  }
  async function testAicc127Navigation() {
    const s = await aicc127Start(), steps = s.nav.steps;
    const [a, b, restored] = steps;
    const valid = a?.slot === 'A' && b?.slot === 'B' &&
      restored?.slot === 'A-return';
    const initialAndB = a?.backend_observed && a?.observer_matches_backend &&
      b?.backend_observed && b?.observer_matches_backend;
    const cacheOnly = restored?.reused_verified_backend &&
      restored.conversation_requests === 0 && restored.conversation_responses === 0;
    const observer = restored?.navigation_dispatched && restored.observer_updates > 0 &&
      restored.observer_matches_backend &&
      restored.visible_conversation_match === true &&
      restored.visible_project_match === true;
    return valid && initialAndB && cacheOnly && observer ? undefined :
      aicc127Incomplete('Navigate backend-verified A -> distinct B -> A; A return must have zero conversation traffic and a real observer callback.');
  }
  async function testAicc127StaleResponse() {
    const s = await aicc127Start();
    return s.nav.steps.some(step => step.stale_responses > 0) &&
      s.nav.steps.at(-1)?.observer_matches_backend ? undefined :
      aicc127Incomplete('Await actual late prior-route response and unaffected current Core identity.');
  }
  async function testAicc127ReloadRebind() {
    const s = await aicc127Start();
    return s.nav.reload_count > 0 && s.callbacks > 0 && s.unsubscribe &&
      chatGPTSubjectHost ? undefined :
      aicc127Incomplete('Arm Test, reload same tab, confirm the shared host and actual observer callback.');
  }
  async function testAicc127GroupOne() {
    const s = await aicc127Start();
    const step = s.nav.steps.at(-1);
    aicc127GroupOne(step || {});
    aicc127Save();
    return step?.group_one_enabled && step.group_one_ready &&
      step.group_one_same !== false ? undefined :
      aicc127Incomplete('Enable the 1 checkbox, await recording-group ownership and rerun.');
  }
  function aicc127ExportEvidence() {
    const s = aicc127Runtime;
    if (!s) return;
    aicc127Save();
    const blob = new Blob([JSON.stringify(s.evidence, null, 2) + '\n'],
      { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'aicc127-queued-evidence.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sessionStorage.removeItem(AICC127_ARMED_KEY);
    s.unsubscribe?.();
    aicc127WitnessSink = null;
    aicc127Runtime = null;
  }

  // Reload rearm before the asynchronous host connects and #310 drains.
  if (sessionStorage.getItem(AICC127_ARMED_KEY) === 'true') {
    aicc127Prepare();
    Promise.resolve().then(() => aicc127Start()).catch(error =>
      logDiagnostic('warnings', 'aicc127-witness-rearm-failed',
        { message: boundedDiagnosticText(errorMessage(error), 200) }));
  }
