import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sourcePrefix = new URL('../src/userscript/02-network-communication/',
  import.meta.url);
const writerModules = [
  '04-csc-comm-disk-lock.js',
  '04-csc-comm-disk-manifest.js',
  '04-csc-comm-disk-copy.js',
  '04-csc-comm-disk-writer.js',
  '04-csc-comm-disk-writer-part2.js'
].map(name => readFileSync(new URL(name, sourcePrefix), 'utf8')).join('\n');

/** Runs a 11MiB stream entirely in one native isolated Worker. */
function nativeWorkerTestEntrypoint() {
  self.__cscWriterLease = cscCommWriterLease(self);
  self.__cscWriterManifest = cscCommDiskManifest(self);
  self.__cscWriterCopy = cscCommDiskCopy();
  const codec = {
    async init() {},
    async compress(raw) {
      const output = new Uint8Array(raw.length + 2);
      output.set([67, 83]); output.set(raw, 2);
      return output;
    },
    async decompress(input) {
      if (input[0] !== 67 || input[1] !== 83) throw Error('bad-codec');
      return input.subarray(2);
    }
  };
  const writer = cscCommDiskWriter(self, codec);
  self.addEventListener('message', event => {
    if (event.data?.type !== 'native-opfs-test') return;
    void (async () => {
      const task = event.data;
      const key_restart = '2026-10-22T00:00:00.000Z';
      const frame = value => new TextEncoder().encode(
        JSON.stringify(value) + '\n');
      await writer.open({ handle: task.handle, namespace: 'chromium-test',
        version: '1.11.7-issue.317-native', key_restart });
      if (task.phase === 'write') {
        await writer.write(frame({ kind: 'csc-comm-start',
          capture_id: 'native-capture', key_restart }));
        const data = 'x'.repeat(1024 * 1024);
        for (let i = 0; i < 11; i += 1) {
          await writer.write(frame({ kind: 'csc-comm-body',
            capture_id: 'native-capture', data }));
        }
        await writer.write(frame({ kind: 'csc-comm-end',
          capture_id: 'native-capture', status: 'completed' }));
      } else {
        let duplicateRejected = false;
        try {
          await writer.write(frame({ kind: 'csc-comm-start',
            capture_id: 'native-capture', key_restart }));
        } catch (error) {
          duplicateRejected = error.message === 'csc-writer-duplicate-capture';
        }
        if (!duplicateRejected) throw Error('replay-created-duplicate');
      }
      const snapshot = await writer.snapshot();
      if (snapshot.archives.length !== 2) throw Error('wrong-archive-count');
      await writer.close();
      self.postMessage({ type: 'native-opfs-result', ok: true,
        phase: task.phase, archives: snapshot.archives });
    })().catch(error => self.postMessage({
      type: 'native-opfs-result', ok: false, reason: String(error)
    }));
  });
}

