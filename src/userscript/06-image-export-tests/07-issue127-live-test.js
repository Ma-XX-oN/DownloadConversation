  // #127 staging-only browser verification. No production identity or filenames.
  // The source is the page's EXISTING observed fetch/XHR, not new API requests.
  const AICC127_EVIDENCE_KEY = 'dc-issue127-live-observations';
  const AICC127_PROVIDER_SHA = 'cf521202e78dede9152840193dc5ca140703b240';
  const AICC127_CORE_SHA = '1a70e7df14a0648c8e144ce3ef0da5e02bc90cd4';
  const AICC127_BLOB_SHA = '32182498480ba061367ce60dbb4104c0c0d55fe7';
  let aicc127Runtime = null;

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

  function aicc127SaveEvidence() {
    if (!aicc127Runtime) return;
    try {
      sessionStorage.setItem(AICC127_EVIDENCE_KEY,
        JSON.stringify(aicc127Runtime.evidence));
    } catch {}
  }

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
    const state = { agent, evidence, host: null, conversationId: null,
      observed: null, snapshots: 0, pending: new Set(), module };
    aicc127Runtime = state;
    agent.observeState(snapshot => {
      state.observed = snapshot;
      state.snapshots += 1;
    }, 'subject-identification');
    aicc127BeginForCurrentConversation();
    aicc127SaveEvidence();
    return state;
  }

  function aicc127BeginForCurrentConversation() {
    const state = aicc127Runtime;
    if (!state) return;
    const id = currentConversationId();
    if (!id || id === state.conversationId) return;
    state.conversationId = id;
    state.pending.clear();
    if (state.host) state.host.begin(id);
    else state.host = state.module.connectChatGPTSubjectHost({
      agent: state.agent, origin: location.origin, conversationId: id
    });
    state.evidence.navigation_count += 1;
    aicc127SaveEvidence();
  }

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

  function aicc127LiveOnFetchResponse(trace, status, bounded) {
    if (!aicc127Runtime?.pending.has(trace.sequence)) return;
    aicc127LiveAcceptResponse(trace, status, bounded);
  }

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

  async function testAicc127StagedArtifact() {
    await aicc127Start();
  }

  async function testAicc127LiveProject() {
    const state = await aicc127Start();
    return state.evidence.project_backend_and_observer ? undefined :
      { status: 'INCOMPLETE', detail: 'Await authenticated project metadata. Navigate to a project conversation and rerun.' };
  }

  async function testAicc127LiveStandalone() {
    const state = await aicc127Start();
    return state.evidence.standalone_backend_and_observer ? undefined :
      { status: 'INCOMPLETE', detail: 'Await observed backend gizmo_id:null. Navigate to standalone chat and rerun.' };
  }

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
  }
