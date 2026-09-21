import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function audioReady(state) {
  const context = {
    agentSoundAudioContext: state === null ? null : { state }
  };
  vm.runInNewContext(`
    ${productionFunctionSource('agentSoundAudioReady')}
    this.result = agentSoundAudioReady();
  `, context);
  return context.result;
}

test('sound readiness is exactly the running AudioContext state', () => {
  assert.equal(audioReady(null), false);
  assert.equal(audioReady('suspended'), false);
  assert.equal(audioReady('running'), true);
});

test('uninitialized indicator is an independent DOM element that does not require the stopwatch', () => {
  const ensure = productionFunctionSource('ensureAgentSoundInitializationIndicator');

  assert.match(ensure, /document\.createElement\(['"]div['"]\)/,
    'indicator must be its own DOM element');
  assert.match(ensure, /AGENT_SOUND_INITIALIZATION_INDICATOR_ID/,
    'repeated synchronization must reuse one indicator');
  assert.doesNotMatch(ensure, /AGENT_STOPWATCH_ID|::before/,
    'indicator creation must not require the stopwatch element');
});

test('indicator is visible until audio is ready, then removed, without polling', () => {
  const sync = productionFunctionSource('agentSoundSyncInitializationIndicator');
  const unlock = productionFunctionSource('unlockAgentSoundAudio');

  assert.match(sync, /ensureAgentSoundInitializationIndicator\(\)/,
    'unready state must create/show the independent indicator');
  assert.match(sync, /\.remove\(\)/,
    'ready state must remove the indicator');
  assert.match(unlock, /agentSoundSyncInitializationIndicator\(\)/,
    'audio unlock must immediately refresh the readiness projection');
  assert.match(unlock, /addEventListener\(['"]statechange['"]\s*,\s*agentSoundSyncInitializationIndicator/,
    'later AudioContext readiness changes must use the same state projection');
  assert.doesNotMatch(sync, /setInterval|setTimeout|MutationObserver/,
    'indicator must not add polling or an alternate readiness detector');
});

test('indicator follows the stopwatch when it exists but has a startup position without it', () => {
  const ensure = productionFunctionSource('ensureAgentSoundInitializationIndicator');
  const position = productionFunctionSource('agentSoundPositionInitializationIndicator');
  const render = productionFunctionSource('agentStopwatchRender');

  assert.match(ensure, /style\.position\s*=\s*['"]fixed['"]/);
  assert.match(ensure, /style\.top\s*=\s*['"]56px['"]/);
  assert.match(ensure, /style\.right\s*=\s*['"]16px['"]/,
    'before the stopwatch exists the icon must still be visible at its startup position');
  assert.match(position, /offsetWidth/,
    'when the stopwatch exists the icon must move immediately to its left');
  assert.match(render, /agentSoundPositionInitializationIndicator/,
    'stopwatch rendering must keep the icon aligned as its width changes');
});
