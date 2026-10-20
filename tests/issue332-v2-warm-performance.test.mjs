import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 24-second real-timer Chromium performance, actual #333/#334/#335 sources.
// Unlike authenticated chatgpt.com, this is a controlled same-origin fixture.
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const moduleSource = source('../src/favicon/browser-sequence.mjs');
const scripts = [
  'const faviconV2RenderSource = (() => {\n'
    + moduleSource.replace(/^export /gm, '')
    + '\nreturn {renderFaviconPulseSequence};\n})();\n',
  source('../src/userscript/03-agent-lifecycle/03-favicon-cache-v2.js'),
  source('../src/userscript/03-agent-lifecycle/03-favicon-cache-v2-part2.js'),
  source('../src/userscript/03-agent-lifecycle/02-favicon-v2-adapter.js'),
  'const VERSION = ' + JSON.stringify(headerVersion) + ';\n'
    + 'const agentFaviconOriginalSources = new Map();\n'
    + 'let agentFaviconRenderGeneration = 0;\n'
    + 'let agentStopwatchState = null;\n'
    + 'function logDiagnostic(level,key,details){'
    + ' (window.diagnostics ||= []).push({level,key,details}); }\n'
    + 'function errorMessage(error){return String(error?.message || error);}\n',
  source('../src/userscript/03-agent-lifecycle/02-favicon-theme.js'),
  source('../src/userscript/03-agent-lifecycle/02-favicon-cached-lookup.js')
].join('\n');
const faviconSvg = source('../assets/favicons/v1/originals/chatgpt-favicon-l4nq08hd.svg');
const headerVersion = /^\/\/\s*@version\s+(\S+)\s*$/m
  .exec(source('../src/userscript-header.js'))?.[1];
assert.ok(headerVersion, 'authoritative userscript version required');

async function benchmark() {
  const link = document.getElementById('stock');
  const original = {href: link.href, media: link.media, type: link.type,
    sizes: link.sizes.value};
  const metrics = {encodes: 0, decodes: 0, decodeMs: 0, transactions: 0,
    idbGets: 0, loadCallbacks: 0, tickCallbacks: 0, tickSynchronousMs: 0};
  link.addEventListener('load', () => {metrics.loadCallbacks++;});
  const originalBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (...args) {
    metrics.encodes++;
    return originalBlob.apply(this, args);
  };
  const originalBitmap = window.createImageBitmap;
  window.createImageBitmap = async function (...args) {
    const before = performance.now();
    try {return await originalBitmap.apply(this, args);}
    finally {
      metrics.decodes++;
      metrics.decodeMs += performance.now() - before;
    }
  };
  const originalTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    metrics.transactions++;
    return originalTransaction.apply(this, args);
  };
  const originalGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (...args) {
    metrics.idbGets++;
    return originalGet.apply(this, args);
  };
  let longestTaskMs = 0, observedLongTasks = 0;
  const observer = typeof PerformanceObserver === 'function'
    ? new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        observedLongTasks++;
        longestTaskMs = Math.max(longestTaskMs, entry.duration);
      }
    }) : null;
  try {observer?.observe({entryTypes: ['longtask']});}
  catch {observer?.disconnect();}
  const originalHeartbeat = agentFaviconPulseHeartbeat;
  agentFaviconPulseHeartbeat = function () {
    const start = performance.now();
    metrics.tickCallbacks++;
    try {return originalHeartbeat();}
    finally {metrics.tickSynchronousMs += performance.now()-start;}
  };
  const take = () => ({...metrics});
  let sampleTimer, previous = performance.now(), maxGapMs = 0, samples = 0;
  sampleTimer = setInterval(() => {
    const now = performance.now();
    maxGapMs = Math.max(maxGapMs, now - previous);
    previous = now;
    samples++;
  }, 10);
  try {
    const coldStart = performance.now();
    const selected = await agentFaviconRenderState('processing');
    if (!selected) throw Error('real consumer could not display initial favicon');
    for (let index = 0; index <= 20; index++) {
      const pair = await get_favicon('1.11.8', 0, 0, index * 250);
      if (!pair?.length) throw Error('failed to preload pulse frame '+index);
    }
    const coldMs = performance.now() - coldStart;
    const cold = take();
    if (cold.encodes !== 21) throw Error('expected exactly 21 cold encodes');
    if (agentFaviconObjectUrls.size !== 21)
      throw Error('expected 21 tab-local warmed PNG URLs');
    const warmStart = performance.now();
    await new Promise(resolve => setTimeout(resolve, 24000));
    const warmElapsedMs = performance.now() - warmStart;
    const after = take();
    const delta = Object.fromEntries(Object.keys(cold)
      .map(key => [key, after[key] - cold[key]]));
    const presentation = {href: link.href, media: link.media, type: link.type,
      sizes: link.sizes.value};
    const result = {status: 'PASS', version: VERSION, coldMs, warmElapsedMs,
      cold, warmDelta: delta, eventLoop: {samples, maxGapMs,
        observedLongTasks, longestTaskMs},
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      objectUrls: agentFaviconObjectUrls.size,
      originalAttributesUnchanged: presentation.media === original.media
        && presentation.type === original.type
        && presentation.sizes === original.sizes,
      returnedToOriginal: false,
      errors: window.diagnostics ?? []};
    agentFaviconDispose();
    result.returnedToOriginal = link.href === original.href;
    return result;
  } finally {
    clearInterval(sampleTimer);
    observer?.disconnect();
  }
}

