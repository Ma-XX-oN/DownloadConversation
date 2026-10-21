import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const files = [
  '04b-persistent-hmac-indexeddb.js',
  '04ba-persistent-hmac-validation.js',
  '04c-persistent-hmac-service.js',
  '04d-persistent-hmac-browser.js'
];
const source = files.map(f => readFileSync(new URL(
  '../src/userscript/02-network-communication/' + f, import.meta.url),
'utf8')).join('\n');

/**
 * Execute a real Chromium process against a retained on-disk profile.
 * @param {string} binary - Chromium executable.
 * @param {string} profile - Native user-data directory.
 * @param {string} url - One local origin and phase.
 * @returns {Promise<Object>} Nonsecret synthetic marker identity.
 */
async function runChromium(binary, profile, url) {
  const child = spawn(binary, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--disable-dev-shm-usage', '--disable-background-timer-throttling',
    '--no-first-run', '--no-default-browser-check', '--dump-dom',
    '--user-data-dir=' + profile, url
  ]);
  const output = await new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Error('Chromium restart fixture timeout'));
    }, 30000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', part => { stdout += part; });
    child.stderr.on('data', part => { stderr += part; });
    child.on('error', err => { clearTimeout(timeout); reject(err); });
    child.on('close', status => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
  assert.equal(output.status, 0, output.stderr.slice(-1500));
  const match = output.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
  assert.ok(match, 'Chromium did not report a restart phase result');
  const result = JSON.parse(match[1].replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&'));
  assert.equal(result.error, undefined, String(result.error));
  return result;
}

/**
 * This exact function is serialized and executed in real Chromium.
 * @returns {Promise<void>} Native Worker-HMAC and complete IDB result.
 */
async function browserPhase() {
  const origin = { origin: 'https://chatgpt.com' };
  // Call the exact production factory with a shadowed approved origin,
  // while IndexedDB/Web Locks remain the REAL Chromium browser APIs.
  const timeOffset = location.search === '?overdue' ?
    25 * 3600000 + 1 : 0;
  const clock = { now: () => Date.now() + timeOffset };
  const factory = hmacFactory(origin, indexedDB, navigator, crypto, clock);
  const service = factory();
  const admission = await service.admit();
  const workerCode = [
    'self.onmessage = async event => {',
    'const bytes = event.data.key_bytes;',
    'const key = await crypto.subtle.importKey("raw",bytes,',
    '  {name:"HMAC",hash:"SHA-256"},false,["sign"]);',
    'const sig = await crypto.subtle.sign("HMAC",key,',
    '  new TextEncoder().encode("DC313-restart-only"));',
    'bytes.fill(0);',
    'const hex = Array.from(new Uint8Array(sig),',
    '  b => b.toString(16).padStart(2,"0")).join("");',
    'self.postMessage({fingerprint:hex});',
    '}'
  ].join('\n');
  const url = URL.createObjectURL(new Blob(
    [workerCode], { type: 'text/javascript' }));
  const worker = new Worker(url);
  try {
    const observed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(
        Error('restart Worker did not respond')), 3000);
      worker.onmessage = event => {
        clearTimeout(timer); resolve(event.data);
      };
      worker.onerror = error => {
        clearTimeout(timer); reject(Error(error.message));
      };
    });
    service.provision(admission.token, worker);
    const { fingerprint } = await observed;
    await service.complete(admission.token);
    const state = await service.status();
    const journal = await service.cycleEvents();
    service.dispose();
    document.querySelector('#result').textContent = JSON.stringify({
      phase: location.search.slice(1), fingerprint,
      epoch: state.redaction_key_epoch,
      generation: state.redaction_scope,
      pending: state.pending_count, cycleCount: journal.length,
      cycleReason: journal[0]?.reason,
      lastCycleReason: journal.at(-1)?.reason,
      nativeIndexedDB: true, nativeWebLocks: true
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

test('Chromium browser-process exit/restart preserves native IDB HMAC', {
  timeout: 90000
}, async () => {
  const binary = (process.platform === 'win32'
    ? ['chrome.exe'] : ['google-chrome', 'chromium', 'chromium-browser'])
    .find(name => spawnSync(
      process.platform === 'win32' ? 'where' : 'which',
      [name], { encoding: 'utf8' }).status === 0);
  assert.ok(binary, 'Chromium required to verify browser restart');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'dc313-restart-'));
  const html = '<!doctype html><meta charset="utf-8">' +
    '<pre id="result">RUNNING</pre><script>\n' + source +
    '\nconst hmacFactory = new Function("location","indexedDB",' +
    '"navigator","crypto","Date",' +
    JSON.stringify(source +
      '\nreturn communicationPersistentHmacCurrentTabService;') +
    ');\n(' + browserPhase.toString() + ')().catch(error => {' +
    'document.querySelector("#result").textContent=' +
    'JSON.stringify({error:String(error)});' +
    '});<\/script><img src="/hold" hidden>';
  const server = createServer((request, response) => {
    if (request.url === '/hold') {
      setTimeout(() => { response.writeHead(204); response.end(); }, 6500);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  try {
    const first = await runChromium(binary, profile, base + '?initial');
    // No Chromium process remains alive when the next phase starts.
    const second = await runChromium(binary, profile, base + '?restart');
    assert.equal(first.phase, 'initial');
    assert.equal(second.phase, 'restart');
    for (const result of [first, second]) {
      assert.equal(result.nativeIndexedDB, true);
      assert.equal(result.nativeWebLocks, true);
      assert.equal(result.epoch, 1);
      assert.equal(result.pending, 0);
      assert.equal(result.cycleCount, 1);
      assert.equal(result.cycleReason, 'initial');
      assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
    }
    assert.equal(second.generation, first.generation);
    assert.equal(second.fingerprint, first.fingerprint);
    // A THIRD fresh Chromium process starts after a simulated >25h
    // offline interval. The factory must rotate before first admission.
    const overdue = await runChromium(binary, profile, base + '?overdue');
    assert.equal(overdue.phase, 'overdue');
    assert.equal(overdue.nativeIndexedDB, true);
    assert.equal(overdue.nativeWebLocks, true);
    assert.equal(overdue.epoch, 2);
    assert.equal(overdue.pending, 0);
    assert.equal(overdue.cycleCount, 2);
    assert.equal(overdue.cycleReason, 'initial');
    assert.equal(overdue.lastCycleReason, 'overdue');
    assert.notEqual(overdue.generation, first.generation);
    assert.notEqual(overdue.fingerprint, first.fingerprint);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(profile, { recursive: true, force: true });
  }
});
