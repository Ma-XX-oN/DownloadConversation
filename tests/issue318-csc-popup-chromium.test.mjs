import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const schemaSource = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-schema.js',
  import.meta.url), 'utf8');
const singletonSource = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-singleton.js',
  import.meta.url), 'utf8');


const sharedSource = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-shared-settings.js',
  import.meta.url), 'utf8');
const control = schemaSource + readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-control-plane.js',
  import.meta.url), 'utf8') + singletonSource;
const popup = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-capture-popup.js',
  import.meta.url), 'utf8');
const panelModule = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/04-launcher-removal.js',
  import.meta.url), 'utf8');
const begin = panelModule.indexOf('panel.innerHTML = `');
const end = panelModule.indexOf('`;\n    ', begin);
assert(begin >= 0 && end > begin, 'Production recorder markup missing');
const markup = panelModule.slice(begin + 'panel.innerHTML = `'.length, end);

const binary = (process.platform === 'win32'
  ? ['chrome.exe'] : ['google-chrome', 'chromium', 'chromium-browser'])
  .find(candidate => spawnSync(
    process.platform === 'win32' ? 'where' : 'which',
    [candidate], { encoding: 'utf8' }).status === 0);

function run(width, theme, failRotation = false) {
  const page = `<!doctype html><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
  :root{color-scheme:${theme};}
  body{margin:0;background:Canvas;color:CanvasText}
  #tm-conversation-recorder{position:fixed;right:8px;top:8px;
    box-sizing:border-box;width:min(380px,calc(100vw - 16px));
    padding:10px;background:Canvas;color:CanvasText;}
  .tm-recording-modes{display:flex;align-items:center;gap:7px;}
  </style>
  <div id="tm-conversation-recorder" style="display:block">${markup}</div>
  <pre id="result">PENDING</pre>
  <script>
  const VERSION='1.11.15-issue.318.13';
  const shared=new Map();
  let consentCount=0, consent=false;
  window.confirm=() => {consentCount++;return consent;};
  ${sharedSource}
  ${control}
  // The popup test isolates UI behaviour. Real IDB is exercised by the
  // separate native two-tab browser integration suite.
  cscControlSharedStore=()=>({
    read:async()=>shared.get('dc-csc-capture-options-v1')??null,
    write:async value=>shared.set('dc-csc-capture-options-v1',value),
    subscribe:()=>()=>{},
    dispose:()=>{}
  });
  ${popup}
  const failRotation = ${failRotation};
  if (!failRotation) {
    cscControlsRegisterHmacFactory(() => ({
      status: async () => ({state:'open',
        key_restart:'2026-10-26T14:00:00.000Z',
        redaction_key_epoch:1}),
      dispose: () => {}
    }));
  }
  if (failRotation) {
    cscControlsRegisterHmacFactory(() => ({
      status: async () => ({ state: 'open',
        key_restart: '2026-10-23T11:00:00.000Z',
        redaction_key_epoch: 1 }),
      cycleEvents: async () => [],
      randomize: async () => {throw Error('injected-rotation-failure')},
      dispose: () => {}
    }));
  }
  async function scenario(){
    const panel=document.getElementById('tm-conversation-recorder');
    const one=panel.querySelector('[data-role="record-one-group"]');
    one.checked=true;
    bindCscCapturePopup(panel);
    if (failRotation) {
      const api = cscControlsCurrent();
      api.bindSinks({
        gen: {
          beginSegment: async h => ({ durable: true, key_restart: h.key_restart }),
          writeCycle: async e => ({ durable: true, id: e.id }),
          hasCycle: async () => false
        },
        comm: {
          drain: async () => ({ durable: true }),
          beginKeyBoundary: async h => ({ durable: true,
            key_restart: h.key_restart }),
          writeCycle: async e => ({ durable: true, id: e.id }),
          hasCycle: async () => false
        }
      });
      await api.bindWorker({
        pause: async () => {}, resume: async () => {},
        configure: async request => ({
          type: 'csc-comm-configured', schema: request.schema,
          request_id: request.request_id
        }),
        provisionTarget: { postMessage: () => {} },
        awaitKey: async token => ({ type: 'csc-comm-key-ready', token })
      });
    }
    await new Promise(resolve=>setTimeout(resolve,30));
    const trigger=panel.querySelector('[data-role="csc-popup-trigger"]');
    const dialog=panel.querySelector('[data-role="csc-popup"]');
    const originalLabel=one.closest('label');
    const after=originalLabel.nextElementSibling===trigger;
    trigger.click();
    const focused=document.activeElement===dialog.querySelector('[data-csc-mode]');
    const open=trigger.getAttribute('aria-expanded')==='true'&&!dialog.hidden;
    const initial=cscControlsCurrent().snapshot();
    const warning=dialog.querySelector('.tm-csc-warning').textContent;
    const master=dialog.querySelector('[data-csc-flag="all"]');
    const children=[...dialog.querySelectorAll('[data-csc-flag]')]
      .filter(input=>input!==master);
    master.click();
    const masterSelected=master.checked&&children.every(input=>input.checked);
    children[0].click();
    const masterCleared=!master.checked&&!children[0].checked;
    master.click();
    master.click();
    const masterReset=!master.checked&&children.every(input=>!input.checked);
    const full=dialog.querySelector('[data-csc-mode="everything"]');
    full.click();
    await cscControlsCurrent().refreshKey();
    const pendingDraftPreserved=full.checked;
    dialog.querySelector('[data-csc-apply]').click();
    await new Promise(resolve=>setTimeout(resolve,30));
    const blocked=shared.size===0;
    consent=true;
    full.click();
    dialog.querySelector('[data-csc-apply]').click();
    await new Promise(resolve=>setTimeout(resolve,30));
    const saved=shared.get('dc-csc-capture-options-v1');
    dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    const escaped=dialog.hidden&&document.activeElement===trigger;
    trigger.click();
    document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const outside=dialog.hidden;
    trigger.click();
    const box=dialog.getBoundingClientRect();
    const viewport=box.left>=0&&box.right<=innerWidth+1;
    const color=getComputedStyle(dialog).backgroundColor;
    const rotationButton=dialog.querySelector('[data-csc-randomize]');
    const rotationInitiallyEnabled=!rotationButton.disabled;
    if (failRotation) {
      rotationButton.click();
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    const rotationDisabledAfterError=rotationButton.disabled;
    const rotationState=cscControlsCurrent().snapshot().settings_state;
    document.getElementById('result').textContent=JSON.stringify({
      after,onePreserved:one.checked,open,focused,
      masterSelected,masterCleared,masterReset,
      pendingDraftPreserved,
      defaultMode:initial.settings.mode,defaultAll:initial.settings.all,
      warning:warning.includes('credentials')&&warning.includes('opaque'),
      denied:blocked,confirmed:consentCount===2,
      savedMode:saved?.mode,savedSchema:saved?.schema,
      status:dialog.querySelector('[data-csc-status]').textContent,
      escaped,outside,viewport,color,theme:'${theme}',
      rotationInitiallyEnabled,rotationDisabledAfterError,rotationState
    });
  }
  scenario().catch(error=>document.getElementById('result').textContent=
    JSON.stringify({error:String(error)}));
  <\/script>`;
  const dir=mkdtempSync(path.join(os.tmpdir(),'dc318-chrome-'));
  try {
    const file=path.join(dir,'index.html');
    writeFileSync(file,page,'utf8');
    assert.ok(binary,'Real Chromium binary required');
    const chrome=spawnSync(binary,[
      '--headless=new','--no-sandbox','--disable-gpu',
      '--disable-dev-shm-usage','--no-first-run',
      '--virtual-time-budget=4000','--window-size='+width+',800',
      '--user-data-dir='+path.join(dir,'profile'),'--dump-dom','file://'+file
    ],{encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024});
    assert.equal(chrome.status,0,String(chrome.stderr).slice(-2000));
    const match=chrome.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
    assert.ok(match&&match[1]!=='PENDING','Actual Chromium script did not complete');
    if(process.env.GITHUB_WORKSPACE){
      // Keep screenshot acceptance inside the disposable browser fixture.
      // RepoWorkflow requires its validation worktree to remain unchanged.
      const destination=path.join(dir,
        'dc318-popup-'+theme+'-'+width+
        (failRotation?'-rotation-failure':'')+'.png');
      const shot=spawnSync(binary,[
        '--headless=new','--no-sandbox','--disable-gpu',
        '--disable-dev-shm-usage','--no-first-run',
        '--virtual-time-budget=4000','--window-size='+width+',800',
        '--user-data-dir='+path.join(dir,'screenshot-profile'),
        '--screenshot='+destination,'file://'+file
      ],{encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024});
      assert.equal(shot.status,0,String(shot.stderr).slice(-1200));
      assert.ok(statSync(destination).size>1024,'Chromium visual evidence missing');
    }
    return JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
}

for (const [width,theme] of [[430,'light'],[430,'dark'],[900,'dark']]) {
  test('actual Chromium CSC popup interactions '+width+' '+theme,
    {timeout:35000},()=>{
      const result=run(width,theme);
      assert.equal(result.error,undefined,result.error);
      for(const key of ['after','onePreserved','open','focused','warning',
        'denied','confirmed','escaped','outside','viewport',
        'masterSelected','masterCleared','masterReset','pendingDraftPreserved']) {
        assert.equal(result[key],true,key+': '+JSON.stringify(result));
      }
      assert.equal(result.defaultMode,'replay-essentials');
      assert.equal(result.defaultAll,false);
      assert.equal(result.savedMode,'everything');
      assert.equal(result.savedSchema,1);
      assert.match(result.status,/pending/);
      assert.notEqual(result.color,'rgba(0, 0, 0, 0)');
    });
}

test('native Chromium keeps Randomize disabled after producer failure',
  {timeout:35000},()=>{
    const result=run(430,'dark',true);
    assert.equal(result.error,undefined,result.error);
    assert.equal(result.rotationInitiallyEnabled,true,JSON.stringify(result));
    assert.equal(result.rotationDisabledAfterError,true,JSON.stringify(result));
    assert.equal(result.rotationState,'failed',JSON.stringify(result));
  });
