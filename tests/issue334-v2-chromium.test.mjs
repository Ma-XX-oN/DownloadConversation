import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

const source = readFileSync(
  new URL('../src/userscript/03-agent-lifecycle/03-favicon-cache-v2.js', import.meta.url), 'utf8'
) + readFileSync(
  new URL('../src/userscript/03-agent-lifecycle/03-favicon-cache-v2-part2.js', import.meta.url), 'utf8'
);

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const kind = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc(Buffer.concat([kind, data])));
  return Buffer.concat([size, kind, data, check]);
}

function png(frame) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, frame * 10, 130, 80, 255]))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const frames = Array.from({ length: 21 }, (_, i) => png(i).toString('base64'));

function pageHtml(isChild) {
  return `<!doctype html><meta charset="utf-8"><link id="stock" rel="icon"
    href="https://chatgpt.com/stock.svg"><pre id="result">RUNNING</pre>
    <script>
      ${source}
      const frameBytes = ${JSON.stringify(frames)};
      const frameBlobs = frameBytes.map(value => new Blob([
        Uint8Array.from(atob(value), c => c.charCodeAt(0))
      ], { type: 'image/png' }));
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const fail = message => { throw Error(message); };
      const verify = (condition, message) => { if (!condition) fail(message); };
      const URL1 = 'https://chatgpt.com/original.svg';
      faviconCacheV2Configure([{version:'1.11.8', update_every_ms:250},
        {version:'1.12.0',update_every_ms:250}]);
      window.calls = [];
      window.cacheWarnings = [];
      function logDiagnostic(level, name, details) {
        cacheWarnings.push({ level, name, details });
      }
      window.renderer = async (args, signal) => {
        calls.push(args);
        if (window.failCount) { window.failCount = 0; return frameBlobs.slice(0,20); }
        if (window.pauseRender) await window.pauseRender;
        if (signal.aborted) throw Error('aborted');
        return frameBlobs;
      };
      window.api = { open_favicon_dataset, faviconSequenceDatabase,
        faviconSequenceRead, faviconSequenceKey, faviconSequenceRequest,
        faviconSequenceTouch, faviconSequenceSweep };
      window.ready = true;
      async function runParent() {
        const child = window.open('/child', '_blank');
        verify(child !== null, 'popup unavailable');
        for(let i=0; i<100 && !child.ready; i++) await wait(50);
        verify(child.ready, 'child tab not ready');
        const key = await get_compatible_version_key('1.11.8-issue.334.999');
        verify(key === '1.11.8', 'numeric version resolution');
        const db = await faviconSequenceDatabase();
        const a = await open_favicon_dataset(key, window.renderer);
        const b = await child.api.open_favicon_dataset(key, child.renderer);
        verify(a && b, 'both dataset sessions open');
        let resume;
        window.pauseRender = new Promise(resolve => { resume = resolve; });
        const first = a.read_png(URL1, 'light', 0, 0, 0);
        for(let i=0;i<100 && calls.length===0;i++) await wait(20);
        verify(calls.length===1, 'first owner not selected');
        const waiting = b.read_png(URL1, 'light', 0, 0, 0);
        const identity = faviconSequenceKey(key, URL1, 'light', 0, 0);
        await wait(200);
        const pre = await faviconSequenceRequest(db.transaction('sequences','readonly')
          .objectStore('sequences').get(identity));
        verify(!pre, 'early ready marker leaked');
        verify(child.calls.length === 0, 'contender generated duplicate');
        verify(document.getElementById('stock').href === 'https://chatgpt.com/stock.svg',
          'stock href changed during pending');
        resume();
        verify((await first)?.type==='image/png', 'first frame failed');
        verify((await waiting)?.type==='image/png', 'waiting tab frame failed');
        verify(calls.length+child.calls.length === 1, 'duplicate render after lock');
        const meta = await faviconSequenceRequest(db.transaction('sequences','readonly')
          .objectStore('sequences').get(identity));
        verify(meta?.ready && meta?.count===21, 'no complete readiness');
        const keys = await faviconSequenceRequest(db.transaction('pngs','readonly')
          .objectStore('pngs').getAllKeys());
        verify(keys.length===21, 'not exactly 21 stored frames');
        const bytesBeforeWarm = calls.length;
        const warm = await a.read_png(URL1,'light',0,0,0);
        verify(warm instanceof Blob && calls.length===bytesBeforeWarm, 'warm frame regenerated');
        verify((await a.read_png(URL1,'light',0,0,15)) instanceof Blob, 'unrequested ready frame absent');
        verify(calls.length===1, 'warm index triggered generation');
        // A second version has independent rows without deleting the first.
        const other = await open_favicon_dataset('1.12.0', window.renderer);
        verify(other && (await other.read_png(URL1,'light',0,0,0)) instanceof Blob,
          'second compatible dataset unavailable');
        const otherId=faviconSequenceKey('1.12.0',URL1,'light',0,0);
        verify((await faviconSequenceRead(db,identity,0)) instanceof Blob &&
          (await faviconSequenceRead(db,otherId,0)) instanceof Blob,
          'version coexistence damaged');
        await other.close();
        window.pauseRender=null;
        const dark = await a.read_png(URL1,'dark',0,0,15);
        verify(dark instanceof Blob && calls.length===3, 'dark theme not separately generated');
        verify(calls[2].theme==='dark', 'wrong active theme');
        verify((await a.read_png(URL1,'dark',0,0,0)) instanceof Blob && calls.length===3,
          'new frame in existing dark sequence rerendered');
        window.failCount=1;
        const failId=faviconSequenceKey(key, URL1, 'light', 1, 3);
        const beforeWarning = cacheWarnings.length;
        const rejected=await a.read_png(URL1,'light',1,3,0);
        verify(rejected===null, 'bad generator output accepted');
        verify(!(await faviconSequenceRequest(db.transaction('sequences','readonly')
          .objectStore('sequences').get(failId))), 'failed generation published');
        const beforeCooling = calls.length+child.calls.length;
        verify((await a.read_png(URL1,'light',1,3,0))===null, 'local cooldown bypassed');
        verify((await b.read_png(URL1,'light',1,3,1))===null, 'cross-tab cooldown bypassed');
        // Twenty-five hundred milliseconds of two-tab 250ms pulse requests
        // must not turn a renderer capability failure into a busy retry.
        for (let beat=0; beat<10; beat++) {
          const tab=beat%2===0 ? a : b;
          verify((await tab.read_png(URL1,'light',1,3,beat%21))===null,
            'cooldown returned a frame during repeated heartbeat');
          await wait(255);
        }
        verify(calls.length+child.calls.length===beforeCooling, 'duplicate failed generation');
        verify(cacheWarnings.length===beforeWarning+1, 'failure warning repeated in cooldown');
        const failures = await faviconSequenceRequest(db.transaction('datasets','readonly')
          .objectStore('datasets').get(key));
        verify(failures.failed_sequences[failId]>Date.now(), 'cross-tab cooldown missing');
        const realDateNow=Date.now;
        try {
          Date.now=()=>realDateNow()+FAVICON_SEQUENCE_FAILURE_BACKOFF_MS+1;
          verify((await a.read_png(URL1,'light',1,3,0)) instanceof Blob,
            'retry after failure cooldown did not recover');
        } finally { Date.now=realDateNow; }
        // Abort during IndexedDB write: all 21 inserts are rolled back.
        const originalPut=IDBObjectStore.prototype.put;
        const abortId=faviconSequenceKey(key, URL1, 'light', 2, 4);
        let rejectedPut=false;
        IDBObjectStore.prototype.put=function(...args){
          if (!rejectedPut && this.name==='sequences' && args[0]?.id===abortId) {
            rejectedPut=true;
            throw Error('inject-write-abort');
          }
          return originalPut.apply(this,args);
        };
        try { verify(await a.read_png(URL1,'light',2,4,0)===null,'aborted import returned frame'); }
        finally { IDBObjectStore.prototype.put=originalPut; }
        verify(rejectedPut, 'atomic fail injection did not trigger');
        verify(!(await faviconSequenceRequest(db.transaction('sequences','readonly')
          .objectStore('sequences').get(abortId))), 'partial ready');
        const orphan=await faviconSequenceRequest(db.transaction('pngs','readonly')
          .objectStore('pngs').get([abortId,0]));
        verify(!orphan,'partial PNG committed');
        verify((await a.read_png(URL1,'light',2,4,0)) instanceof Blob,'recovery after abort');
        // Navigation/close of a generator must free the exact sequence lock.
        let canceled;
        child.pauseRender=new Promise(resolve => { canceled=resolve; });
        const crashKey=faviconSequenceKey(key, URL1, 'light', 3, 5);
        const doomed=b.read_png(URL1,'light',3,5,0);
        for(let i=0;i<100 && child.calls.length===0;i++)await wait(20);
        verify(child.calls.length===1,'aborting owner not entered');
        const saved=await b.close();
        verify((await doomed)===null,'aborted generator leaked frame');
        const takeover=await a.read_png(URL1,'light',3,5,0);
        verify(takeover instanceof Blob && calls.at(-1).base_type===3,'claim takeover failed');
        canceled();
        verify(!(await faviconSequenceRead(db,crashKey,21)), 'out-of-range pulse used');
        // Real navigation releases a stalled renderer's browser-owned Web Lock.
        const navSession=await child.api.open_favicon_dataset(key,child.renderer);
        verify(navSession!==null,'navigation owner cannot reopen session');
        child.pauseRender=new Promise(()=>{});
        const beforeNavigation=child.calls.length;
        void navSession.read_png(URL1,'light',3,6,0);
        for(let i=0;i<100 && child.calls.length===beforeNavigation;i++)await wait(20);
        verify(child.calls.length===beforeNavigation+1,'navigation claim not held');
        child.location.href='/gone';
        const navigationReplacement=await a.read_png(URL1,'light',3,6,0);
        verify(navigationReplacement instanceof Blob,'navigation did not release generation lock');
        // Global touch throttle: 599999ms skips; 600000ms updates once.
        const initial=await faviconSequenceRequest(db.transaction('datasets','readonly')
          .objectStore('datasets').get(key));
        const realNow=Date.now;
        try {
          Date.now=()=>initial.last_used+599999;
          await faviconSequenceTouch(db,key);
          const before=await faviconSequenceRequest(db.transaction('datasets','readonly')
            .objectStore('datasets').get(key));
          verify(before.last_used===initial.last_used,'premature last_used write');
          Date.now=()=>initial.last_used+600000;
          await faviconSequenceTouch(db,key);
          const boundary=await faviconSequenceRequest(db.transaction('datasets','readonly')
            .objectStore('datasets').get(key));
          verify(boundary.last_used===initial.last_used+600000,'touch boundary missed');
        } finally { Date.now=realNow; }
        // Expiration cannot evict open shared readers; strict cutoff after close.
        const tx=db.transaction('datasets','readwrite');
        const record=await faviconSequenceRequest(tx.objectStore('datasets').get(key));
        record.last_used=Date.now()-600001;
        tx.objectStore('datasets').put(record);
        await wait(30);
        await faviconSequenceSweep(db);
        verify((await faviconSequenceRead(db,identity,0)) instanceof Blob,'active cache evicted');
        await a.close();
        await faviconSequenceSweep(db);
        verify(!(await faviconSequenceRead(db,identity,0)),'stale cache not evicted');
        child.close();
        document.getElementById('result').textContent=JSON.stringify({
          winner:true, atomic21:true, no_duplicate:true, theme:true,
          no_eager:true, recovery:true, failure_cooldown:true, aborted_transaction:true,
          takeover:true, navigation:true, warm:true, strict_ttl:true, throttle:true, versions:true });
      }
      ${isChild ? '' : `runParent().catch(error => {
        document.getElementById('result').textContent=JSON.stringify({error:String(error)});
      });`}
    <\/script><img hidden src="/hold">`;
}

