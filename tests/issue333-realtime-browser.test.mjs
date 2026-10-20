import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=(ms,message)=>new Promise((_,reject)=>{
  const timeout=setTimeout(()=>reject(new Error(message)),ms);
  timeout.unref();
});

async function runSequence(payload){
  const url=URL.createObjectURL(new Blob([payload.module],
    {type:'text/javascript'}));
  let provider;
  try { provider=await import(url); }
  finally { URL.revokeObjectURL(url); }
  const source='data:image/webp;base64,'+payload.webp;
  const theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  const ticks=[];
  let last=performance.now(),maxGapMs=0,encodes=0;
  const original=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,...args){
    encodes++;
    return original.call(this,callback,...args);
  };
  const interval=setInterval(()=>{
    const now=performance.now();
    maxGapMs=Math.max(maxGapMs,now-last);
    last=now;
    ticks.push(now);
  },0);
  const started=performance.now();
  try {
    const sequence=await provider.renderFaviconPulseSequence({
      originalUrl:source,theme,base:'processing',progressStep:3
    });
    const invalidSource=await provider.renderFaviconPulseSequence({
      originalUrl:'data:image/webp;base64,YWJj',theme,
      base:'processing',progressStep:3
    }).then(()=> 'UNEXPECTED_SUCCESS',error=>error.name);
    const oversized='data:image/svg+xml;base64,'+
      btoa('<svg xmlns="http://www.w3.org/2000/svg" width="513" height="1"></svg>');
    const oversizedSource=await provider.renderFaviconPulseSequence({
      originalUrl:oversized,theme,base:'processing',progressStep:3
    }).then(()=> 'UNEXPECTED_SUCCESS',error=>error.name);
    const wrongTheme=await provider.renderFaviconPulseSequence({
      originalUrl:source,theme:'dark',base:'processing',progressStep:3
    }).then(()=> 'UNEXPECTED_SUCCESS',error=>error.name);
    return {theme,frames:sequence.frames.length,encodes,
      invalidSource,oversizedSource,wrongTheme,
      width:sequence.width,height:sequence.height,
      elapsedMs:performance.now()-started,ticks:ticks.length,maxGapMs};
  } finally {
    clearInterval(interval);
    HTMLCanvasElement.prototype.toBlob=original;
  }
}

/** Terminate an attempted browser before retrying with a fresh profile. */
async function stopChrome(child) {
  if(!child)return;
  const exited=(child.exitCode!==null || child.signalCode!==null) ?
    Promise.resolve() : new Promise(resolve=>child.once('exit',resolve));
  child.kill('SIGTERM');
  await Promise.race([exited,sleep(1500)]);
  if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');
  await Promise.race([exited,sleep(1500)]);
}

/** A failed CDP startup is retried; renderer failures never are. */
async function launchChrome(chrome,temp) {
  const diagnostics=[];
  for(let attempt=1;attempt<=3;attempt++){
    const profile=join(temp,'chrome-profile-'+attempt);
    const child=spawn(chrome,[
      '--headless=new','--no-sandbox','--disable-dev-shm-usage',
      '--disable-gpu','--disable-background-networking','--no-first-run',
      '--force-prefers-color-scheme=light',
      '--remote-allow-origins=*','--remote-debugging-port=0',
      '--user-data-dir='+profile,'about:blank'
    ],{stdio:['ignore','ignore','pipe']});
    let stderr='',spawnError=null,socket;
    child.on('error',error=>{spawnError=error;});
    child.stderr?.on('data',chunk=>{
      stderr=(stderr+chunk.toString('utf8')).slice(-4096);
    });
    try {
      let pages=null;
      for(let probe=0;probe<120;probe++){
        const portPath=join(profile,'DevToolsActivePort');
        if(spawnError || child.exitCode!==null || child.signalCode!==null)break;
        if(existsSync(portPath)){
          const port=readFileSync(portPath,'utf8').split('\n')[0].trim();
          if(/^\d+$/.test(port)){
            try {
              const response=await fetch('http://127.0.0.1:'+port+'/json/list',
                {signal:AbortSignal.timeout(1000)});
              if(response.ok)pages=await response.json();
            } catch { /* Chrome may not be listening yet. */ }
            if(pages?.some(page=>page.type==='page' &&
              page.webSocketDebuggerUrl))break;
          }
        }
        await sleep(100);
      }
      const page=pages?.find(entry=>entry.type==='page' &&
        entry.webSocketDebuggerUrl);
      if(!page)throw new Error('DevToolsActivePort or CDP page not ready');
      socket=new WebSocket(page.webSocketDebuggerUrl);
      await Promise.race([
        new Promise((resolve,reject)=>{
          socket.addEventListener('open',resolve,{once:true});
          socket.addEventListener('error',reject,{once:true});
        }),
        deadline(5000,'DevTools WebSocket handshake timed out')
      ]);
      if(attempt>1){
        console.log('DC333_CHROMIUM_STARTUP_RECOVERED='+attempt);
      }
      return {child,socket};
    } catch(error){
      socket?.close();
      diagnostics.push('attempt='+attempt+', error='+error.message+
        ', exit='+child.exitCode+', signal='+child.signalCode+
        ', spawnError='+(spawnError?.message||'none')+
        ', stderr='+stderr.slice(-2000));
      await stopChrome(child);
      await sleep(200);
    }
  }
  throw new Error('Chromium debugging endpoint unavailable after 3 '+
    'bounded fresh-profile attempts: '+diagnostics.join(' | '));
}

