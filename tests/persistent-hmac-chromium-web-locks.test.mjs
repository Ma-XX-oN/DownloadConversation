import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const source = [
  '../src/userscript/02-network-communication/04b-persistent-hmac-indexeddb.js',
  '../src/userscript/02-network-communication/04ba-persistent-hmac-validation.js',
  '../src/userscript/02-network-communication/04c-persistent-hmac-service.js',
  '../src/userscript/02-network-communication/04d-persistent-hmac-browser.js'
].map(name => readFileSync(new URL(name, import.meta.url), 'utf8'))
  .join('\n');

test('Chromium native IndexedDB and Web Locks serialize first-use and rotation',
  { timeout: 40000 }, async () => {
    const page = `<!doctype html><meta charset="utf-8">
<pre id="result">RUNNING</pre><script>
${source}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const storage = communicationPersistentHmacIndexedDbStorage(
  indexedDB, { origin: 'https://chatgpt.com' });
const authority = communicationPersistentHmacIndexedDbAuthority(
  navigator, { origin: 'https://chatgpt.com' }, storage);
const make = () => communicationPersistentHmacService({
  storage, authority, crypto
});
window.probe = { ready: true, make };
async function scenario() {
  const child = window.open(location.href + '#child', '_blank');
  if (!child) throw Error('second same-origin tab unavailable');
  for (let i = 0; i < 80 && !child.probe?.ready; i++) await delay(50);
  if (!child.probe?.ready) throw Error('second tab not ready');
  const first = make(), second = child.probe.make();
  const services = Array.from({ length: 40 },
    (_, i) => i % 2 ? first : second);
  const admissions = await Promise.all(services.map(s => s.admit()));
  const scopes = [...new Set(admissions.map(a => a.metadata.redaction_scope))];
  if (scopes.length !== 1) throw Error('first-use split brain');
  const rotation = first.randomize(true);
  await delay(20);
  let fenced = false;
  try { await second.admit(); }
  catch (e) { fenced = String(e).includes('rotation-draining'); }
  if (!fenced) throw Error('admission was not fenced during rotation');
  await Promise.all(admissions.map((a, i) => services[i].complete(a.token)));
  const rotated = await rotation;
  if (rotated.state !== 'DRAINING') throw Error('unexpected rotation result');
  const next = await second.admit();
  if (next.metadata.redaction_scope === scopes[0] ||
      next.metadata.redaction_key_epoch !== 2) {
    throw Error('rotation did not advance epoch');
  }
  const workerCode = 'self.onmessage = event => {' +
    'const item = event.data;const bytes = item.key_bytes;' +
    'if(item.type !== "dc-hmac-key-v2" ||' +
    '!(bytes instanceof Uint8Array) || bytes.length !== 32)' +
    'throw Error("invalid synthetic Worker key");' +
    'const length = bytes.byteLength;bytes.fill(0);' +
    'self.postMessage({type:"synthetic-key-ack",length,token:item.token});' +
    '}';
  const workerUrl = URL.createObjectURL(new Blob([workerCode],
    { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  let workerAck;
  try {
    const acknowledgement = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Worker key transfer timeout')),
        3000);
      worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
      worker.onerror = error => { clearTimeout(timer);
        reject(Error('Worker key transfer failed: ' + error.message)); };
    });
    second.provision(next.token, worker);
    workerAck = await acknowledgement;
    if (workerAck.type !== 'synthetic-key-ack' ||
        workerAck.length !== 32 || workerAck.token !== next.token) {
      throw Error('Worker key receipt mismatch');
    }
  } finally {
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
  }
  await second.complete(next.token);
  document.getElementById('result').textContent = JSON.stringify({
    nativeWebLocks: true, nativeIndexedDb: true,
    sameOriginTabs: 2, firstUseAdmissions: 40,
    singleScope: true, fenced: true, rotatedEpoch: 2,
    workerKeyReceived: workerAck.length
  });
  child.close();
}
if (location.hash !== '#child') scenario().catch(e => {
  document.getElementById('result').textContent =
    JSON.stringify({ error: String(e) });
});
<\/script><img src="/hold" hidden>`;
    const server = createServer((request, response) => {
      if (request.url === '/hold') {
        setTimeout(() => { response.writeHead(204); response.end(); }, 7500);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(page);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'dc-313-lock-'));
    try {
      const binary = (process.platform === 'win32'
        ? ['chrome.exe'] : ['google-chrome', 'chromium', 'chromium-browser'])
        .find(candidate => spawnSync(
          process.platform === 'win32' ? 'where' : 'which',
          [candidate], { encoding: 'utf8' }).status === 0);
      assert.ok(binary, 'Chromium required');
      const child = spawn(binary, [
        '--headless=new', '--no-sandbox', '--disable-gpu',
        '--disable-dev-shm-usage', '--disable-popup-blocking',
        '--disable-background-timer-throttling', '--no-first-run',
        '--no-default-browser-check', '--dump-dom',
        '--user-data-dir=' + tmp,
        'http://127.0.0.1:' + server.address().port + '/'
      ]);
      const run = await new Promise((resolve, reject) => {
        let stdout = '', stderr = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(Error('Chromium cross-tab test timeout'));
        }, 33000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', status => {
          clearTimeout(timer);
          resolve({ status, stdout, stderr });
        });
      });
      assert.equal(run.status, 0, run.stderr.slice(-1600));
      const match = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
      assert.ok(match, 'Missing rendered Chromium result');
      const result = JSON.parse(match[1].replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&'));
      assert.equal(result.error, undefined, result.error);
      assert.equal(result.nativeWebLocks, true);
      assert.equal(result.singleScope, true);
      assert.equal(result.fenced, true);
      assert.equal(result.rotatedEpoch, 2);
      assert.equal(result.workerKeyReceived, 32);
    } finally {
      await new Promise(resolve => server.close(resolve));
      rmSync(tmp, { recursive: true, force: true });
    }
  });