test('V2: Chromium two tabs elect one 21-frame producer, commit atomically and recover',
  { timeout: 55000 }, async () => {
    const server = createServer((req, res) => {
      if (req.url === '/gone') {
        res.writeHead(200, {'Content-Type':'text/html'}); res.end('<p>navigated</p>'); return;
      }
      if (req.url === '/hold') {
        setTimeout(() => { if (!res.writableEnded) { res.writeHead(204); res.end(); } }, 18000);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageHtml(req.url === '/child'));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'dc334-v2-'));
    try {
      let exe = process.platform === 'win32' ? 'chrome.exe' : '';
      if (!exe) {
        for (const cmd of ['google-chrome','chromium','chromium-browser']) {
          const r = spawnSync('which', [cmd], { encoding: 'utf8' });
          if (r.status === 0) { exe = r.stdout.trim(); break; }
        }
      }
      assert.ok(exe, 'Chromium not installed');
      const command = ['--headless=new','--no-sandbox','--disable-gpu',
        '--disable-dev-shm-usage','--disable-popup-blocking',
        '--disable-background-timer-throttling','--disable-renderer-backgrounding',
        '--no-first-run','--dump-dom','--user-data-dir='+tmp,
        `http://127.0.0.1:${server.address().port}/`];
      const output = await new Promise((resolve, reject) => {
        const p = spawn(exe, command);
        let stdout='', stderr='';
        const watchdog = setTimeout(() => { p.kill('SIGKILL'); reject(Error('chromium-timeout')); }, 45000);
        p.stdout.on('data', data => { stdout+=data; });
        p.stderr.on('data', data => { stderr+=data; });
        p.on('error', e => { clearTimeout(watchdog); reject(e); });
        p.on('close', code => { clearTimeout(watchdog); resolve({code,stdout,stderr}); });
      });
      assert.equal(output.code, 0, output.stderr.slice(-2000));
      const match=output.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
      assert.ok(match, output.stdout.slice(-1000));
      const result=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
      assert.equal(result.error, undefined, JSON.stringify(result));
      for (const name of ['winner','atomic21','no_duplicate','theme','no_eager',
        'recovery','failure_cooldown','aborted_transaction','takeover','warm','strict_ttl',
        'throttle','versions','navigation']) {
        assert.equal(result[name],true,name);
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      rmSync(tmp, { recursive:true, force:true });
    }
  });