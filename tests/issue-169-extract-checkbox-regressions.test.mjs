import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { downloadConversationSource } from './helpers/userscript-source.mjs';

const ACTIVE_ID = '6ab708a8-b568-83e9-b438-50c3e20e8c31';

function functionSourceFrom(source, name) {
  const starts = [
    source.indexOf(`  async function ${name}(`),
    source.indexOf(`  function ${name}(`)
  ].filter(index => index >= 0);
  assert.ok(starts.length > 0, `Production function ${name} is missing.`);
  const start = Math.min(...starts);
  const boundaries = [
    source.indexOf('\n\n  /**', start + 3),
    source.indexOf('\n  // END ', start + 3)
  ].filter(index => index >= 0);
  assert.ok(boundaries.length > 0, `Production function ${name} boundary is missing.`);
  return source.slice(start, Math.min(...boundaries)).trimStart();
}

function authContextHarness() {
  const fetchCalls = [];
  const context = {
    URL,
    Request,
    Response,
    Date,
    performance: { now: () => 1234 },
    location: {
      href: `https://chatgpt.com/c/${ACTIVE_ID}`,
      origin: 'https://chatgpt.com',
      pathname: `/c/${ACTIVE_ID}`
    },
    window: {},
    unsafeWindow: null,
    apiRequestContext: null,
    originalPageFetch: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      return new Response('{"messages":[],"page_info":{}}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    },
    stockNetworkSequence: 0,
    stockNetworkSafeUrl: url => String(url),
    communicationLogFetchRequest: async () => {},
    communicationLogFetchResponse: async () => {},
    communicationLogReportFailure: () => {}
  };
  context.window.fetch = context.originalPageFetch;
  vm.createContext(context);
  vm.runInContext(`
    ${functionSourceFrom(downloadConversationSource, 'currentConversationId')}
    ${functionSourceFrom(downloadConversationSource, 'isConversationApiUrl')}
    ${functionSourceFrom(downloadConversationSource, 'rawHeadersToObject')}
    ${functionSourceFrom(downloadConversationSource, 'rememberApiRequestContext')}
    ${functionSourceFrom(downloadConversationSource, 'apiFetch')}
    globalThis.issue169Api = {
      isConversationApiUrl,
      rememberApiRequestContext,
      apiFetch,
      context: () => apiRequestContext
    };
  `, context);
  return { api: context.issue169Api, fetchCalls };
}

test('collection batch endpoint is not a conversation-instance API URL', () => {
  const { api } = authContextHarness();
  assert.equal(
    api.isConversationApiUrl(`https://chatgpt.com/backend-api/conversations/${ACTIVE_ID}?num_turns=10`),
    true
  );
  assert.equal(
    api.isConversationApiUrl(`https://chatgpt.com/backend-api/conversations/${ACTIVE_ID}/messages?before=x`),
    true
  );
  assert.equal(
    api.isConversationApiUrl('https://chatgpt.com/backend-api/conversations/batch'),
    false
  );
});

test('authorized batch request cannot displace active conversation extraction context', async () => {
  const { api, fetchCalls } = authContextHarness();
  const activeUrl = `https://chatgpt.com/backend-api/conversations/${ACTIVE_ID}?num_turns=10&include_has_versions=true`;
  const headers = {
    authorization: 'Bearer live-fixture-token',
    'chatgpt-account-id': 'account-fixture'
  };

  api.rememberApiRequestContext(activeUrl, headers);
  assert.equal(api.context()?.conversation_id, ACTIVE_ID);

  // This is the exact later stock request observed in the v1.6.1 failure trace.
  api.rememberApiRequestContext('https://chatgpt.com/backend-api/conversations/batch', headers);
  assert.equal(api.context()?.conversation_id, ACTIVE_ID);

  const response = await api.apiFetch(
    `https://chatgpt.com/backend-api/conversations/${ACTIVE_ID}?include_has_versions=true&num_turns=100`
  );
  assert.equal(response.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init.headers.authorization, 'Bearer live-fixture-token');
});

test('recorder owns visible native checkbox rendering independently of host CSS', () => {
  const styles = functionSourceFrom(downloadConversationSource, 'injectStyles');
  assert.match(styles, /#\$\{PANEL_ID\} input\[type="checkbox"\]/,
    'Recorder CSS must scope an explicit checkbox rule to its own panel.');
  assert.match(styles, /(?:all:\s*revert|appearance:\s*(?:auto|checkbox)|-webkit-appearance:\s*checkbox)/,
    'Recorder checkbox CSS must restore native checkbox appearance rather than inherit host suppression.');
  assert.match(styles, /visibility:\s*visible|all:\s*revert/,
    'Recorder checkbox CSS must guarantee visibility.');
  assert.match(styles, /opacity:\s*1|all:\s*revert/,
    'Recorder checkbox CSS must prevent host opacity rules from hiding controls.');
});
