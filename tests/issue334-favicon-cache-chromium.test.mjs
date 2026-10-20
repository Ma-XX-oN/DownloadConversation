import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { syntheticPack, catalogue } from './helpers/issue334-favicon-synthetic.mjs';

const source = readFileSync(new URL('../src/userscript/03-agent-lifecycle/03-favicon-cache-format.js', import.meta.url), 'utf8')
  + '\n' + readFileSync(new URL('../src/userscript/03-agent-lifecycle/03-favicon-cache.js', import.meta.url), 'utf8');
const original = syntheticPack();
const corrupt = Buffer.from(original.pack);
corrupt[corrupt.length - 20] ^= 0x04;
const invalidIdat = syntheticPack({ badDecode: true });
const cat = catalogue(original, ['1.11.7', '1.12.0']);
const invalidDescriptor = catalogue(invalidIdat, ['1.13.0']).datasets[0];
invalidDescriptor.favicons.path = 'assets/favicons/v1/invalid-idat.dcfav';
cat.datasets.push(invalidDescriptor);

// Chromium runs the exact browser implementation with origin-scoped Web Locks and IndexedDB.
test('Chromium: two tabs share one import, lock eviction, recover corruption', { timeout: 85000 }, async () => {
  let packRequests = 0;
  let corruptNext = false;
  const server = createServer((req, res) => {
    if (req.url === '/corrupt/on' || req.url === '/corrupt/off') {
      corruptNext = req.url === '/corrupt/on';
      res.writeHead(204); res.end(); return;
    }
    if (req.url === '/hold') { setTimeout(() => { res.writeHead(204); res.end(); }, 12000); return; }
    if (req.url?.startsWith('/pack')) {
      packRequests++;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(req.url === '/pack-invalid' ? invalidIdat.pack
        : corruptNext ? corrupt : original.pack);
      return;
    }
    if (req.url?.startsWith('/catalogue')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(cat));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><pre id="result">RUNNING</pre><script>
      ${source}
      faviconCacheCatalogueUrl = 'https://raw.githubusercontent.com/Ma-XX-oN/DownloadConversation/main/assets/favicons/v1/catalogue.json';
      window.downloads = 0;
      let reads = 0;
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function(...args) {
        if (this.name === 'pngs') reads++;
        return get.apply(this, args);
      };
      function GM_xmlhttpRequest(options) {
        const target = options.url.endsWith('invalid-idat.dcfav') ? '/pack-invalid'
          : options.url.endsWith('.dcfav') ? '/pack' : '/catalogue';
        fetch(target).then(r => options.responseType === 'arraybuffer' ? r.arrayBuffer() : r.text())
          .then(response => options.onload({ status: 200, response })).catch(options.onerror);
      }
      function logDiagnostic(...args) { window.diags = (window.diags || []).concat([args]); }
      const delay = ms => new Promise(done => setTimeout(done, ms));
      async function runChild() {
        const version = await get_compatible_version_key('1.11.7-issue.999.2');
        const session = await open_favicon_dataset(version);
        if (!session) throw Error('child session unavailable');
        const v = session.find_variant('a'.repeat(64));
        const b = await session.read_png(v, 0, 0, 0);
        if (!b || b.type !== 'image/png') throw Error('child PNG missing');
        window.childResult = { session, reads: reads, version: session.version };
        window.childReady = true;
      }
      async function runParent() {
        const key = await get_compatible_version_key('1.11.7-issue.3.999');
        if (key !== '1.11.7') throw Error('numeric boundary wrong: '+ key);
        const child = window.open(location.origin + '/child', '_blank');
        if (!child) throw Error('child popup blocked');
        const parentPromise = open_favicon_dataset(key);
        const parent = await parentPromise;
        if (!parent) throw Error('parent session unavailable');
        for (let x = 0; x < 60 && !child.childReady; x++) await delay(100);
        if (!child.childReady) throw Error('child not ready: ' + child?.document?.getElementById('result')?.textContent);
        if (child.childResult.version !== '1.11.7') throw Error('child wrong version');
        const variant = parent.find_variant('a'.repeat(64));
        if (variant !== '0') throw Error('source digest variant selection wrong');
        const first = await parent.read_png(variant, 3, 6, 20);
        const second = await parent.read_png(variant, 3, 6, 20);
        if (!first || first !== second || reads !== 1) throw Error('warm cache read count '+reads);
        if (await parent.read_png(variant, 4, 0, 0) !== null) throw Error('bad frame accepted');
        const db = await faviconCacheDatabase();
        // Initial/warm use cannot advance the dataset clock before 600000 ms.
        const baselineUse = (await faviconCacheMetadata(db, key)).last_used;
        const realDateNow = Date.now;
        try {
          Date.now = () => baselineUse + 599999;
          await faviconCacheTouch(db, key);
          if ((await faviconCacheMetadata(db, key)).last_used !== baselineUse) {
            throw Error('early last_used write');
          }
          Date.now = () => baselineUse + 600000;
          await faviconCacheTouch(db, key);
          if ((await faviconCacheMetadata(db, key)).last_used !== baselineUse + 600000) {
            throw Error('missing exact ten-minute touch');
          }
          Date.now = () => baselineUse + 600001;
          await faviconCacheTouch(db, key);
          if ((await faviconCacheMetadata(db, key)).last_used !== baselineUse + 600000) {
            throw Error('double touch inside ten-minute interval');
          }
        } finally { Date.now = realDateNow; }
        // The active shared lock must suppress an otherwise expired cleanup.
        { const tx = db.transaction('datasets', 'readwrite');
          const store = tx.objectStore('datasets');
          const record = await faviconCacheRequest(store.get('1.11.7'));
          record.last_used = Date.now() - 600001;
          store.put(record); }
        await delay(100);
        await faviconCacheSweep(db);
        if (!await faviconCacheMetadata(db, '1.11.7')) throw Error('active dataset evicted');
        await parent.close();
        await child.childResult.session.close();
        child.close();
        // The two versions have independent images and may coexist.
        const key2 = await get_compatible_version_key('1.12.2-issue.100');
        if (key2 !== '1.12.0') throw Error('second boundary incorrect');
        const other = await open_favicon_dataset(key2);
        if (!other) throw Error('other version unavailable');
        await other.close();
        if (!await faviconCacheMetadata(db, '1.11.7')) throw Error('first version disappeared');
        if (!await faviconCacheMetadata(db, '1.12.0')) throw Error('second version missing');
        // A dataset exactly 600000 ms old must survive; >600000 must not.
        const actualNow = Date.now;
        const cutoffNow = actualNow();
        Date.now = () => cutoffNow;
        try {
          const tx = db.transaction('datasets', 'readwrite');
          const store = tx.objectStore('datasets');
          const record = await faviconCacheRequest(store.get('1.11.7'));
          record.last_used = cutoffNow - 600000;
          store.put(record);
          await delay(100);
          await faviconCacheSweep(db);
          if (!await faviconCacheMetadata(db, '1.11.7')) throw Error('exact 10-minute cutoff evicted');
        } finally { Date.now = actualNow; }
        // Force expiration and confirm strict stale eviction.
        { const tx = db.transaction('datasets', 'readwrite');
          const store = tx.objectStore('datasets');
          const record = await faviconCacheRequest(store.get('1.11.7'));
          record.last_used = Date.now() - 600001;
          store.put(record); }
        await delay(100);
        await faviconCacheSweep(db);
        if (await faviconCacheMetadata(db, '1.11.7')) throw Error('expired dataset retained');
        // Corrupted hash must fail closed without committing a ready marker.
        await fetch('/corrupt/on');
        const corruptRead = await open_favicon_dataset(key);
        if (corruptRead !== null) throw Error('corrupted pack accepted');
        if (await faviconCacheMetadata(db, key)) throw Error('corrupt dataset published');
        await fetch('/corrupt/off');
        const revived = await open_favicon_dataset(key);
        if (!revived) throw Error('redownload after corruption failed');
        await revived.close();
        // Valid CRC/hash with undecodable IDAT must also fail closed.
        const invalidFrame = await open_favicon_dataset('1.13.0');
        if (invalidFrame !== null) throw Error('undecodable PNG accepted');
        if (await faviconCacheMetadata(db, '1.13.0')) throw Error('invalid PNG published');
        // Simulate an interrupted transaction after PNG puts but before ready.
        { const tx = db.transaction('datasets', 'readwrite');
          const store = tx.objectStore('datasets');
          const record = await faviconCacheRequest(store.get(key));
          record.last_used = Date.now() - 600001;
          store.put(record); }
        await delay(100);
        await faviconCacheSweep(db);
        const originalPut = IDBObjectStore.prototype.put;
        let injectedAbort = false;
        IDBObjectStore.prototype.put = function(...args) {
          if (!injectedAbort && this.name === 'datasets' && args[0]?.version === key) {
            injectedAbort = true;
            throw Error('injected-atomic-import-failure');
          }
          return originalPut.apply(this, args);
        };
        let partial;
        try { partial = await open_favicon_dataset(key); }
        finally { IDBObjectStore.prototype.put = originalPut; }
        if (partial !== null || !injectedAbort) throw Error('interrupted import accepted');
        if (await faviconCacheMetadata(db, key)) throw Error('aborted ready marker committed');
        const rows = await faviconCacheRequest(db.transaction('pngs', 'readonly')
          .objectStore('pngs').index('by_version').getAllKeys(IDBKeyRange.only(key)));
        if (rows.length) throw Error('aborted PNG records committed');
        const afterAbort = await open_favicon_dataset(key);
        if (!afterAbort) throw Error('retry after aborted transaction failed');
        await afterAbort.close();
        document.getElementById('result').textContent = JSON.stringify({
          cross_tab: true, warm_reads: reads, child_reads: child.childResult.reads,
          two_versions: true, stale_evicted: true, cutoff_exact: true, touch_throttled: true,
          corrupt_rejected: true, idat_rejected: true, atomic_abort: true, recovered: true });
      }
      (location.pathname === '/child' ? runChild() : runParent()).catch(error => {
        document.getElementById('result').textContent = JSON.stringify({ error: String(error), diagnostics: window.diags });
      });
    <\/script><img hidden src="/hold">`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dc334-'));
  try {
    const port = server.address().port;
    const argv = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-popup-blocking', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--no-first-run', '--dump-dom',
      '--user-data-dir=' + dataDir, `http://127.0.0.1:${port}/`
    ];
    let executable = process.platform === 'win32' ? 'chrome.exe' : '';
    if (process.platform !== 'win32') {
      const candidates = process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'google-chrome', 'chromium']
        : ['google-chrome', 'chromium', 'chromium-browser'];
      for (const name of candidates) {
        if (name.startsWith('/') && existsSync(name)) { executable = name; break; }
        const found = spawnSync('which', [name], { encoding: 'utf8' });
        if (found.status === 0) { executable = found.stdout.trim(); break; }
      }
    }
    assert.ok(executable, 'No Chromium browser executable was found');
    const result = await new Promise((resolve, reject) => {
      const chrome = spawn(executable, argv);
      let stdout = '';
      let stderr = '';
      const watchdog = setTimeout(() => { chrome.kill('SIGKILL'); reject(Error('browser-timeout')); }, 65000);
      chrome.stdout.on('data', chunk => { stdout += chunk; });
      chrome.stderr.on('data', chunk => { stderr += chunk; });
      chrome.on('error', error => { clearTimeout(watchdog); reject(error); });
      chrome.on('close', code => { clearTimeout(watchdog); resolve({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, result.stderr.slice(-2000));
    const match = result.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
    assert.ok(match, result.stdout.slice(-3000));
    const report = JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    assert.equal(report.error, undefined, JSON.stringify(report));
    assert.equal(report.cross_tab, true);
    assert.equal(report.warm_reads, 1);
    assert.equal(report.two_versions, true);
    assert.equal(report.stale_evicted, true);
    assert.equal(report.recovered, true);
    assert.equal(report.cutoff_exact, true);
    assert.equal(report.touch_throttled, true);
    assert.equal(report.corrupt_rejected, true);
    assert.equal(report.idat_rejected, true);
    assert.equal(report.atomic_abort, true);
    assert.equal(packRequests, 7,
      'initial, second version, corruption, recovery, bad IDAT, aborted import, recovery');
  } finally {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    rmSync(dataDir, { recursive: true, force: true });
  }
});