import { productionFunctionSource } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const source = [
  'communicationLogStoreDirectoryHandle',
  'communicationLogHandleDirectoryGesture',
  'communicationLogRetryStoredDirectory',
  'communicationLogInstallDirectoryRetryObservers',
  'initializeCommunicationDiskRecorder'
].map(productionFunctionSource).join('\n');

const signalKey = 'tm-downloadconversation-communication-directory-updated';

/**
 * Builds two independent page contexts with one shared, permission-scoped directory.
 *
 * @param {Object} options - Permission and saved-handle fixture.
 * @returns {Object} Shared browser and tab fixture.
 */
function makeBrowser(options = {}) {
  const shared = {
    handle: null,
    permission: options.permission ?? 'prompt',
    grant: options.grant ?? true,
    requests: 0,
    pickers: 0,
    broadcast: options.broadcast !== false,
    tabs: []
  };

  /**
   * Simulates a structured-cloneable handle with an origin-wide Chrome grant.
   *
   * @param {string} name - Directory display name.
   * @returns {Object} Handle with File System Access methods.
   */
  function directory(name) {
    return {
      name,
      queryPermission: async () => shared.permission,
      requestPermission: () => {
        shared.requests += 1;
        shared.permission = shared.grant ? 'granted' : 'denied';
        return Promise.resolve(shared.permission);
      }
    };
  }

  shared.handle = options.saved === false ? null : directory('COMM');

  /**
   * Creates an independently initialized restored ChatGPT document.
   *
   * @returns {Object} Test API and observed events.
   */
  function tab() {
    const events = new Map();
    const state = { activations: 0, errors: [], prompt: 0, picker: 0 };
    const window = {
      addEventListener(type, fn) {
        const listeners = events.get(type) ?? [];
        listeners.push(fn);
        events.set(type, listeners);
      }
    };
    const context = {
      window,
      unsafeWindow: {
        showDirectoryPicker: () => {
          shared.pickers += 1;
          state.picker += 1;
          const handle = directory('COMM');
          shared.permission = 'granted';
          return Promise.resolve(handle);
        }
      },
      document: { getElementById: () => ({ remove() {} }) },
      crypto: { randomUUID: () => String(shared.requests) + ':' + String(shared.pickers) },
      logDiagnostic() {},
      boundedDiagnosticText: String,
      communicationLogOpenDb: async () => ({
        transaction: () => {
          const tx = {
            objectStore: () => ({
              put(handle, key) {
                assert.equal(key, 'communication-directory');
                queueMicrotask(() => {
                  shared.handle = handle;
                  tx.oncomplete();
                });
              }
            })
          };
          return tx;
        },
        close() {}
      }),
      localStorage: {
        setItem(key, value) {
          assert.equal(key, signalKey);
          assert.ok(value);
          if (shared.broadcast) {
            for (const other of shared.tabs) {
              if (other.state === state) continue;
              other.emit('storage', { key });
            }
          }
        }
      }
    };
    const prelude = `
      let communicationLogReady = false;
      let communicationLogDirectoryGestureArmed = false;
      let communicationLogDirectoryPickerOpening = false;
      let communicationLogDirectoryReselectRequired = false;
      let communicationLogStorageFailed = false;
      let communicationLogDirectoryRestorePromise = null;
      let communicationLogDirectoryRetryInstalled = false;
      let communicationLogPendingDirectoryHandle = null;
      let communicationLogPromptShown = false;
      let communicationLogInitializationPromise = null;
      const COMMUNICATION_LOG_DB_STORE = 'handles';
      const COMMUNICATION_LOG_DIRECTORY_SIGNAL_KEY = '${signalKey}';
      function communicationLogLoadDirectoryHandle() { return Promise.resolve(browserHandle()); }
      function communicationLogPermissionState(handle) { return handle.queryPermission({mode:'readwrite'}); }
      function communicationLogReportFailure(stage, error) { recordError(stage, error); }
      function communicationLogShowDirectoryPrompt() {
        communicationLogPromptShown = true;
        communicationLogDirectoryGestureArmed = true;
        recordPrompt();
      }
      function communicationLogActivateDirectory(handle) {
        if (!handle) throw new Error('Activation requires an authorised handle');
        recordActivation();
        communicationLogReady = true;
        communicationLogDirectoryGestureArmed = false;
        communicationLogPromptShown = false;
        return Promise.resolve(true);
      }
      ${source}
      this.api = {
        init() {
          communicationLogInitializationPromise = initializeCommunicationDiskRecorder();
          return communicationLogInitializationPromise;
        },
        gesture() {
          const result = { prevented: false, stopped: false };
          communicationLogHandleDirectoryGesture({
            isTrusted: true,
            preventDefault() { result.prevented = true; },
            stopImmediatePropagation() { result.stopped = true; }
          });
          return result;
        },
        ready: () => communicationLogReady,
        pending: () => Boolean(communicationLogPendingDirectoryHandle),
        reselect: () => communicationLogDirectoryReselectRequired
      };
    `;
    context.browserHandle = () => shared.handle;
    context.recordError = (stage, error) => state.errors.push({ stage, error });
    context.recordPrompt = () => { state.prompt += 1; };
    context.recordActivation = () => { state.activations += 1; };
    vm.runInNewContext(prelude, context);
    const result = {
      state,
      api: context.api,
      emit: (type, event) => {
        for (const listener of events.get(type) ?? []) listener(event);
      }
    };
    shared.tabs.push(result);
    return result;
  }

  return { shared, tab, directory };
}

