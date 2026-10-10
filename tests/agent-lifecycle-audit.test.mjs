import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { downloadConversationSource, productionFunctionSource } from './helpers/userscript-source.mjs';

function auditHarness() {
  const context = { entries: [], persisted: 0, refreshed: 0 };
  vm.runInNewContext(`
    let agentLifecycleState = 'unknown';
    let agentLifecycleTransitionSequence = 0;
    let agentLifecycleTransitionId = null;
    const diagnosticLog = this.entries;
    const MAX_DIAGNOSTIC_LOG_ITEMS = 100;
    function logConsoleDiagnostic() {}
    const DIAGNOSTIC_LEVELS = Object.freeze({ errors: 0, warnings: 1, debug: 2, verbose: 3 });
    let diagnosticsLevel = 'warnings';
    ${productionFunctionSource('diagnosticEnabled')}
    function redactDiagnosticSignedTokens(value) { return value; }
    function schedulePersistDiagnosticLog() { this.persisted += 1; }
    function refreshDiagnosticLog() { this.refreshed += 1; }
    ${productionFunctionSource('logDiagnostic')}
    ${productionFunctionSource('agentLifecycleTransition')}
    ${productionFunctionSource('agentLifecycleAction')}
    this.api = {
      transition: agentLifecycleTransition,
      action: agentLifecycleAction,
      debug: () => logDiagnostic('debug', 'suppressed-debug')
    };
  `, context);
  return context;
}

test('lifecycle entries bypass warnings-only diagnostic filter and are persisted', () => {
  const harness = auditHarness();
  harness.api.transition('processing', { conversation_id: 'conversation-1' });
  harness.api.action('stopwatch', 'started');
  assert.equal(harness.entries.length, 2);
  assert.equal(harness.persisted, 2);
  assert.equal(harness.refreshed, 2);
  assert.equal(harness.entries[0].level, 'lifecycle');
  assert.equal(harness.entries[1].data.transition_id, harness.entries[0].data.transition_id);
  assert.equal(harness.entries[1].data.component, 'stopwatch');
  assert.equal(harness.entries[1].data.action, 'started');
});

test('repeated state observation does not generate another state change', () => {
  const harness = auditHarness();
  const first = harness.api.transition('processing');
  assert.equal(harness.api.transition('processing'), first);
  assert.equal(harness.entries.length, 1);
  const second = harness.api.transition('completed', { terminal_key: 'turn-A' });
  assert.equal(second, first + 1);
  assert.equal(harness.entries.length, 2);
  assert.equal(harness.entries[1].data.previous_state, 'processing');
  assert.equal(harness.entries[1].data.state, 'completed');
});

test('late asynchronous consumer outcome retains its initiating transition', () => {
  const harness = auditHarness();
  const processing = harness.api.transition('processing');
  harness.api.transition('completed');
  harness.api.action('favicon', 'superseded', { state: 'processing' }, processing);
  assert.equal(harness.entries[2].data.transition_id, processing);
  assert.equal(harness.entries[2].data.action, 'superseded');
});

test('unrelated debug records are still filtered', () => {
  const harness = auditHarness();
  harness.api.debug();
  assert.equal(harness.entries.length, 0);
});

test('sound startup and explicit changes retain source and volume at warning threshold', () => {
  assert.ok(downloadConversationSource.includes("'agent-sound-volume-initialized'"));
  assert.ok(downloadConversationSource.includes('source: initialSoundVolume !== null'));
  assert.ok(downloadConversationSource.includes("'agent-sound-volume-changed'"));
  assert.ok(downloadConversationSource.includes("source: 'user-input'"));
  assert.ok(downloadConversationSource.includes("logDiagnostic('lifecycle', 'agent-sound-volume-initialized'"));
  assert.ok(downloadConversationSource.includes("logDiagnostic('lifecycle', 'agent-sound-volume-changed'"));
});

