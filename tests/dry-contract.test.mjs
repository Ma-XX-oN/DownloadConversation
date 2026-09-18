import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { diskBlock, userscript } from './helpers/userscript-source.mjs';

test('tests share the userscript source loader and disk-block extractor', async () => {
  for (const name of await readdir(new URL('.', import.meta.url))) {
    if (!name.endsWith('.mjs') || name === 'dry-contract.test.mjs') continue;
    const source = await readFile(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(source,
      /^const userscript = await readFile\([\s\S]{0,160}chatgpt-conversation-markdown-export\.user\.js/m,
      `${name} reimplemented the shared userscript loader.`);
    assert.doesNotMatch(source, /function diskBlock\(\)/,
      `${name} reimplemented the shared disk-block extractor.`);
  }
});

test('production icon buttons and communication-log queue each have one shared contract', () => {
  assert.equal((userscript.match(/#\$\{PANEL_ID\} \.tm-icon-button\{/g) ?? []).length, 1,
    'Icon-button geometry/style must have one production CSS rule.');
  assert.match(userscript,
    /class="tm-icon-button" data-role="rename-communication-log"/);
  assert.match(userscript, /function communicationLogEnqueue\(/);
  assert.equal((diskBlock().match(/communicationLogWriteChain = operation\.catch/g) ?? []).length, 1,
    'Only the shared communication-log queue helper may recover the write chain.');
});
