import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function optionalProductionFunctionSource(name, fallback) {
  try {
    return productionFunctionSource(name);
  } catch {
    return fallback;
  }
}

function commentaryCapture(exchangeId = 'exchange-A') {
  return {
    conversation_id: 'conversation-1',
    parent_message_id: `parent-${exchangeId}`,
    request_messages: [{
      id: `user-${exchangeId}`,
      author: { role: 'user' },
      metadata: { request_id: `request-${exchangeId}` }
    }],
    stream_messages: [{
      id: `assistant-commentary-${exchangeId}`,
      author: { role: 'assistant' },
      channel: 'commentary',
      status: 'finished_successfully',
      end_turn: false,
      metadata: {
        turn_exchange_id: exchangeId,
        working_turn_id: exchangeId,
        request_id: `request-${exchangeId}`
      }
    }],
    agent_terminal_success_observed: false,
    agent_terminal_error_observed: false,
    handed_off: false,
    handoff_topic_id: null
  };
}

function providerFrame(conversationId = 'conversation-1') {
  return JSON.stringify([{
    type: 'message',
    topic_id: 'conversations',
    payload: {
      type: 'conversation-turn-complete',
      payload: { conversation_id: conversationId },
      metadata: null
    }
  }]);
}

function terminalSourceBlock() {
  return `
    ${productionFunctionSource('agentTerminalIsPollingTimeout')}
    ${productionFunctionSource('agentTerminalHasFinishedAssistant')}
    ${productionFunctionSource('agentTerminalIsConversationTurnComplete')}
    ${productionFunctionSource('agentTerminalSuccessfulFinal')}
    ${productionFunctionSource('agentTerminalExchangeId')}
    ${productionFunctionSource('agentTerminalKey')}
    ${productionFunctionSource('agentTerminalClassifyKind')}
    ${productionFunctionSource('agentTerminalNormalize')}
  `;
}

function normalizeHarness() {
  const context = { performance: { now: () => 45000 } };
  vm.runInNewContext(`
    ${terminalSourceBlock()}
    this.normalize = agentTerminalNormalize;
  `, context);
  return context;
}

function lifecycleHarness(capture = commentaryCapture()) {
  const context = {
    capture,
    sounds: [],
    stopwatch: [],
    favicon: [],
    diagnostics: []
  };
  vm.runInNewContext(`
    let streamTailCapture = this.capture;
    let agentTerminalLifecycleCapture = null;
    const agentTerminalLifecycleCaptures = [];
    const AGENT_TERMINAL_LIFECYCLE_CAPTURE_LIMIT = 16;
    const performance = { now: () => 45000 };
    function logDiagnostic(level, name, details) {
      this.diagnostics.push({ level, name, details });
    }
    function agentSoundHandleTerminal(terminal) { this.sounds.push(terminal); }
    function agentStopwatchHandleTerminal(terminal) { this.stopwatch.push(terminal); }
    function agentFaviconHandleTerminal(terminal) { this.favicon.push(terminal); }
    const agentTerminalHandlers = Object.freeze([
      agentSoundHandleTerminal,
      agentStopwatchHandleTerminal,
      agentFaviconHandleTerminal
    ]);
    function streamTailConsumeWebSocketMessage() {}
    ${terminalSourceBlock()}
    ${productionFunctionSource('agentTerminalObserve')}
    ${optionalProductionFunctionSource(
      'agentTerminalRegisterLifecycleCapture',
      'function agentTerminalRegisterLifecycleCapture(capture) { agentTerminalLifecycleCapture = capture; }'
    )}
    ${productionFunctionSource('agentTerminalObserveConversationTurnCompleteFrame')}
    ${productionFunctionSource('captureGenerationWebSocketFrame')}
    agentTerminalRegisterLifecycleCapture(this.capture);
    this.receive = captureGenerationWebSocketFrame;
    this.observeProviderFrame = agentTerminalObserveConversationTurnCompleteFrame;
    this.register = agentTerminalRegisterLifecycleCapture;
  `, context);
  return context;
}

test('commentary finished_successfully remains nonterminal without provider completion', () => {
  const context = normalizeHarness();
  assert.equal(context.normalize(commentaryCapture(), null), null);
});

