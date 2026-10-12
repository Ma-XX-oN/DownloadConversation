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
  return JSON.parse(JSON.stringify(result));
};

test('directory and exact logical base are independent', () => {
  assert.deepEqual(format({ name: 'Comm-logs2' }, 'Repo-Workflow__Merge readiness summary.jsonl'), {
    directory: 'Comm-logs2',
    base: 'Repo-Workflow__Merge readiness summary'
  });
});

test('legacy filenames are not silently transformed', () => {
  assert.deepEqual(format({ name: 'Comm-logs2' }, 'DownloadConversation_Legacy.jsonl'), {
    directory: 'Comm-logs2',
    base: 'DownloadConversation_Legacy'
  });
  assert.deepEqual(format(null, null), {
    directory: 'Not configured',
    base: 'Not configured'
  });
});
