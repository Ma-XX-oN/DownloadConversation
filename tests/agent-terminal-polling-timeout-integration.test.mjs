import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/agent-terminal-polling-timeout.json', import.meta.url),
  'utf8'
));

test('captured polling timeout drives the real shared terminal consumers', async () => {
  const context = {
    URL,
    payload: fixture.stats_flush,
    diagnostics: [],
    sounds: [],
    faviconStates: [],
    performance: { now: () => 45000 },
    location: {
      href: 'https://chatgpt.com/c/conversation-1',
      origin: 'https://chatgpt.com'
    },
    document: { addEventListener() {} }
  };

  vm.runInNewContext(`
    const streamTailCapture = {
      conversation_id: 'conversation-1',
      parent_message_id: 'parent-1',
      request_messages: [{
        id: 'user-1',
        author: { role: 'user' },
        metadata: {
          request_id: 'request-1',
          turn_exchange_id: 'exchange-A',
          working_turn_id: 'exchange-A'
        }
      }],
      stream_messages: []
    };
    let agentSoundVolume = 10;
    let agentSoundAudioContext = { state: 'running' };
    const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;
    const agentSoundTerminalKeys = new Set();
    let agentSoundPendingTerminal = null;
    let agentStopwatchState = {
      active: true,
      exchange_id: 'exchange-A',
      started_at_ms: 5000,
      lap_started_at_ms: 5000,
      laps_ms: [],
      total_ms: null,
      pending_submission_at_ms: 6000,
      pending_message_id: 'pending-1'
    };
    let agentFaviconProcessingObserved = true;
    let stopped = false;
    let renderedAt = null;

    function cloneSafely(request) { return request; }
    function boundedDiagnosticText(value) { return value; }
    function errorMessage(error) { return error?.message ?? String(error); }
    function logDiagnostic(level, name, details) {
      this.diagnostics.push({ level, name, details });
    }
    function playAgentSound(kind) { this.sounds.push(kind); return true; }
    function agentSoundHandleUserGesture() {}
    function agentStopwatchRecordLap(at) {
      agentStopwatchState.laps_ms.push(at - agentStopwatchState.lap_started_at_ms);
    }
    function agentStopwatchStopTimer() { stopped = true; }
    function agentStopwatchRender(at) { renderedAt = at; }
    function agentFaviconRenderState(state) {
      this.faviconStates.push(state);
      return Promise.resolve(true);
    }

    ${productionFunctionSource('agentTerminalFailureFromStatsPayload')}
    ${productionFunctionSource('isAgentTerminalStatsUrl')}
    ${productionFunctionSource('agentTerminalIsPollingTimeout')}
    ${productionFunctionSource('agentTerminalSuccessfulFinal')}
    ${productionFunctionSource('agentTerminalExchangeId')}
    ${productionFunctionSource('agentTerminalKey')}
    ${productionFunctionSource('agentTerminalClassifyKind')}
    ${productionFunctionSource('agentTerminalNormalize')}
    ${productionFunctionSource('agentSoundRememberTerminalKey')}
    ${productionFunctionSource('agentSoundRememberPendingTerminal')}
    ${productionFunctionSource('agentSoundClearPendingTerminal')}
    ${productionFunctionSource('agentSoundHandleTerminal')}
    ${productionFunctionSource('agentStopwatchHandleTerminal')}
    ${productionFunctionSource('agentFaviconHandleTerminal')}
    const agentTerminalHandlers = Object.freeze([
      agentSoundHandleTerminal,
      agentStopwatchHandleTerminal,
      agentFaviconHandleTerminal
    ]);
    ${productionFunctionSource('agentTerminalObserve')}
    ${productionFunctionSource('agentTerminalObserveStatsRequest')}

    this.run = () => agentTerminalObserveStatsRequest({
      async text() { return JSON.stringify(payload); }
    }, 'https://chatgpt.com/ces/statsc/flush', 'POST');
    this.stopwatch = () => ({ ...agentStopwatchState, laps_ms: [...agentStopwatchState.laps_ms] });
    this.stopped = () => stopped;
    this.renderedAt = () => renderedAt;
    this.faviconProcessingObserved = () => agentFaviconProcessingObserved;
  `, context);

  await context.run();

  assert.deepEqual(context.sounds, ['error']);
  assert.deepEqual(context.faviconStates, ['error']);
  assert.equal(context.faviconProcessingObserved(), false);

  const stopwatch = context.stopwatch();
  assert.equal(stopwatch.active, false);
  assert.deepEqual(JSON.parse(JSON.stringify(stopwatch.laps_ms)), [40000]);
  assert.equal(stopwatch.total_ms, 40000);
  assert.equal(stopwatch.pending_submission_at_ms, null);
  assert.equal(stopwatch.pending_message_id, null);
  assert.equal(context.stopped(), true);
  assert.equal(context.renderedAt(), 45000);

  assert.equal(
    context.diagnostics.filter(entry => entry.name === 'agent-terminal-polling-timeout-observed').length,
    1
  );
  assert.equal(
    context.diagnostics.filter(entry => entry.name === 'agent-terminal-normalized').length,
    1
  );
  assert.equal(
    context.diagnostics.filter(entry => entry.name === 'agent-terminal-stats-request-parse-failed').length,
    0
  );
});