test('provider conversation-turn-complete promotes corroborated commentary-only completion through the shared normalizer', () => {
  const context = normalizeHarness();
  const capture = commentaryCapture();
  const terminal = context.normalize(capture, {
    type: 'provider_conversation_turn_complete',
    conversation_id: 'conversation-1'
  });

  assert.equal(terminal.kind, 'success');
  assert.equal(terminal.conversation_id, 'conversation-1');
  assert.equal(terminal.exchange_id, 'exchange-A',
    'The exchange identity must come from structured streamed Assistant metadata when no final message exists.');
  assert.equal(terminal.terminal_key, 'conversation-1:exchange-A');
  assert.equal(terminal.completed_at_ms, 45000);
});

test('provider completion does not infer success without finished Assistant evidence', () => {
  const context = normalizeHarness();
  const capture = commentaryCapture();
  capture.stream_messages[0].status = 'in_progress';
  assert.equal(context.normalize(capture, {
    type: 'provider_conversation_turn_complete',
    conversation_id: 'conversation-1'
  }), null);
});

test('provider completion for another conversation does not normalize the active capture', () => {
  const context = normalizeHarness();
  assert.equal(context.normalize(commentaryCapture(), {
    type: 'provider_conversation_turn_complete',
    conversation_id: 'conversation-2'
  }), null);
});

test('captured provider completion reaches all shared terminal consumers without requiring a stream-handoff topic', () => {
  const context = lifecycleHarness();

  context.receive(providerFrame());

  assert.equal(context.sounds.length, 1);
  assert.equal(context.stopwatch.length, 1);
  assert.equal(context.favicon.length, 1);
  assert.equal(context.sounds[0], context.stopwatch[0]);
  assert.equal(context.sounds[0], context.favicon[0]);
  assert.equal(context.sounds[0].kind, 'success');
  assert.equal(context.sounds[0].exchange_id, 'exchange-A');
  assert.equal(context.capture.agent_terminal_success_observed, true);
});

test('duplicate provider completion is suppressed before a second normalized fan-out', () => {
  const context = lifecycleHarness();

  context.receive(providerFrame());
  context.receive(providerFrame());

  assert.equal(context.sounds.length, 1);
  assert.equal(context.stopwatch.length, 1);
  assert.equal(context.favicon.length, 1);
});

test('provider completion cannot convert a capture whose structured terminal error was already observed', () => {
  const capture = commentaryCapture();
  capture.agent_terminal_error_observed = true;
  const context = lifecycleHarness(capture);

  context.receive(providerFrame());

  assert.equal(context.sounds.length, 0);
  assert.equal(context.stopwatch.length, 0);
  assert.equal(context.favicon.length, 0);
});

test('provider completion is correlated to the lifecycle capture conversation identity', () => {
  const context = lifecycleHarness();

  context.receive(providerFrame('conversation-2'));

  assert.equal(context.sounds.length, 0);
  assert.equal(context.stopwatch.length, 0);
  assert.equal(context.favicon.length, 0);
});

test('a delayed completion resolves the oldest unresolved same-conversation capture, not a newer exchange', () => {
  const older = commentaryCapture('exchange-A');
  const newer = commentaryCapture('exchange-B');
  const context = lifecycleHarness(older);
  context.register(newer);

  context.receive(providerFrame());

  assert.equal(context.sounds.length, 1);
  assert.equal(context.sounds[0].exchange_id, 'exchange-A',
    'A delayed completion from an older turn must not terminate the newer same-conversation exchange.');
  assert.equal(older.agent_terminal_success_observed, true);
  assert.equal(newer.agent_terminal_success_observed, false);

  context.receive(providerFrame());
  assert.equal(context.sounds.length, 2);
  assert.equal(context.sounds[1].exchange_id, 'exchange-B');
  assert.equal(newer.agent_terminal_success_observed, true);
});

test('generation and resume capture paths register shared lifecycle captures before stream consumption', () => {
  const generation = productionFunctionSource('captureGenerationStreamRequest');
  const resume = productionFunctionSource('captureConversationResumeStreamResponse');
  const registerCall = /const capture = createStreamTailCapture\(conversationId\);\s*(?:agentTerminalLifecycleCapture = capture|agentTerminalRegisterLifecycleCapture\(capture\));/;

  assert.match(generation, registerCall);
  assert.match(resume, registerCall);
});
