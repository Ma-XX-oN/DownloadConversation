import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function pendingHarness(volume = 10, playbackResults = [false, true]) {
  const context = {
    emitted: [],
    playbackResults: [...playbackResults],
    diagnostics: []
  };

  vm.runInNewContext(`
    let agentSoundVolume = ${volume};
    let agentSoundAudioContext = null;
    const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;
    const agentSoundTerminalKeys = new Set();
    const agentSoundPendingTerminals = new Map();

    function playAgentSound(kind) {
      this.emitted.push(kind);
      return this.playbackResults.length ? this.playbackResults.shift() : true;
    }

    function logDiagnostic(level, name, details) {
      this.diagnostics.push({ level, name, details });
    }

    ${productionFunctionSource('agentSoundRememberTerminalKey')}
    ${productionFunctionSource('agentSoundRememberPendingTerminal')}
    ${productionFunctionSource('agentSoundRetryPendingTerminals')}
    ${productionFunctionSource('agentSoundHandleTerminal')}

    this.api = {
      observe(kind, terminalKey) {
        agentSoundHandleTerminal({ kind, terminal_key: terminalKey });
      },
      retry() {
        agentSoundRetryPendingTerminals();
      },
      setVolume(value) {
        agentSoundVolume = value;
      },
      keys() {
        return [...agentSoundTerminalKeys];
      },
      pending() {
        return [...agentSoundPendingTerminals.entries()];
      }
    };
  `, context);

  return context;
}

test('unavailable terminal playback is retained and later replayed exactly once', () => {
  const harness = pendingHarness(10, [false, true]);

  harness.api.observe('success', 'turn-1');
  assert.deepEqual(harness.emitted, ['success']);
  assert.deepEqual(Array.from(harness.api.keys()), [],
    'failed immediate playback must not consume the terminal key');
  assert.equal(harness.api.pending().length, 1,
    'failed immediate playback must retain one pending terminal cue');

  harness.api.retry();
  assert.deepEqual(harness.emitted, ['success', 'success'],
    'trusted-unlock retry must play the retained cue without another terminal observation');
  assert.equal(harness.api.pending().length, 0, 'successful retry must consume the pending cue');
  assert.equal(harness.api.keys().length, 1, 'successful retry must consume the terminal key exactly once');

  harness.api.retry();
  harness.api.observe('success', 'turn-1');
  assert.deepEqual(harness.emitted, ['success', 'success'],
    'later gestures and duplicate terminal observations must not replay a delivered cue');
});

test('pending success and later same-exchange error retain independent ordered cues', () => {
  const harness = pendingHarness(10, [false, false, true, true]);

  harness.api.observe('success', 'turn-1');
  harness.api.observe('error', 'turn-1');
  assert.deepEqual(harness.emitted, ['success', 'error']);
  assert.deepEqual(harness.api.pending().map(([, value]) => value.kind), ['success', 'error']);

  harness.api.retry();
  assert.deepEqual(harness.emitted, ['success', 'error', 'success', 'error']);
  assert.equal(harness.api.pending().length, 0);
  assert.equal(harness.api.keys().length, 2,
    'success and error for one exchange must remain independently de-duplicated');
});

test('duplicate unavailable terminal observation does not create or attempt a second pending cue', () => {
  const harness = pendingHarness(10, [false, true]);

  harness.api.observe('success', 'turn-1');
  harness.api.observe('success', 'turn-1');

  assert.deepEqual(harness.emitted, ['success'],
    'a terminal already pending must not repeatedly attempt playback while audio remains unavailable');
  assert.equal(harness.api.pending().length, 1);
});

test('volume zero suppresses new pending cues and clears retained cues before replay', () => {
  const disabled = pendingHarness(0, [false, true]);
  disabled.api.observe('success', 'turn-1');
  assert.deepEqual(disabled.emitted, []);
  assert.equal(disabled.api.pending().length, 0);

  const mutedAfterTerminal = pendingHarness(10, [false, true]);
  mutedAfterTerminal.api.observe('success', 'turn-2');
  assert.equal(mutedAfterTerminal.api.pending().length, 1);
  mutedAfterTerminal.api.setVolume(0);
  mutedAfterTerminal.api.retry();
  assert.deepEqual(mutedAfterTerminal.emitted, ['success'],
    'muting before unlock must not emit the retained cue');
  assert.equal(mutedAfterTerminal.api.pending().length, 0,
    'volume zero must discard retained terminal cues');
  assert.equal(mutedAfterTerminal.api.keys().length, 0,
    'a suppressed pending cue must not be marked as played');
});

test('successful audio unlock owns pending replay instead of requiring terminal re-observation', () => {
  const unlock = productionFunctionSource('unlockAgentSoundAudio');
  assert.match(unlock, /agentSoundRetryPendingTerminals\(\)/,
    'successful AudioContext unlock must trigger pending-cue replay');

  const terminal = productionFunctionSource('agentSoundHandleTerminal');
  assert.match(terminal, /agentSoundRememberPendingTerminal/,
    'failed immediate playback must be retained by the terminal consumer');
});
