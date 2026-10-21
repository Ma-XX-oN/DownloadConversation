import assert from 'node:assert/strict';
import test from 'node:test';

// An isolated behavioural oracle. It is NOT a proposed #333/#334/#335 API.
// This model checks the independent animation V2 semantics.
const bases = ['processing','completed','error','acknowledged'];
const cadence = 1000;
const expiry = 600000;
const original = 'https://chatgpt.com/favicon.svg';
const tuple = Object.freeze({version:'2.0.0',
  url:original,theme:'light',base:'processing',step:2});

function numericVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9a-z.-]+)?$/i.exec(version);
  if (!m) return null;
  const n = m.slice(1,4).map(Number);
  return n.every(Number.isSafeInteger) ? n : null;
}

function selectVersion(boundaries, running) {
  const target = numericVersion(running);
  if (!target) return null;
  const compare = (a,b) => {
    for (let i=0;i<3;i++) if (a[i]!==b[i]) return a[i]-b[i];
    return 0;
  };
  const seen = new Set();
  const valid = boundaries.map(value => {
    const n = numericVersion(value);
    assert.ok(n,'malformed boundary');
    const key = n.join('.');
    assert.ok(!seen.has(key),'duplicate normalized boundary');
    seen.add(key);
    return {n,key};
  });
  return valid.filter(x => compare(x.n,target)<=0)
    .sort((a,b)=>compare(b.n,a.n))[0]?.key ?? null;
}

function frameIndex(ms) {
  assert.ok(Number.isFinite(ms));
  const phase=((ms%2000)+2000)%2000;
  return Math.floor(phase/cadence);
}

function gate() {
  let open;
  const wait=new Promise(resolve=>{open=resolve;});
  return {wait,open};
}

class SequenceModel {
  constructor() {
    this.ready=new Map();
    this.images=new Map();
    this.claims=new Map();
    this.rendered=[];
    this.generations=0;
    this.reads=0;
    this.touches=0;
    this.now=1_000_000_000;
    this.active=new Set();
  }
  key(t) {
    const version=numericVersion(t.version);
    assert.ok(version && t.url.startsWith('https://'));
    assert.ok(['light','dark'].includes(t.theme));
    assert.ok(bases.includes(t.base));
    assert.ok(Number.isInteger(t.step)&&t.step>=0&&t.step<=6);
    return JSON.stringify([version.join('.'),t.url,t.theme,t.base,t.step]);
  }
  tab() {return {href:original,stock:original,urls:new Map()};}
  async lock(key,task) {
    const previous=this.claims.get(key)??Promise.resolve();
    const done=gate();
    this.claims.set(key,done.wait);
    await previous;
    try{return await task();}
    finally {
      done.open();
      if(this.claims.get(key)===done.wait)this.claims.delete(key);
    }
  }
  async produce(t,options) {
    this.generations++;
    if(options.gate)await options.gate.wait;
    const frames=[];
    for(let i=0;i<2;i++) {
      if(options.crashAt===i)throw Error('generator crashed');
      const bytes=new Uint8Array([137,80,78,71,13,10,26,10,
        t.theme==='dark'?1:0,bases.indexOf(t.base),t.step,i]);
      frames.push(new Blob([bytes],{type:'image/png'}));
      this.rendered.push([this.key(t),i]);
      if(i%5===0)await Promise.resolve();
    }
    return frames;
  }
  async request(tab,t,offset,options={}) {
    const key=this.key(t);
    const frame=frameIndex(offset);
    const index=key+'/'+frame;
    if(tab.urls.has(index))return 'warm';
    if(!this.ready.get(key)) {
      tab.href=tab.stock;
      await this.lock(key,async()=>{
        if(this.ready.get(key))return;
        const produced=await this.produce(t,options);
        assert.equal(produced.length,2);
        const staged=new Map();
        for(let i=0;i<2;i++) {
          staged.set(key+'/'+i,produced[i]);
          if(options.abortAt===i)throw Error('transaction aborted');
        }
        // In-memory atomic transaction model; not a claim of real IDB.
        for(const [id,blob] of staged)this.images.set(id,blob);
        this.ready.set(key,{lastUsed:this.now});
      });
    }
    assert.ok(this.ready.has(key));
    const blob=this.images.get(index);
    assert.ok(blob instanceof Blob && blob.type==='image/png');
    tab.urls.set(index,blob);
    this.reads++;
    tab.href='blob:synthetic/'+frame;
    this.touch(key);
    return 'cold';
  }
  touch(key) {
    const meta=this.ready.get(key);
    if(this.now-meta.lastUsed<expiry)return;
    meta.lastUsed=this.now;
    this.touches++;
  }
  sweep() {
    let deleted=0;
    for(const [key,meta] of this.ready) {
      if(this.active.has(key)||this.claims.has(key))continue;
      if(this.now-meta.lastUsed<=expiry)continue;
      this.ready.delete(key);
      for(let i=0;i<2;i++)this.images.delete(key+'/'+i);
      deleted++;
    }
    return deleted;
  }
}

test('first request for a blink frame generates two and no other tuples',async()=>{
  const s=new SequenceModel(), tab=s.tab();
  await s.request(tab,tuple,9750);
  assert.equal(s.images.size,2);
  assert.equal(s.ready.size,1);
  assert.equal(s.generations,1);
  assert.deepEqual(s.rendered.map(x=>x[1]),Array.from({length:2},(_,i)=>i));
  assert.deepEqual([...new Set(s.rendered.map(x=>x[0]))],[s.key(tuple)]);
  assert.equal(tab.urls.size,1);
});

