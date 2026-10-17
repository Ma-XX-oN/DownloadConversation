import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../src/userscript/06-image-export-tests/07-issue127-live-test.js',
  import.meta.url), 'utf8') + readFileSync(new URL('../src/userscript/06-image-export-tests/07a-issue127-navigation.js', import.meta.url), 'utf8');

function createHarness(shared = new Map(), useSharedHost = false) {
  const state = { id: 'A', title: 'Conversation A', project: 'Project A',
    projectId: 'g-p-A', projectNamePending: false };
  const pending = new Map();
  const listeners = new Map();
  let subscriber;
  let connectCalls = 0;
  let lastConversation = null;
  const agent = {
    version: () => ({ version: '0.1.0-issue.1.29' }),
    observeState(callback) {
      subscriber = callback;
      callback({ readiness: 'unresolved',
        conversation: { status: 'unresolved', id: null, name: null },
        project: { status: 'unresolved', id: null, name: null } });
      return () => { subscriber = null; };
    }
  };
  const module = {
    connectChatGPTSubjectHost() {
      connectCalls++;
      return {
        begin() { pending.clear(); lastConversation = null; },
        request({ network_sequence, request_url }) {
          pending.set(network_sequence, request_url); return true;
        },
        response({ network_sequence, body }) {
          const url = pending.get(network_sequence);
          if (!pending.delete(network_sequence)) return false;
          if (url.includes('/gizmos/')) {
            if (lastConversation) subscriber?.({ readiness: 'resolved',
              conversation: { status: 'identified', ...lastConversation },
              project: { status: 'identified', id: state.projectId,
                name: state.project } });
            return true;
          }
          lastConversation = { id: body.conversation_id, name: body.title };
          subscriber?.({ readiness: 'resolved',
            conversation: { status: 'identified',
              id: body.conversation_id, name: body.title },
            project: body.gizmo_id === null
              ? { status: 'none', id: null, name: null }
              : { status: 'identified', id: body.gizmo_id,
                  name: state.projectNamePending ? null : state.project } });
          return true;
        }
      };
    }
  };
  const document = {
    get title() { return state.visibleTitle + ' - ChatGPT'; },
    querySelectorAll(selector) {
      if (selector === 'a[href]') return [{
        href: 'https://chatgpt.com/c/' + state.id,
        textContent: state.title,
        getAttribute: () => 'page'
      }];
      return state.project ? [{
        href: 'https://chatgpt.com/g/' + state.projectId + '/project',
        textContent: state.project
      }] : [];
    }
  };
  const context = {
    chatGPTSubjectHost: useSharedHost ? {
      navigation() { return true; }, request() { return true; },
      response() { return true; }, dispose() {}
    } : null,
    window: { navigation: {
      addEventListener(name, fn) { listeners.set(name, fn); },
      removeEventListener(name) { listeners.delete(name); }
    } },
    document, URL, Date, Promise, Object, Set, Math, JSON, Blob, Response,
    location: { origin: 'https://chatgpt.com',
      href: 'https://chatgpt.com/c/A' },
    sessionStorage: {
      getItem: key => shared.get(key) ?? null,
      setItem: (key, value) => shared.set(key, value),
      removeItem: key => shared.delete(key)
    },
    canonicalCore: () => ({
      getVersion: () => '1.1.0-issue.127.22',
      getAgentPluginArtifact: () => ({
        commit: 'db7e3450aac94eb2990fba0de54d090e377dafa3',
        gitBlobSha1: 'c731721005aefbc14a61bfc97270d7270aa80ea0'
      })
    }),
    assert(condition, message) { assert.ok(condition, message); },
    ensureChatGPTCanonicalAgent: async () => agent,
    importAgentPluginModule: async () => module,
    currentConversationId: () => state.id
  };
  vm.runInNewContext(source + `
    globalThis.capture = {start:aicc127Start, request:aicc127LiveOnRequest,
      response:aicc127LiveOnFetchResponse, navigation:testAicc127Navigation,
      evidence:aicc127MinimalEvidence, navEvent:aicc127NavigationChanged};`, context);
  function publishCurrent() {
    subscriber?.({ readiness: 'resolved',
      conversation: { status: 'identified', id: state.id, name: state.title },
      project: state.project
        ? { status: 'identified', id: state.projectId, name: state.project }
        : { status: 'none', id: null, name: null } });
  }
  function navigateWithoutBackend(id, title, project, publish = true) {
    state.id = id; state.title = title; state.visibleTitle = title;
    state.project = project;
    state.projectId = 'g-p-' + (project ? id : 'none');
    if (useSharedHost) context.capture.navEvent();
    else listeners.get('currententrychange')?.();
    if (publish) publishCurrent();
  }
  async function visit(id, title, project, sequence, visibleTitle = title) {
    state.id = id; state.title = title; state.visibleTitle = visibleTitle;
    state.project = project;
    state.projectId = 'g-p-' + (project ? id : 'none');
    if (useSharedHost) context.capture.navEvent();
    else listeners.get('currententrychange')?.();
    const trace = {sequence, method:'GET',
      url:'/backend-api/conversations/' + id};
    context.capture.request(trace);
    if (useSharedHost) publishCurrent();
    context.capture.response(trace, 200, {
      text:JSON.stringify({conversation_id:id, title,
        gizmo_id:project ? state.projectId : null}), truncated:false
    });
  }
  return { f: context.capture, state, visit, navigateWithoutBackend, shared,
    get connectCalls() { return connectCalls; } };
}

