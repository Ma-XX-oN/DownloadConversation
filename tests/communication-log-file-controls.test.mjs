import { diskBlock, diskFunctionSource, diskHarnessSource, userscript } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

function notFound(name) {
  const error = new Error(`Not found: ${name}`);
  error.name = 'NotFoundError';
  return error;
}

function directoryHarness(initialFiles = {}) {
  const files = new Map(
    Object.entries(initialFiles).map(([name, value]) => [name, new Blob([value])])
  );
  const events = [];

  function fileHandle(name) {
    return {
      name,
      async getFile() {
        const value = files.get(name);
        if (!value) throw notFound(name);
        return value;
      },
      async createWritable() {
        let pending = files.get(name) ?? new Blob([]);
        let aborted = false;
        return {
          async write(data) {
            assert.equal(aborted, false);
            events.push(`write:${name}`);
            pending = data instanceof Blob ? data : new Blob([data]);
          },
          async truncate(size) {
            assert.equal(aborted, false);
            events.push(`truncate:${name}:${size}`);
            const bytes = await pending.arrayBuffer();
            pending = new Blob([bytes.slice(0, size)]);
          },
          async seek() {},
          async close() {
            assert.equal(aborted, false);
            events.push(`close:${name}`);
            files.set(name, pending);
          },
          async abort() {
            aborted = true;
            events.push(`abort:${name}`);
          }
        };
      }
    };
  }

  const directory = {
    async getFileHandle(name, options = {}) {
      if (!files.has(name)) {
        if (!options.create) throw notFound(name);
        files.set(name, new Blob([]));
      }
      return fileHandle(name);
    },
    async removeEntry(name) {
      if (!files.has(name)) throw notFound(name);
      events.push(`remove:${name}`);
      files.delete(name);
    }
  };

  return { directory, events, files };
}

function issue134Harness(initialFiles = {}) {
  const { directory, events, files } = directoryHarness(initialFiles);
  const context = {
    Blob,
    TextDecoder,
    URL,
    location: {
      origin: 'https://chatgpt.com',
      href: 'https://chatgpt.com/c/conversation-1'
    },
    __issue134Directory: directory,
    __issue134Events: events
  };

  vm.runInNewContext(
    `${diskHarnessSource()}\ncommunicationLogDirectoryHandle = this.__issue134Directory;\ncommunicationLogFileName = 'DownloadConversation_test.jsonl';\ncommunicationLogReady = true;\ncommunicationLogWriteChain = Promise.resolve();\ncommunicationLogReportFailure = (stage, error) => {\n  this.__issue134Events.push(\`failure:\${stage}:\${error?.message ?? error}\`);\n};\nthis.__issue134 = {\n  rename: communicationLogRename,\n  duplicate: communicationLogDuplicate,\n  duplicateName: communicationLogDuplicateFileName,\n  departureCheckpoint: typeof communicationLogCheckpointForDocumentDeparture === 'function'\n    ? communicationLogCheckpointForDocumentDeparture\n    : null,\n  setWriter(writer, dirty) {\n    communicationLogWritable = writer;\n    communicationLogWriterDirty = dirty;\n  },\n  setWriteChain(chain) {\n    communicationLogWriteChain = chain;\n  },\n  state() {\n    return {\n      writable: communicationLogWritable,\n      dirty: communicationLogWriterDirty,\n      fileName: communicationLogFileName\n    };\n  }\n};`,
    context
  );

  return { api: context.__issue134, context, directory, events, files };
}

