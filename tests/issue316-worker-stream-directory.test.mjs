
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root,
  'src/userscript/06-image-export-tests/08-csc-worker-boundary-probe.js'), 'utf8');
const registry = readFileSync(path.join(root,
  'src/userscript/06-image-export-tests/04-tests-modal-transition.js'), 'utf8');
const readiness = readFileSync(path.join(root,
  'src/userscript/06-image-export-tests/06-agent-plugin-readiness.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(root,
  'src/userscript-manifest.json'), 'utf8'));

function directoryFixture({ deny = false } = {}) {
  const files = new Map();
  const handle = {
    async queryPermission() { return deny ? 'denied' : 'granted'; },
    async getFileHandle(name, options = {}) {
      if (deny) throw new DOMException('Forbidden', 'NotAllowedError');
      if (!files.has(name)) {
        if (!options.create) throw new DOMException('Missing', 'NotFoundError');
        files.set(name, new Uint8Array());
      }
      return {
        async createWritable() {
          const parts = [];
          return {
            async write(part) { parts.push(Uint8Array.from(part)); },
            async close() {
              const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
              let pos = 0;
              for (const part of parts) { bytes.set(part, pos); pos += part.length; }
              files.set(name, bytes);
            },
            async abort() { parts.length = 0; }
          };
        },
        async getFile() {
          return { async arrayBuffer() { return Uint8Array.from(files.get(name)).buffer; } };
        }
      };
    },
    async removeEntry(name) {
      if (!files.delete(name)) throw new DOMException('Missing', 'NotFoundError');
    }
  };
  return { handle, files };
}

function harness({ unavailable = false, csp = false, cloneError = false,
  pickerError = null, deny = false } = {}) {
  const dir = directoryFixture({ deny });
  const state = { workers: [], revoked: [], pickerCalls: 0, dir };
  const urls = {
    createObjectURL(blob) { return blob.chunks.join(''); },
    revokeObjectURL(url) { state.revoked.push(url); }
  };
  class FakeBlob {
    constructor(chunks) { this.chunks = chunks; }
  }
  class FakeWorker {
    constructor(script) {
      if (csp) throw new Error('CSP blocked synthetic Worker');
      this.handlers = new Map();
      this.terminated = false;
      const workerSelf = { postMessage: payload => {
        queueMicrotask(() => this.emit('message', { data: payload }));
      } };
      this.workerSelf = workerSelf;
      vm.runInNewContext(script, {
        self: workerSelf, Uint8Array, setTimeout, clearTimeout, Promise,
        Math, Error, String
      });
      state.workers.push(this);
    }
    addEventListener(type, callback) {
      const list = this.handlers.get(type) || [];
      list.push(callback);
      this.handlers.set(type, list);
    }
    emit(type, event) {
      for (const callback of this.handlers.get(type) || []) callback(event);
    }
    postMessage(payload, transfer) {
      if (cloneError) throw new DOMException('Not cloneable', 'DataCloneError');
      const transferred = payload.kind === 'directory'
        ? payload // Fixture handle is not a native platform object.
        : structuredClone(payload, { transfer });
      queueMicrotask(() => {
        Promise.resolve(this.workerSelf.onmessage({ data: transferred }))
          .catch(error => this.emit('error', { message: error.message }));
      });
    }
    terminate() { this.terminated = true; }
  }
  const page = {
    Worker: unavailable ? undefined : FakeWorker,
    URL: urls, Blob: FakeBlob,
    showDirectoryPicker() {
      state.pickerCalls += 1;
      return pickerError ? Promise.reject(pickerError) : Promise.resolve(dir.handle);
    }
  };
  const context = vm.createContext({
    window: page, unsafeWindow: page, Request, Response, ReadableStream,
    Uint8Array, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    assert: (condition, message) => assert.ok(condition, message),
    cloneSafely: object => object.clone(),
    errorMessage: error => error.message,
    setTimeout, clearTimeout
  });
  vm.runInContext(source + '\nthis.runProbe = testCscWorkerBoundary;', context);
  return { run: context.runProbe, state };
}

test('#316 has one opt-in Test row, no start-up invocation or new network request', () => {
  assert.equal(registry.split("['CSC Worker stream + directory', testCscWorkerBoundary]").length - 1, 1);
  assert.match(readiness, /name !== 'CSC Worker stream \+ directory'/);
  const modules = manifest.modules.flatMap(m => m.files);
  assert.equal(modules.filter(f => f.endsWith('08-csc-worker-boundary-probe.js')).length, 1);
  assert.match(source, /cloneSafely\(original\)/);
  assert.match(source, /eventQueue\.push\(\{/);
  assert.match(source, /async function drainEventQueue\(\)/);
  assert.match(source, /\[body\]/);
  assert.match(source, /showDirectoryPicker\(\{ mode: 'readwrite' \}\)/);
  assert.match(registry, /if \(name === 'CSC Worker stream \+ directory'\) continue;/);
  assert.doesNotMatch(source, /GM_xmlhttpRequest|fetch\s*\(|send\s*\(|\.text\s*\(/);
});

test('native transferable Request/Response cloning and synthetic Worker write round-trip', async () => {
  const h = harness();
  const result = await h.run();
  assert.match(result, /Response: 524299 bytes exact\/stock intact/);
  assert.match(result, /Request: 524299 bytes exact\/stock intact/);
  assert.match(result, /Stream abort: PASS/);
  assert.match(result, /Directory: 263185 bytes write\/read\/delete PASS/);
  assert.equal(h.state.pickerCalls, 1);
  assert.equal(h.state.dir.files.size, 0);
  assert.equal(h.state.workers.length, 4);
  assert.ok(h.state.workers.every(w => w.terminated));
  assert.equal(h.state.revoked.length, 4);
});

test('CSP refusal yields failure and no synthetic file', async () => {
  const h = harness({ csp: true });
  await assert.rejects(h.run(), /CSP blocked synthetic Worker/);
  assert.equal(h.state.dir.files.size, 0);
  assert.equal(h.state.pickerCalls, 1);
  assert.ok(h.state.revoked.length >= 1);
});

test('missing Worker is not treated as PASS', async () => {
  const h = harness({ unavailable: true });
  await assert.rejects(h.run(), /Worker constructor unavailable/);
  assert.equal(h.state.dir.files.size, 0);
});

test('DataCloneError reports failure and leaves directory clean', async () => {
  const h = harness({ cloneError: true });
  await assert.rejects(h.run(), /DataCloneError/);
  assert.equal(h.state.dir.files.size, 0);
  assert.ok(h.state.workers.every(w => w.terminated));
});

test('permission denied does not silently report a filesystem PASS', async () => {
  const h = harness({ deny: true });
  await assert.rejects(h.run(), /readwrite permission: denied/);
  assert.equal(h.state.dir.files.size, 0);
});

test('picker cancellation still runs stream cases and reports aborted permission', async () => {
  const h = harness({ pickerError: new DOMException('User cancelled', 'AbortError') });
  await assert.rejects(h.run(), /Response: .*Request: .*Stream abort: PASS.*AbortError/);
  assert.equal(h.state.dir.files.size, 0);
});
