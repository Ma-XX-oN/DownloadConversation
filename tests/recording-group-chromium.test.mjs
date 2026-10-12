import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/userscript/01-runtime/01-recording-group.js', import.meta.url),
  'utf8'
);

test('Chromium retains an owner across reload and rekeys a cloned session tab',
  { timeout: 40000 }, async () => {
    const fixture = `<!doctype html><meta charset="utf-8">
      <pre id="result">RUNNING</pre><script>
      function logConsoleDiagnostic() {}
      function currentConversationId() { return 'browser-conversation'; }
      const communicationLogSegmentDirectoryHandle = { name: 'browser-segments' };
      ${source}
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      async function check() {
        if (location.hash === '#duplicate') return;
        const original = sessionStorage.getItem('test-recording-group');
        if (!original) {
          const enabled = await recordingGroupEnable();
          if (!enabled) throw new Error('initial group ownership rejected');
          sessionStorage.setItem('test-recording-group', recordingGroupState().uuid);
          location.reload();
          return;
        }
        await wait(800);
        if (!recordingGroupState().ready
          || recordingGroupState().uuid !== original) {
          throw new Error('reload changed original recording UUID');
        }
        const child = window.open(location.href + '#duplicate', '_blank');
        if (!child) throw new Error('duplicate tab window could not open');
        await wait(3500);
        if (!child.recordingGroupState) {
          throw new Error('duplicate did not initialize');
        }
        const theirs = child.recordingGroupState();
        const ours = recordingGroupState();
        if (!ours.ready || !theirs.ready
          || ours.uuid !== original || theirs.uuid === original) {
          throw new Error('live duplicate group collision not resolved: '
            + JSON.stringify({ original, ours, theirs }));
        }
        document.getElementById('result').textContent = JSON.stringify({
          reload_retained_uuid: true, duplicate_rekeyed: true,
          original_ready: ours.ready, duplicate_ready: theirs.ready
        });
        child.close();
      }
      check().catch(error => {
        document.getElementById('result').textContent =
          JSON.stringify({ error: String(error) });
      });
      <\/script><img src="/hold" hidden>`;
    const server = createServer((request, response) => {
      if (request.url === '/hold') {
        setTimeout(() => { response.writeHead(204); response.end(); }, 8500);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(fixture);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const userData = mkdtempSync(path.join(os.tmpdir(), 'dc-220-chrome-'));
    try {
      const chrome = process.platform === 'win32'
        ? 'chrome.exe' : 'google-chrome';
      let executable = chrome;
      if (process.platform !== 'win32') {
        for (const candidate of ['google-chrome', 'chromium', 'chromium-browser']) {
          const found = spawnSync('which', [candidate], { encoding: 'utf8' });
          if (found.status === 0) {
            executable = found.stdout.trim();
            break;
          }
        }
      }
      const args = [
        '--headless=new', '--no-sandbox', '--disable-gpu',
        '--disable-dev-shm-usage', '--disable-popup-blocking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--no-first-run', '--no-default-browser-check',
        '--dump-dom',
        '--user-data-dir=' + userData,
        'http://127.0.0.1:' + port + '/'
      ];
      const run = await new Promise((resolve, reject) => {
        const child = spawn(executable, args);
        let stdout = '';
        let stderr = '';
        const watchdog = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Chromium scenario timed out.'));
        }, 35000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', error => {
          clearTimeout(watchdog);
          reject(error);
        });
        child.on('close', status => {
          clearTimeout(watchdog);
          resolve({ status, stdout, stderr });
        });
      });
      assert.equal(run.status, 0, run.stderr.slice(-3000));
      const match = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
      assert.ok(match, 'Chromium must render result pre');
      assert.notEqual(match[1], 'RUNNING', 'Browser scenario did not finish');
      const outcome = JSON.parse(match[1].replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&amp;'));
      assert.equal(outcome.error, undefined, outcome.error);
      assert.equal(outcome.reload_retained_uuid, true);
      assert.equal(outcome.duplicate_rekeyed, true);
    } finally {
      await new Promise(resolve => server.close(resolve));
      rmSync(userData, { recursive: true, force: true });
    }
  });