/** Page fixture uses browser OPFS instead of a user-picked directory. */
async function nativePageTest() {
  const out = document.querySelector('#result');
  async function phase(root, selected) {
    const url = URL.createObjectURL(new Blob([workerScript],
      { type: 'text/javascript' }));
    let worker = null;
    try {
      worker = new Worker(url);
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('worker-timeout')), 30000);
        worker.addEventListener('error', event => {
          clearTimeout(timeout); reject(Error(event.message));
        });
        worker.addEventListener('message', event => {
          if (event.data?.type !== 'native-opfs-result') return;
          clearTimeout(timeout);
          if (event.data.ok) resolve(event.data);
          else reject(Error(event.data.reason));
        });
        worker.postMessage({ type: 'native-opfs-test',
          handle: root, phase: selected });
      });
    } finally {
      worker?.terminate();
      URL.revokeObjectURL(url);
    }
  }
  try {
    const root = await navigator.storage.getDirectory();
    const original = await phase(root, 'write');
    const recovered = await phase(root, 'reopen');
    const sub = await root.getDirectoryHandle('dc-comm-chromium-test');
    const handle = await sub.getFileHandle('manifest.json');
    const manifest = JSON.parse(await (await handle.getFile()).text());
    if (manifest.schema !== 'dc-csc-comm-segments/2' ||
        Object.keys(manifest.archives).length !== 2 ||
        original.archives.length !== recovered.archives.length) {
      throw Error('physical-manifest-mismatch');
    }
    // Native two-Worker contention is not proved by the in-memory lease
    // fixture; contend against one persistent physical namespace.
    async function checkNativeLock() {
      const url = URL.createObjectURL(new Blob([workerScript],
        { type: 'text/javascript' }));
      const first = new Worker(url);
      const contender = new Worker(url);
      const successor = new Worker(url);
      function message(worker, desired, operation) {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(
            Error('native-lock-timeout:' + desired)), 12000);
          const handler = event => {
            if (event.data?.type !== desired &&
                event.data?.type !== 'csc-writer-error') return;
            worker.removeEventListener('message', handler);
            clearTimeout(timeout);
            resolve(event.data);
          };
          worker.addEventListener('message', handler);
          worker.postMessage(operation);
        });
      }
      const config = { type: 'csc-writer-open', handle: root,
        namespace: 'chromium-test',
        version: '1.11.7-issue.317-native',
        key_restart: '2026-10-22T00:00:00.000Z' };
      try {
        const acquired = await message(first, 'csc-writer-ready', config);
        if (acquired.type !== 'csc-writer-ready') {
          throw Error('native-first-lock-denied');
        }
        const blocked = await message(contender, 'csc-writer-error', config);
        if (blocked.reason !== 'csc-writer-lock-contended') {
          throw Error('native-writer-lock-not-exclusive');
        }
        const released = await message(first, 'csc-writer-closed',
          { type: 'csc-writer-close' });
        if (released.type !== 'csc-writer-closed') {
          throw Error('native-lease-release-failed');
        }
        const resumed = await message(successor, 'csc-writer-ready', config);
        if (resumed.type !== 'csc-writer-ready') {
          throw Error('native-lock-not-reacquired');
        }
        const done = await message(successor, 'csc-writer-closed',
          { type: 'csc-writer-close' });
        if (done.type !== 'csc-writer-closed') {
          throw Error('native-successor-close-failed');
        }
      } finally {
        first.terminate(); contender.terminate(); successor.terminate();
        URL.revokeObjectURL(url);
      }
    }
    await checkNativeLock();
    await root.removeEntry('dc-comm-chromium-test', { recursive: true });
    out.textContent = JSON.stringify({ native_worker: true,
      web_locks: true, opfs: true, immutable_restart: true, cross_worker_lock: true, fragments: 2 });
  } catch (error) {
    out.textContent = JSON.stringify({ error: String(error) });
  }
}

test('Chromium Worker WebLocks + OPFS physical segments survive Worker restart',
  { timeout: 65000 }, async () => {
    const workerSource = writerModules + '\n(' +
      nativeWorkerTestEntrypoint.toString() + ')();';
    const html = '<!doctype html><meta charset="utf-8">' +
      '<pre id="result">PENDING</pre><script>const workerScript = ' +
      JSON.stringify(workerSource) + ';(' +
      nativePageTest.toString() + ')();</script>' +
      '<img src="/hold" hidden>';
    const server = createServer((request, response) => {
      if (request.url === '/hold') {
        setTimeout(() => { response.writeHead(204); response.end(); }, 19000);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const userData = mkdtempSync(path.join(os.tmpdir(), 'dc317-chrome-'));
    try {
      let executable = process.platform === 'win32' ? 'chrome.exe' : 'google-chrome';
      if (process.platform !== 'win32') {
        for (const candidate of ['google-chrome', 'chromium', 'chromium-browser']) {
          const found = spawnSync('which', [candidate], { encoding: 'utf8' });
          if (found.status === 0) {
            executable = found.stdout.trim();
            break;
          }
        }
      }
      const args = ['--headless=new', '--no-sandbox', '--disable-gpu',
        '--disable-dev-shm-usage', '--no-first-run',
        '--disable-background-timer-throttling',
        '--user-data-dir=' + userData, '--dump-dom',
        'http://127.0.0.1:' + port + '/'];
      const output = await new Promise((resolve, reject) => {
        const child = spawn(executable, args);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL'); reject(Error('Chromium OPFS test timeout'));
        }, 55000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', value => { stdout += value; });
        child.stderr.on('data', value => { stderr += value; });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => {
          clearTimeout(timer);
          if (code !== 0) reject(Error('Chromium exit=' + code + ' ' +
            stderr.slice(-800)));
          else resolve(stdout);
        });
      });
      assert.match(output, /"native_worker":true/);
      assert.match(output, /"web_locks":true/);
      assert.match(output, /"opfs":true/);
      assert.match(output, /"immutable_restart":true/);
      assert.match(output, /"cross_worker_lock":true/);
      assert.match(output, /"fragments":2/);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      rmSync(userData, { recursive: true, force: true });
    }
  });
