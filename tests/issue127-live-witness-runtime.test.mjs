import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL(
  '../src/userscript/06-image-export-tests/07-issue127-live-test.js', import.meta.url), 'utf8');
const noop = () => {};
const providerCommit = 'cf521202e78dede9152840193dc5ca140703b240';
const providerBlob = '32182498480ba061367ce60dbb4104c0c0d55fe7';

function harness() {
  const storage = new Map();
  const state = { browserObservations: [], networkCreated: 0 };
  const agent = {
    version() { return { version: '0.1.0-issue.1.21' }; },
    observeState(callback) {
      state.publish = callback;
      callback({ readiness: 'unresolved',
        project: { status: 'unresolved', name: null },
        conversation: { status: 'unresolved', name: null } });
      return noop;
    }
  };
  const plugin = {
    connectChatGPTSubjectHost({ conversationId }) {
      let conversation = conversationId;
      const pending = new Map();
      return {
        begin(id) { conversation = id; pending.clear(); },
        request({ network_sequence, method, request_url }) {
          if (method !== 'GET') return false;
          pending.set(network_sequence, request_url);
          return true;
        },
        response({ network_sequence, status, body }) {
          const url = pending.get(network_sequence);
          pending.delete(network_sequence);
          if (!url || status !== 200) return false;
          if (url.includes('/conversations/')) {
            if (body.conversation_id !== conversation || !('gizmo_id' in body))
              return false;
            const named = typeof body.gizmo_id === 'string';
            state.publish({ readiness: 'resolved',
              project: { status: named ? 'identified' : 'none',
                name: named ? 'Project' : null },
              conversation: { status: 'identified', name: body.title } });
            return true;
          }
          if (url.includes('/gizmos/')) {
            state.publish({ readiness: 'resolved',
              project: { status: 'identified', name: 'Project' },
              conversation: { status: 'identified', name: 'Conversation' } });
            return true;
          }
          return false;
        }
      };
    }
  };
  const context = {
    URL, Date, Promise, JSON, Object, Set, Blob, console,
    location: { origin: 'https://chatgpt.com', href: 'https://chatgpt.com/c/A' },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    canonicalCore: () => ({
      getVersion: () => '1.1.0-issue.127.19',
      getAgentPluginArtifact: () => ({
        commit: providerCommit, gitBlobSha1: providerBlob
      })
    }),
    assert: (condition, detail) => {
      if (!condition) throw Error(detail);
    },
    ensureChatGPTCanonicalAgent: async () => agent,
    importAgentPluginModule: async () => plugin,
    currentConversationId: () => state.currentId ?? 'A',
    boundedDiagnosticText: String,
    errorMessage: String,
    logDiagnostic: noop
  };
  vm.runInNewContext(script + `
    globalThis.harness = {
      start: aicc127Start,
      request: aicc127LiveOnRequest,
      response: aicc127LiveOnFetchResponse,
      project: testAicc127LiveProject,
      standalone: testAicc127LiveStandalone,
      evidence: aicc127MinimalEvidence
    };`, context);
  return { functions: context.harness, state, storage };
}

const req = (sequence, id) => ({
  sequence, method: 'GET',
  url: '/backend-api/conversations/' + id
});
function response(fn, sequence, body) {
  fn.response(req(sequence, body.conversation_id), 200,
    { text: JSON.stringify(body), truncated: false });
}

test('live witness stays INCOMPLETE until matching authentic-response shape is observed', async () => {
  const { functions: f, state } = harness();
  await f.start();
  assert.equal((await f.standalone()).status, 'INCOMPLETE');
  f.request(req(1, 'A'));
  response(f, 1, { conversation_id: 'A', title: 'Missing membership' });
  assert.equal((await f.standalone()).status, 'INCOMPLETE');
  f.request(req(2, 'A'));
  response(f, 2, { conversation_id: 'A', title: 'Standalone', gizmo_id: null });
  assert.equal(await f.standalone(), undefined);
  assert.equal(f.evidence().standalone_backend_and_observer, true);
  assert.equal(f.evidence().project_backend_and_observer, false);
  assert.ok(state.publish);
});

test('project evidence requires observer publication and redacts full names/IDs', async () => {
  const { functions: f, storage } = harness();
  await f.start();
  f.request(req(4, 'A'));
  response(f, 4, { conversation_id: 'A', title: 'Secret conversation',
    gizmo_id: 'g-p-sensitive' });
  assert.equal(await f.project(), undefined);
  const exported = JSON.stringify(f.evidence());
  assert.ok(!exported.includes('Secret conversation'));
  assert.ok(!exported.includes('g-p-sensitive'));
  assert.equal(f.evidence().captures.at(-1).observer_published, true);
  assert.equal(f.evidence().captures.at(-1).backend_project_membership, true);
  assert.equal(storage.get('dc-issue127-live-armed'), 'true');
});

test('wrong-origin and non-GET requests do not produce identity evidence', async () => {
  const { functions: f } = harness();
  await f.start();
  f.request({ sequence: 7, method: 'POST',
    url: '/backend-api/conversations/A' });
  f.request({ sequence: 8, method: 'GET',
    url: 'https://evil.invalid/backend-api/conversations/A' });
  response(f, 7, { conversation_id: 'A', gizmo_id: null });
  response(f, 8, { conversation_id: 'A', gizmo_id: null });
  assert.equal((await f.standalone()).status, 'INCOMPLETE');
  assert.equal(f.evidence().captures.length, 0);
});
