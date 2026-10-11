import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

const INDICATOR_ID = 'tm-agent-sound-uninitialized';
const WORKSTACK_ID = 'tm-workstack-continuation';

function harness({ audioState = null, volume = 10, withWorkStack = false } = {}) {
  const elements = new Map();
  const createElement = (id = '') => ({
    id,
    style: {},
    children: [],
    parentNode: null,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    append(child) {
      if (child.parentNode) {
        child.parentNode.children = child.parentNode.children.filter(item => item !== child);
      }
      child.parentNode = this;
      this.children.push(child);
      if (child.id) elements.set(child.id, child);
    },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter(item => item !== this);
      }
      elements.delete(this.id);
      this.parentNode = null;
    }
  });
  const body = createElement();
  const document = {
    body,
    documentElement: body,
    getElementById(id) { return elements.get(id) ?? null; },
    createElement() { return createElement(); },
    addEventListener() {}
  };
  let workStack = null;
  if (withWorkStack) {
    workStack = createElement(WORKSTACK_ID);
    body.append(workStack);
  }
  class MockAudioContext {
    constructor() { this.state = 'running'; }
    addEventListener() {}
  }
  const context = {
    document,
    window: { AudioContext: MockAudioContext },
    logDiagnostic() {},
    agentSoundClearPendingTerminal() {},
    agentSoundRetryPendingTerminal() {},
    errorMessage(error) { return String(error); },
    agentSoundVolume: volume,
    agentSoundAudioContext: audioState === null ? null : { state: audioState },
    AGENT_SOUND_INITIALIZATION_INDICATOR_ID: INDICATOR_ID,
    AGENT_SOUND_INITIALIZATION_GAP_PX: 8,
    WORKSTACK_CONTROL_ID: WORKSTACK_ID
  };
  vm.runInNewContext(`
    ${productionFunctionSource('agentSoundAudioReady')}
    ${productionFunctionSource('agentSoundPositionInitializationIndicator')}
    ${productionFunctionSource('ensureAgentSoundInitializationIndicator')}
    ${productionFunctionSource('agentSoundSyncInitializationIndicator')}
    ${productionFunctionSource('unlockAgentSoundAudio')}
    ${productionFunctionSource('agentSoundHandleUserGesture')}
    this.syncIndicator = agentSoundSyncInitializationIndicator;
    this.handleGesture = agentSoundHandleUserGesture;
  `, context);
  return { context, document, body, workStack, elements };
}

test('locked audio without WS creates no misplaced page-level icon', () => {
  const { context, elements } = harness();
  assert.equal(context.syncIndicator(), false);
  assert.equal(elements.has(INDICATOR_ID), false);
});

test('locked audio warning is a child of WS and stays immediately to its left', () => {
  const { context, body, workStack, elements } = harness({ withWorkStack: true });
  assert.equal(context.syncIndicator(), false);
  const icon = elements.get(INDICATOR_ID);
  assert.ok(icon);
  assert.equal(icon.parentNode, workStack);
  assert.equal(body.children.includes(icon), false);
  assert.equal(icon.style.position, 'absolute');
  assert.equal(icon.style.top, '50%');
  assert.equal(icon.style.right, 'calc(100% + 8px)');
  assert.equal(icon.style.transform, 'translateY(-50%)');
});

test('repeated placement does not duplicate the warning', () => {
  const { context, workStack, elements } = harness({ withWorkStack: true });
  context.syncIndicator();
  const icon = elements.get(INDICATOR_ID);
  context.syncIndicator();
  assert.equal(elements.get(INDICATOR_ID), icon);
  assert.equal(workStack.children.filter(child => child.id === INDICATOR_ID).length, 1);
});

test('WS is mounted after startup and warning is then created', () => {
  const { context, body, document, elements } = harness();
  context.syncIndicator();
  const workStack = document.createElement('div');
  workStack.id = WORKSTACK_ID;
  body.append(workStack);
  context.syncIndicator();
  assert.equal(elements.get(INDICATOR_ID)?.parentNode, workStack);
});

test('warning follows WS reparenting and is removed if WS disappears', () => {
  const { context, document, body, workStack, elements } = harness({ withWorkStack: true });
  context.syncIndicator();
  const icon = elements.get(INDICATOR_ID);
  const replacement = document.createElement('div');
  replacement.id = WORKSTACK_ID;
  workStack.remove();
  body.append(replacement);
  context.syncIndicator();
  assert.equal(elements.get(INDICATOR_ID), icon);
  assert.equal(icon.parentNode, replacement);
  replacement.remove();
  context.syncIndicator();
  assert.equal(elements.has(INDICATOR_ID), false);
});

test('successful user-gesture unlock removes warning; suspension restores it', () => {
  const { context, elements } = harness({ withWorkStack: true });
  context.syncIndicator();
  assert.ok(elements.has(INDICATOR_ID));
  context.agentSoundAudioContext = { state: 'running' };
  assert.equal(context.syncIndicator(), true);
  assert.equal(elements.has(INDICATOR_ID), false);
  context.agentSoundAudioContext.state = 'suspended';
  assert.equal(context.syncIndicator(), false);
  assert.ok(elements.has(INDICATOR_ID));
});

test('a user gesture creates a running AudioContext and removes the warning', () => {
  const { context, elements } = harness({ withWorkStack: true });
  context.syncIndicator();
  assert.ok(elements.has(INDICATOR_ID));
  context.handleGesture();
  assert.equal(context.agentSoundAudioContext.state, 'running');
  assert.equal(elements.has(INDICATOR_ID), false);
});

test('explicitly disabled audio shows no misleading interaction warning', () => {
  const { context, elements } = harness({ volume: 0, withWorkStack: true });
  assert.equal(context.syncIndicator(), true);
  assert.equal(elements.has(INDICATOR_ID), false);
});

test('the warning artwork remains the red crossed-out speaker', () => {
  const { context, elements } = harness({ withWorkStack: true });
  context.syncIndicator();
  const icon = elements.get(INDICATOR_ID);
  assert.match(icon.style.backgroundImage, /%3Ccircle/);
  assert.match(icon.style.backgroundImage, /stroke='%23d93025'/);
  assert.match(icon.style.backgroundImage, /fill='%23f5f5f5'/);
});

test('startup is deferred until all declarations exist and WS positioning drives warning', () => {
  const indicatorSource = productionFunctionSource('agentSoundSyncInitializationIndicator');
  const workStackSource = productionFunctionSource('workStackPositionControl');
  const unlockSource = productionFunctionSource('unlockAgentSoundAudio');
  assert.doesNotMatch(indicatorSource, /setInterval|setTimeout|MutationObserver/);
  assert.doesNotMatch(userscript, /^  agentSoundSyncInitializationIndicator\(\);$/m,
    'eager readiness call before WorkStack declaration aborts startup');
  assert.match(userscript,
    /document.addEventListener\('pointerdown', agentSoundHandleUserGesture, true\)/);
  assert.match(workStackSource, /agentSoundPositionInitializationIndicator\(\)/);
  assert.match(unlockSource, /agentSoundSyncInitializationIndicator\(\)/);
  assert.match(unlockSource, /addEventListener\(['"]statechange['"], agentSoundSyncInitializationIndicator/);
});
