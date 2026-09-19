import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/agent-terminal-polling-timeout.json', import.meta.url),
  'utf8'
));

test('stats-flush observer dispatches recognized polling timeout through shared terminal lifecycle', async () => {
  const observerSource = productionFunctionSource('agentTerminalObserveStatsRequest');
  assert.doesNotMatch(observerSource, /agent(?:Sound)?TerminalKey\s*\(/,
    'Stats observer must not derive terminal identity outside the shared normalizer.');

  const context = {
    URL,
    payload: fixture.stats_flush,
    dispatches: [],
    diagnostics: [],
    location: {
      href: 'https://chatgpt.com/c/conversation-1',
      origin: 'https://chatgpt.com'
    }
  };
  vm.runInNewContext(`
    const streamTailCapture = {
      conversation_id: 'conversation-1',
      parent_message_id: 'parent-1',
      request_messages: [{ id: 'user-1', metadata: {} }]
    };
    function cloneSafely(request) { return request; }
    function boundedDiagnosticText(value) { return value; }
    function errorMessage(error) { return error?.message ?? String(error); }
    function logDiagnostic(level, name, details) {
      this.diagnostics.push({ level, name, details });
    }
    function agentTerminalObserve(capture, event) {
      this.dispatches.push({ capture, event });
    }
    ${productionFunctionSource('agentTerminalFailureFromStatsPayload')}
    ${productionFunctionSource('isAgentTerminalStatsUrl')}
    ${observerSource}
    this.run = () => agentTerminalObserveStatsRequest({
      async text() { return JSON.stringify(payload); }
    }, 'https://chatgpt.com/ces/statsc/flush', 'POST');
  `, context);

  await context.run();

  assert.equal(context.dispatches.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.dispatches[0].event)),
    {
      type: 'client_terminal_error',
      code: 'network_error',
      source: 'completion_stream_polling_fallback',
      reason: 'polling_timeout'
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.diagnostics)),
    [{
      level: 'debug',
      name: 'agent-terminal-polling-timeout-observed',
      details: {
        conversation_id: 'conversation-1'
      }
    }]
  );
});
