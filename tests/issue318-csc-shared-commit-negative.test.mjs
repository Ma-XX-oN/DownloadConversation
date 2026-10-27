import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const shared = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-shared-settings.js',
  import.meta.url), 'utf8');

function fixture({ notificationFails = false, abort = false } = {}) {
  let emitted = 0;
  let stored = null;
  let thrownInTransaction = null;
  let closed = false;
  const db = {
    transaction() {
      const tx = { error: Error('injected-transaction-abort') };
      tx.objectStore = () => ({
        put(value) {
          queueMicrotask(() => {
            if (abort) {
              tx.onabort?.();
              return;
            }
            stored = value;
            try { tx.oncomplete?.(); }
            catch (error) { thrownInTransaction = error; }
          });
        }
      });
      return tx;
    },
    close() {}
  };
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    }
  };
  const context = vm.createContext({
    crypto: { getRandomValues: value => value.fill(4) },
    indexedDB,
    BroadcastChannel: class {
      postMessage() {
        emitted++;
        if (notificationFails) throw Error('injected-notification-failure');
      }
      close() { closed = true; }
    }
  });
  vm.runInContext(shared + '\nthis.store=cscControlSharedStore();',
    context);
  return { store: context.store,
    state: () => ({ stored, emitted, thrownInTransaction, closed }) };
}

test('durable native IDB write resolves despite unavailable broadcast peers',
  { timeout: 3000 }, async () => {
    const f = fixture({ notificationFails: true });
    const sentinel = { schema: 1, mode: 'replay-essentials',
      all: false };
    const result = await Promise.race([
      f.store.write(sentinel).then(() => 'committed'),
      new Promise(resolve => setTimeout(() => resolve('unresolved'), 250))
    ]);
    assert.equal(result, 'committed',
      'IDB durable write must not hang due to notification exception');
    assert.deepEqual(f.state().stored, sentinel);
    assert.equal(f.state().thrownInTransaction, null);
    f.store.dispose();
    assert.equal(f.state().closed, true);
  });

test('aborted IDB transaction rejects and never announces a persisted setting',
  async () => {
    const f = fixture({ abort: true });
    await assert.rejects(f.store.write({ all: true }),
      /injected-transaction-abort/);
    assert.equal(f.state().stored, null);
    assert.equal(f.state().emitted, 0);
    f.store.dispose();
  });