test('real-time Chromium services event loop while producing 21 PNGs',
  {timeout:90000},async()=>{
  const chrome=process.env.DC_FAVICON_CHROME ||
    (existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome');
  assert(existsSync(chrome),'Chromium required for real-time responsiveness');
  const temp=mkdtempSync(join(tmpdir(),'dc333-realtime-'));
  let child=null,socket;
  try {
    ({child,socket}=await launchChrome(chrome,temp));
    let nextId=0;
    const pending=new Map();
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(!message.id)return;
      const operation=pending.get(message.id);
      if(!operation)return;
      pending.delete(message.id);
      if(message.error)operation.reject(new Error(JSON.stringify(message.error)));
      else operation.resolve(message.result);
    });
    const send=(method,params)=>new Promise((resolve,reject)=>{
      const id=++nextId;
      pending.set(id,{resolve,reject});
      socket.send(JSON.stringify({id,method,params}));
    });
    const payload={
      module:readFileSync(new URL('../src/favicon/browser-sequence.mjs',
        import.meta.url),'utf8'),
      webp:readFileSync(new URL(
        '../assets/favicons/v1/originals/chatgpt-favicon-48x48.webp',
        import.meta.url)).toString('base64')
    };
    const expression='('+runSequence.toString()+')('+
      JSON.stringify(payload)+')';
    const response=await Promise.race([
      send('Runtime.evaluate',{
        expression,awaitPromise:true,returnByValue:true
      }),
      deadline(30000,'Real browser run timed out')
    ]);
    assert(!response.exceptionDetails,
      'Browser exception: '+JSON.stringify(response.exceptionDetails));
    const result=response.result?.value;
    assert(result,'Chromium returned no real-time measurements');
    assert.equal(result.theme,'light');
    assert.equal(result.frames,21);
    assert.equal(result.encodes,21);
    assert.equal(result.width,48);
    assert.equal(result.height,48);
    assert.equal(result.invalidSource,'FaviconRenderError');
    assert.equal(result.oversizedSource,'FaviconRenderError');
    assert.equal(result.wrongTheme,'AbortError');
    assert(result.elapsedMs>0,'Real-time clock did not advance');
    assert(result.ticks>=5,'Browser UI timer starved during generation');
    console.log('DC333_REALTIME_BROWSER='+JSON.stringify(result));
  } finally {
    socket?.close();
    await stopChrome(child);
    // Chromium child processes can briefly write into a profile after exit.
    // Retry only transient profile cleanup races; do not mask other errors.
    let cleaned=false;
    for(let attempt=0;attempt<30;attempt++){
      try {
        rmSync(temp,{recursive:true,force:true,maxRetries:3,retryDelay:100});
        cleaned=true;
        break;
      } catch(error){
        if(!['ENOTEMPTY','EBUSY','EPERM'].includes(error.code))throw error;
        await sleep(100);
      }
    }
    assert(cleaned,'Chromium temporary profile could not be cleaned');
  }
});
