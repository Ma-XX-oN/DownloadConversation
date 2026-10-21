import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const renderer = readFileSync(new URL('../src/favicon/browser-sequence.mjs',
  import.meta.url),'utf8');
const ring = ['#00cc00','#55cc00','#aacc00','#ffcc00','#ff7700','#ff0000'];
const states = {
  processing:[255,255,0],
  completed:[0,255,0],
  acknowledged:[255,255,255],
  error:[255,0,0]
};

// Draw simple, transparent source artwork with both recolourable and
// nonwhite stock pixels; it must not contain a filled progress background.
const sourceSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">'
  + '<rect x="28" y="28" width="8" height="8" fill="white"/>'
  + '<rect x="4" y="4" width="8" height="8" fill="#1a334d"/></svg>';
const sourceUrl = 'data:image/svg+xml;base64,'
  + Buffer.from(sourceSvg).toString('base64');

function htmlFor(scheme) {
  const fixture = async function(payload) {
    const output = document.getElementById('result');
    try {
      const moduleUrl = URL.createObjectURL(new Blob([payload.renderer],
        {type:'text/javascript'}));
      const renderer = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const theme = matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
      if(theme !== payload.theme)throw Error('Theme emulation failed');
      const hex = value => [
        parseInt(value.slice(1,3),16),
        parseInt(value.slice(3,5),16),
        parseInt(value.slice(5,7),16)
      ];
      const pixel = (ctx,x,y) => [
        ...ctx.getImageData(x,y,1,1).data
      ];
      const decode = async blob => {
        const image = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(image,0,0);
        image.close();
        return ctx;
      };
      const equal = (got,want,label) => {
        if(JSON.stringify(got)!==JSON.stringify(want))
          throw Error(label+': got '+JSON.stringify(got)+
            ', expected '+JSON.stringify(want));
      };
      let cases = 0, frames = 0;
      for (const [base,colour] of Object.entries(payload.states)) {
        for(let step=0;step<=6;step++) {
          const sequence = await renderer.renderFaviconPulseSequence({
            originalUrl:payload.url,theme,base,progressStep:step
          });
          if(sequence.frames.length!==2)throw Error('Frame count mismatch');
          const first = await decode(sequence.frames[0]);
          const second = await decode(sequence.frames[1]);
          equal(pixel(first,30,30),[...colour,255],
            theme+'/'+base+'/'+step+' recoloured logo');
          equal(pixel(first,6,6),[26,51,77,255],
            theme+'/'+base+'/'+step+' stock pixel');
          equal(pixel(first,41,17),[0,0,0,0],
            theme+'/'+base+'/'+step+' pie interior must remain transparent');
          equal(pixel(second,41,17),[0,0,0,0],
            theme+'/'+base+'/'+step+' dim pie interior must remain transparent');
          const expectedRing = step===0 || base==='error'
            ? [0,0,0,0] : [...hex(payload.ring[step-1]),255];
          equal(pixel(first,46,8),expectedRing,
            theme+'/'+base+'/'+step+' six-step outer ring');
          equal(pixel(second,30,30),[...colour,51],
            theme+'/'+base+'/'+step+' dim whole-icon frame');
          if(step>0&&base!=='error') {
            const dimRing=pixel(second,46,8);
            const ringRgb=hex(payload.ring[step-1]);
            if(dimRing[3]!==51 ||
              ringRgb.some((channel,i)=>Math.abs(channel-dimRing[i])>2)) {
              throw Error(theme+'/'+base+'/'+step+' dim ring mismatch: '+
                JSON.stringify(dimRing));
            }
          }
          cases++;
          frames+=sequence.frames.length;
        }
      }
      output.textContent='PASS:'+JSON.stringify({theme,cases,frames});
    } catch(error) {
      output.textContent='FAIL:'+error.name+':'+error.message;
    }
  };
  const data = {renderer,url:sourceUrl,theme:scheme,states,ring};
  return '<!doctype html><html><body><pre id="result">RUNNING</pre>'
    + '<script>(' + fixture.toString() + ')('
    + JSON.stringify(data).replaceAll('<','\\u003c')
    + ');</script></body></html>';
}

