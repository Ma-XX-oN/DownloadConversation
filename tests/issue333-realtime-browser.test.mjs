import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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
    return {theme,frames:sequence.frames.length,encodes,
      width:sequence.width,height:sequence.height,
      elapsedMs:performance.now()-started,ticks:ticks.length,maxGapMs};
  } finally {
    clearInterval(interval);
    HTMLCanvasElement.prototype.toBlob=original;
  }
}

test('real-time Chromium services event loop while producing 21 PNGs',
  {timeout:45000},async()=>{
  const chrome=process.env.DC_FAVICON_CHROME ||
    (existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome');
  assert(existsSync(chrome),'Chromium required for real-time responsiveness');
  const temp=mkdtempSync(join(tmpdir(),'dc333-realtime-'));
  const profile=join(temp,'chrome-profile');
  const child=spawn(chrome,[
    '--headless=new','--no-sandbox','--disable-dev-shm-usage',
    '--disable-gpu','--disable-background-networking','--no-first-run',
    '--force-prefers-color-scheme=light',
    '--remote-allow-origins=*','--remote-debugging-port=0',
    '--user-data-dir='+profile,'about:blank'
  ],{stdio:'ignore'});
  let socket;
  try {
    let port=null;
    for(let attempt=0;attempt<120;attempt++){
      const path=join(profile,'DevToolsActivePort');
      if(existsSync(path)){
        port=readFileSync(path,'utf8').split('\n')[0].trim();
        break;
      }
      if(child.exitCode!==null)break;
      await sleep(100);
    }
    assert(port,'Chromium debugging endpoint unavailable');
    const discovery=await fetch('http://127.0.0.1:'+port+'/json/list');
    assert.equal(discovery.status,200);
    const pages=await discovery.json();
    const page=pages.find(entry=>entry.type==='page' &&
      entry.webSocketDebuggerUrl);
    assert(page,'No Chromium page debugging endpoint');
    socket=new WebSocket(page.webSocketDebuggerUrl);
    await Promise.race([
      new Promise((resolve,reject)=>{
        socket.addEventListener('open',resolve,{once:true});
        socket.addEventListener('error',reject,{once:true});
      }),
      sleep(5000).then(()=>{throw new Error('DevTools socket timeout');})
    ]);
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
      sleep(30000).then(()=>{throw new Error('Real browser run timed out');})
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
    assert(result.elapsedMs>0,'Real-time clock did not advance');
    assert(result.ticks>=5,'Browser UI timer starved during generation');
    console.log('DC333_REALTIME_BROWSER='+JSON.stringify(result));
  } finally {
    socket?.close();
    child.kill('SIGKILL');
    await Promise.race([
      new Promise(resolve=>child.once('exit',resolve)),
      sleep(2500)
    ]);
    rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
