import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

const context = {
  sanitizeFileName: name => String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim(),
  canonicalFilenameTimestamp: () => '2026,10,12;00,00,00'
};
vm.runInNewContext(
  productionFunctionSource('canonicalFilename') +
    '\nthis.canonicalFilename = canonicalFilename;', context
);
const range = { start_timestamp: '2026-10-12T00:00:00Z',
  end_timestamp: '2026-10-12T00:02:00Z' };

test('saved name is project__conversation with no fixed product prefix', () => {
  assert.equal(context.canonicalFilename('Repo Workflow', 'Merge readiness summary', range),
    'Repo-Workflow__Merge readiness summary_2026,10,12;00,00,00-2026,10,12;00,00,00');
  assert.equal(context.canonicalFilename('Download Conversation', 'Filename Layout Revision', range),
    'Download-Conversation__Filename Layout Revision_2026,10,12;00,00,00-2026,10,12;00,00,00');
  assert.equal(context.canonicalFilename(null, 'Standalone', range),
    'Standalone_2026,10,12;00,00,00-2026,10,12;00,00,00');
});

test('the checked-in userscript has matching canonical generator and header', () => {
  assert.match(userscript, /@version\s+1\.11\.4-issue\.220\.37/);
  assert.match(userscript, /return `\$\{identity\}_\$\{start\}-\$\{end\}`;/);
  assert.doesNotMatch(productionFunctionSource('canonicalFilename'), /DownloadConversation_/);
});

test('project navigation source caches names by route, not current tab', () => {
  const context = {
    location: { pathname: '/g/project-a/chat-a', origin: 'https://chatgpt.com',
      href: 'https://chatgpt.com/g/project-a/chat-a' },
    document: {
      querySelectorAll: () => [],
      querySelector: () => ({ textContent: 'Conversation' }),
      title: 'Conversation - ChatGPT'
    },
    URL
  };
  let projectName = 'Download Conversation';
  context.document.querySelectorAll = () => [{
    href: 'https://chatgpt.com/g/project-a',
    textContent: projectName
  }];
  vm.runInNewContext('' +
    productionFunctionSource('conversationProjectName') +
    '\nthis.projectName = conversationProjectName;', context);
  assert.equal(context.projectName(), 'Download Conversation');
  context.location.pathname = '/g/project-b/chat-b';
  context.document.querySelectorAll = () => [{
    href: 'https://chatgpt.com/g/project-b',
    textContent: 'Repo Workflow'
  }];
  assert.equal(context.projectName(), 'Repo Workflow');
  context.location.pathname = '/g/project-a/chat-c';
  context.document.querySelectorAll = () => [];
  assert.equal(context.projectName(), 'Download Conversation');
  context.location.pathname = '/c/no-project';
  assert.equal(context.projectName(), null);
});