/**
 * Flushes pending storage events, promised permission checks and activation work.
 *
 * @returns {Promise<void>} Resolves after current microtasks settle.
 */
async function flush() {
  for (let i = 0; i < 80; i += 1) await Promise.resolve();
}

test('one reauthorisation resumes all Chrome-restored tabs with no new picker', async () => {
  const browser = makeBrowser();
  const first = browser.tab();
  const second = browser.tab();
  await Promise.all([first.api.init(), second.api.init()]);
  assert.equal(first.api.ready(), false);
  assert.equal(second.api.ready(), false);
  assert.equal(first.api.pending(), true);
  first.api.gesture();
  await flush();
  assert.equal(browser.shared.requests, 1);
  assert.equal(browser.shared.pickers, 0);
  assert.equal(first.api.ready(), true);
  assert.equal(second.api.ready(), true, JSON.stringify(second.state));
  assert.equal(first.state.activations, 1);
  assert.equal(second.state.activations, 1);
  assert.deepEqual(first.state.errors, []);
  assert.deepEqual(second.state.errors, []);
});

test('first-ever folder selection is broadcast after IndexedDB transaction completion', async () => {
  const browser = makeBrowser({ saved: false });
  const first = browser.tab();
  const second = browser.tab();
  await Promise.all([first.api.init(), second.api.init()]);
  assert.equal(first.api.pending(), false);
  first.api.gesture();
  await flush();
  assert.equal(browser.shared.pickers, 1);
  assert.equal(first.api.ready(), true);
  assert.equal(second.api.ready(), true);
  assert.equal(browser.shared.handle.name, 'COMM');
});

test('denied saved permission remains blocked, then permits deliberate folder re-selection', async () => {
  const browser = makeBrowser({ grant: false });
  const first = browser.tab();
  await first.api.init();
  first.api.gesture();
  await flush();
  assert.equal(first.api.ready(), false);
  assert.equal(first.api.reselect(), true);
  first.api.gesture();
  await flush();
  assert.equal(browser.shared.requests, 1);
  assert.equal(browser.shared.pickers, 1);
  assert.equal(first.api.ready(), true);
});

test('focus retries missed cross-tab notification without duplicate activation', async () => {
  const browser = makeBrowser({ broadcast: false });
  const first = browser.tab();
  const second = browser.tab();
  await Promise.all([first.api.init(), second.api.init()]);
  first.api.gesture();
  await flush();
  assert.equal(first.api.ready(), true);
  assert.equal(second.api.ready(), false);
  second.emit('focus', {});
  second.emit('focus', {});
  await flush();
  assert.equal(second.api.ready(), true);
  assert.equal(second.state.activations, 1);
  assert.equal(browser.shared.pickers, 0);
});

test('already-granted folder with a stale tab listener cannot reopen the directory chooser', async () => {
  const browser = makeBrowser({ broadcast: false });
  const first = browser.tab();
  const second = browser.tab();
  await Promise.all([first.api.init(), second.api.init()]);
  first.api.gesture();
  await flush();

  assert.equal(browser.shared.permission, 'granted');
  assert.equal(second.api.ready(), false, 'Second tab is intentionally left armed');
  second.api.gesture();
  await flush();
  assert.equal(browser.shared.pickers, 0, 'A stale handler must not show a second folder picker');
  assert.equal(second.api.ready(), true);
  assert.equal(second.state.activations, 1);
});

test('gesture during pending peer restoration neither consumes click nor activates twice', async () => {
  const browser = makeBrowser({ broadcast: false });
  const first = browser.tab();
  const second = browser.tab();
  await Promise.all([first.api.init(), second.api.init()]);
  first.api.gesture();
  await flush();

  second.emit('focus', {});
  const gesture = second.api.gesture();
  await flush();

  assert.equal(gesture.prevented, false, 'Peer permission retry owns the pending activation');
  assert.equal(gesture.stopped, false, 'Ordinary ChatGPT interaction must continue');
  assert.equal(browser.shared.pickers, 0);
  assert.equal(second.api.ready(), true);
  assert.equal(second.state.activations, 1);
  assert.equal(browser.shared.requests, 1, 'Only the first tab needs to request permission');
});

test('deferred prompt does not remount after peer has activated the recorder', () => {
  const callbacks = [];
  const document = {
    body: null,
    getElementById: () => null
  };
  const ctx = {
    document,
    requestAnimationFrame: fn => { callbacks.push(fn); },
    window: { addEventListener() {} },
    logDiagnostic() {}
  };
  const prelude = `
    let communicationLogDirectoryGestureArmed = false;
    let communicationLogPromptShown = false;
    let communicationLogReady = false;
    let communicationLogPendingDirectoryHandle = null;
    let communicationLogDirectoryReselectRequired = false;
    let communicationLogStorageFailed = false;
    function communicationLogHandleDirectoryGesture() {}
    ${productionFunctionSource('communicationLogShowDirectoryPrompt')}
    this.api = {
      show: () => communicationLogShowDirectoryPrompt('Initial request'),
      resolve: () => { communicationLogReady = true; communicationLogPromptShown = false; }
    };
  `;
  vm.runInNewContext(prelude, ctx);
  ctx.api.show();
  assert.equal(callbacks.length, 1);
  let mounted = 0;
  document.body = { append() { mounted += 1; } };
  ctx.api.resolve();
  callbacks[0]();
  assert.equal(mounted, 0, 'Peer grant must cancel the queued blocker mount.');
});
