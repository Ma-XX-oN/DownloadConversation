import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function indicatorHarness({ volume = 10, audioMode = 'absent' } = {}) {
  const elements = new Map();
  let stopwatchWidth = 120;
  const body = {
    append(element) {
      if (element?.id) elements.set(element.id, element);
      element.isConnected = true;
    }
  };

  function makeElement() {
    return {
      id: '',
      style: {},
      innerHTML: '',
      textContent: '',
      title: '',
      isConnected: false,
      attributes: new Map(),
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
      },
      getAttribute(name) {
        return this.attributes.get(name) ?? null;
      },
      remove() {
        if (this.id) elements.delete(this.id);
        this.isConnected = false;
      },
      get offsetWidth() {
        return this.id === 'tm-agent-turn-stopwatch' ? stopwatchWidth : 24;
      }
    };
  }

  class FakeAudioContext {
    constructor() {
      this.state = audioMode === 'running' ? 'running' : 'suspended';
      this.listeners = new Map();
    }

    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    }

    async resume() {
      if (audioMode === 'resume-running') {
        this.state = 'running';
        this.listeners.get('statechange')?.();
      }
    }
  }

  const document = {
    body,
    documentElement: body,
    addEventListener() {},
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement() {
      return makeElement();
    }
  };

  const context = {
    document,
    window: {
      AudioContext: audioMode === 'unavailable' ? undefined : FakeAudioContext,
      webkitAudioContext: undefined
    },
    diagnostics: []
  };

  vm.runInNewContext(`
    const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';
    const AGENT_SOUND_INITIALIZATION_INDICATOR_ID = 'tm-agent-sound-uninitialized';
    const AGENT_SOUND_INITIALIZATION_INDICATOR_GAP_PX = 8;
    let agentSoundVolume = ${volume};
    let agentSoundAudioContext = ${audioMode === 'running' ? 'new window.AudioContext()' : 'null'};
    let agentSoundPendingTerminal = null;
    function agentSoundClearPendingTerminal() { agentSoundPendingTerminal = null; }
    function agentSoundRetryPendingTerminal() {}
    function errorMessage(error) { return String(error?.message ?? error); }
    function logDiagnostic(level, name, details) { this.diagnostics.push({ level, name, details }); }
    ${productionFunctionSource('agentSoundAudioReady')}
    ${productionFunctionSource('agentSoundInitializationIndicatorMarkup')}
    ${productionFunctionSource('agentSoundPositionInitializationIndicator')}
    ${productionFunctionSource('agentSoundSyncInitializationIndicator')}
    ${productionFunctionSource('unlockAgentSoundAudio')}
    ${productionFunctionSource('ensureAgentStopwatchControl')}
    this.api = {
      ensureStopwatch() { return ensureAgentStopwatchControl(); },
      sync() { return agentSoundSyncInitializationIndicator(); },
      position() { return agentSoundPositionInitializationIndicator(); },
      unlock() { return unlockAgentSoundAudio(); },
      ready() { return agentSoundAudioReady(); },
      indicator() { return document.getElementById(AGENT_SOUND_INITIALIZATION_INDICATOR_ID); },
      stopwatch() { return document.getElementById(AGENT_STOPWATCH_ID); },
      setAudioState(value) {
        if (!agentSoundAudioContext) return;
        agentSoundAudioContext.state = value;
        agentSoundAudioContext.listeners?.get('statechange')?.();
      }
    };
  `, context);

  return {
    api: context.api,
    elements,
    setStopwatchWidth(value) {
      stopwatchWidth = value;
    }
  };
}