test('sound initialization resolves saved, legacy, default and malformed preferences', () => {
  const cases = [
    { saved: null, legacy: null, volume: 0, source: 'default', valid: true },
    { saved: null, legacy: 'true', volume: 10, source: 'legacy-preference', valid: true },
    { saved: null, legacy: 'false', volume: 0, source: 'legacy-preference', valid: true },
    { saved: '7', legacy: 'false', volume: 7, source: 'saved-volume', valid: true },
    { saved: '0', legacy: 'true', volume: 0, source: 'saved-volume', valid: true },
    { saved: '12', legacy: null, volume: 10, source: 'saved-volume', valid: true },
    { saved: 'invalid', legacy: 'true', volume: 0, source: 'saved-volume', valid: false }
  ];
  const begin = downloadConversationSource.indexOf(
    '  const initialSoundVolume = localStorage.getItem(AGENT_SOUND_VOLUME_STORAGE_KEY);'
  );
  const end = downloadConversationSource.indexOf('  installNetworkCapture();', begin);
  assert.ok(begin >= 0 && end > begin, 'actual startup logging source must be present');
  const startup = downloadConversationSource.slice(begin, end);
  for (const item of cases) {
    const records = [];
    const storage = new Map();
    if (item.saved !== null) storage.set('volume', item.saved);
    if (item.legacy !== null) storage.set('legacy', item.legacy);
    const context = {
      localStorage: { getItem: key => storage.get(key) ?? null },
      records,
      AGENT_SOUND_VOLUME_STORAGE_KEY: 'volume',
      LEGACY_AGENT_SOUNDS_STORAGE_KEY: 'legacy',
      logDiagnostic(level, message, data) { records.push({ level, message, data }); }
    };
    vm.runInNewContext(`
      ${productionFunctionSource('loadAgentSoundVolume')}
      const agentSoundVolume = loadAgentSoundVolume();
      ${startup}
      this.resolvedVolume = agentSoundVolume;
    `, context);
    assert.equal(context.resolvedVolume, item.volume);
    assert.equal(records.length, 1);
    assert.equal(records[0].level, 'lifecycle');
    assert.equal(records[0].message, 'agent-sound-volume-initialized');
    assert.equal(records[0].data.volume, item.volume);
    assert.equal(records[0].data.source, item.source);
    assert.equal(records[0].data.valid_saved_value, item.valid);
  }
});

test('muted terminal sound is suppressed and recorded once per terminal kind', () => {
  const context = { entries: [], document: { addEventListener() {} } };
  vm.runInNewContext(`
    let agentSoundVolume = 0;
    let agentSoundAudioContext = null;
    let agentSoundPendingTerminal = null;
    const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;
    const agentSoundTerminalKeys = new Set();
    function logDiagnostic(level, name, details) {
      this.entries.push({ level, name, details });
    }
    function agentLifecycleAction(component, action, details) {
      this.entries.push({ level: 'lifecycle', name: component + ':' + action, details });
    }
    function playAgentSound() { throw new Error('Muted sound must never play'); }
    function agentSoundHandleUserGesture() {}
    ${productionFunctionSource('agentSoundRememberTerminalKey')}
    ${productionFunctionSource('agentSoundClearPendingTerminal')}
    ${productionFunctionSource('agentSoundHandleTerminal')}
    this.observe = agentSoundHandleTerminal;
    this.keys = () => Array.from(agentSoundTerminalKeys);
  `, context);
  const terminal = { kind: 'success', terminal_key: 'conversation-1:exchange-A' };
  context.observe(terminal);
  context.observe(terminal);
  assert.equal(context.entries.filter(entry =>
    entry.name === 'sound:suppressed').length, 1);
  assert.equal(context.keys().length, 1);
  context.observe({ ...terminal, kind: 'error' });
  assert.equal(context.entries.filter(entry =>
    entry.name === 'sound:suppressed').length, 2);
});
