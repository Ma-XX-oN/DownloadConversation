import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

const helpers = [
  'conversationFilenameOverride',
  'conversationFilenameSetOverride',
  'conversationProjectName',
  'conversationFileBaseName',
  'canonicalFilename'
];
const functions = helpers.map(productionFunctionSource).join('\n');
const store = new Map();
const localStorage = {
  getItem(key) { return store.get(key) ?? null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); }
};

function harness(projectLabel = null, conversation = 'chat-1') {
  const location = {
    pathname: '/g/project-1/c/' + conversation,
    href: 'https://chatgpt.com/g/project-1/c/' + conversation,
    origin: 'https://chatgpt.com'
  };
  let label = projectLabel;
  const document = {
    title: 'Filename Layout Revision - ChatGPT',
    querySelector() { return { textContent: '58' }; },
    querySelectorAll() {
      return label ? [{
        href: 'https://chatgpt.com/g/project-1',
        textContent: label
      }] : [];
    }
  };
  const state = {
    location, document, localStorage, URL,
    currentConversationId: () => location.pathname.split('/').at(-1),
    conversationTitle: () => 'Filename Layout Revision',
    sanitizeFileName: value => String(value || 'ChatGPT conversation')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim(),
    canonicalFilenameTimestamp: () => '2026,10,12;00,00,00'
  };
  vm.runInNewContext(functions + '\nthis.api = {'
    + helpers.join(',') + '};', state);
  return { api: state.api, setProject(value) { label = value; } };
}

const range = {
  start_timestamp: '2026-10-12T00:00:00Z',
  end_timestamp: '2026-10-12T00:01:00Z'
};

test('late project discovery updates auto filename but not manual filename', () => {
  store.clear();
  const page = harness();
  assert.equal(page.api.conversationFileBaseName(),
    'Unknown__Filename Layout Revision');
  page.setProject('Download Conversation');
  assert.equal(page.api.conversationFileBaseName(),
    'Download-Conversation__Filename Layout Revision');
  page.api.conversationFilenameSetOverride('My own title');
  page.setProject('Other Project');
  assert.equal(page.api.conversationFileBaseName(), 'My own title');
  assert.equal(page.api.canonicalFilename('Other Project', 'Filename Layout Revision', range),
    'My own title_2026,10,12;00,00,00-2026,10,12;00,00,00');
});

test('edit before project discovery remains unchanged across reload', () => {
  store.clear();
  const first = harness();
  assert.equal(first.api.conversationFileBaseName(),
    'Unknown__Filename Layout Revision');
  first.api.conversationFilenameSetOverride('Edited before project');
  const reload = harness('Download Conversation');
  assert.equal(reload.api.conversationFileBaseName(), 'Edited before project');
  reload.api.conversationFilenameSetOverride(null);
  assert.equal(reload.api.conversationFileBaseName(),
    'Download-Conversation__Filename Layout Revision');
  const nextReload = harness('Download Conversation');
  assert.equal(nextReload.api.conversationFileBaseName(),
    'Download-Conversation__Filename Layout Revision');
});

test('manual filename belongs to conversation, not another conversation', () => {
  store.clear();
  const first = harness('Download Conversation', 'chat-1');
  first.api.conversationFilenameSetOverride('Custom file');
  const second = harness('Download Conversation', 'chat-2');
  assert.equal(second.api.conversationFileBaseName(),
    'Download-Conversation__Filename Layout Revision');
  assert.equal(first.api.conversationFileBaseName(), 'Custom file');
});

test('file reset is a separate button wired to clear override after successful rename', () => {
  assert.match(userscript, /data-role="reset-communication-log-filename"/);
  assert.match(userscript, /conversationFilenameSetOverride\(newFileName/);
  assert.match(userscript, /conversationFilenameSetOverride\(null\)/);
  assert.match(userscript, /communicationLogRename\(automaticBase \+ '\.jsonl'\)/);
});
