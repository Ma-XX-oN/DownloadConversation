import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Chromium fixture runs against actual image decode and CSS theme emulation.
// It is not #333's renderer and does not claim #334 IDB/Web Locks conformance.
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">'
  +'<style>rect{fill:#000}@media(prefers-color-scheme:dark)'
  +'{rect{fill:#fff}}</style><rect width="4" height="4"/></svg>';
const originalUrl='data:image/svg+xml,'+encodeURIComponent(svg);

async function launch() {
  const directory=mkdtempSync(path.join(os.tmpdir(),'dc336-theme-'));
  const executable=['google-chrome','chromium','chromium-browser']
    .map(name=>spawnSync('which',[name],{encoding:'utf8'}))
    .find(result=>result.status===0)?.stdout.trim();
  assert.ok(executable,'Chromium/Chrome executable unavailable');
  const chrome=spawn(executable,['--headless=new','--no-sandbox',
    '--disable-dev-shm-usage','--disable-background-networking',
    '--remote-debugging-port=0','--user-data-dir='+directory,'about:blank'],
    {stdio:'ignore'});
  let socket;
  try {
    let port=0;
    for(let i=0;i<80;i++){
      const target=path.join(directory,'DevToolsActivePort');
      if(existsSync(target)){
        port=Number(readFileSync(target,'utf8').split('\n')[0]);
        break;
      }
      if(chrome.exitCode!==null)throw Error('Chromium exited early');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(port,'no Chromium CDP port');
    const tabs=await fetch('http://127.0.0.1:'+port+'/json/list')
      .then(response=>response.json());
    const page=tabs.find(item=>item.type==='page');
    assert.ok(page);
    socket=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
      socket.onopen=resolve; socket.onerror=reject;
    });
    let serial=0;
    const replies=new Map();
    socket.onmessage=event=>{
      const data=JSON.parse(event.data);
      if(!replies.has(data.id))return;
      const finish=replies.get(data.id);
      replies.delete(data.id);
      finish(data);
    };
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++serial;
      replies.set(id,data=>{
        if(data.error)reject(Error(JSON.stringify(data.error)));
        else resolve(data.result);
      });
      socket.send(JSON.stringify({id,method,params}));
    });
    return {
      send,
      async evaluate(expression){
        const result=await send('Runtime.evaluate',{
          expression,awaitPromise:true,returnByValue:true
        });
        if(result.exceptionDetails)
          throw Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      },
      async close(){
        socket.close();
        chrome.kill('SIGKILL');
        await new Promise(resolve=>setTimeout(resolve,75));
        rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
      }
    };
  }catch(error){
    socket?.close();
    chrome.kill('SIGKILL');
    rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    throw error;
  }
}

function browserModel(sourceUrl) {
  const icon=document.createElement('link');
  icon.rel='icon';
  icon.media='(prefers-color-scheme: light)';
  icon.type='image/svg+xml';
  icon.sizes='any';
  icon.href=sourceUrl;
  document.head.append(icon);
  const original={href:icon.href,media:icon.media,type:icon.type,
    sizes:icon.sizes.value};
  const sequences=new Map();
  let rendered=0;
  async function request(){
    const theme=matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark':'light';
    const key=theme+'/processing/step-3';
    if(sequences.has(key))return {theme,warm:true};
    icon.href=original.href;
    const image=new Image();
    await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=()=>reject(Error('SVG load failed'));
      image.src=sourceUrl;
    });
    const raster=document.createElement('canvas');
    raster.width=raster.height=4;
    const rasterContext=raster.getContext('2d',{willReadFrequently:true});
    rasterContext.drawImage(image,0,0);
    const pixel=Array.from(rasterContext.getImageData(0,0,1,1).data);
    const frames=[];
    for(let frame=0;frame<2;frame++){
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=4;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(image,0,0);
      ctx.globalCompositeOperation='destination-in';
      const alpha=frame===0?1:0.2;
      ctx.fillStyle='rgba(0,0,0,'+alpha+')';
      ctx.fillRect(0,0,4,4);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob||blob.type!=='image/png')throw Error('PNG encode failed');
      frames.push(blob);
      rendered++;
    }
    sequences.set(key,{frames,pixel});
    const href=URL.createObjectURL(frames[1]);
    icon.href=href;
    return {theme,warm:false,count:frames.length,pixel,
      originalUrl:sourceUrl,attributesPreserved:icon.media===original.media
        &&icon.type===original.type&&icon.sizes.value===original.sizes};
  }
  return {
    request,
    summary:()=>({rendered,keys:[...sequences.keys()]}),
    original:()=>original,
    restore:()=>{icon.href=original.href;}
  };
}

test('Chromium synthetic same SVG URL light/dark creates only requested two-frame tuples',
  {timeout:30000},async()=>{
    const client=await launch();
    try {
      await client.evaluate('globalThis.fixture=('+browserModel.toString()
        +')('+JSON.stringify(originalUrl)+')');
      await client.send('Emulation.setEmulatedMedia',
        {features:[{name:'prefers-color-scheme',value:'light'}]});
      const light=await client.evaluate('fixture.request()');
      assert.equal(light.theme,'light');
      assert.equal(light.warm,false);
      assert.equal(light.count,2);
      assert.equal(light.attributesPreserved,true);
      assert.equal(light.originalUrl,originalUrl);
      assert.equal((await client.evaluate('fixture.summary()')).rendered,2);
      await client.send('Emulation.setEmulatedMedia',
        {features:[{name:'prefers-color-scheme',value:'dark'}]});
      const dark=await client.evaluate('fixture.request()');
      assert.equal(dark.theme,'dark');
      assert.equal(dark.count,2);
      assert.notDeepEqual(dark.pixel,light.pixel,
        'same source SVG URL must decode differently across themes');
      const replay=await client.evaluate('fixture.request()');
      assert.equal(replay.warm,true);
      const summary=await client.evaluate('fixture.summary()');
      assert.equal(summary.rendered,4);
      assert.deepEqual(summary.keys,
        ['light/processing/step-3','dark/processing/step-3']);
      await client.evaluate('fixture.restore()');
      assert.equal(await client.evaluate(
        'document.querySelector("link[rel~=icon]").href'),originalUrl);
      console.log('SYNTHETIC CHROMIUM ONLY '+JSON.stringify({
        lightPixel:light.pixel,darkPixel:dark.pixel,summary
      }));
    }finally{
      await client.close();
    }
  });
