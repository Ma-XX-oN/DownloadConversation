import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { renderFaviconPulseSequence, pulseFrameForSlot } from '../src/favicon/browser-sequence.mjs';

const PINNED_SVG = new URL(
  '../assets/favicons/v1/originals/chatgpt-favicon-l4nq08hd.svg', import.meta.url);
const PINNED_WEBP = new URL(
  '../assets/favicons/v1/originals/chatgpt-favicon-48x48.webp', import.meta.url);

test('40 slots address just 21 stored cosine frames, independent of issue suffix', () => {
  assert.deepEqual(Array.from({length:40}, (_, i) => pulseFrameForSlot(i)),
    [...Array.from({length:21},(_,i)=>i),
      ...Array.from({length:19},(_,i)=>19-i)]);
  assert.equal(pulseFrameForSlot(40),0);
  assert.equal(pulseFrameForSlot(41),1);
  assert.equal(pulseFrameForSlot(-1),1);
});

test('invalid tuple and pre-abort fail without loading any image', async () => {
  for(const candidate of [
    {originalUrl:'',theme:'light',base:'processing',progressStep:0},
    {originalUrl:'https://chatgpt.com/favicon.ico',theme:'sepia',base:'processing',progressStep:0},
    {originalUrl:'https://chatgpt.com/favicon.ico',theme:'light',base:'purple',progressStep:0},
    {originalUrl:'https://chatgpt.com/favicon.ico',theme:'light',base:'processing',progressStep:7}
  ]) await assert.rejects(renderFaviconPulseSequence(candidate));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(renderFaviconPulseSequence({
    originalUrl:'https://chatgpt.com/favicon.ico',
    theme:'light',base:'processing',progressStep:0,signal:controller.signal
  }),error => error.name === 'AbortError');
});

/** Execute one browser scenario while reading the actual pinned source bytes. */
function browserFixture(svgBytes,webpBytes,moduleSource) {
  const script = async function (serialized) {
    const result=document.getElementById('result');
    try {
      const moduleUrl=URL.createObjectURL(new Blob([serialized.module],{type:'text/javascript'}));
      const provider=await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const source='data:image/svg+xml;base64,'+serialized.svg;
      const theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
      const ticks=[];
      const timer=setInterval(()=>ticks.push(performance.now()),1);
      const start=performance.now();
      const sequence=await provider.renderFaviconPulseSequence({
        originalUrl:source,theme,base:'processing',progressStep:3
      });
      clearInterval(timer);
      const times=performance.now()-start;
      const pngs=await Promise.all(sequence.frames.map(async frame=>({
        mime:frame.type, size:frame.size,
        sig:Array.from(new Uint8Array(await frame.slice(0,8).arrayBuffer()))
      })));
      const decode=async(blob)=>{
        const url=URL.createObjectURL(blob);
        const image=new Image();
        try {
          await new Promise((resolve,reject)=>{
            image.onload=resolve;image.onerror=reject;image.src=url;
          });
          const c=document.createElement('canvas');
          c.width=image.naturalWidth;c.height=image.naturalHeight;
          const ctx=c.getContext('2d',{willReadFrequently:true});
          ctx.drawImage(image,0,0);
          return [...ctx.getImageData(0,0,c.width,c.height).data];
        } finally {URL.revokeObjectURL(url);}
      };
      const a=await decode(sequence.frames[0]);
      const mid=await decode(sequence.frames[10]);
      const b=await decode(sequence.frames[20]);
      const opacity=(pixels)=>pixels.filter((_,i)=>i%4===3).reduce((v,n)=>v+n,0);
      const aggregate={
        frames:sequence.frames.length,
        width:sequence.width,height:sequence.height,
        theme:sequence.theme, pngs,
        firstAlpha:opacity(a),midAlpha:opacity(mid),lastAlpha:opacity(b),
        distinct:new Set(pngs.map(p=>p.size)).size,
        ticks:ticks.length,elapsedMs:times
      };
      // Test lazy rendering: a new call for another URL produces exactly one
      // separate 21-Blob result; the first must never pre-render that URL.
      const weblink='data:image/webp;base64,'+serialized.webp;
      const web=await provider.renderFaviconPulseSequence({
        originalUrl:weblink,theme,base:'completed',progressStep:0
      });
      aggregate.otherWidth=web.width;aggregate.otherFrames=web.frames.length;
      // Deterministic repeated request must yield the same decoded pixels.
      const replay=await provider.renderFaviconPulseSequence({
        originalUrl:source,theme,base:'processing',progressStep:3
      });
      aggregate.repeatPixels=JSON.stringify(await decode(replay.frames[0]))===
        JSON.stringify(a);
      // Later abort: interrupt at the first yield to event loop, return NO
      // partially successful frames.
      const aborter=new AbortController();
      const pending=provider.renderFaviconPulseSequence({
        originalUrl:source,theme,base:'processing',progressStep:3,
        signal:aborter.signal
      }).then(()=> 'UNEXPECTED_SUCCESS',e=>e.name);
      setTimeout(()=>aborter.abort(),0);
      aggregate.aborted=await pending;
      aggregate.returnedFields=Object.keys(sequence).sort();
      result.textContent='PASS:'+JSON.stringify(aggregate);
    } catch (error) {
      result.textContent='FAIL:'+error.name+':'+error.message;
    }
  };
  const data={svg:svgBytes.toString('base64'),
    webp:webpBytes.toString('base64'),module:moduleSource};
  return '<!doctype html><html><body><pre id="result">RUNNING</pre>'+
    '<script>(' + script.toString() + ')('+
    JSON.stringify(data).replaceAll('<','\\u003c') +
    ');</script></body></html>';
}

