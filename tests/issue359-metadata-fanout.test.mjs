import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const source = readFileSync(new URL('../src/userscript/02-network-communication/03-csc-canonical-ingress.js', import.meta.url), 'utf8');
const start = source.indexOf('  function cscFanOut('), end = source.indexOf('\n  /**', start);
assert.ok(start >= 0 && end > start);
const fanoutSource = source.slice(start, end);
function fixture({ cloneFailure = false, listenerFailure = false } = {}) {
  const order = [], observations = [], failures = [];
  const prefix = [
    "let cscMetadataIngress = envelope => { order.push('metadata'); observations.push(envelope); if(listenerFailure) throw Error('observer failed'); };",
    "const cscCommWorker = { postMessage() {order.push('comm');} };",
    "const cscPluginIngress = () => {order.push('plugin');};",
    "const cloneSafely = () => {order.push('clone'); if(cloneFailure) throw Error('clone failure'); return {body:null};};",
    "const cscIngressFailure = (_stamp, stage) => {failures.push(stage);};",
    "const cancelReadableBodyQuietly = async () => {};",
    "const structuredClone = value => value;"
  ].join('\n');
  const make = new Function('order','observations','failures','cloneFailure','listenerFailure', prefix + '\n' + fanoutSource + '\nreturn cscFanOut;');
  return {publish:make(order,observations,failures,cloneFailure,listenerFailure),order,observations,failures};
}
test('early metadata before clones preserves timestamp and excludes raw headers', () => {
  const f=fixture();
  f.publish(Object.freeze({capture_id:'c7',captured_at_epoch_ms:1234,network_sequence:7,transport:'fetch',direction:'response'}),{status:503,headers:{authorization:'secret'}},{body:null});
  assert.equal(f.order[0],'metadata');
  assert.equal(f.observations[0].captured_at_epoch_ms,1234);
  assert.equal(f.observations[0].status,503);
  assert.equal(f.observations[0].headers,undefined);
  assert.ok(Object.isFrozen(f.observations[0]));
});
test('metadata survives native clone failures', () => {
  const f=fixture({cloneFailure:true});
  f.publish({capture_id:'c8',network_sequence:8},{status:503},{body:null});
  assert.equal(f.observations.length,1);
  assert.ok(f.failures.includes('worker-transfer'));
  assert.ok(f.failures.includes('plugin-payload-clone'));
});
test('observer throw never suppresses COMM or plugin paths', () => {
  const f=fixture({listenerFailure:true});
  f.publish({capture_id:'c9',network_sequence:9},{status:200},{body:null});
  assert.deepEqual(f.order.filter(x=>x==='comm'||x==='plugin'),['comm','plugin']);
  assert.ok(f.failures.includes('metadata-delivery'));
});

test('nonprimitive metadata cannot escape to early observer', () => {
  const f=fixture();
  const secret={credentials:'secret'};
  f.publish({capture_id:'c10',network_sequence:10},
    {status:503,request:secret,nested:[secret],body:secret,headers:secret,value:secret},null);
  assert.equal(f.observations[0].capture_id,'c10');
  assert.equal(f.observations[0].status,503);
  for(const name of ['request','nested','body','headers','value'])
    assert.equal(f.observations[0][name],undefined);
});
