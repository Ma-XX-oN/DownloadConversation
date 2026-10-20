import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  productionFunctionSource, downloadConversationSource
} from './helpers/userscript-source.mjs';

test('get_favicon maps ten-second phases to 21 symmetric PNG samples', () => {
  const source = productionFunctionSource('agentFaviconPulseIndex');
  const context = {};
  vm.runInNewContext(`${source}\nthis.index = agentFaviconPulseIndex;`, context);
  for (let slot = 0; slot < 40; slot += 1) {
    assert.equal(context.index(slot * 250), Math.min(slot, 40 - slot));
  }
  assert.equal(context.index(10000), 0);
  assert.equal(context.index(-250), 1);
  assert.equal(context.index(5250), 19);
  assert.equal(context.index(NaN), null);
  assert.equal(context.index(Infinity), null);
});

test('cached presentation contract has exact four-argument API', () => {
  const source = productionFunctionSource('get_favicon');
  assert.match(source, /function get_favicon\(compatible_version_key, base_type, completion_time, time_offset\)/);
  assert.doesNotMatch(source, /toDataURL|createElement\(['"]canvas['"]\)|getImageData|putImageData/);
});

test('runtime no longer executes heartbeat PNG recomposition', () => {
  assert.doesNotMatch(downloadConversationSource, /canvas\.toDataURL\(['"]image\/png['"]\)/);
  assert.doesNotMatch(downloadConversationSource, /context\.getImageData\(/);
  assert.doesNotMatch(downloadConversationSource, /context\.putImageData\(/);
  assert.match(productionFunctionSource('agentFaviconRenderState'), /get_favicon\(/);
});