test('refresh-state stopwatch creation shows exactly one disabled-speaker indicator when audio is absent', () => {
  const harness = indicatorHarness();
  const stopwatch = harness.api.ensureStopwatch();
  const indicator = harness.api.indicator();

  assert.ok(stopwatch, 'stopwatch must exist before the adjacent readiness indicator is positioned');
  assert.ok(indicator, 'absent Web Audio readiness must create the indicator');
  assert.equal(harness.elements.size, 2, 'startup must create one stopwatch and one indicator only');
  assert.match(indicator.innerHTML, /<svg[\s\S]*<circle[\s\S]*<path/,
    'indicator must render a speaker with an overlaid circle/slash vector treatment');
  assert.equal(indicator.getAttribute('aria-label'), 'Sound system not initialized');
  assert.equal(indicator.style.top, stopwatch.style.top,
    'indicator top must align with the stopwatch top');
  assert.equal(indicator.style.right, '144px',
    'indicator must sit immediately left of the 120px stopwatch plus the 8px gap');

  harness.api.ensureStopwatch();
  harness.api.sync();
  assert.equal(harness.elements.size, 2, 'repeated startup/sync must not duplicate the indicator');
});

test('successful trusted AudioContext resume removes the indicator immediately and it does not resurrect', async () => {
  const harness = indicatorHarness({ audioMode: 'resume-running' });
  harness.api.ensureStopwatch();
  assert.ok(harness.api.indicator());

  assert.equal(await harness.api.unlock(), true);
  assert.equal(harness.api.ready(), true);
  assert.equal(harness.api.indicator(), null, 'ready audio removes the uninitialized indicator');

  harness.api.ensureStopwatch();
  harness.api.sync();
  assert.equal(harness.api.indicator(), null,
    'later renders/turns must not recreate the indicator while audio remains ready');
});

test('unavailable or still-suspended audio keeps the indicator visible', async () => {
  const unavailable = indicatorHarness({ audioMode: 'unavailable' });
  unavailable.api.ensureStopwatch();
  assert.equal(await unavailable.api.unlock(), false);
  assert.ok(unavailable.api.indicator(), 'missing AudioContext support must leave the indicator visible');

  const suspended = indicatorHarness({ audioMode: 'suspended' });
  suspended.api.ensureStopwatch();
  assert.equal(await suspended.api.unlock(), false);
  assert.ok(suspended.api.indicator(), 'a context that remains suspended is not ready for playback');
});

test('indicator represents readiness rather than the volume preference', async () => {
  const harness = indicatorHarness({ volume: 0 });
  harness.api.ensureStopwatch();
  assert.ok(harness.api.indicator(), 'volume zero must not masquerade as initialized audio');
  assert.equal(await harness.api.unlock(), false);
  assert.ok(harness.api.indicator(), 'volume-zero unlock suppression must not hide the readiness indicator');
});

test('audio initialized before stopwatch creation prevents an unnecessary indicator', () => {
  const harness = indicatorHarness({ audioMode: 'running' });
  assert.equal(harness.api.ready(), true);
  harness.api.ensureStopwatch();
  assert.equal(harness.api.indicator(), null);
});

test('indicator repositions beside stopwatch width changes without changing readiness', () => {
  const harness = indicatorHarness();
  harness.api.ensureStopwatch();
  assert.equal(harness.api.indicator().style.right, '144px');

  harness.setStopwatchWidth(200);
  harness.api.position();
  assert.equal(harness.api.indicator().style.right, '224px');
  assert.equal(harness.api.ready(), false);
});

test('AudioContext statechange uses the same readiness state instead of a polling detector', async () => {
  const harness = indicatorHarness({ audioMode: 'resume-running' });
  harness.api.ensureStopwatch();
  await harness.api.unlock();
  assert.equal(harness.api.indicator(), null);

  harness.api.setAudioState('suspended');
  assert.ok(harness.api.indicator(), 'authoritative AudioContext statechange must expose lost readiness');
  harness.api.setAudioState('running');
  assert.equal(harness.api.indicator(), null, 'restored running state removes the indicator again');

  const unlock = productionFunctionSource('unlockAgentSoundAudio');
  assert.match(unlock, /addEventListener\(['"]statechange['"]/);
  const sync = productionFunctionSource('agentSoundSyncInitializationIndicator');
  assert.doesNotMatch(sync, /setInterval|setTimeout/,
    'readiness status must not add an independent polling or delayed fallback detector');
});
