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

test('uninitialized indicator is anchored to the stopwatch without geometry calculations', () => {
  const context = {
    AGENT_SOUND_INITIALIZATION_ATTRIBUTE: 'data-tm-agent-sound-uninitialized',
    AGENT_STOPWATCH_ID: 'tm-agent-turn-stopwatch',
    AGENT_SOUND_INITIALIZATION_GAP_PX: 8
  };
  vm.runInNewContext(`
    ${productionFunctionSource('agentSoundInitializationIndicatorCss')}
    this.css = agentSoundInitializationIndicatorCss();
  `, context);

  assert.match(context.css, /#tm-agent-turn-stopwatch::before/);
  assert.match(context.css, /position:absolute/);
  assert.match(context.css, /top:0/);
  assert.match(context.css, /right:calc\(100% \+ 8px\)/);
  assert.match(context.css, /border-radius:50%/);
  assert.match(context.css, /M4 9h4l5-4v14l-5-4H4z/,
    'indicator must contain a speaker glyph');
  assert.match(context.css, /M5 5l14 14/,
    'indicator must contain the slash overlay');
});

test('readiness projection toggles from the same sound state and does not poll', () => {
  const sync = productionFunctionSource('agentSoundSyncInitializationIndicator');
  const ensureStyle = productionFunctionSource('ensureAgentSoundInitializationIndicatorStyle');
  const unlock = productionFunctionSource('unlockAgentSoundAudio');

  assert.match(sync, /setAttribute\(AGENT_SOUND_INITIALIZATION_ATTRIBUTE, 'true'\)/);
  assert.match(sync, /removeAttribute\(AGENT_SOUND_INITIALIZATION_ATTRIBUTE\)/);
  assert.match(ensureStyle, /getElementById\(AGENT_SOUND_INITIALIZATION_STYLE_ID\)/,
    'repeated synchronization must reuse one stylesheet');
  assert.match(unlock, /agentSoundSyncInitializationIndicator\(\)/,
    'audio unlock must immediately refresh the readiness projection');
  assert.match(unlock, /addEventListener\(['"]statechange['"]\s*,\s*agentSoundSyncInitializationIndicator/,
    'later AudioContext readiness changes must use the same state projection');
  assert.doesNotMatch(sync, /setInterval|setTimeout|MutationObserver/,
    'indicator must not add polling or an alternate readiness detector');
});
