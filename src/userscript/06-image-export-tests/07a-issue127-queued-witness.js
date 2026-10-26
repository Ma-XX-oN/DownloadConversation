  /**
   * aicc127Attach Agent Early for the #297 test-only observer.
   * @param {Object} agent - Input to this read-only witness operation.
   * @returns {void} Observer operation result.
   */
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

  /**
   * aicc127Prepare for the #297 test-only observer.
   * @returns {Object} Observer operation result.
   */
  function aicc127Prepare() {
    if (aicc127Runtime) return aicc127Runtime;
    const nav = aicc127Checkpoint();
    const resumed = nav.page && nav.page !== cscPageInstanceId;
    if (resumed) {
      nav.reload_count++;
      if (nav.steps.length) nav.steps.at(-1).navigation_dispatched = false;
    }
    nav.page = cscPageInstanceId;
    let evidence = null;
    try {
      evidence = JSON.parse(sessionStorage.getItem(AICC127_EVIDENCE_KEY) || 'null');
      if (evidence?.schema !== 'aicc127-queued-witness-v2') evidence = null;
    } catch {}
    evidence ??= { schema: 'aicc127-queued-witness-v2',
      source_sha: AICC127_SOURCE_SHA, source_version: VERSION,
      core_sha: AICC127_CORE_SHA,
      provider_sha: AICC127_PROVIDER_SHA, provider_blob_sha1: AICC127_PROVIDER_BLOB,
      provider_identity_attestation: 'runtime-version-only',
      started_at: new Date().toISOString(), navigation_steps: [],
      notes: 'Expected pins are not runtime byte verification. No names, IDs, URLs, headers, credentials or messages exported' };
    const s = { evidence, nav, agent: null, unsubscribe: null, callbacks: 0,
      observed: null, requests: new Map(), groupKey: null };
    aicc127Runtime = s;
    aicc127WitnessSink = aicc127OnIngress;
    for (const event of aicc127EarlyEvents) aicc127OnIngress(event);
    aicc127Save();
    return s;
  }

  /**
   * aicc127Start for the #297 test-only observer.
   * @returns {Promise<Object>} Observer operation result.
   */
  async function aicc127Start() {
    sessionStorage.setItem(AICC127_ARMED_KEY, 'true');
    aicc127Prepare();
    if (!aicc127StartPending) aicc127StartPending = (async () => {
      const core = canonicalCore();
      assert(core.getVersion() === '1.1.1',
        'Released AICC Core 1.1.1 is required.');
      assert(typeof core.createAgent === 'function' &&
        core.getAgentPlugin('chatgpt-web')?.id === 'chatgpt-web',
        'ChatGPT provider must be registered through Core.');
      const agent = await ensureChatGPTCanonicalAgent();
      aicc127AttachAgentEarly(agent);
      const identity = agent.version();
      assert(identity.plugin === 'chatgpt-web' &&
        identity.apiVersion === 1 &&
        identity.version === '0.1.2-issue.11.1',
        'Registered private provider identity mismatch.');
      assert(typeof agent.connectChatGPTSubjectHost === 'function' &&
        chatGPTSubjectHost &&
        ['navigation', 'request', 'response', 'dispose'].every(
          key => typeof chatGPTSubjectHost[key] === 'function'),
        'Registered agent did not attach private identity host.');
      return aicc127Runtime;
    })();
    try { return await aicc127StartPending; }
    finally { aicc127StartPending = null; }
  }

  /**
   * aicc127Witness Navigation Dispatch for the #297 test-only observer.
   * @param {Object} event - Input to this read-only witness operation.
   * @returns {void} Observer operation result.
   */
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

  /**
   * aicc127Witness Parsed for the #297 test-only observer.
   * @param {Object} request - Input to this read-only witness operation.
   * @param {Object} response - Input to this read-only witness operation.
   * @param {Object} body - Input to this read-only witness operation.
   * @returns {void} Observer operation result.
   */
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

  /**
   * aicc127Incomplete for the #297 test-only observer.
   * @param {string} detail - Input to this read-only witness operation.
   * @returns {Object} Observer operation result.
   */
  function aicc127Incomplete(detail) { return { status: 'INCOMPLETE', detail }; }
  /**
   * test Aicc127Staged Artifact for the #297 test-only observer.
   * @returns {Promise<void>} Observer operation result.
   */
  async function testAicc127StagedArtifact() { await aicc127Start(); }
  /**
   * test Aicc127Live Project for the #297 test-only observer.
   * @returns {Promise<Object|undefined>} Observer operation result.
   */
  async function testAicc127LiveProject() {
    const s = await aicc127Start();
    return s.nav.steps.some(step => step.backend_observed &&
      step.backend_project_membership && step.observer_matches_backend &&
      step.visible_project_match === true) ? undefined :
      aicc127Incomplete('Await genuine project backend, actual Core publication and matching breadcrumb.');
  }
  /**
   * test Aicc127Live Standalone for the #297 test-only observer.
   * @returns {Promise<Object|undefined>} Observer operation result.
   */
  async function testAicc127LiveStandalone() {
    const s = await aicc127Start();
    return s.nav.steps.some(step => step.backend_observed &&
      step.backend_explicit_gizmo_null && step.observer_matches_backend &&
      step.visible_project_match === true) ? undefined :
      aicc127Incomplete('Await backend explicit gizmo_id:null and Core project.status=none.');
  }
  /**
   * test Aicc127Navigation for the #297 test-only observer.
   * @returns {Promise<Object|undefined>} Observer operation result.
   */
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
  /**
   * test Aicc127Stale Response for the #297 test-only observer.
   * @returns {Promise<Object|undefined>} Observer operation result.
   */
  async function testAicc127StaleResponse() {
    const s = await aicc127Start();
    return s.nav.steps.some(step => step.stale_responses > 0) &&
      s.nav.steps.at(-1)?.observer_matches_backend ? undefined :
      aicc127Incomplete('Await actual late prior-route response and unaffected current Core identity.');
  }
  /**
   * test Aicc127Reload Rebind for the #297 test-only observer.
   * @returns {Promise<Object|undefined>} Observer operation result.
   */
  async function testAicc127ReloadRebind() {
    const s = await aicc127Start();
    return s.nav.reload_count > 0 && s.callbacks > 0 && s.unsubscribe &&
      chatGPTSubjectHost ? undefined :
      aicc127Incomplete('Arm Test, reload same tab, confirm the shared host and actual observer callback.');
  }
  /**
   * test Aicc127Group One for the #297 test-only observer.
   * @returns {Promise<Object|undefined>} Observer operation result.
   */
  async function testAicc127GroupOne() {
    const s = await aicc127Start();
    const step = s.nav.steps.at(-1);
    aicc127GroupOne(step || {});
    aicc127Save();
    return step?.group_one_enabled && step.group_one_ready &&
      (s.nav.reload_count === 0 || step.group_one_same === true) ? undefined :
      aicc127Incomplete('Enable the 1 checkbox, await recording-group ownership and rerun.');
  }
  /**
   * aicc127Export Evidence for the #297 test-only observer.
   * @returns {void} Observer operation result.
   */
  function aicc127ExportEvidence() {
    const s = aicc127Runtime;
    if (!s) throw new Error('Arm AICC #127 before exporting evidence.');
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
