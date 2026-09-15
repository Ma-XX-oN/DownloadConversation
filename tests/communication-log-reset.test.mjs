import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

function resetHarness() {
  const context = {
    Blob,
    TextDecoder,
    URL,
    location: {
      origin: 'https://chatgpt.com',
      href: 'https://chatgpt.com/c/conversation-1'
    },
    communicationLogDirectoryHandle: { id: 'directory-handle' },
    communicationLogFileName: 'DownloadConversation_test.jsonl',
    communicationLogReady: true
  };

  vm.runInNewContext(
    `${diskBlock()}
this.__issue133Events = [];
communicationLogReportFailure = (stage, error) => {
  this.__issue133Events.push(\`failure:\${stage}:\${error?.message ?? error}\`);
};
this.__issue133 = {
  reset: communicationLogReset,
  setWriter(writer, dirty) {
    communicationLogWritable = writer;
    communicationLogWriterDirty = dirty;
  },
  setWriteChain(chain) {
    communicationLogWriteChain = chain;
  },
  setSnapshot(snapshot) {
    communicationLogRefreshedFileSnapshot = async () => snapshot;
  },
  state() {
    return {
      writable: communicationLogWritable,
      dirty: communicationLogWriterDirty,
      directory: communicationLogDirectoryHandle,
      fileName: communicationLogFileName
    };
  }
};`,
    context
  );

  return {
    api: context.__issue133,
    events: context.__issue133Events,
    context
  };
}

test('general status panel exposes a communication-log reset button wired to production reset', () => {
  assert.match(userscript,
    /<span class="tm-label">Communication log<\/span><button data-role="reset-communication-log" type="button">Reset log<\/button>/);
  assert.match(userscript,
    /querySelector\('\[data-role="reset-communication-log"\]'\)/);
  assert.match(userscript, /communicationLogReset\(\)/);
  assert.match(userscript, /Resetting…/);
});

test('communication log reset waits for pending writes, closes active writer, then truncates committed file', async () => {
  const { api, events } = resetHarness();
  let releasePending = null;
  const pending = new Promise(resolve => { releasePending = resolve; });
  api.setWriteChain(pending);
  api.setWriter({
    async close() {
      events.push('active-close');
    }
  }, true);

  const snapshot = {
    handle: null,
    file: { size: 8192 }
  };
  const resetWritable = {
    async truncate(size) {
      events.push(`truncate:${size}`);
    },
    async close() {
      events.push('reset-close');
      snapshot.file.size = 0;
    },
    async abort() {
      events.push('reset-abort');
    }
  };
  snapshot.handle = {
    async createWritable(options) {
      events.push(`create:${options?.keepExistingData === true}`);
      return resetWritable;
    }
  };
  api.setSnapshot(snapshot);

  const resetPromise = api.reset();
  await Promise.resolve();
  assert.deepEqual(events, [], 'Reset must remain behind the existing write chain.');

  releasePending();
  await resetPromise;
  assert.deepEqual(events, [
    'active-close',
    'create:true',
    'truncate:0',
    'reset-close'
  ]);
  assert.equal(snapshot.file.size, 0, 'Fresh post-close state must verify the committed file is empty.');
  assert.equal(api.state().writable, null);
  assert.equal(api.state().dirty, false);
});

test('communication log reset truncates with no active writer and retains directory/file identity', async () => {
  const { api, events, context } = resetHarness();
  const directoryBefore = context.communicationLogDirectoryHandle;
  const fileNameBefore = context.communicationLogFileName;
  api.setWriter(null, false);

  const snapshot = {
    handle: null,
    file: { size: 4096 }
  };
  snapshot.handle = {
    async createWritable(options) {
      events.push(`create:${options?.keepExistingData === true}`);
      return {
        async truncate(size) {
          events.push(`truncate:${size}`);
        },
        async close() {
          events.push('reset-close');
          snapshot.file.size = 0;
        },
        async abort() {
          events.push('reset-abort');
        }
      };
    }
  };
  api.setSnapshot(snapshot);

  await api.reset();
  assert.deepEqual(events, ['create:true', 'truncate:0', 'reset-close']);
  assert.equal(snapshot.file.size, 0);
  assert.equal(api.state().directory, directoryBefore);
  assert.equal(api.state().fileName, fileNameBefore);
});

test('communication log reset recovers the write chain after reset failure without hiding the failure', async () => {
  const { api, events } = resetHarness();
  api.setWriter(null, false);
  api.setSnapshot({
    handle: {
      async createWritable() {
        throw new Error('reset write failed');
      }
    },
    file: { size: 1024 }
  });

  await assert.rejects(api.reset(), /reset write failed/);
  await Promise.resolve();
  assert.deepEqual(events, ['failure:reset:reset write failed']);
});
