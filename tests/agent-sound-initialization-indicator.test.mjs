import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function indicatorHarness({ volume = 10, audioMode = 'absent' } = {}) {
  const elements = new Map();

  function makeElement(tagName) {
    const attributes = new Map();
    return {
      tagName: String(tagName).toUpperCase(),
      id: '',
      textContent: '',
      attributes,
      children: [],
      append(child) {
        this.children.push(child);
        if (child?.id) elements.set(child.id, child);
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      removeAttribute(name) {
        attributes.delete(name);
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      hasAttribute(name) {
        return attributes.has(name);
      }
    };
  }

  const root = makeElement('html');
  const head = makeElement('head');
  root.append(head);

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
    head,
    documentElement: root,
    addEventListener() {},
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement(tagName) {
      return makeElement(tagName);
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
    const AGENT_SOUND_INITIALIZATION_ATTRIBUTE = 'data-tm-agent-sound-uninitialized';
    const AGENT_SOUND_INITIALIZATION_STYLE_ID = 'tm-agent-sound-uninitialized-style';
    const AGENT_SOUND_INITIALIZATION_GAP_PX = 8;
    let agentSoundVolume = ${volume};
    let agentSoundAudioContext = ${audioMode === 'running' ? 'new window.AudioContext()' : 'null'};
    let agentSoundPendingTerminal = null;
    function agentSoundClearPendingTerminal() { agentSoundPendingTerminal = null; }
    function agentSoundRetryPendingTerminal() {}
    function errorMessage(error) { return String(error?.message ?? error); }
    function logDiagnostic(level, name, details) { this.diagnostics.push({ level, name, details }); }
    ${productionFunctionSource('agentSoundAudioReady')}
    ${productionFunctionSource('agentSoundInitializationIndicatorCss')}
    ${productionFunctionSource('ensureAgentSoundInitializationIndicatorStyle')}
    ${productionFunctionSource('agentSoundSyncInitializationIndicator')}
    ${productionFunctionSource('unlockAgentSoundAudio')}
    this.api = {
      sync() { return agentSoundSyncInitializationIndicator(); },
      unlock() { return unlockAgentSoundAudio(); },
      ready() { return agentSoundAudioReady(); },
      rootHasIndicatorState() {
        return document.documentElement.hasAttribute(AGENT_SOUND_INITIALIZATION_ATTRIBUTE);
      },
      style() { return document.getElementById(AGENT_SOUND_INITIALIZATION_STYLE_ID); },
      setAudioState(value) {
        if (!agentSoundAudioContext) return;
        agentSoundAudioContext.state = value;
        agentSoundAudioContext.listeners?.get('statechange')?.();
      }
    };
  `, context);

  return { api: context.api, root, head };
}

test('refresh startup projects one disabled-speaker indicator beside the stopwatch when audio is absent', () => {
  const harness = indicatorHarness();
  assert.equal(harness.api.sync(), false, 'absent Web Audio must not report ready');
  assert.equal(harness.api.rootHasIndicatorState(), true,
    'startup must project the uninitialized state onto the document root');

  const style = harness.api.style();
  assert.ok(style, 'startup must install the indicator style exactly once');
  assert.match(style.textContent, /#tm-agent-turn-stopwatch::before/);
  assert.match(style.textContent, /right:\s*calc\(100% \+ 8px\)/,
    'indicator must be immediately left of the stopwatch regardless of stopwatch width');
  assert.match(style.textContent, /top:\s*0/,
    'indicator top must align with the stopwatch top');
  assert.match(style.textContent, /border-radius:\s*50%/,
    'indicator must include the requested enclosing circle');
  assert.match(style.textContent, /data:image\/svg\+xml/,
    'indicator must use an internal vector speaker/slash graphic rather than an external asset');

  harness.api.sync();
  assert.equal(harness.head.children.filter(child => child.id === style.id).length, 1,
    'repeated startup/sync must not duplicate the indicator style');
});

test('successful trusted AudioContext resume removes the indicator immediately and it does not resurrect', async () => {
  const harness = indicatorHarness({ audioMode: 'resume-running' });
  harness.api.sync();
  assert.equal(harness.api.rootHasIndicatorState(), true);

  assert.equal(await harness.api.unlock(), true);
  assert.equal(harness.api.ready(), true);
  assert.equal(harness.api.rootHasIndicatorState(), false,
    'ready audio removes the uninitialized status immediately');

  harness.api.sync();
  assert.equal(harness.api.rootHasIndicatorState(), false,
    'later status synchronization must not recreate the indicator while audio remains ready');
});

test('unavailable or still-suspended audio keeps the indicator visible', async () => {
  const unavailable = indicatorHarness({ audioMode: 'unavailable' });
  unavailable.api.sync();
  assert.equal(await unavailable.api.unlock(), false);
  assert.equal(unavailable.api.rootHasIndicatorState(), true,
    'missing AudioContext support must leave the indicator visible');

  const suspended = indicatorHarness({ audioMode: 'suspended' });
  suspended.api.sync();
  assert.equal(await suspended.api.unlock(), false);
  assert.equal(suspended.api.rootHasIndicatorState(), true,
    'a context that remains suspended is not ready for playback');
});

test('indicator represents readiness rather than the volume preference', async () => {
  const harness = indicatorHarness({ volume: 0 });
  harness.api.sync();
  assert.equal(harness.api.rootHasIndicatorState(), true,
    'volume zero must not masquerade as initialized audio');
  assert.equal(await harness.api.unlock(), false);
  assert.equal(harness.api.rootHasIndicatorState(), true,
    'volume-zero unlock suppression must not hide the readiness indicator');
});

test('already-running audio suppresses the uninitialized indicator', () => {
  const harness = indicatorHarness({ audioMode: 'running' });
  assert.equal(harness.api.ready(), true);
  assert.equal(harness.api.sync(), true);
  assert.equal(harness.api.rootHasIndicatorState(), false);
});

test('AudioContext statechange uses the same readiness state instead of a polling detector', async () => {
  const harness = indicatorHarness({ audioMode: 'resume-running' });
  harness.api.sync();
  await harness.api.unlock();
  assert.equal(harness.api.rootHasIndicatorState(), false);

  harness.api.setAudioState('suspended');
  assert.equal(harness.api.rootHasIndicatorState(), true,
    'authoritative AudioContext statechange must expose lost readiness');
  harness.api.setAudioState('running');
  assert.equal(harness.api.rootHasIndicatorState(), false,
    'restored running state removes the indicator again');

  const unlock = productionFunctionSource('unlockAgentSoundAudio');
  assert.match(unlock, /addEventListener\(['"]statechange['"]\s*,\s*agentSoundSyncInitializationIndicator/);
  const sync = productionFunctionSource('agentSoundSyncInitializationIndicator');
  assert.doesNotMatch(sync, /setInterval|setTimeout|MutationObserver/,
    'readiness status must not add an independent polling, delay, or DOM-observer detector');
});

test('indicator projection leaves stopwatch layout ownership untouched', () => {
  const sync = productionFunctionSource('agentSoundSyncInitializationIndicator');
  assert.doesNotMatch(sync, /style\.|offsetWidth|getBoundingClientRect/,
    'readiness projection must not rewrite stopwatch geometry');
  const css = productionFunctionSource('agentSoundInitializationIndicatorCss');
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /right:\s*calc\(100% \+ \$\{AGENT_SOUND_INITIALIZATION_GAP_PX\}px\)/);
});
