import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

function diskBlock() {
  const start = userscript.indexOf('  // BEGIN Issue #123 disk communication recorder');
  const endMarker = '  // END Issue #123 disk communication recorder';
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start,
    'Issue #123 disk communication recorder production block is missing.');
  return userscript.slice(start, end + endMarker.length);
}

test('missing directory uses the first page click or key press to open the native chooser directly', () => {
  const block = diskBlock();

  assert.doesNotMatch(block, /Choose Log Folder/,
    'There must not be a separate in-page Choose Log Folder button step.');
  assert.doesNotMatch(block, /createElement\(['"]button['"]\)/,
    'Directory authorization must not require clicking an intermediate button.');

  assert.match(block, /function communicationLogHandleDirectoryGesture\(event\)/,
    'One synchronous user-gesture handler must own directory chooser launch.');
  assert.match(block, /addEventListener\(['"]click['"],\s*communicationLogHandleDirectoryGesture,\s*\{\s*capture:\s*true/,
    'The first page click must be captured for chooser launch.');
  assert.match(block, /addEventListener\(['"]keydown['"],\s*communicationLogHandleDirectoryGesture,\s*\{\s*capture:\s*true/,
    'The first key press must be captured for chooser launch.');

  assert.match(block, /event\.preventDefault\(\)/);
  assert.match(block, /event\.stopImmediatePropagation\(\)/,
    'The triggering interaction is reserved for directory authorization and must not also activate ChatGPT UI.');

  const handlerStart = block.indexOf('function communicationLogHandleDirectoryGesture(event)');
  const handlerEnd = block.indexOf('\n  }', handlerStart);
  const handler = block.slice(handlerStart, handlerEnd + 4);
  const pickerIndex = handler.indexOf('pickerWindow.showDirectoryPicker({ mode: \'readwrite\' })');
  assert.ok(pickerIndex >= 0,
    'The native directory chooser must be called from inside the actual trusted event handler.');
  assert.equal(handler.slice(0, pickerIndex).includes('await '), false,
    'No await may occur before showDirectoryPicker(); transient user activation must still be live.');
});

test('directory-required UI blocks page interaction but contains no authorization button', () => {
  const block = diskBlock();
  assert.match(block, /position:fixed;inset:0/,
    'A full-page blocker must reserve the first interaction for directory authorization.');
  assert.match(block, /Click or press any key/i,
    'The blocker may explain the required gesture but must not add a second button step.');
});

test('successful activation disarms gesture capture and removes the blocker', () => {
  const block = diskBlock();
  assert.match(block, /communicationLogDisarmDirectoryGesture\(\)/);
  assert.match(block, /removeEventListener\(['"]click['"],\s*communicationLogHandleDirectoryGesture,\s*true\)/);
  assert.match(block, /removeEventListener\(['"]keydown['"],\s*communicationLogHandleDirectoryGesture,\s*true\)/);
  assert.match(block, /tm-communication-directory-required/);
});
