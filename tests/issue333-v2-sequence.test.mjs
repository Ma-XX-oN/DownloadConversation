import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { renderFaviconPulseSequence, pulseFrameForSlot } from '../src/favicon/browser-sequence.mjs';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

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
      result.textContent='PHASE:module-import';
      const moduleUrl=URL.createObjectURL(new Blob([serialized.module],{type:'text/javascript'}));
      const provider=await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const source='data:image/svg+xml;base64,'+serialized.svg;
      const theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
      const ticks=[];
      const task=setTimeout(()=>ticks.push(performance.now()),0);
      const start=performance.now();
      result.textContent='PHASE:first-sequence';
      const sequence=await provider.renderFaviconPulseSequence({
        originalUrl:source,theme,base:'processing',progressStep:3
      });
      clearTimeout(task);
      const times=performance.now()-start;
      const pngs=await Promise.all(sequence.frames.map(async frame=>({
        mime:frame.type, size:frame.size,
        sig:Array.from(new Uint8Array(await frame.slice(0,8).arrayBuffer()))
      })));
      // PNG binary equality, not compressed sizes, proves all 21 are unique.
      const binary=await Promise.all(sequence.frames.map(async frame=>
        new Uint8Array(await frame.arrayBuffer())));
      const identical=(a,b)=>a.length===b.length &&
        a.every((value,index)=>value===b[index]);
      const allFramesUnique=binary.every((frame,index)=>
        binary.slice(0,index).every(previous=>!identical(frame,previous)));
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
      // Independent pixel proof: project exactly the existing production
      // recolour, pie, ring, and cosine helpers against the same original.
      const originalImage=new Image();
      await new Promise((resolve,reject)=>{
        originalImage.onload=resolve;
        originalImage.onerror=reject;
        originalImage.src=source;
      });
      result.textContent='PHASE:legacy-pixel-comparison';
      for(const frame of [0,10,20]){
        const target=document.createElement('canvas');
        target.width=180;target.height=180;
        const tctx=target.getContext('2d',{willReadFrequently:true});
        tctx.drawImage(originalImage,0,0);
        const pixels=tctx.getImageData(0,0,180,180);
        agentFaviconRecolorPixels(pixels.data,[255,255,0]);
        tctx.putImageData(pixels,0,0);
        tctx.globalCompositeOperation='destination-over';
        try {agentFaviconDrawPieSlice(tctx,180,180,3);}
        finally {tctx.globalCompositeOperation='source-over';}
        agentFaviconDrawRing(tctx,180,180,3);
        const expectedPixels=tctx.getImageData(0,0,180,180);
        agentFaviconApplyOpacity(expectedPixels.data,
          agentFaviconPulseOpacity(frame*250));
        tctx.putImageData(expectedPixels,0,0);
        const actual=await decode(sequence.frames[frame]);
        const expected=tctx.getImageData(0,0,180,180).data;
        if(actual.length!==expected.length)throw new Error('Frame dimensions differ');
        for(let i=0;i<actual.length;i++){
          if(actual[i]!==expected[i])throw new Error(
            'Legacy pixel mismatch, scheme='+theme+', frame='+frame+
            ', channel='+i+', expected='+expected[i]+', actual='+actual[i]);
        }
      }
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
        allFramesUnique,
        ticks:ticks.length,elapsedMs:times
      };
      // Test lazy rendering: a new call for another URL produces exactly one
      // separate 21-Blob result; the first must never pre-render that URL.
      const weblink='data:image/webp;base64,'+serialized.webp;
      result.textContent='PHASE:second-source';
      const web=await provider.renderFaviconPulseSequence({
        originalUrl:weblink,theme,base:'completed',progressStep:0
      });
      aggregate.otherWidth=web.width;aggregate.otherFrames=web.frames.length;
      // Deterministic repeated request must yield the same decoded pixels.
      result.textContent='PHASE:deterministic-replay';
      const replay=await provider.renderFaviconPulseSequence({
        originalUrl:source,theme,base:'processing',progressStep:3
      });
      aggregate.repeatPixels=JSON.stringify(await decode(replay.frames[0]))===
        JSON.stringify(a);
      // Inject cancellation after the first real PNG encoding.  A virtual
      // clock timer cannot reliably interrupt Chromium's asynchronous encoder.
      const nativeToBlob=HTMLCanvasElement.prototype.toBlob;
      const aborter=new AbortController();
      let cancelledAfterEncode=false;
      HTMLCanvasElement.prototype.toBlob=function(callback,...args){
        return nativeToBlob.call(this,blob=>{
          if(!cancelledAfterEncode){
            cancelledAfterEncode=true;
            aborter.abort();
          }
          callback(blob);
        },...args);
      };
      try {
        result.textContent='PHASE:cancellation';
        aggregate.aborted=await provider.renderFaviconPulseSequence({
          originalUrl:source,theme,base:'processing',progressStep:3,
          signal:aborter.signal
        }).then(()=> 'UNEXPECTED_SUCCESS',e=>e.name);
      } finally {
        HTMLCanvasElement.prototype.toBlob=nativeToBlob;
      }
      aggregate.cancelledAfterEncode=cancelledAfterEncode;
      const nativeMatchMedia=window.matchMedia;
      const changed=(theme==='light');
      let flippedAfterEncode=false;
      HTMLCanvasElement.prototype.toBlob=function(callback,...args){
        return nativeToBlob.call(this,blob=>{
          if(!flippedAfterEncode){
            flippedAfterEncode=true;
            window.matchMedia=()=>({matches:changed});
          }
          callback(blob);
        },...args);
      };
      try {
        result.textContent='PHASE:theme-flip';
        aggregate.themeFlip=await provider.renderFaviconPulseSequence({
          originalUrl:source,theme,base:'processing',progressStep:3
        }).then(()=> 'UNEXPECTED_SUCCESS',e=>e.name);
      } finally {
        window.matchMedia=nativeMatchMedia;
        HTMLCanvasElement.prototype.toBlob=nativeToBlob;
      }
      aggregate.flippedAfterEncode=flippedAfterEncode;
      const recovery=await provider.renderFaviconPulseSequence({
        originalUrl:source,theme,base:'processing',progressStep:3
      });
      aggregate.recovered=recovery.frames.length===21;
      aggregate.returnedFields=Object.keys(sequence).sort();
      result.textContent='PASS:'+JSON.stringify(aggregate);
    } catch (error) {
      result.textContent='FAIL:'+error.name+':'+error.message;
    }
  };
  const data={svg:svgBytes.toString('base64'),
    webp:webpBytes.toString('base64'),module:moduleSource};
  const legacyFunctions = [
    'agentFaviconRecolorPixels','agentFaviconDrawPieSlice',
    'agentFaviconDrawRing','agentFaviconRingColor',
    'agentFaviconApplyOpacity','agentFaviconPulseOpacity'
  ].map(productionFunctionSource).join('\n');
  return '<!doctype html><html><body><pre id="result">RUNNING</pre>'+
    '<script>const AGENT_FAVICON_PULSE_INTERVAL_MS=10000;'+
    'function assert(condition,reason){if(!condition)throw new Error(reason)};'+
    legacyFunctions+'</script>'+
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
      const themeFlags=scheme==='dark' ?
        ['--force-dark-mode','--force-prefers-color-scheme=dark'] :
        ['--force-prefers-color-scheme=light'];
      const output=execFileSync(chrome,[
        '--headless','--no-sandbox','--disable-dev-shm-usage',
        '--disable-gpu','--disable-background-networking',
        '--user-data-dir='+join(temp,'chrome-profile-'+scheme),
        ...themeFlags,
        '--virtual-time-budget=180000','--dump-dom','file://'+page
      ],{encoding:'utf8',maxBuffer:6*1024*1024,timeout:120000,
        stdio:['ignore','pipe','ignore']});
      const status=/<pre id="result">([^<]*)<\/pre>/.exec(output)?.[1];
      assert(status?.startsWith('PASS:'),scheme+' browser fixture '+status);
      const result=JSON.parse(status.slice(5));
      assert.equal(result.frames,21);
      assert.equal(result.allFramesUnique,true);
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
      assert.equal(result.cancelledAfterEncode,true);
      assert.equal(result.themeFlip,'AbortError');
      assert.equal(result.flippedAfterEncode,true);
      assert.equal(result.recovered,true);
      assert(result.ticks>=1,'Generation starved a queued UI task');
      console.log('DC333_V2_BROWSER_'+scheme.toUpperCase()+'='+JSON.stringify({
        frames:result.frames,elapsed_ms:result.elapsedMs,timer_ticks:result.ticks,
        unique_sizes:result.distinct, theme:result.theme, canceled:result.aborted
      }));
    }
  } finally {rmSync(temp,{recursive:true,force:true});}
});

