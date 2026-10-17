import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probe = readFileSync(path.join(root,
  'src/userscript/06-image-export-tests/07-worker-zstd-csp-probe.js'), 'utf8');
const registry = readFileSync(path.join(root,
  'src/userscript/06-image-export-tests/04-tests-modal-transition.js'), 'utf8');
const readiness = readFileSync(path.join(root,
  'src/userscript/06-image-export-tests/06-agent-plugin-readiness.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(root,
  'src/userscript-manifest.json'), 'utf8'));

function harness({ pageWorks = true, sandboxWorks = true, messageError = null } = {}) {
  const created = [];
  const revoked = [];
  const diagnostics = [];
  const events = [];
  const urls = { createObjectURL: () => 'blob:synthetic-probe',
    revokeObjectURL: url => revoked.push(url) };
  class BlobFixture {
    constructor(chunks) { this.chunks = chunks; }
  }
  function makeWorker(works, label) {
    return class {
      constructor(url) {
        if (!works) throw new Error(label + ' CSP rejected ' + url);
        this.handlers = {};
        this.terminated = false;
        created.push(this);
      }
      addEventListener(name, handler) { this.handlers[name] = handler; }
      postMessage(payload) {
        assert.equal(payload.level, 6);
        assert.equal(payload.wasm_gzip_base64, 'synthetic-gzip');
        if (messageError) {
          queueMicrotask(() => this.handlers.error({ message: messageError }));
          return;
        }
        queueMicrotask(() => this.handlers.message({ data: {
          ok: true, bytes: 10485760, archive_bytes: 40000,
          elapsed_ms: 300, worker_cross_origin_isolated: false,
          iterations: 5
        } }));
      }
      terminate() { this.terminated = true; }
    };
  }
  const page = { Worker: makeWorker(pageWorks, 'page'),
    Blob: BlobFixture, URL: urls, crossOriginIsolated: false };
  const sandbox = { Worker: makeWorker(sandboxWorks, 'userscript'),
    Blob: BlobFixture, URL: urls };
  const context = vm.createContext({
    unsafeWindow: page,
    window: sandbox,
    globalThis: { __dcCompressor: null },
    logDiagnostic: (...args) => diagnostics.push(args),
    errorMessage: e => e.message,
    assert: (ok, message) => assert.ok(ok, message),
    setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask
  });
  vm.runInContext([
    'async function __dcCompressorInit() {}',
    'function __dcCompressorViews() {}',
    'class CompressorEncoder {}',
    'function __dcCompressorDecompress() {}',
    probe,
    'globalThis.__dcCompressor = { init: __dcCompressorInit, Encoder: CompressorEncoder,',
    'decompress: __dcCompressorDecompress,',
    "wasmGzipBase64: 'synthetic-gzip', _compression_level: 6 };",
    'this.runProbe = testWorkerZstdCsp;'
  ].join('\n'), context);
  return { runProbe: context.runProbe, created, revoked, diagnostics, events };
}

test('Worker probe is registered exactly once, under existing Test button', () => {
  assert.equal(registry.split("['Worker + Zstd/CSP', testWorkerZstdCsp]").length - 1, 1);
  assert.match(registry, /const detail = await fn\(\)/);
  assert.match(registry, /result\.status \+ \(result\.detail/);
  assert.match(readiness, /name !== 'Worker \+ Zstd\/CSP'/);
  const files = manifest.modules.flatMap(module => module.files);
  assert.equal(files.filter(file => file.endsWith('07-worker-zstd-csp-probe.js')).length, 1);
});

test('Worker probe uses the real bundled bridge and only synthetic bytes', () => {
  assert.match(probe, /typeof bridge\?\.Encoder === 'function'/);
  assert.match(probe, /bridge\.init\.toString\(\)/);
  assert.match(probe, /bridge\.Encoder\.toString\(\)/);
  assert.match(probe, /bridge\.decompress\.toString\(\)/);
  assert.match(probe, /engine\.init\(wasm\)/);
  assert.match(probe, /new engine\.Encoder\(event\.data\.level\)/);
  assert.match(probe, /engine\.decompress\(archive\)/);
  assert.match(probe, /for \(let i = 0; i < bytes\.length; i \+= 1\)/);
  assert.doesNotMatch(probe, /(?:^|[^.])fetch\s*\(/);
  assert.doesNotMatch(probe, /GM_xmlhttpRequest|currentConversationId|document\.querySelector/);
});

test('working page Worker returns measurement and releases all resources', async () => {
  const h = harness();
  const text = await h.runProbe();
  assert.match(text, /page Worker; 10 MiB Zstd exact-byte PASS/);
  assert.match(text, /isolated=false/);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].terminated, true);
  assert.equal(h.revoked.length, 1);
  assert.equal(h.diagnostics[0][1], 'worker-zstd-csp-test-pass');
});

test('page CSP refusal falls back to userscript Worker', async () => {
  const h = harness({ pageWorks: false });
  assert.match(await h.runProbe(), /userscript Worker/);
  assert.equal(h.created.length, 1);
  assert.equal(h.revoked.length, 2);
});

test('both Worker refusals yield explicit failure, no leaked Blob URLs', async () => {
  const h = harness({ pageWorks: false, sandboxWorks: false });
  await assert.rejects(h.runProbe(), /page: page CSP rejected.*userscript: userscript CSP rejected/);
  assert.equal(h.created.length, 0);
  assert.equal(h.revoked.length, 2);
  assert.equal(h.diagnostics[0][1], 'worker-zstd-csp-test-fail');
});

test('Worker execution error is reported and terminated', async () => {
  const h = harness({ messageError: 'synthetic runtime failure' });
  await assert.rejects(h.runProbe(), /synthetic runtime failure/);
  assert.equal(h.created.length, 2);
  assert.equal(h.revoked.length, 2);
  assert.ok(h.created.every(worker => worker.terminated));
});
