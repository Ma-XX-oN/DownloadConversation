'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const shared = fs.readFileSync('src/userscript/01-runtime/02-shared-network-transition.js', 'utf8');
const identity = fs.readFileSync('src/userscript/01-runtime/03-conversation-identity.js', 'utf8');
const stock = fs.readFileSync('src/userscript/02-network-communication/02-stock-network-responses.js', 'utf8');
function extract(source, name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name + ' declared');
  let brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Unclosed function: ' + name);
}
function environment({ title = 'Version provenance design', active = true,
  breadcrumb = true, route = '/g/g-p-6a74170dd7ac8191b0f5bc2147af1f33-download-conversation/c/6acd0eb0-938c-83ea-94fe-786b9d69df4e' } = {}) {
  const seen = [];
  const activeLink = {
    href: 'https://chatgpt.com/g/g-p-6a74170dd7ac8191b0f5bc2147af1f33/c/6acd0eb0-938c-83ea-94fe-786b9d69df4e',
    querySelector(selector) {
      assert.equal(selector, '[data-thread-title]');
      return { textContent: 'Version provenance design' };
    },
    getAttribute() { return 'Version provenance design'; }
  };
  const projectLink = {
    href: 'https://chatgpt.com/g/g-p-6a74170dd7ac8191b0f5bc2147af1f33/project',
    textContent: 'Download Conversation'
  };
  const state = {
    URL,
    location: { href: 'https://chatgpt.com' + route,
      pathname: route, origin: 'https://chatgpt.com' },
    document: {
      title,
      querySelectorAll(selector) {
        seen.push(selector);
        if (selector.includes('aria-current')) return active ? [activeLink] : [];
        if (selector.includes('Breadcrumb')) return breadcrumb ? [projectLink] : [];
        throw new Error('Unexpected broad DOM query: ' + selector);
      },
      querySelector(selector) {
        if (selector === 'h1') return { textContent: 'Skip to content' };
        return null;
      }
    },
    localStorage: { value: null, setItem(_key,v) { this.value = v; },
      getItem() { return this.value; } },
    COMMUNICATION_LOG_TITLE_STORAGE_PREFIX: 'title:'
  };
  vm.runInNewContext([
    extract(shared, 'usableConversationTitle'),
    extract(shared, 'currentConversationId'),
    extract(shared, 'conversationTitle'),
    extract(shared, 'sanitizeFileName'),
    extract(identity, 'projectNameFromRouteSlug'),
    extract(identity, 'conversationProjectName'),
    extract(stock, 'communicationLogConversationName'),
    'this.api = { conversationTitle, conversationProjectName, communicationLogConversationName };'
  ].join('\n'), state);
  return { api: state.api, state, seen };
}

test('saved DOM: active sidebar name and project breadcrumb', () => {
  const { api } = environment({title:'A stale document title'});
  assert.equal(api.conversationTitle(), 'Version provenance design');
  assert.equal(api.conversationProjectName(), 'Download Conversation');
});
test('document title fallback never uses Skip to content h1', () => {
  const {api} = environment({active:false});
  assert.equal(api.conversationTitle(), 'Version provenance design');
});
test('project slugged route and slugless breadcrumb share stable project id', () => {
  const {api} = environment();
  assert.equal(api.conversationProjectName(), 'Download Conversation');
});
test('mismatched project breadcrumb is ignored', () => {
  const {api,state} = environment();
  state.document.querySelectorAll = s => s.includes('Breadcrumb') ?
    [{href:'https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/project',
      textContent:'Wrong project'}] : [];
  assert.equal(api.conversationProjectName(), 'Download Conversation');
});
test('invalid legacy cached Skip to content is rejected', () => {
  const {api,state} = environment({title:'Skip to content',active:false});
  state.localStorage.value = 'Skip to content';
  assert.equal(api.communicationLogConversationName(), null);
});
test('valid conversation title replaces bad cached name', () => {
  const {api,state} = environment();
  state.localStorage.value = 'Skip to content';
  assert.equal(api.communicationLogConversationName(), 'Version provenance design');
  assert.equal(state.localStorage.value, 'Version provenance design');
});
