import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const INDICATOR_ID = 'tm-agent-sound-uninitialized';
const STOPWATCH_ID = 'tm-agent-turn-stopwatch';
const WORKSTACK_ID = 'tm-workstack-continuation';

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

function indicatorHarness({ audioState = null, withStopwatch = false, withWorkStack = false } = {}) {
  const elements = new Map();
  const makeContainer = (id = '') => ({
    id,
    style: {},
    children: [],
    getBoundingClientRect() { return { top: 130, left: 120, width: 175, height: 45 }; },
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

  if (withWorkStack) body.append(makeContainer(WORKSTACK_ID));
  const context = {
    window: { innerWidth: 312 },
    document,
    WORKSTACK_CONTROL_ID: WORKSTACK_ID,
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

test('uninitialized indicator appears before a stopwatch exists', () => {
  const withoutStopwatch = indicatorHarness();
  assert.equal(withoutStopwatch.context.syncIndicator(), false);
  const indicator = withoutStopwatch.elements.get(INDICATOR_ID);
  assert.ok(indicator, 'audio blocked before a stopwatch must display a warning');
  assert.equal(indicator.parentNode, withoutStopwatch.body);
  assert.equal(indicator.style.position, 'fixed');
  assert.equal(indicator.style.top, '56px');
  assert.equal(indicator.style.right, '16px');
  withoutStopwatch.context.syncIndicator();
  assert.equal(withoutStopwatch.body.children.filter(child => child.id === INDICATOR_ID).length, 1);
});

test('uninitialized indicator stays body-fixed when a stopwatch appears without WS', () => {
  const withoutStopwatch = indicatorHarness();
  withoutStopwatch.context.syncIndicator();
  const indicator = withoutStopwatch.elements.get(INDICATOR_ID);
  const stopwatch = withoutStopwatch.context.document.createElement('div');
  stopwatch.id = STOPWATCH_ID;
  withoutStopwatch.body.append(stopwatch);
  withoutStopwatch.context.syncIndicator();
  assert.equal(withoutStopwatch.elements.get(INDICATOR_ID), indicator);
  assert.equal(indicator.parentNode, withoutStopwatch.body);
  assert.equal(indicator.style.position, 'fixed');
  assert.equal(indicator.style.top, '56px');
  assert.equal(indicator.style.right, '16px');
});

test('uninitialized indicator does not attach to an existing stopwatch', () => {
  const withStopwatch = indicatorHarness({ withStopwatch: true });
  assert.equal(withStopwatch.context.syncIndicator(), false);
  const indicator = withStopwatch.elements.get(INDICATOR_ID);
  assert.ok(indicator, 'uninitialized audio must deploy the readiness icon with the stopwatch');
  assert.equal(indicator.parentNode, withStopwatch.body);
  assert.equal(indicator.style.position, 'fixed');
  assert.equal(indicator.style.top, '56px');
  assert.equal(indicator.style.right, '16px');
});

test('warning aligns with visible WS control independently of stopwatch', () => {
  const { context, elements, body } = indicatorHarness({ withWorkStack: true });
  assert.equal(context.syncIndicator(), false);
  const indicator = elements.get(INDICATOR_ID);
  assert.ok(indicator);
  assert.equal(indicator.parentNode, body);
  assert.equal(indicator.style.position, 'fixed');
  assert.equal(indicator.style.top, '141px');
  assert.equal(indicator.style.right, '200px');
  const workStack = elements.get(WORKSTACK_ID);
  workStack.getBoundingClientRect = () => ({ top: 200, left: 80, width: 150, height: 30 });
  context.syncIndicator();
  assert.equal(indicator.style.top, '203px');
  assert.equal(indicator.style.right, '240px');
  workStack.style.display = 'none';
  context.syncIndicator();
  assert.equal(indicator.style.top, '56px');
  assert.equal(indicator.style.right, '16px');
});

test('disabled-speaker artwork uses a red prohibition circle and slash over a white speaker', () => {
  const { context, elements } = indicatorHarness({ withStopwatch: true });
  context.syncIndicator();
  const indicator = elements.get(INDICATOR_ID);
  assert.ok(indicator);
  assert.equal(indicator.style.border, 'none',
    'the circle must come from the SVG so its stroke and slash endpoints share one coordinate system');
  assert.match(indicator.style.backgroundImage,
    /%3Ccircle cx='12' cy='12' r='10\.5' fill='none' stroke='%23d93025' stroke-width='2\.1'\/%3E/,
    'the prohibition circle must be red');
  assert.match(indicator.style.backgroundImage,
    /%3Cpath fill='%23f5f5f5' d='M4 9h4l5-4v14l-5-4H4z'\/%3E/,
    'the speaker must remain white');
  assert.match(indicator.style.backgroundImage,
    /%3Cpath d='M4\.6 19\.4L19\.4 4\.6' stroke='%23d93025' stroke-width='2\.1' stroke-linecap='round'\/%3E/,
    'the slash must be red, run bottom-left to top-right, and terminate at the circle');
  assert.equal(indicator.style.backgroundSize, '24px 24px');
});

test('repeated readiness projection keeps one body-owned indicator', () => {
  const { context, elements, stopwatch, body } = indicatorHarness({ withStopwatch: true });

  context.syncIndicator();
  const first = elements.get(INDICATOR_ID);
  context.syncIndicator();
  assert.equal(elements.get(INDICATOR_ID), first);
  assert.equal(body.children.filter(child => child.id === INDICATOR_ID).length, 1);
  assert.equal(stopwatch.children.filter(child => child.id === INDICATOR_ID).length, 0);
});

test('running audio removes the uninitialized indicator even without a stopwatch', () => {
  const { context, elements } = indicatorHarness();
  context.syncIndicator();
  assert.ok(elements.has(INDICATOR_ID));
  context.agentSoundAudioContext = { state: 'running' };
  assert.equal(context.syncIndicator(), true);
  assert.equal(elements.has(INDICATOR_ID), false);
});

test('audio suspension restores the warning after a successful unlock', () => {
  const { context, elements } = indicatorHarness({ audioState: 'running' });
  assert.equal(context.syncIndicator(), true);
  assert.equal(elements.has(INDICATOR_ID), false);
  context.agentSoundAudioContext.state = 'suspended';
  assert.equal(context.syncIndicator(), false);
  assert.ok(elements.has(INDICATOR_ID));
  context.agentSoundAudioContext.state = 'running';
  assert.equal(context.syncIndicator(), true);
  assert.equal(elements.has(INDICATOR_ID), false);
});

test('running audio removes the stopwatch-owned uninitialized indicator immediately', () => {
  const { context, elements } = indicatorHarness({ withStopwatch: true });

  context.syncIndicator();
  assert.ok(elements.has(INDICATOR_ID));
  context.agentSoundAudioContext = { state: 'running' };
  assert.equal(context.syncIndicator(), true);
  assert.equal(elements.has(INDICATOR_ID), false);
});

test('WS positioning updates the indicator and audio readiness adds no polling', () => {
  const render = productionFunctionSource('workStackPositionControl');
  const position = productionFunctionSource('agentSoundPositionInitializationIndicator');
  const sync = productionFunctionSource('agentSoundSyncInitializationIndicator');
  const unlock = productionFunctionSource('unlockAgentSoundAudio');

  assert.match(render, /agentSoundPositionInitializationIndicator\(\)/,
    'stopwatch rendering must redeploy/align the indicator after replacing stopwatch text');
  assert.match(position, /ensureAgentSoundInitializationIndicator\(\)/,
    'positioning must recreate the indicator if removed');
  assert.match(unlock, /agentSoundSyncInitializationIndicator\(\)/,
    'audio unlock must immediately refresh the readiness projection');
  assert.match(unlock, /addEventListener\(['"]statechange['"]\s*,\s*agentSoundSyncInitializationIndicator/,
    'later AudioContext readiness changes must use the same state projection');
  assert.doesNotMatch(sync, /setInterval|setTimeout|MutationObserver/,
    'indicator must not add polling or an alternate readiness detector');
});
