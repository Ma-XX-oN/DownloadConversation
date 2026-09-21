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

function commentaryCapture() {
  return {
    conversation_id: 'conversation-1',
    parent_message_id: 'parent-1',
    request_messages: [{
      id: 'user-1',
      author: { role: 'user' },
      metadata: {
        turn_exchange_id: 'exchange-A',
        working_turn_id: 'exchange-A',
        request_id: 'request-1'
      }
    }],
    stream_messages: [{
      id: 'assistant-commentary-1',
      author: { role: 'assistant' },
      channel: 'commentary',
      status: 'finished_successfully',
      end_turn: false,
      metadata: {
        turn_exchange_id: 'exchange-A',
        working_turn_id: 'exchange-A',
        request_id: 'request-1'
      }
    }],
    agent_terminal_success_observed: false,
    agent_terminal_error_observed: false,
    handed_off: false,
    handoff_topic_id: null
  };
}

function frame(conversationId = 'conversation-1') {
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

function routingHarness(capture = commentaryCapture()) {
  const context = {
    capture,
    terminalEvents: [],
    diagnostics: []
  };
  const providerObserver = optionalProductionFunctionSource(
    'agentTerminalObserveConversationTurnCompleteFrame',
    'function agentTerminalObserveConversationTurnCompleteFrame() { return false; }'
  );
  vm.runInNewContext(`
    let streamTailCapture = this.capture;
    function logDiagnostic(level, name, details) {
      this.diagnostics.push({ level, name, details });
    }
    function agentTerminalObserve(capture, event) {
      this.terminalEvents.push({ capture, event });
      capture.agent_terminal_success_observed = true;
    }
    function streamTailConsumeWebSocketMessage() {}
    ${optionalProductionFunctionSource(
      'agentTerminalHasFinishedAssistant',
      'function agentTerminalHasFinishedAssistant() { return null; }'
    )}
    ${providerObserver}
    ${productionFunctionSource('captureGenerationWebSocketFrame')}
    this.receive = captureGenerationWebSocketFrame;
  `, context);
  return context;
}

test('captured provider conversation-turn-complete reaches the shared terminal watcher for the current successful commentary-only turn', () => {
  const context = routingHarness();

  context.receive(frame());

  assert.equal(context.terminalEvents.length, 1,
    'The structured provider completion event must reach the shared terminal watcher exactly once.');
  assert.equal(context.terminalEvents[0].capture, context.capture);
  assert.equal(context.terminalEvents[0].event.type, 'provider_conversation_turn_complete');
  assert.equal(context.terminalEvents[0].event.conversation_id, 'conversation-1');
});
