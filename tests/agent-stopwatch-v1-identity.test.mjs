import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function harness() {
  let now = 1000;
  const output = { style: {}, textContent: '' };
  const diagnostics = [];
  const context = {
    atob,
    performance: { now: () => now },
    document: {
      getElementById: () => output,
      createElement: () => output,
      body: { append() {} }
    },
    setInterval: () => 1,
    clearInterval() {},
    logDiagnostic(_level, name, data) { diagnostics.push({ name, data }); }
  };
  const functions = [
    'assert',
    'agentStopwatchExchangeId',
    'agentStopwatchFormatDuration',
    'ensureAgentStopwatchControl',
    'agentStopwatchRender',
    'agentStopwatchStartTimer',
    'agentStopwatchStopTimer',
    'agentStopwatchStartNew',
    'agentStopwatchRecordLap',
    'agentStopwatchObserveRequest',
    'agentStopwatchObserveInputMessage',
    'agentStopwatchBindExchange',
    'agentStopwatchResumeTokenExchange',
    'agentStopwatchObserveProviderIdentity',
    'agentTerminalObserve',
    'agentTerminalSuccessfulFinal',
    'agentTerminalExchangeId',
    'agentStopwatchHandleTerminal'
  ];
  vm.runInNewContext(`
    const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';
    const AGENT_STOPWATCH_REFRESH_MS = 250;
    let agentStopwatchState = null;
    let agentStopwatchTimer = null;
    ${functions.map(productionFunctionSource).join('\n')}
    function agentTerminalNormalize(_capture, event) { return event?.terminal ?? null; }
    const agentTerminalHandlers = Object.freeze([agentStopwatchHandleTerminal]);
    this.api = {
      terminal(capture, exchangeId, atMs) {
        return agentTerminalObserve(capture, { terminal: {
          kind: 'success', exchange_id: exchangeId, completed_at_ms: atMs
        } });
      },
      request: agentStopwatchObserveRequest,
      identify: agentStopwatchObserveProviderIdentity,
      handle: agentStopwatchHandleTerminal,
      state: () => agentStopwatchState
    };
  `, context);
  return {
    ...context.api,
    diagnostics,
    setNow(value) { now = value; }
  };
}

function capture(submitted, id) {
  return {
    stopwatch_submitted_at_ms: submitted,
    conversation_id: 'chat-1',
    request_messages: [{ id, author: { role: 'user' }, metadata: {} }],
    stream_messages: []
  };
}

function resumeToken(exchangeId) {
  const payload = Buffer.from(JSON.stringify({
    turn_topic_id: 'conversation-turn-' + exchangeId
  })).toString('base64url');
  return {
    type: 'resume_conversation_token',
    conversation_id: 'chat-1',
    token: 'header.' + payload + '.signature'
  };
}

test('recorded V1 shape binds exchange before terminal even without input_message', () => {
  const h = harness();
  const a = capture(1000, 'user-a');
  h.request(a);
  assert.equal(h.state().exchange_id, null);
  h.identify(a, resumeToken('exchange-a'));
  assert.equal(h.state().exchange_id, 'exchange-a');
  assert.equal(a.stopwatch_exchange_id, 'exchange-a');
  h.setNow(30000);
  h.handle({ kind: 'success', exchange_id: 'exchange-a', completed_at_ms: 30000 });
  assert.equal(h.state().active, false);
  assert.equal(h.state().total_ms, 29000);
  const b = capture(31000, 'user-b');
  h.request(b);
  assert.equal(h.state().active, true);
  assert.equal(h.state().started_at_ms, 31000);
});

test('a new request replaces stale unidentified active run on first authoritative ID', () => {
  const h = harness();
  const a = capture(1000, 'user-a');
  h.request(a);
  const b = capture(12000, 'user-b');
  h.request(b);
  h.identify(b, resumeToken('exchange-b'));
  assert.equal(h.state().exchange_id, 'exchange-b');
  assert.equal(h.state().started_at_ms, 12000);
  assert.deepEqual(Array.from(h.state().laps_ms), []);
  h.identify(a, resumeToken('exchange-a'));
  assert.equal(h.state().exchange_id, 'exchange-b');
});

test('late metadata for older capture cannot rebind a new run', () => {
  const h = harness();
  const a = capture(1000, 'user-a');
  h.request(a);
  h.identify(a, resumeToken('exchange-a'));
  const b = capture(2000, 'user-b');
  h.request(b);
  h.identify(b, resumeToken('exchange-b'));
  assert.equal(h.state().exchange_id, 'exchange-b');
  assert.equal(h.state().started_at_ms, 2000);
  h.identify(a, resumeToken('exchange-a'));
  assert.equal(h.state().exchange_id, 'exchange-b');
  assert.equal(h.state().active, true);
});

test('conflicting exchange identity does not overwrite the bound capture', () => {
  const h = harness();
  const a = capture(1000, 'user-a');
  h.request(a);
  h.identify(a, resumeToken('exchange-a'));
  h.identify(a, resumeToken('exchange-b'));
  assert.equal(h.state().exchange_id, 'exchange-a');
  assert.ok(h.diagnostics.some(item =>
    item.name === 'agent-stopwatch-exchange-identity-conflict'
  ));
});

test('late prior completion during unidentified new request is rejected', () => {
  const h = harness();
  const old = capture(1000, 'user-old');
  h.request(old);
  h.identify(old, resumeToken('exchange-old'));
  const next = capture(5000, 'user-new');
  h.request(next);
  h.identify(old, resumeToken('exchange-old'));
  assert.equal(h.state().pending_capture, next);
  const rejected = h.terminal(old, 'exchange-old', 6000);
  assert.equal(rejected, null);
  assert.equal(h.state().active, true);
  h.identify(next, resumeToken('exchange-new'));
  assert.equal(h.state().exchange_id, 'exchange-new');
  const accepted = h.terminal(next, 'exchange-new', 9000);
  assert.equal(accepted?.kind, 'success');
  assert.equal(h.state().active, false);
});

test('same exchange on a subsequent prompt preserves total and records lap', () => {
  const h = harness();
  const a = capture(1000, 'user-a');
  h.request(a);
  h.identify(a, resumeToken('exchange-a'));
  const b = capture(11000, 'user-b');
  h.request(b);
  h.identify(b, resumeToken('exchange-a'));
  assert.equal(h.state().started_at_ms, 1000);
  assert.deepEqual(Array.from(h.state().laps_ms), [10000]);
});

test('unrelated conversation token does not bind active run', () => {
  const h = harness();
  const a = capture(1000, 'user-a');
  h.request(a);
  h.identify(a, { ...resumeToken('exchange-a'), conversation_id: 'other' });
  assert.equal(h.state().exchange_id, null);
});