/** Run the real Chromium fixture without virtual-time fast-forward. */
async function runBrowserPage(theme,page,temp) {
  const chrome=process.env.DC_FAVICON_CHROME ||
    ['google-chrome','chromium','chromium-browser']
      .map(name=>spawnSync('which',[name],{encoding:'utf8'}))
      .find(result=>result.status===0)?.stdout.trim();
  assert.ok(chrome && existsSync(chrome),'Real Chromium required');
  const profile=join(temp,'profile-'+theme);
  const child=spawn(chrome,['--headless=new','--no-sandbox',
    '--disable-dev-shm-usage','--disable-background-networking',
    '--remote-debugging-port=0','--user-data-dir='+profile,
    '--force-prefers-color-scheme='+theme,'about:blank'],{stdio:'ignore'});
  let socket;
  try {
    let port=null;
    for(let i=0;i<100;i++) {
      const filename=join(profile,'DevToolsActivePort');
      if(existsSync(filename)) {
        port=Number(readFileSync(filename,'utf8').split('\n')[0]);
        break;
      }
      if(child.exitCode!==null)throw Error('Chromium exited early');
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    assert.ok(port,'Chromium debugging port unavailable');
    const targets=await fetch('http://127.0.0.1:'+port+'/json/list')
      .then(response=>response.json());
    const target=targets.find(item=>item.type==='page');
    assert.ok(target,'Chromium page target unavailable');
    socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
      socket.onopen=resolve; socket.onerror=reject;
    });
    let serial=0;
    const waiting=new Map();
    socket.onmessage=event=>{
      const result=JSON.parse(event.data);
      const finish=waiting.get(result.id);
      if(!finish)return;
      waiting.delete(result.id);
      finish(result);
    };
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++serial;
      waiting.set(id,result=>{
        if(result.error)reject(Error(JSON.stringify(result.error)));
        else resolve(result.result);
      });
      socket.send(JSON.stringify({id,method,params}));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setEmulatedMedia',{
      features:[{name:'prefers-color-scheme',value:theme}]
    });
    await send('Page.navigate',{url:'file://'+page});
    let last='UNLOADED';
    for(let i=0;i<450;i++){
      const data=await send('Runtime.evaluate',{
        expression:'document.getElementById("result")?.textContent',
        returnByValue:true
      });
      last=data.result?.value ?? 'UNLOADED';
      if(last.startsWith('PASS:') || last.startsWith('FAIL:'))return last;
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    throw Error('Chromium rendering timed out: '+last);
  } finally {
    socket?.close();
    child.kill('SIGKILL');
    await new Promise(resolve=>setTimeout(resolve,75));
  }
}

test('ring-only pixel matrix: all 7 steps, 4 states, both frames and themes',
  {timeout:120000}, async () => {
    const temp=mkdtempSync(join(tmpdir(),'dc354-ring-'));
    try {
      for(const theme of ['light','dark']) {
        const page=join(temp,'test-'+theme+'.html');
        writeFileSync(page,htmlFor(theme),'utf8');
        const status=await runBrowserPage(theme,page,temp);
        assert.ok(status?.startsWith('PASS:'),theme+': '+status);
        const result=JSON.parse(status.slice(5));
        assert.deepEqual(result,{theme,cases:28,frames:56});
      }
    } finally {
      rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
  });

test('changed frame bytes have an independent version and no pie renderer',()=>{
  const adapter=readFileSync(new URL(
    '../src/userscript/03-agent-lifecycle/02-favicon-v2-adapter.js',
    import.meta.url),'utf8');
  assert.match(adapter,/FAVICON_ANIMATION_VERSION = '2\.1\.0'/);
  assert.doesNotMatch(renderer,/destination-over|\.fill\(\)/);
  assert.match(renderer,/size \* 0\.43/);
  assert.match(renderer,/size \* 0\.12/);
  assert.match(renderer,/for \(let frame = 0; frame < 2; frame\+\+\)/);
  assert.match(renderer,/completed: Object\.freeze\(\[0, 255, 0\]\)/);
});
