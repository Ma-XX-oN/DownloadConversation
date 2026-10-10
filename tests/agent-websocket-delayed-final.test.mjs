import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const functions = [
  'agentTerminalWebSocketMessageExchangeId',
  'agentTerminalCaptureHasExchange',
  'agentTerminalObserveConversationUpdateFrame',
  'captureGenerationWebSocketFrame'
];

function harness(captures) {
  const observed = [];
  const diagnostics = [];
  const context = {
    agentTerminalLifecycleCaptures: captures,
    streamTailCapture: null,
    observed,
    diagnostics,
    logDiagnostic(_level, name, data) { diagnostics.push({ name, data }); },
    streamTailUpsertMessage(capture, message) {
      capture.stream_messages.push(message);
      return true;
    },
    agentTerminalObserve(capture) { observed.push(capture); },
    agentTerminalObserveConversationTurnCompleteFrame() {},
    streamTailConsumeWebSocketMessage() {}
  };
  vm.runInNewContext(functions.map(productionFunctionSource).join('\n') +
    '\nthis.receive = captureGenerationWebSocketFrame;', context);
  return context;
}

function assistant(exchange, id = 'final') {
  return {
    id,
    author: { role: 'assistant' },
    metadata: { turn_exchange_id: exchange },
    channel: 'final',
    end_turn: true,
    status: 'finished_successfully'
  };
}

function update(conversation, messages) {
  return JSON.stringify({
    type: 'conversation-update',
    payload: {
      conversation_id: conversation,
      update_type: 'add-messages',
      update_content: { messages }
    }
  });
}

function capture(conversation, exchange) {
  return {
    conversation_id: conversation,
    request_messages: [{ author: { role: 'user' }, metadata: {
      turn_exchange_id: exchange
    } }],
    stream_messages: [],
    agent_terminal_success_observed: false,
    agent_terminal_error_observed: false
  };
}

test('delayed WebSocket final reaches only the matching unresolved exchange', () => {
  const first = capture('chat', 'exchange-a');
  const second = capture('chat', 'exchange-b');
  const h = harness([first, second]);
  h.receive(update('chat', [assistant('exchange-a')]));
  assert.equal(h.observed.length, 1);
  assert.equal(h.observed[0], first);
  assert.equal(first.stream_messages.length, 1);
  assert.equal(second.stream_messages.length, 0);
});

test('wrong conversation, missing exchange, and ambiguous ownership do not complete', () => {
  const a = capture('chat', 'exchange-a');
  const b = capture('chat', 'exchange-a');
  const h = harness([a, b]);
  h.receive(update('other', [assistant('exchange-a')]));
  h.receive(update('chat', [assistant('other-exchange')]));
  h.receive(update('chat', [assistant('exchange-a')]));
  h.receive(update('chat', [assistant(null)]));
  assert.equal(h.observed.length, 0);
  assert.equal(a.stream_messages.length, 0);
  assert.equal(b.stream_messages.length, 0);
});

test('already-terminal lifecycle capture cannot be reopened by a delayed update', () => {
  const terminal = capture('chat', 'exchange-a');
  terminal.agent_terminal_success_observed = true;
  const h = harness([terminal]);
  h.receive(update('chat', [assistant('exchange-a')]));
  assert.equal(h.observed.length, 0);
  assert.equal(terminal.stream_messages.length, 0);
});