test('A-B-A checks actual observer identity against visible sidebar and project', async () => {
  const h = createHarness();
  await h.f.start();
  await h.visit('A', 'Conversation A', 'Project A', 1);
  assert.equal((await h.f.navigation()).status, 'INCOMPLETE');
  await h.visit('B', 'Conversation B', 'Project B', 2);
  await h.visit('A', 'Conversation A', 'Project A', 3);
  assert.equal(await h.f.navigation(), undefined);
  const exportable = JSON.stringify(h.f.evidence());
  for (const secret of ['Conversation A', 'Conversation B', 'Project A',
    'Project B', 'g-p-A', 'g-p-B']) assert.ok(!exportable.includes(secret));
  assert.deepEqual(h.f.evidence().navigation_steps.map(step => step.slot),
    ['A','B','A-return']);
});

test('visible-title mismatch cannot produce navigation PASS', async () => {
  const h = createHarness();
  await h.f.start();
  await h.visit('A', 'Conversation A', 'Project A', 1);
  await h.visit('B', 'Conversation B', 'Project B', 2);
  await h.visit('A', 'Conversation A', 'Project A', 3, 'Wrong title');
  assert.equal((await h.f.navigation()).status, 'INCOMPLETE');
});

test('sessionStorage checkpoint survives reload without publishing private names', async () => {
  const first = createHarness();
  await first.f.start();
  await first.visit('A', 'Conversation A', 'Project A', 1);
  const resumed = createHarness(first.shared);
  await resumed.f.start();
  assert.equal(resumed.f.evidence().reload_count, 1);
  assert.equal(resumed.f.evidence().navigation_steps.length, 1);
  assert.ok(!JSON.stringify(resumed.f.evidence()).includes('Conversation A'));
});

test('late project-name publication upgrades already observed conversation step', async () => {
  const h = createHarness();
  h.state.projectNamePending = true;
  await h.f.start();
  await h.visit('A', 'Conversation A', 'Project A', 1);
  assert.equal(h.f.evidence().navigation_steps[0].observer_matches_backend, false);
  const trace = { sequence: 2, method: 'GET',
    url: '/backend-api/gizmos/g-p-A' };
  h.f.request(trace);
  h.f.response(trace, 200, { text: JSON.stringify({
    gizmo: { id: 'g-p-A', display: { name: 'Project A' } }
  }), truncated: false });
  assert.equal(h.f.evidence().navigation_steps[0].observer_matches_backend, true);
  assert.equal(h.f.evidence().navigation_steps[0].visible_project_match, true);
});

test('shared observer validates verified A on return without a backend request', async () => {
  const h = createHarness(new Map(), true);
  await h.f.start();
  await h.visit('A', 'Conversation A', 'Project A', 1);
  await h.visit('B', 'Conversation B', 'Project B', 2);
  h.navigateWithoutBackend('A', 'Conversation A', 'Project A');
  assert.equal(await h.f.navigation(), undefined);
  const steps = h.f.evidence().navigation_steps;
  assert.equal(steps[2].backend_source, 'verified-session-cache');
  assert.equal(steps[2].observer_matches_backend, true);
  assert.equal(steps.length, 3);
});

test('cached return does not pass while observer still reports B', async () => {
  const h = createHarness(new Map(), true);
  await h.f.start();
  await h.visit('A', 'Conversation A', 'Project A', 1);
  await h.visit('B', 'Conversation B', 'Project B', 2);
  h.navigateWithoutBackend('A', 'Conversation A', 'Project A', false);
  assert.equal((await h.f.navigation()).status, 'INCOMPLETE');
  assert.equal(h.f.evidence().navigation_steps[2].observer_matches_backend, false);
});

test('shared provider host is never re-created by witness on A-B-A', async () => {
  const h = createHarness(new Map(), true);
  await h.f.start();
  await h.visit('A', 'Conversation A', 'Project A', 11);
  await h.visit('B', 'Conversation B', 'Project B', 12);
  h.navigateWithoutBackend('A', 'Conversation A', 'Project A');
  assert.equal(h.connectCalls, 0, 'Only the existing #306 host may own the canonical agent.');
  assert.equal(await h.f.navigation(), undefined);
});
