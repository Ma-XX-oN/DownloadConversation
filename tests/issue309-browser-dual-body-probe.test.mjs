import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const source = read('src/userscript/06-image-export-tests/09-csc-dual-body-clone-probe.js');
const registry = read('src/userscript/06-image-export-tests/04-tests-modal-transition.js');
const readiness = read('src/userscript/06-image-export-tests/06-agent-plugin-readiness.js');
const manifest = JSON.parse(read('src/userscript-manifest.json'));

function harness({ cloneFailure = false, workerFailure = false } = {}) {
  const state = { calls: [], clones: 0 };
  const window = { Worker: class FakeWorker {} };
  const context = vm.createContext({
    unsafeWindow: window,
    window,
    Request, Response, ReadableStream, Uint8Array, Math,
    Promise, Error, Object, String,
    assert: (condition, explanation) => assert.ok(condition, explanation),
    cloneSafely(original) {
      state.clones++;
      return cloneFailure ? null : original.clone();
    },
    errorMessage: err => String(err?.message || err),
    cscProbeByteStream(length) {
      let offset = 0;
      return new ReadableStream({
        pull(controller) {
          if (offset === length) { controller.close(); return; }
          const size = Math.min(16384, length - offset);
          const bytes = new Uint8Array(size);
          for (let i = 0; i < size; i++) {
            bytes[i] = (Math.imul(offset + i, 29) + 7) & 255;
          }
          offset += size;
          controller.enqueue(bytes);
        }
      }, { highWaterMark: 1 });
    },
    async cscProbeWorkerTask(realm, task, transfer) {
      assert.equal(realm, window);
      state.calls.push(task);
      if (workerFailure) throw Error('Synthetic CSP Worker rejection');
      const received = structuredClone(task, { transfer });
      assert.equal(transfer[0].locked, true);
      const reader = received.body.getReader();
      let n = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (let i = 0; i < value.byteLength; i++) {
            assert.equal(value[i], (Math.imul(n + i, 29) + 7) & 255);
          }
          n += value.byteLength;
        }
      } finally { reader.releaseLock(); }
      return { bytes: n, cancelled: false };
    }
  });
  vm.runInContext(source + '\nthis.run = testCscDualCloneOwnership;', context);
  return { state, run: context.run };
}

test('#309 browser witness is one opt-in UI row and uses no page API calls', () => {
  const files = manifest.modules.flatMap(group => group.files);
  const name = 'src/userscript/06-image-export-tests/09-csc-dual-body-clone-probe.js';
  assert.equal(files.filter(file => file === name).length, 1);
  assert.equal(registry.split("['CSC dual clone + Worker', testCscDualCloneOwnership]")
    .length - 1, 1);
  assert.match(readiness, /name !== 'CSC dual clone \+ Worker'/);
  assert.doesNotMatch(source,
    /fetch\s*\(|XMLHttpRequest\s*\(|showDirectoryPicker\s*\(|getFileHandle\s*\(/);
  assert.match(source, /cloneSafely\(original\)/);
  assert.match(source, /cscProbeWorkerTask\(realm,/);
  assert.match(source, /\[transferred\]/);
});

test('#309 four browser-like native dual body cases preserve 3 independent readers', async () => {
  const h = harness();
  const result = await h.run();
  assert.match(result, /response\/plugin: stock\/plugin\/Worker 524299 bytes exact/);
  assert.match(result, /response\/stock: stock\/plugin\/Worker 524299 bytes exact/);
  assert.match(result, /request\/plugin: stock\/plugin\/Worker 524299 bytes exact/);
  assert.match(result, /request\/stock: stock\/plugin\/Worker 524299 bytes exact/);
  assert.equal(h.state.clones, 8, 'Exactly two native clones for every case');
  assert.equal(h.state.calls.length, 4);
});

test('#309 clone failure is rejected and never claims a false PASS', async () => {
  const h = harness({ cloneFailure: true });
  await assert.rejects(h.run(), /Independent native Request\/Response clones unavailable/);
  assert.equal(h.state.calls.length, 0);
});

test('#309 Worker failure cannot be misreported as success', async () => {
  const h = harness({ workerFailure: true });
  await assert.rejects(h.run(), /Synthetic CSP Worker rejection/);
});
