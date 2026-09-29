import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runtimeSource = await readFile(
  new URL('../src/userscript/01-runtime/02-shared-network-transition.js', import.meta.url),
  'utf8'
);
const lifecycleSource = await readFile(
  new URL('../src/userscript/02-network-communication/03-communication-lifecycle.js', import.meta.url),
  'utf8'
);
const manifestSource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-manifest.js', import.meta.url),
  'utf8'
);
const imageRecoverySource = await readFile(
  new URL('../src/userscript/06-image-export-tests/02-image-recovery.js', import.meta.url),
  'utf8'
);
const diagnosticSource = await readFile(
  new URL('../src/userscript/07-panel-launcher/02-diagnostic-archive.js', import.meta.url),
  'utf8'
);

function functionSource(source, name) {
  const marker = `function ${name}`;
  const functionStart = source.indexOf(marker);
  assert.ok(functionStart >= 0, `missing ${name}`);
  let depth = 0;
  let seenBrace = false;
  for (let index = functionStart; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
      seenBrace = true;
    } else if (source[index] === '}') {
      depth -= 1;
      if (seenBrace && depth === 0) return source.slice(functionStart, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function identityHarness({ pathname, heading, title, links }) {
  const conversationTitle = functionSource(runtimeSource, 'conversationTitle');
  const sanitizeFileName = functionSource(runtimeSource, 'sanitizeFileName');
  const projectName = functionSource(runtimeSource, 'conversationProjectName');
  const fileBase = functionSource(runtimeSource, 'conversationFileBaseName');
  const location = {
    origin: 'https://chatgpt.com',
    href: `https://chatgpt.com${pathname}`,
    pathname
  };
  const document = {
    title,
    querySelector: selector => selector === 'h1' ? { textContent: heading } : null,
    querySelectorAll: selector => selector === 'a[href]' ? links : []
  };
  return new Function('document', 'location', 'URL', `
    ${conversationTitle}
    ${sanitizeFileName}
    ${projectName}
    ${fileBase}
    return {
      projectName: conversationProjectName(),
      fileBase: conversationFileBaseName()
    };
  `)(document, location, URL);
}

test('Issue 172 project chat resolves project name and canonical project-conversation base', () => {
  const projectSegment = 'g-p-1234567890-download-conversation';
  const result = identityHarness({
    pathname: `/g/${projectSegment}/c/conversation-1`,
    heading: 'Browser XZ Comparison',
    title: 'Browser XZ Comparison - ChatGPT',
    links: [{
      href: `/g/${projectSegment}/project`,
      textContent: 'Download Conversation'
    }]
  });
  assert.deepEqual(result, {
    projectName: 'Download Conversation',
    fileBase: 'Download Conversation - Browser XZ Comparison'
  });
});

test('Issue 172 standalone chat keeps conversation-only filename base', () => {
  const result = identityHarness({
    pathname: '/c/conversation-1',
    heading: 'Browser XZ Comparison',
    title: 'Browser XZ Comparison - ChatGPT',
    links: []
  });
  assert.deepEqual(result, {
    projectName: null,
    fileBase: 'Browser XZ Comparison'
  });
});

test('Issue 172 manifest persists project identity separately from conversation identity', () => {
  assert.match(manifestSource, /project_name:/);
  assert.match(manifestSource, /conversationProjectName\(\)/);
  assert.match(manifestSource, /conversation_name:/);
});

test('Issue 172 all user-facing filename paths use the canonical filename base', () => {
  assert.match(lifecycleSource,
    /DownloadConversation_\$\{conversationFileBaseName\(\)\}\.jsonl/);
  assert.match(imageRecoverySource,
    /\$\{conversationFileBaseName\(\)\}\.jsonl/);
  assert.match(imageRecoverySource,
    /\$\{conversationFileBaseName\(\)\}\.md/);
  assert.match(diagnosticSource,
    /DownloadConversation_\$\{conversationFileBaseName\(\)\}/);
  assert.doesNotMatch(imageRecoverySource,
    /sanitizeFileName\(conversationTitle\(\)\)\.(?:jsonl|md)/);
});
