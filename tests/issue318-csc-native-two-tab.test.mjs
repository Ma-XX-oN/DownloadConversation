import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const schemaSource = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-schema.js',
  import.meta.url), 'utf8');
const singletonSource = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-singleton.js',
  import.meta.url), 'utf8');

const shared=readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-shared-settings.js',
  import.meta.url),'utf8');
const control=schemaSource+readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-control-plane.js',
  import.meta.url),'utf8')+singletonSource;
test('native Chromium: shared registered controls across two browser tabs',
  {timeout:55000},async()=>{
    const html=['<!doctype html><meta charset="utf-8">',
      '<pre id="result">PENDING</pre><script>',
      shared,control,"const VERSION='1.11.15-issue.318.7';\nconst delay=t=>new Promise(done=>setTimeout(done,t));\nconst opts=(mode,binary=false)=>({schema:1,mode,binary,\n  cross_origin:false,auth_headers:false,all:false});\nconst worker=()=>({pause:async()=>{},resume:async()=>{},\n  configure:async r=>({type:'csc-comm-configured',schema:r.schema,\n    request_id:r.request_id}),\n  provisionTarget:{postMessage(){}},\n  awaitKey:async token=>({type:'csc-comm-key-ready',token})});\nwindow.probe={ready:true,make:()=>cscControlSharedStore(),opts,worker,\n  control:cscCaptureControlPlane({store:cscControlSharedStore(),\n    origin:location.origin,version:VERSION})};\nasync function waitFor(fn){\n  for(let n=0;n<125;n++){\n    if(await fn())return;\n    await delay(75);\n  }\n  throw Error('cross-tab convergence timeout');\n}\nasync function scenario(){\n  const child=window.open(location.href+'#child','_blank');\n  if(!child)throw Error('second physical tab unavailable');\n  await waitFor(()=>child.probe?.ready);\n  const a=window.probe.control,b=child.probe.control;\n  await Promise.all([a.init(),b.init()]);\n  await Promise.all([a.bindWorker(worker()),b.bindWorker(child.probe.worker())]);\n  if(!a.snapshot().settings_applied||!b.snapshot().settings_applied)\n    throw Error('default safe Worker settings not applied');\n  const expanded=opts('everything',true);\n  await a.setOptions(expanded,true);\n  await waitFor(()=>b.snapshot().settings.mode==='everything');\n  if(b.snapshot().settings_applied!==false||\n     b.snapshot().settings_state!=='pending')\n    throw Error('remote sensitive policy silently enabled');\n  await b.setOptions(expanded,true);\n  await waitFor(()=>b.snapshot().settings_applied);\n  const store=cscControlSharedStore();\n  const safe=opts('replay-essentials');\n  await Promise.all([a.setOptions(safe,false),b.setOptions(expanded,true)]);\n  await waitFor(async()=>{\n    const value=await store.read();\n    return JSON.stringify(value)===JSON.stringify(a.snapshot().settings)&&\n      JSON.stringify(value)===JSON.stringify(b.snapshot().settings);\n  });\n  const value=await store.read();\n  const concurrentAgreement=JSON.stringify(value)===\n    JSON.stringify(a.snapshot().settings)&&\n    JSON.stringify(value)===JSON.stringify(b.snapshot().settings);\n  await a.setOptions(safe,false);\n  await waitFor(()=>b.snapshot().settings.mode==='replay-essentials');\n  const malicious=new BroadcastChannel('dc-csc-settings-v1');\n  malicious.postMessage({type:'settings-committed-v1',\n    key:'dc-csc-capture-options-v1',owner:'not-a-control-tab',\n    options:opts('everything',true),key_bytes:[1,2,3]});\n  await delay(180);\n  malicious.close();\n  const forgedNoticeIgnored=a.snapshot().settings.mode===\n    'replay-essentials'&&b.snapshot().settings.mode===\n    'replay-essentials'&&(await store.read()).mode===\n    'replay-essentials';\n  if(!forgedNoticeIgnored)throw Error('forged BC payload applied');\n  b.dispose();child.close();\n  const reloaded=window.open(location.href+'#reloaded','_blank');\n  if(!reloaded)throw Error('reloaded physical tab unavailable');\n  await waitFor(()=>reloaded.probe?.ready);\n  await reloaded.probe.control.init();\n  const restored=reloaded.probe.control.snapshot().settings;\n  const result={nativeChrome:true,twoTabs:true,\n    sameOrigin:reloaded.location.origin===location.origin,\n    hasIndexedDb:typeof indexedDB==='object',\n    hasWebLocks:Boolean(navigator.locks),\n    hasBroadcastChannel:typeof BroadcastChannel==='function',\n    remoteSensitivePending:true,reauthorized:true,\n    concurrentAgreement,forgedNoticeIgnored,\n    reloadPersisted:restored.mode==='replay-essentials'&&!restored.binary,\n    settingsSchema:restored.schema,noRawKeyBytes:true};\n  reloaded.probe.control.dispose();reloaded.close();\n  a.dispose();store.dispose();\n  document.getElementById('result').textContent=JSON.stringify(result);\n}\nif(!location.hash)scenario().catch(e=>{\n  document.getElementById('result').textContent=JSON.stringify({error:String(e)});\n});",
      '</script><img hidden src="/hold">'].join('\n');
    const server=createServer((request,response)=>{
      if(request.url==='/hold'){
        setTimeout(()=>{response.writeHead(204);response.end();},11000);
        return;
      }
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      response.end(html);
    });
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const dir=mkdtempSync(path.join(os.tmpdir(),'dc318-two-tab-'));
    try{
      const chrome=['google-chrome','chromium','chromium-browser']
        .find(bin=>spawnSync('which',[bin]).status===0);
      assert.ok(chrome,'Chromium required');
      const child=spawn(chrome,['--headless=new','--no-sandbox',
        '--disable-gpu','--disable-dev-shm-usage','--disable-popup-blocking',
        '--disable-background-timer-throttling','--no-first-run',
        '--dump-dom','--user-data-dir='+dir,
        'http://127.0.0.1:'+server.address().port+'/']);
      const result=await new Promise((resolve,reject)=>{
        let stdout='',stderr='';
        const timer=setTimeout(()=>{
          child.kill('SIGKILL');reject(Error('native two-tab timeout'));
        },40000);
        child.stdout.on('data',chunk=>{stdout+=chunk;});
        child.stderr.on('data',chunk=>{stderr+=chunk;});
        child.on('error',error=>{clearTimeout(timer);reject(error);});
        child.on('close',code=>{
          clearTimeout(timer);resolve({code,stdout,stderr});
        });
      });
      assert.equal(result.code,0,result.stderr.slice(-1200));
      const match=result.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
      assert.ok(match,'missing rendered result');
      const obj=JSON.parse(match[1].replace(/&quot;/g,'"')
        .replace(/&amp;/g,'&'));
      assert.equal(obj.error,undefined,obj.error);
      for(const name of ['nativeChrome','twoTabs','sameOrigin',
        'hasIndexedDb','hasWebLocks','hasBroadcastChannel',
        'remoteSensitivePending','reauthorized','concurrentAgreement',
        'forgedNoticeIgnored','reloadPersisted','noRawKeyBytes']){
        assert.equal(obj[name],true,name+': '+JSON.stringify(obj));
      }
      assert.equal(obj.settingsSchema,1);
    }finally{
      await new Promise(done=>server.close(done));
      rmSync(dir,{recursive:true,force:true});
    }
  });
