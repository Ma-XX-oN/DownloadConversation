import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const context = {};
vm.runInNewContext(
  productionFunctionSource('communicationLogDisplayLocation')
    + '\nthis.display = communicationLogDisplayLocation;', context
);

const format = (folder, name) => {
  const result = context.display(folder, name);
  return { display: result.display, exact: result.exact };
};

test('display uses the selected project folder name, not a fixed DC prefix', () => {
  const filename = 'DownloadConversation_Project Chat Export Plan.jsonl';
  const output = format({ name: 'Actual Project Folder' }, filename);
  assert.deepEqual(output, {
    display: 'Actual Project Folder / Project Chat Export Plan.jsonl',
    exact: 'Actual Project Folder / ' + filename
  });
  assert.equal(filename, 'DownloadConversation_Project Chat Export Plan.jsonl',
    'display formatting must not rename the logical on-disk basename');
});

test('switching folders, changing the logical basename and missing directories', () => {
  assert.equal(format({ name: 'First Folder' }, 'DownloadConversation_Chat.jsonl')
    .display, 'First Folder / Chat.jsonl');
  assert.equal(format({ name: 'Second Folder' }, 'DownloadConversation_Chat.jsonl')
    .display, 'Second Folder / Chat.jsonl');
  assert.equal(format({ name: 'Second Folder' }, 'custom-name.jsonl')
    .display, 'Second Folder / custom-name.jsonl');
  assert.equal(format(null, 'DownloadConversation_Chat.jsonl')
    .display, 'DownloadConversation_Chat.jsonl');
  assert.deepEqual(format(null, null), {
    display: 'Not configured', exact: 'Not configured'
  });
});

test('do not hide names that merely contain DownloadConversation in the middle', () => {
  const filename = 'custom_DownloadConversation_chat.jsonl';
  assert.equal(format({ name: 'My Logs' }, filename).display,
    'My Logs / ' + filename);
});
