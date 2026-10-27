import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const root='../src/userscript/07-panel-launcher/';
const singleton=readFileSync(new URL(root+'03-csc-singleton.js',import.meta.url),'utf8');
const startup=readFileSync(new URL(root+'05-bootstrap-part2.js',import.meta.url),'utf8');
const registration=startup.match(/^\s*cscControlsRegisterHmacFactory\(communicationPersistentHmacCurrentTabService\);/m)?.[0];
assert.ok(registration,'registered HMAC service call must appear in actual startup');
assert.ok(startup.indexOf(registration)<startup.indexOf('cscControlsCurrent().init()'), 'factory must register before first controller init');
test('exact #313 factory supplies the #318 singleton dependency once',()=>{
  const factory=()=>({id:'accepted-hmac-service'});
  const runner=new Function('assert','cscCaptureControlPlane','cscControlSharedStore','VERSION','location','communicationPersistentHmacCurrentTabService',
    singleton+'\n'+registration+'\nreturn {first:cscControlsCurrent(),second:cscControlsCurrent()};');
  const seen=[];
  const instance=runner(assert, deps=>{seen.push(deps);return {deps};},()=>({key:'store'}),'1.11.15',{origin:'https://chatgpt.com'},factory);
  assert.equal(instance.first,instance.second);
  assert.equal(seen.length,1);
  assert.equal(seen[0].serviceFactory,factory);
  assert.equal(seen[0].version,'1.11.15');
});