test('only first tab generates; contender shows original until fully ready',async()=>{
  const s=new SequenceModel(), held=gate(), first=s.tab(),second=s.tab();
  const a=s.request(first,tuple,0,{gate:held});
  await new Promise(resolve=>setImmediate(resolve));
  const b=s.request(second,tuple,250);
  assert.equal(second.href,second.stock);
  assert.equal(first.href,first.stock);
  assert.equal(s.ready.size,0);
  assert.equal(s.generations,1);
  held.open();
  await Promise.all([a,b]);
  assert.equal(s.generations,1);
  assert.equal(s.images.size,2);
  assert.notEqual(second.href,second.stock);
});

test('crashed generator and aborted transaction leave no partial ready',async()=>{
  const s=new SequenceModel();
  await assert.rejects(s.request(s.tab(),tuple,0,{crashAt:1}),/crashed/);
  assert.equal(s.ready.size,0);
  assert.equal(s.images.size,0);
  await assert.rejects(s.request(s.tab(),tuple,0,{abortAt:1}),/aborted/);
  assert.equal(s.ready.size,0);
  assert.equal(s.images.size,0);
  await s.request(s.tab(),tuple,0);
  assert.equal(s.generations,3);
  assert.equal(s.images.size,2);
});

test('contender takes over after generator failure, original while waiting',async()=>{
  const s=new SequenceModel(), held=gate(), a=s.tab(),b=s.tab();
  const failed=s.request(a,tuple,500,{gate:held,crashAt:1});
  await new Promise(resolve=>setImmediate(resolve));
  const takeover=s.request(b,tuple,500);
  assert.equal(b.href,b.stock);
  held.open();
  await assert.rejects(failed,/crashed/);
  await takeover;
  assert.equal(s.generations,2);
  assert.equal(s.images.size,2);
});

test('light-only; same URL dark-only on later theme change',async()=>{
  const s=new SequenceModel(), tab=s.tab();
  await s.request(tab,tuple,1000);
  assert.equal(s.images.size,2);
  const dark={...tuple,theme:'dark'};
  await s.request(tab,dark,1000);
  assert.equal(s.images.size,4);
  assert.equal(s.ready.size,2);
  assert.deepEqual([...s.ready.keys()],[s.key(tuple),s.key(dark)]);
});

test('four colours and seven steps are strictly request-driven',async()=>{
  const s=new SequenceModel();
  for(const base of bases)for(let step=0;step<=6;step++)
    await s.request(s.tab(),{...tuple,base,step},5000);
  assert.equal(s.generations,28);
  assert.equal(s.images.size,56);
  assert.equal(s.ready.size,28);
});

test('different source URL/version do not reuse the requested sequence',async()=>{
  const s=new SequenceModel();
  const keys=[tuple,{...tuple,url:'https://chatgpt.com/other.svg'},
    {...tuple,version:'3.0.0'}];
  for(const t of keys)await s.request(s.tab(),t,5000);
  assert.equal(s.ready.size,3);
  assert.equal(s.generations,3);
  assert.equal(s.images.size,6);
});

test('two-frame cycle repeats without additional generation/read',async()=>{
  const s=new SequenceModel(),tab=s.tab();
  for(let i=0;i<4;i++)await s.request(tab,tuple,i*cadence);
  assert.equal(s.generations,1);
  assert.equal(s.reads,2);
  for(let i=0;i<4;i++)await s.request(tab,tuple,i*cadence);
  assert.equal(s.generations,1);
  assert.equal(s.reads,2);
  assert.equal(frameIndex(0),0);
  assert.equal(frameIndex(5000),1);
  assert.equal(frameIndex(9750),1);
  assert.equal(frameIndex(-250),1);
});

test('version boundary ignores issue suffix; duplicate normalized rejected',()=>{
  assert.equal(selectVersion(['1.11.7','1.12.0','2.0.0'],
    '1.11.7-issue.999.1'),'1.11.7');
  assert.equal(selectVersion(['1.11.7','1.12.0','2.0.0'],
    '1.99.0'),'1.12.0');
  assert.equal(selectVersion(['1.11.7'],'1.11.6'),null);
  assert.equal(selectVersion(['1.11.7'],'malformed'),null);
  assert.throws(()=>selectVersion(['1.11.7','1.11.7-issue.2.4'],
    '1.11.8'),/duplicate/);
});

test('touch no more often than 10m; >10m only; active reader protected',async()=>{
  const s=new SequenceModel();
  await s.request(s.tab(),tuple,0);
  const key=s.key(tuple);
  s.now+=599999;
  s.touch(key);
  assert.equal(s.touches,0);
  assert.equal(s.sweep(),0);
  s.now++;
  s.touch(key);
  assert.equal(s.touches,1);
  s.now+=600000;
  assert.equal(s.sweep(),0);
  s.now++;
  s.active.add(key);
  assert.equal(s.sweep(),0);
  s.active.delete(key);
  assert.equal(s.sweep(),1);
  assert.equal(s.images.size,0);
  await s.request(s.tab(),tuple,0);
  assert.equal(s.generations,2);
  assert.equal(s.images.size,2);
});
