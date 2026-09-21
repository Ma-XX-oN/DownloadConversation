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

function indicatorHarness({ audioState = null, withStopwatch = false } = {}) {
  const elements = new Map();
  const makeContainer = (id = '') => ({
    id,
    style: {},
    children: [],
    parentNode: null,
    append(element) {
      if (element.parentNode?.children) {
        element.parentNode.children = element.parentNode.children.filter(child => child !== element);
      }
      element.parentNode = this;
      this.children.push(element);
      if (element.id) elements.set(element.id, element);
    }
  });
  const body = makeContainer();
  const document = {
    body,
    documentElement: body,
    addEventListener() {},
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement(tagName) {
      const element = makeContainer();
      element.tagName = tagName;
      element.attributes = new Map();
      element.setAttribute = function setAttribute(name, value) {
        this.attributes.set(name, value);
      };
      element.remove = function remove() {
        if (this.parentNode?.children) {
          this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        }
        if (elements.get(this.id) === this) elements.delete(this.id);
        this.parentNode = null;
      };
      return element;
    }
  };

  let stopwatch = null;
  if (withStopwatch) {
    stopwatch = makeContainer(STOPWATCH_ID);
    stopwatch.style.position = 'fixed';
    elements.set(STOPWATCH_ID, stopwatch);
    body.append(stopwatch);
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
  return { context, elements, body, stopwatch };
}

test('sound readiness is exactly the running AudioContext state', () => {
  assert.equal(audioReady(null), false);
  assert.equal(audioReady('suspended'), false);
  assert.equal(audioReady('running'), true);
});

test('uninitialized indicator is deployed only with the stopwatch', () => {
  const withoutStopwatch = indicatorHarness();
  assert.equal(withoutStopwatch.context.syncIndicator(), false);
  assert.equal(withoutStopwatch.elements.has(INDICATOR_ID), false,
    'the readiness icon must not be deployed as an independent page-level control');

  const withStopwatch = indicatorHarness({ withStopwatch: true });
  assert.equal(withStopwatch.context.syncIndicator(), false);
  const indicator = withStopwatch.elements.get(INDICATOR_ID);
  assert.ok(indicator, 'uninitialized audio must deploy the readiness icon with the stopwatch');
  assert.equal(indicator.parentNode, withStopwatch.stopwatch);
  assert.equal(indicator.style.position, 'absolute');
  assert.equal(indicator.style.top, '5px');
  assert.equal(indicator.style.right, 'calc(100% + 8px)');
  assert.equal(withStopwatch.body.children.includes(indicator), false,
    'the readiness icon must not be a body-level sibling of the stopwatch');
});

test('repeated readiness projection keeps one stopwatch-owned indicator', () => {
  const { context, elements, stopwatch } = indicatorHarness({ withStopwatch: true });

  context.syncIndicator();
  const first = elements.get(INDICATOR_ID);
  context.syncIndicator();
  assert.equal(elements.get(INDICATOR_ID), first);
  assert.equal(stopwatch.children.filter(child => child.id === INDICATOR_ID).length, 1);
});

test('running audio removes the stopwatch-owned uninitialized indicator immediately', () => {
  const { context, elements } = indicatorHarness({ withStopwatch: true });

  context.syncIndicator();
  assert.ok(elements.has(INDICATOR_ID));
  context.agentSoundAudioContext = { state: 'running' };
  assert.equal(context.syncIndicator(), true);
  assert.equal(elements.has(INDICATOR_ID), false);
});

test('stopwatch rendering redeploys its indicator after text rendering and readiness adds no polling', () => {
  const render = productionFunctionSource('agentStopwatchRender');
  const position = productionFunctionSource('agentSoundPositionInitializationIndicator');
  const sync = productionFunctionSource('agentSoundSyncInitializationIndicator');
  const unlock = productionFunctionSource('unlockAgentSoundAudio');

  assert.match(render, /agentSoundPositionInitializationIndicator\(\)/,
    'stopwatch rendering must redeploy/align the indicator after replacing stopwatch text');
  assert.match(position, /ensureAgentSoundInitializationIndicator\(\)/,
    'stopwatch-owned positioning must recreate the indicator when text rendering removed it');
  assert.match(unlock, /agentSoundSyncInitializationIndicator\(\)/,
    'audio unlock must immediately refresh the readiness projection');
  assert.match(unlock, /addEventListener\(['"]statechange['"]\s*,\s*agentSoundSyncInitializationIndicator/,
    'later AudioContext readiness changes must use the same state projection');
  assert.doesNotMatch(sync, /setInterval|setTimeout|MutationObserver/,
    'indicator must not add polling or an alternate readiness detector');
});