/** Exhaustively exercise the requested 4 x 7 tuple space, without prefetch. */
test('all four colours and seven progress steps render only requested frames',()=>{
  const chrome=process.env.DC_FAVICON_CHROME ||
    (existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome');
  assert(existsSync(chrome),'Chromium required for colour/progress acceptance');
  const script=async function(payload){
    const result=document.getElementById('matrix-result');
    try {
      const moduleURL=URL.createObjectURL(new Blob([payload.module],
        {type:'text/javascript'}));
      const provider=await import(moduleURL);
      URL.revokeObjectURL(moduleURL);
      const source='data:image/webp;base64,'+payload.webp;
      const theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
      if(theme!=='light')throw new Error('Expected isolated light theme');
      const toBlob=HTMLCanvasElement.prototype.toBlob;
      const signatures=[];
      let encodes=0, requests=0;
      const equal=(a,b)=>a.length===b.length &&
        a.every((value,index)=>value===b[index]);
      HTMLCanvasElement.prototype.toBlob=function(callback,...args){
        encodes++;
        return toBlob.call(this,callback,...args);
      };
      try {
        for(const base of ['processing','completed','acknowledged','error']){
          for(let progressStep=0;progressStep<=6;progressStep++){
            result.textContent='PHASE:'+base+':'+progressStep;
            const before=encodes;
            const sequence=await provider.renderFaviconPulseSequence({
              originalUrl:source,theme,base,progressStep
            });
            if(sequence.frames.length!==21 || encodes-before!==21) {
              throw new Error('Wrong frame count for '+base+':'+progressStep);
            }
            if(sequence.frames.some(blob=>blob.type!=='image/png')) {
              throw new Error('Non-PNG returned');
            }
            signatures.push({base,step:progressStep,
              bytes:new Uint8Array(await sequence.frames[0].arrayBuffer())});
            requests++;
          }
        }
      } finally {
        HTMLCanvasElement.prototype.toBlob=toBlob;
      }
      const signature=(base,step)=>signatures.find(entry=>
        entry.base===base && entry.step===step).bytes;
      for(const base of ['processing','completed','acknowledged']) {
        if(equal(signature(base,0),signature(base,6))) {
          throw new Error('Missing progress overlay for '+base);
        }
      }
      if(!equal(signature('error',0),signature('error',6))) {
        throw new Error('Error state unexpectedly includes progress overlay');
      }
      const states=['processing','completed','acknowledged','error'];
      for(let i=0;i<states.length;i++){
        for(let k=i+1;k<states.length;k++){
          if(equal(signature(states[i],0),signature(states[k],0))) {
            throw new Error('Base colours identical: '+states[i]+','+states[k]);
          }
        }
      }
      result.textContent='PASS:'+JSON.stringify({requests,encodes,theme});
    } catch(error) {
      result.textContent='FAIL:'+error.name+':'+error.message;
    }
  };
  const payload={webp:readFileSync(PINNED_WEBP).toString('base64'),
    module:readFileSync(new URL('../src/favicon/browser-sequence.mjs',
      import.meta.url),'utf8')};
  const html='<!doctype html><html><body><pre id="matrix-result">RUNNING</pre>'+
    '<script>('+script.toString()+')('+
    JSON.stringify(payload).replaceAll('<','\\u003c')+
    ');</script></body></html>';
  const temp=mkdtempSync(join(tmpdir(),'dc333-matrix-'));
  try {
    const page=join(temp,'matrix.html');
    writeFileSync(page,html);
    const output=execFileSync(chrome,[
      '--headless','--no-sandbox','--disable-dev-shm-usage',
      '--disable-gpu','--disable-background-networking',
      '--force-prefers-color-scheme=light',
      '--user-data-dir='+join(temp,'chrome-profile'),
      '--virtual-time-budget=180000','--dump-dom','file://'+page
    ],{encoding:'utf8',maxBuffer:1024*1024,timeout:120000,
      stdio:['ignore','pipe','ignore']});
    const status=/<pre id="matrix-result">([^<]*)<\/pre>/.exec(output)?.[1];
    assert(status?.startsWith('PASS:'),'Colour matrix '+status);
    const result=JSON.parse(status.slice(5));
    assert.equal(result.requests,28);
    assert.equal(result.encodes,588);
    assert.equal(result.theme,'light');
    console.log('DC333_V2_4X7_COLOUR_PROGRESS='+JSON.stringify(result));
  } finally {
    rmSync(temp,{recursive:true,force:true});
  }
});
