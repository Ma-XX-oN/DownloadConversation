import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Exact #333 renderer and #334 cache, exercised through #335 heartbeat.
const read = part => readFileSync(new URL(part, import.meta.url), 'utf8');
const renderer = read('../src/favicon/browser-sequence.mjs').replace(/^export /gm, '');
const provider = read('../src/userscript/03-agent-lifecycle/03-favicon-cache-v2.js')
  + read('../src/userscript/03-agent-lifecycle/03-favicon-cache-v2-part2.js');
const adapter = read('../src/userscript/03-agent-lifecycle/02-favicon-v2-adapter.js');
const theme = read('../src/userscript/03-agent-lifecycle/02-favicon-theme.js');
const consumer = read('../src/userscript/03-agent-lifecycle/02-favicon-cached-lookup.js');
const opaque = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">'
  + '<rect width="48" height="48" fill="#ffffff"/></svg>';
const script = [
  'const faviconV2RenderSource = (() => {',
  renderer, 'return {renderFaviconPulseSequence}; })();',
  provider,adapter,
  "const VERSION = '1.11.10-issue.332.9';",
  'const agentFaviconOriginalSources = new Map();',
  'let agentFaviconRenderGeneration = 0;',
  'let agentStopwatchState = null;',
  'window.warnings = [];',
  'function logDiagnostic(level,name,details) {warnings.push({level,name,details});}',
  'function errorMessage(error) {return String(error?.message || error);}',
  theme,consumer,
  'window.renderCalls = 0;',
  'const actualRenderer = faviconV2RenderSequenceAdapter;',
  'faviconV2RenderSequenceAdapter = async function (...args) {',
  '  window.renderCalls++; return actualRenderer(...args);',
  '};',
  'const wait = ms => new Promise(resolve => setTimeout(resolve,ms));',
  'async function run() {',
  '  const stock = document.getElementById("stock");',
  '  const original = stock.href;',
  '  const start = performance.now();',
  '  const initial = await agentFaviconRenderState("processing");',
  '  if (initial) throw Error("unsupported favicon falsely accepted");',
  '  await wait(2450);',
  '  const attempts = window.renderCalls;',
  '  const db = await faviconSequenceDatabase();',
  '  const rows = await faviconSequenceRequest(db.transaction(',
  '    "sequences","readonly").objectStore("sequences").getAllKeys());',
  '  const result = {attempts,durationMs:performance.now()-start,',
  '    originalPreserved:stock.href===original,readyCount:rows.length,',
  '    warnings:window.warnings.length};',
  '  agentFaviconDispose();',
  '  document.getElementById("result").textContent = JSON.stringify(result);',
  '}',
  'run().catch(error => {',
  '  document.getElementById("result").textContent = JSON.stringify({',
  '    error:String(error),stack:error?.stack,attempts:window.renderCalls});',
  '});'
].join('\n');
function page() {
  return '<!doctype html><meta charset="utf-8">'
    + '<link id="stock" rel="icon" href="/opaque.svg" type="image/svg+xml">'
    + '<pre id="result">RUNNING</pre><script>'
    + script.replace(/<\/script/gi,'<\\/script')
    + '</script><img hidden src="/hold">';
}

test('DC #334: permanent renderer failure backs off across 250ms real heartbeats',
  {timeout: 35000}, async () => {
    const server = createServer((req,res) => {
      if (req.url === '/opaque.svg') {
        res.writeHead(200, {'Content-Type':'image/svg+xml'}); res.end(opaque);
      } else if (req.url === '/hold') {
        setTimeout(() => {if(!res.writableEnded) {res.writeHead(204);res.end();}}, 7000);
      } else {
        res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'}); res.end(page());
      }
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1'));
    const dir = mkdtempSync(path.join(os.tmpdir(),'dc334-retry-backoff-'));
    try {
      const chrome = ['google-chrome','chromium','chromium-browser']
        .map(name=>spawnSync('which',[name],{encoding:'utf8'}))
        .find(found=>found.status===0)?.stdout.trim();
      assert.ok(chrome,'Chromium executable required');
      const flags = ['--headless=new','--no-sandbox','--disable-gpu',
        '--disable-dev-shm-usage','--disable-popup-blocking',
        '--disable-background-timer-throttling','--disable-renderer-backgrounding',
        '--no-first-run','--dump-dom','--user-data-dir='+dir,
        'http://127.0.0.1:'+server.address().port+'/'];
      const output = await new Promise((resolve,reject) => {
        const child = spawn(chrome,flags);
        let stdout = '', stderr = '';
        const watchdog=setTimeout(()=>{
          child.kill('SIGKILL');reject(Error('Chromium test exceeded deadline'));
        },26000);
        child.stdout.on('data',data=>{stdout+=data;});
        child.stderr.on('data',data=>{stderr+=data;});
        child.on('error',error=>{clearTimeout(watchdog);reject(error);});
        child.on('close',exit=>{
          clearTimeout(watchdog);resolve({exit,stdout,stderr});
        });
      });
      assert.equal(output.exit,0,output.stderr.slice(-1800));
      const match=output.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
      assert.ok(match,'Chromium fixture did not return a result');
      const data=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
      assert.equal(data.error,undefined,JSON.stringify(data));
      assert.ok(data.attempts>=1,'source failure not reproduced');
      assert.ok(data.attempts<=2,
        'unbounded 250ms renderer retries on unsupported stock URL: '+JSON.stringify(data));
      assert.equal(data.readyCount,0,'failed renders must never publish ready');
      assert.equal(data.originalPreserved,true,'failed renders must retain stock icon');
      console.log('DC334_NEGATIVE_CACHE_REAL_CHROMIUM='+JSON.stringify(data));
    } finally {
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
      rmSync(dir,{recursive:true,force:true});
    }
  });
