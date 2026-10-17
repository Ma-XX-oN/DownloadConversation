import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../src/userscript/06-image-export-tests/07-issue127-live-test.js',
  import.meta.url), 'utf8');

function createHarness(shared = new Map()) {
  const state = { id: 'A', title: 'Conversation A', project: 'Project A',
    projectId: 'g-p-A' };
  const pending = new Map();
  const listeners = new Map();
  let subscriber;
  const agent = {
    version: () => ({ version: '0.1.0-issue.1.21' }),
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
      return {
        begin() { pending.clear(); },
        request({ network_sequence, request_url }) {
          pending.set(network_sequence, request_url); return true;
        },
        response({ network_sequence, body }) {
          if (!pending.delete(network_sequence)) return false;
          subscriber?.({ readiness: 'resolved',
            conversation: { status: 'identified',
              id: body.conversation_id, name: body.title },
            project: body.gizmo_id === null
              ? { status: 'none', id: null, name: null }
              : { status: 'identified', id: body.gizmo_id,
                  name: state.project } });
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
      getVersion: () => '1.1.0-issue.127.19',
      getAgentPluginArtifact: () => ({
        commit: 'cf521202e78dede9152840193dc5ca140703b240',
        gitBlobSha1: '32182498480ba061367ce60dbb4104c0c0d55fe7'
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
      evidence:aicc127MinimalEvidence};`, context);
  async function visit(id, title, project, sequence, visibleTitle = title) {
    state.id = id; state.title = title; state.visibleTitle = visibleTitle;
    state.project = project;
    state.projectId = 'g-p-' + (project ? id : 'none');
    listeners.get('currententrychange')?.();
    const trace = {sequence, method:'GET',
      url:'/backend-api/conversations/' + id};
    context.capture.request(trace);
    context.capture.response(trace, 200, {
      text:JSON.stringify({conversation_id:id, title,
        gizmo_id:project ? state.projectId : null}), truncated:false
    });
  }
  return { f: context.capture, state, visit, shared };
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
