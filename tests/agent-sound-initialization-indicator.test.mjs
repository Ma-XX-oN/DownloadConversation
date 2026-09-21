import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const INDICATOR_ID = 'tm-agent-sound-uninitialized';
const STOPWATCH_ID = 'tm-agent-turn-stopwatch';

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

function indicatorHarness({ audioState = null, stopwatchWidth = null } = {}) {
  const elements = new Map();
  const parent = {
    append(element) {
      element.parentNode = this;
      elements.set(element.id, element);
    }
  };
  const document = {
    body: parent,
    documentElement: parent,
    addEventListener() {},
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement(tagName) {
      return {
        tagName,
        id: '',
        style: {},
        attributes: new Map(),
        parentNode: null,
        setAttribute(name, value) {
          this.attributes.set(name, value);
        },
        remove() {
          if (elements.get(this.id) === this) elements.delete(this.id);
          this.parentNode = null;
        }
      };
    }
  };

  if (stopwatchWidth !== null) {
    elements.set(STOPWATCH_ID, {
      id: STOPWATCH_ID,
      offsetWidth: stopwatchWidth
    });
  }

  const context = {
    document,
    agentSoundAudioContext: audioState === null ? null : { state: audioState },
    AGENT_SOUND_INITIALIZATION_INDICATOR_ID: INDICATOR_ID,
    AGENT_SOUND_INITIALIZATION_GAP_PX: 8,
    AGENT_STOPWATCH_ID: STOPWATCH_ID
  };
  vm.runInNewContext(`
    ${productionFunctionSource('agentSoundAudioReady')}
    ${productionFunctionSource('agentSoundPositionInitializationIndicator')}
    ${productionFunctionSource('ensureAgentSoundInitializationIndicator')}
    ${productionFunctionSource('agentSoundSyncInitializationIndicator')}
    this.syncIndicator = agentSoundSyncInitializationIndicator;
  `, context);
  return { context, elements };
}

test('sound readiness is exactly the running AudioContext state', () => {
  assert.equal(audioReady(null), false);
  assert.equal(audioReady('suspended'), false);
  assert.equal(audioReady('running'), true);
});

test('refresh state shows one standalone indicator even when no stopwatch exists', () => {
  const { context, elements } = indicatorHarness();

  assert.equal(context.syncIndicator(), false);
  const first = elements.get(INDICATOR_ID);
  assert.ok(first, 'uninitialized audio must create the indicator without a stopwatch');
  assert.equal(first.style.position, 'fixed');
  assert.equal(first.style.top, '56px');
  assert.equal(first.style.right, '16px');

  assert.equal(context.syncIndicator(), false);
  assert.equal(elements.get(INDICATOR_ID), first,
    'repeated readiness projection must reuse the same indicator');
});

test('running audio removes the visible uninitialized indicator immediately', () => {
  const { context, elements } = indicatorHarness();

  context.syncIndicator();
  assert.ok(elements.has(INDICATOR_ID));
  context.agentSoundAudioContext = { state: 'running' };
  assert.equal(context.syncIndicator(), true);
  assert.equal(elements.has(INDICATOR_ID), false);
});

test('indicator moves immediately left of an existing stopwatch', () => {
  const { context, elements } = indicatorHarness({ stopwatchWidth: 120 });

  context.syncIndicator();
  const indicator = elements.get(INDICATOR_ID);
  assert.ok(indicator);
  assert.equal(indicator.style.top, '56px');
  assert.equal(indicator.style.right, '144px');
});

test('stopwatch rendering keeps the independent indicator aligned and readiness adds no polling', () => {
  const render = productionFunctionSource('agentStopwatchRender');
  const sync = productionFunctionSource('agentSoundSyncInitializationIndicator');
  const unlock = productionFunctionSource('unlockAgentSoundAudio');

  assert.match(render, /agentSoundPositionInitializationIndicator/,
    'stopwatch rendering must realign the indicator after its width changes');
  assert.match(unlock, /agentSoundSyncInitializationIndicator\(\)/,
    'audio unlock must immediately refresh the readiness projection');
  assert.match(unlock, /addEventListener\(['"]statechange['"]\s*,\s*agentSoundSyncInitializationIndicator/,
    'later AudioContext readiness changes must use the same state projection');
  assert.doesNotMatch(sync, /setInterval|setTimeout|MutationObserver/,
    'indicator must not add polling or an alternate readiness detector');
});