test('real Chromium renders only one 21-Blob sequence at a time in each theme',()=>{
  const chrome=process.env.DC_FAVICON_CHROME ||
    (existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome');
  assert(existsSync(chrome),'Chromium required for pixel and responsiveness proof');
  const fixture=browserFixture(readFileSync(PINNED_SVG),readFileSync(PINNED_WEBP),
    readFileSync(new URL('../src/favicon/browser-sequence.mjs',import.meta.url),'utf8'));
  const temp=mkdtempSync(join(tmpdir(),'dc333-v2-'));
  try {
    const page=join(temp,'test.html');
    writeFileSync(page,fixture);
    for(const scheme of ['light','dark']){
      const output=execFileSync(chrome,[
        '--headless','--no-sandbox','--disable-dev-shm-usage',
        '--disable-gpu','--disable-background-networking',
        '--force-prefers-color-scheme='+scheme,
        '--virtual-time-budget=120000','--dump-dom','file://'+page
      ],{encoding:'utf8',maxBuffer:6*1024*1024,timeout:120000,
        stdio:['ignore','pipe','ignore']});
      const status=/<pre id="result">([^<]*)<\/pre>/.exec(output)?.[1];
      assert(status?.startsWith('PASS:'),scheme+' browser fixture '+status);
      const result=JSON.parse(status.slice(5));
      assert.equal(result.frames,21);
      assert.equal(result.theme,scheme);
      assert.equal(result.width,180);
      assert.equal(result.height,180);
      assert.equal(result.otherWidth,48);
      assert.equal(result.otherFrames,21);
      assert(result.pngs.every(p=>p.mime==='image/png' && p.size>100 &&
        p.sig.join(',')==='137,80,78,71,13,10,26,10'));
      assert(result.firstAlpha>result.midAlpha);
      assert(result.midAlpha>result.lastAlpha);
      assert.equal(result.repeatPixels,true);
      assert.equal(result.aborted,'AbortError');
      assert(result.ticks>=2,'Generation starved the timer loop');
      console.log('DC333_V2_BROWSER_'+scheme.toUpperCase()+'='+JSON.stringify({
        frames:result.frames,elapsed_ms:result.elapsedMs,timer_ticks:result.ticks,
        unique_sizes:result.distinct, theme:result.theme, canceled:result.aborted
      }));
    }
  } finally {rmSync(temp,{recursive:true,force:true});}
});