function html() {
  const script = scripts + '\nwindow.runBenchmark = (' + benchmark.toString() + ');';
  return '<!doctype html><meta charset="utf-8">'
    + '<link id="stock" rel="icon" media="" type="image/svg+xml"'
    + ' sizes="any" href="/favicon.svg"><div id="ready">READY</div>'
    + '<script>' + script.replace(/<\/script/gi, '<\\/script') + '</script>';
}

async function launch(address) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dc332-24s-'));
  const executable = ['google-chrome', 'chromium', 'chromium-browser']
    .map(name => spawnSync('which', [name], {encoding: 'utf8'}))
    .find(result => result.status === 0)?.stdout.trim();
  assert.ok(executable, 'Chromium executable required');
  const processChrome = spawn(executable, ['--headless=new', '--no-sandbox',
    '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--remote-debugging-port=0', '--user-data-dir='+dir, 'about:blank'],
    {stdio: 'ignore'});
  let socket;
  try {
    let port;
    for (let i=0; i<100; i++) {
      const name = path.join(dir, 'DevToolsActivePort');
      if (existsSync(name)) {port = Number(readFileSync(name, 'utf8').split('\n')[0]); break;}
      if (processChrome.exitCode !== null) throw Error('Chromium exited');
      await new Promise(resolve=>setTimeout(resolve, 80));
    }
    assert.ok(port, 'Chromium CDP startup failed');
    const tabs = await fetch('http://127.0.0.1:'+port+'/json/list').then(x=>x.json());
    socket = new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
      socket.onopen=resolve; socket.onerror=reject;
    });
    let serial=0;
    const pending = new Map();
    socket.onmessage=event=>{
      const message=JSON.parse(event.data);
      const resolve=pending.get(message.id);
      if (!resolve) return;
      pending.delete(message.id);
      resolve(message);
    };
    const send = (method,params={}) => new Promise((resolve,reject)=>{
      const id=++serial;
      pending.set(id,message => {
        if(message.error)reject(Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({id,method,params}));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate',{url:address});
    const ready=await send('Runtime.evaluate',{
      expression:'new Promise(resolve=>{if(document.readyState==="complete")'
        +'resolve(true);else window.addEventListener("load",()=>resolve(true),{once:true})})',
      returnByValue:true,awaitPromise:true
    });
    assert.equal(ready.result.value,true);
    return {
      send,
      async evaluate(expression) {
        const reply = await send('Runtime.evaluate', {
          expression, awaitPromise: true, returnByValue: true
        });
        if (reply.exceptionDetails) throw Error(JSON.stringify(reply.exceptionDetails));
        return reply.result.value;
      },
      async run() {
        const done=await send('Runtime.evaluate',{
          expression:'runBenchmark()',awaitPromise:true,returnByValue:true
        });
        if(done.exceptionDetails)throw Error(JSON.stringify(done.exceptionDetails));
        return done.result.value;
      },
      async close() {
        socket.close();
        processChrome.kill('SIGKILL');
        await new Promise(resolve=>setTimeout(resolve,70));
        rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
      }
    };
  } catch(error) {
    socket?.close();
    processChrome.kill('SIGKILL');
    rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    throw error;
  }
}

test('actual V2 24-second warm pulse avoids encoding, decoding and IndexedDB reads',
  {timeout: 65000}, async () => {
    const server=createServer((req,res)=>{
      if(req.url==='/favicon.svg') {
        res.writeHead(200,{'Content-Type':'image/svg+xml'});
        res.end(faviconSvg);
        return;
      }
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end(html());
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let client;
    try {
      client=await launch('http://127.0.0.1:'+server.address().port+'/');
      const result=await client.run();
      assert.equal(result.status,'PASS',JSON.stringify(result));
      assert.equal(result.cold.encodes,21);
      assert.equal(result.warmDelta.encodes,0);
      assert.equal(result.warmDelta.decodes,0);
      assert.equal(result.warmDelta.idbGets,0);
      assert.ok(result.warmDelta.tickCallbacks>=80,result.warmDelta.tickCallbacks);
      assert.equal(result.originalAttributesUnchanged,true);
      assert.equal(result.returnedToOriginal,true);
      console.log('DC332_24S_REAL_CHROMIUM='+JSON.stringify(result));
    } finally {
      await client?.close();
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
    }
  });

test('actual provider cache consumer: CSS theme flip reuses exact original URL',
  {timeout:45000}, async () => {
    const server=createServer((req,res)=>{
      if(req.url==='/favicon.svg') {
        res.writeHead(200,{'Content-Type':'image/svg+xml'});
        res.end(faviconSvg);
        return;
      }
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end(html());
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let client;
    try {
      client=await launch('http://127.0.0.1:'+server.address().port+'/');
      const scheme = value => client.send('Emulation.setEmulatedMedia',
        {features:[{name:'prefers-color-scheme',value}]});
      await scheme('light');
      await client.evaluate('(() => {'
        + 'window.renderEncodes=0;'
        + 'const original=HTMLCanvasElement.prototype.toBlob;'
        + 'HTMLCanvasElement.prototype.toBlob=function(...args){'
        + 'window.renderEncodes++;return original.apply(this,args)};'
        + 'return true;})()');
      assert.equal(await client.evaluate('agentFaviconRenderState("processing")'),true);
      const light=await client.evaluate('(async()=>{'
        + 'const db=await faviconSequenceDatabase();'
        + 'const keys=await faviconSequenceRequest('
        + 'db.transaction("sequences","readonly").objectStore("sequences").getAllKeys());'
        + 'return {keys,encodes:window.renderEncodes,'
        + 'original:agentFaviconOriginalSources.get(document.getElementById("stock"))};'
        + '})()');
      assert.equal(light.keys.length,1);
      assert.equal(JSON.parse(light.keys[0])[2],'light');
      assert.equal(light.encodes,21);
      await scheme('dark');
      const dark=await client.evaluate('(async()=>{'
        + 'const until=performance.now()+12000;'
        + 'let keys=[];let href="";'
        + 'while(performance.now()<until){'
        + 'const db=await faviconSequenceDatabase();'
        + 'keys=await faviconSequenceRequest('
        + 'db.transaction("sequences","readonly").objectStore("sequences").getAllKeys());'
        + 'href=document.getElementById("stock").href;'
        + 'if(keys.length===2 && href.startsWith("blob:")) break;'
        + 'await new Promise(done=>setTimeout(done,50));}'
        + 'return {keys,href,encodes:window.renderEncodes,theme:agentFaviconCurrentTheme(),'
        + 'original:agentFaviconOriginalSources.get(document.getElementById("stock"))};'
        + '})()');
      assert.equal(dark.theme,'dark');
      assert.equal(dark.keys.length,2,JSON.stringify(dark));
      assert.deepEqual(dark.keys.map(key=>JSON.parse(key)[2]).sort(),['dark','light']);
      assert.equal(dark.original,light.original);
      assert.equal(dark.encodes,42);
      const pixels=await client.evaluate('(async()=>{'
        + 'const db=await faviconSequenceDatabase();'
        + 'const keys=await faviconSequenceRequest('
        + 'db.transaction("sequences","readonly").objectStore("sequences").getAllKeys());'
        + 'const out=[];'
        + 'for(const key of keys){const row=await faviconSequenceRequest('
        + 'db.transaction("pngs","readonly").objectStore("pngs").get([key,0]));'
        + 'const bytes=await row.blob.arrayBuffer();'
        + 'const hash=await crypto.subtle.digest("SHA-256",bytes);'
        + 'out.push({theme:JSON.parse(key)[2],'
        + 'hash:Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,"0")).join("")});}'
        + 'return out;})()');
      assert.notEqual(pixels[0].hash,pixels[1].hash,
        'light/dark must produce distinct original SVG raster pixels');
      await scheme('light');
      const back=await client.evaluate('(async()=>{'
        + 'const until=performance.now()+5000;'
        + 'while(performance.now()<until){'
        + 'if(agentFaviconCurrentTheme()==="light" &&'
        + 'document.getElementById("stock").href.startsWith("blob:")) break;'
        + 'await new Promise(done=>setTimeout(done,40));}'
        + 'return {theme:agentFaviconCurrentTheme(),encodes:window.renderEncodes};})()');
      assert.equal(back.theme,'light');
      assert.equal(back.encodes,42,'cached light sequence must not regenerate');
      console.log('DC332_REAL_THEME_FLIP='+JSON.stringify({
        light, dark, hashes:pixels, back, distinctGenerationKeys:2}));
    } finally {
      await client?.close();
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
    }
  });