async function blobText(blob) {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

test('Issue 134 filename controls are present', () => {
  assert.match(userscript, /data-role="communication-log-name"/);
  assert.match(userscript, /data-role="rename-communication-log"/);
  assert.match(userscript, /aria-label="Rename communication log"/);
  assert.match(userscript, /class="tm-icon-button" data-role="duplicate-communication-log"[^>]*aria-label="Duplicate communication log"/);
  assert.match(userscript, /querySelector\('\[data-role="rename-communication-log"\]'\)/);
  assert.match(userscript, /querySelector\('\[data-role="duplicate-communication-log"\]'\)/);
});

test('long active filename uses a dark hover-scroll viewport instead of a readonly text input', () => {
  assert.match(userscript, /data-role="communication-log-name-viewport"/);
  assert.match(userscript, /class="tm-log-name-text"[^>]*data-role="communication-log-name"/);
  assert.doesNotMatch(userscript,
    /<input[^>]*data-role="communication-log-name"[^>]*readonly/);
  assert.match(userscript, /--tm-log-name-overflow/);
  assert.match(userscript, /\.tm-log-name-viewport:hover\s+\.tm-log-name-text/);
  assert.match(userscript, /overflow:hidden/);
});

test('document-departure checkpoint waits for queued writes and commits the dirty writer', async () => {
  const { api, events } = issue134Harness({
    'DownloadConversation_test.jsonl': 'source'
  });
  assert.equal(typeof api.departureCheckpoint, 'function',
    'Issue 134 must expose one shared document-departure checkpoint path.');

  let releasePending;
  const pending = new Promise(resolve => { releasePending = resolve; });
  api.setWriteChain(pending);
  api.setWriter({
    async close() {
      events.push('departure-close');
    }
  }, true);

  let resolved = false;
  const operation = api.departureCheckpoint('beforeunload').then(value => {
    resolved = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.deepEqual(events, [], 'Departure checkpoint must remain behind pending writes.');

  releasePending();
  assert.equal(await operation, true);
  assert.deepEqual(events, ['departure-close']);
  assert.equal(api.state().writable, null);
  assert.equal(api.state().dirty, false);

  assert.match(userscript,
    /addEventListener\('beforeunload',[\s\S]*communicationLogCheckpointForDocumentDeparture\('beforeunload'\)/);
  assert.match(userscript,
    /addEventListener\('pagehide',[\s\S]*communicationLogCheckpointForDocumentDeparture\('pagehide'\)/);
});

test('duplicate names use the lowest unused positive suffix with no space before parenthesis', async () => {
  const { api, directory } = issue134Harness({
    'DownloadConversation_test.jsonl': 'source',
    'DownloadConversation_test(1).jsonl': 'one',
    'DownloadConversation_test(2).jsonl': 'two'
  });
  assert.equal(api.duplicateName('DownloadConversation_test.jsonl', 1),
    'DownloadConversation_test(1).jsonl');
  assert.equal(api.duplicateName('archive.tar.gz', 4), 'archive.tar(4).gz');
  assert.equal(api.duplicateName('no-extension', 3), 'no-extension(3)');

  await assert.rejects(directory.getFileHandle('DownloadConversation_test(3).jsonl'),
    error => error?.name === 'NotFoundError');
  const duplicated = await api.duplicate();
  assert.equal(duplicated, 'DownloadConversation_test(3).jsonl');
});

test('duplicate waits for pending writes, snapshots exact committed bytes, and keeps the active filename', async () => {
  const { api, events, files } = issue134Harness({
    'DownloadConversation_test.jsonl': 'alpha\nbeta\n'
  });
  let releasePending;
  const pending = new Promise(resolve => { releasePending = resolve; });
  api.setWriteChain(pending);
  api.setWriter({
    async close() {
      events.push('active-close');
    }
  }, true);

  const operation = api.duplicate();
  await Promise.resolve();
  assert.deepEqual(events, [], 'Duplicate must remain behind pending communication writes.');
  releasePending();
  const duplicateName = await operation;

  assert.equal(duplicateName, 'DownloadConversation_test(1).jsonl');
  assert.equal(await blobText(files.get(duplicateName)), 'alpha\nbeta\n');
  assert.equal(api.state().fileName, 'DownloadConversation_test.jsonl');
  assert.equal(api.state().writable, null);
  assert.equal(api.state().dirty, false);
  assert.equal(events[0], 'active-close');

  files.set('DownloadConversation_test.jsonl', new Blob(['changed later']));
  assert.equal(await blobText(files.get(duplicateName)), 'alpha\nbeta\n',
    'Later writes to the active log must not mutate the duplicate snapshot.');
});

test('rename waits for pending writes, preserves exact bytes, removes the old name, and switches active filename', async () => {
  const { api, events, files } = issue134Harness({
    'DownloadConversation_test.jsonl': 'rename payload'
  });
  api.setWriter({
    async close() {
      events.push('active-close');
    }
  }, true);

  const renamed = await api.rename('renamed.jsonl');
  assert.equal(renamed, 'renamed.jsonl');
  assert.equal(files.has('DownloadConversation_test.jsonl'), false);
  assert.equal(await blobText(files.get('renamed.jsonl')), 'rename payload');
  assert.equal(api.state().fileName, 'renamed.jsonl');
  assert.equal(api.state().writable, null);
  assert.equal(api.state().dirty, false);
  assert.equal(events[0], 'active-close');
  assert.ok(events.includes('remove:DownloadConversation_test.jsonl'));
});

test('rename rejects collisions without changing either file or active identity', async () => {
  const { api, files } = issue134Harness({
    'DownloadConversation_test.jsonl': 'source',
    'already.jsonl': 'existing'
  });

  await assert.rejects(api.rename('already.jsonl'), /already exists/i);
  assert.equal(await blobText(files.get('DownloadConversation_test.jsonl')), 'source');
  assert.equal(await blobText(files.get('already.jsonl')), 'existing');
  assert.equal(api.state().fileName, 'DownloadConversation_test.jsonl');
});

test('rename rejects invalid filenames rather than silently sanitizing them', async () => {
  const { api, files } = issue134Harness({
    'DownloadConversation_test.jsonl': 'source'
  });

  await assert.rejects(api.rename('../bad.jsonl'), /invalid communication log filename/i);
  assert.equal(files.size, 1);
  assert.equal(api.state().fileName, 'DownloadConversation_test.jsonl');
});


test('communication-log mutators share queue, writer-close, and panel action infrastructure', () => {
  const block = diskBlock();
  assert.match(block, /function communicationLogEnqueue\(/);
  for (const name of [
    'communicationLogCheckpoint',
    'communicationLogRename',
    'communicationLogDuplicate',
    'communicationLogReset',
    'communicationLogAppendLine'
  ]) {
    assert.match(diskFunctionSource(name), /communicationLogEnqueue\(/,
      `${name} must use the shared communication-log queue helper.`);
  }
  assert.match(diskFunctionSource('communicationLogReset'), /communicationLogCloseActiveWriter\(\)/);
  assert.doesNotMatch(diskFunctionSource('communicationLogReset'), /communicationLogWritable\.close\(\)/,
    'Reset must not reimplement active-writer close state cleanup.');
  assert.match(userscript, /function runCommunicationLogPanelAction\(/);
  assert.match(userscript, /function communicationLogPanelControls\(/);
});


test('Issue 166 Duplicate creates a 7z archive instead of a raw JSONL sibling', () => {
  assert.match(userscript, /communicationLogDuplicateArchiveFileName\(/);
  assert.match(userscript, /await create7zArchive\(new Uint8Array\(await sourceSnapshot\.file\.arrayBuffer\(\)\), memberName\)/);
  assert.match(userscript, /application\/x-7z-compressed/);
  assert.doesNotMatch(
    userscript,
    /await communicationLogCopySnapshot\(sourceSnapshot\.file, duplicateName\);\s*return duplicateName;/,
    'Duplicate must not retain the old raw JSONL copy path.'
  );
});
