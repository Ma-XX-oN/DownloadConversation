import fs from 'node:fs';

const userscriptPath = 'chatgpt-conversation-markdown-export.user.js';
const designPath = 'DESIGN.md';
const soundTestPath = 'tests/agent-completion-sounds.test.mjs';
const stopwatchTestPath = 'tests/agent-turn-stopwatch.test.mjs';
const stopwatchStreamTestPath = 'tests/agent-turn-stopwatch-stream.test.mjs';
const timeoutTestPath = 'tests/agent-terminal-polling-timeout.test.mjs';

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`Missing expected ${label}.`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected exactly one ${label}.`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function documentedFunctionRange(source, name) {
  const starts = [
    source.indexOf(`  async function ${name}(`),
    source.indexOf(`  function ${name}(`)
  ].filter(index => index >= 0);
  if (!starts.length) throw new Error(`Missing production function ${name}.`);
  const functionStart = Math.min(...starts);
  const docStart = source.lastIndexOf('\n  /**', functionStart);
  if (docStart < 0) throw new Error(`Missing JSDoc for ${name}.`);
  const boundaries = [
    source.indexOf('\n\n  /**', functionStart + 3),
    source.indexOf('\n  // END ', functionStart + 3)
  ].filter(index => index >= 0);
  if (!boundaries.length) throw new Error(`Missing boundary for ${name}.`);
  return { start: docStart + 1, end: Math.min(...boundaries) };
}

function replaceDocumentedFunction(source, name, replacement) {
  const { start, end } = documentedFunctionRange(source, name);
  return source.slice(0, start) + replacement + source.slice(end);
}

let source = fs.readFileSync(userscriptPath, 'utf8');
source = replaceOnce(
  source,
  '// @version      1.4.0-issue.140.1',
  '// @version      1.4.0-issue.140.2',
  'Issue 140 iteration-1 version'
);

source = replaceDocumentedFunction(source, 'agentSoundTerminalKey', `  /**
   * Returns one stable terminal identity from the shared normalized exchange identity.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {string|null} exchangeId - Shared structured exchange identity, when available.
   * @param {Object|null} finalMessage - Structured successful final Assistant message, when available.
   * @returns {string|null} Stable conversation/turn key, or null when no structured identity exists.
   */
  function agentTerminalKey(capture, exchangeId = null, finalMessage = null) {
    const request = [...(capture?.request_messages ?? [])]
      .reverse()
      .find(message => typeof message?.id === 'string' && message.id);
    const finalMetadata = finalMessage?.metadata ?? {};
    const requestMetadata = request?.metadata ?? {};
    const turnIdentity = exchangeId || finalMetadata.request_id || requestMetadata.request_id ||
      request?.id || capture?.parent_message_id || null;
    if (!turnIdentity) return null;
    return \`${'${capture?.conversation_id ?? \'new\'}'}:${'${turnIdentity}'}\`;
  }`);

source = replaceDocumentedFunction(source, 'agentSoundClassifyTerminal', `  /**
   * Classifies one structured agent terminal observation without deriving consumer-specific state.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} event - Most recently parsed structured SSE/v1 event, when any.
   * @returns {string|null} \`success\`, \`error\`, or null when the turn is not terminal.
   */
  function agentTerminalClassifyKind(capture, event) {
    const structured = [];
    if (event && typeof event === 'object' && !Array.isArray(event)) structured.push(event);
    if (event?.v && typeof event.v === 'object' && !Array.isArray(event.v)) structured.push(event.v);
    for (const candidate of structured) {
      if (agentTerminalIsPollingTimeout(candidate)) return 'error';
      const providerCode = candidate.code ?? candidate?.error?.code ?? null;
      if (candidate.type === 'error' && providerCode === 'conversation_too_large') return 'error';
      if (candidate.result === 'error' &&
          candidate?.error?.reason === 'request_failed' &&
          Number(candidate?.error?.status_code) >= 400) {
        return 'error';
      }
    }
    return agentTerminalSuccessfulFinal(capture) ? 'success' : null;
  }`);

source = replaceDocumentedFunction(source, 'agentSoundObserveTerminal', `  /**
   * Handles one already-normalized terminal event for browser audio only.
   *
   * @param {Object} terminal - Shared normalized terminal event.
   * @returns {void} No value is returned.
   */
  function agentSoundHandleTerminal(terminal) {
    const kind = terminal?.kind ?? null;
    const key = terminal?.terminal_key ?? null;
    if (!kind) return;
    logDiagnostic('debug', 'agent-sound-terminal-classified', {
      kind,
      terminal_key: key,
      exchange_id: terminal?.exchange_id ?? null,
      volume: agentSoundVolume,
      audio_context_state: agentSoundAudioContext?.state ?? 'absent'
    });
    if (!key) return;
    if (agentSoundTerminalKeys.has(key)) {
      logDiagnostic('debug', 'agent-sound-duplicate-suppressed', {
        kind,
        terminal_key: key,
        volume: agentSoundVolume
      });
      return;
    }
    if (agentSoundVolume <= 0) {
      logDiagnostic('debug', 'agent-sound-volume-zero-suppressed', {
        kind,
        terminal_key: key,
        volume: agentSoundVolume
      });
      return;
    }
    if (playAgentSound(kind)) agentSoundRememberTerminalKey(key);
  }`);

source = replaceDocumentedFunction(source, 'agentStopwatchSuccessfulFinal', `  /**
   * Returns the exact structured successful final Assistant message for one capture.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @returns {Object|null} Successful final Assistant message, or null when not terminal-success.
   */
  function agentTerminalSuccessfulFinal(capture) {
    return [...(capture?.stream_messages ?? [])].reverse().find(message =>
      message?.author?.role === 'assistant' &&
      message?.channel === 'final' &&
      message?.status === 'finished_successfully' &&
      message?.end_turn === true
    ) ?? null;
  }

  /**
   * Derives the shared structured exchange identity for one terminal observation.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} finalMessage - Structured successful final Assistant message, when available.
   * @returns {string|null} Turn exchange identity shared by all terminal consumers, or null.
   */
  function agentTerminalExchangeId(capture, finalMessage = null) {
    const finalMetadata = finalMessage?.metadata ?? {};
    const request = [...(capture?.request_messages ?? [])]
      .reverse()
      .find(message => typeof message?.id === 'string' && message.id);
    const requestMetadata = request?.metadata ?? {};
    return finalMetadata.turn_exchange_id || finalMetadata.working_turn_id ||
      capture?.stopwatch_exchange_id || requestMetadata.turn_exchange_id ||
      requestMetadata.working_turn_id || null;
  }

  /**
   * Normalizes one structured terminal observation exactly once before fan-out to consumers.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} event - Most recently parsed structured SSE/v1 event, when any.
   * @returns {Object|null} Shared immutable terminal event, or null when not terminal.
   */
  function agentTerminalNormalize(capture, event = null) {
    const kind = agentTerminalClassifyKind(capture, event);
    if (!kind) return null;
    const finalMessage = kind === 'success' ? agentTerminalSuccessfulFinal(capture) : null;
    const exchangeId = agentTerminalExchangeId(capture, finalMessage);
    return Object.freeze({
      kind,
      conversation_id: capture?.conversation_id ?? null,
      exchange_id: exchangeId,
      terminal_key: agentTerminalKey(capture, exchangeId, finalMessage),
      completed_at_ms: performance.now()
    });
  }`);

source = replaceDocumentedFunction(source, 'agentStopwatchObserveTerminal', `  /**
   * Handles one already-normalized terminal event for the active stopwatch only.
   *
   * @param {Object} terminal - Shared normalized terminal event.
   * @returns {void} No value is returned.
   */
  function agentStopwatchHandleTerminal(terminal) {
    if (!agentStopwatchState?.active) return;
    const exchangeId = terminal?.exchange_id ?? null;
    if (!exchangeId || exchangeId !== agentStopwatchState.exchange_id) return;
    const completedAtMs = terminal.completed_at_ms;
    if (!Number.isFinite(completedAtMs)) return;
    agentStopwatchRecordLap(completedAtMs);
    agentStopwatchState.active = false;
    agentStopwatchState.total_ms = completedAtMs - agentStopwatchState.started_at_ms;
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchStopTimer();
    agentStopwatchRender(completedAtMs);
  }

  /** Ordered consumers of one shared normalized terminal event. */
  const agentTerminalHandlers = Object.freeze([
    agentSoundHandleTerminal,
    agentStopwatchHandleTerminal
  ]);

  /**
   * Normalizes one structured terminal observation once and fans it out to all terminal consumers.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} event - Most recently parsed structured SSE/v1 event, when any.
   * @returns {void} No value is returned.
   */
  function agentTerminalObserve(capture, event = null) {
    const terminal = agentTerminalNormalize(capture, event);
    if (!terminal) return;
    logDiagnostic('debug', 'agent-terminal-normalized', {
      kind: terminal.kind,
      conversation_id: terminal.conversation_id,
      exchange_id: terminal.exchange_id,
      terminal_key: terminal.terminal_key
    });
    for (const handler of agentTerminalHandlers) handler(terminal);
  }`);

source = replaceDocumentedFunction(source, 'agentStopwatchObserveStreamEvent', `  /**
   * Observes structured stream events that affect stopwatch submission/lap state before terminal fan-out.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object} event - Parsed provider stream event.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveStreamEvent(capture, event) {
    if (event && event.type === 'input_message' && event.input_message?.author?.role === 'user') {
      agentStopwatchObserveInputMessage(capture, event.input_message);
    }
  }`);

source = replaceOnce(
  source,
  `      agentSoundObserveTerminal(capture, event);\n      agentStopwatchObserveTerminal(capture, event);`,
  `      agentTerminalObserve(capture, event);`,
  'polling-timeout split terminal fan-out'
);
source = replaceOnce(
  source,
  `        agentSoundObserveTerminal(capture, null);`,
  `        agentTerminalObserve(capture, null);`,
  'DONE sound-only terminal observation'
);
source = replaceOnce(
  source,
  `      agentStopwatchObserveStreamEvent(capture, parsed);\n      agentSoundObserveTerminal(capture, parsed);`,
  `      agentStopwatchObserveStreamEvent(capture, parsed);\n      agentTerminalObserve(capture, parsed);`,
  'parsed split terminal observation'
);

if (/agentSoundObserveTerminal\s*\(/.test(source)) {
  throw new Error('Legacy sound terminal observer still exists after patch.');
}
if (/agentStopwatchObserveTerminal\s*\(/.test(source)) {
  throw new Error('Legacy stopwatch terminal observer still exists after patch.');
}
fs.writeFileSync(userscriptPath, source);

let soundTest = fs.readFileSync(soundTestPath, 'utf8');
soundTest = replaceOnce(
  soundTest,
  `    diagnostics: [],\n    document: { addEventListener() {} }`,
  `    diagnostics: [],\n    performance: { now: () => 1000 },\n    document: { addEventListener() {} }`,
  'sound harness performance clock'
);
soundTest = replaceOnce(
  soundTest,
  `    \${productionFunctionSource('agentSoundTerminalKey')}\n    \${productionFunctionSource('agentSoundRememberTerminalKey')}\n    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentSoundClassifyTerminal')}\n    \${productionFunctionSource('agentSoundObserveTerminal')}\n    this.api = {\n      classify: agentSoundClassifyTerminal,\n      observe: agentSoundObserveTerminal,\n      keys: () => [...agentSoundTerminalKeys]\n    };`,
  `    \${productionFunctionSource('agentSoundRememberTerminalKey')}\n    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentTerminalSuccessfulFinal')}\n    \${productionFunctionSource('agentTerminalExchangeId')}\n    \${productionFunctionSource('agentTerminalKey')}\n    \${productionFunctionSource('agentTerminalClassifyKind')}\n    \${productionFunctionSource('agentTerminalNormalize')}\n    \${productionFunctionSource('agentSoundHandleTerminal')}\n    this.api = {\n      classify(capture, event) { return agentTerminalNormalize(capture, event)?.kind ?? null; },\n      observe(capture, event) {\n        const terminal = agentTerminalNormalize(capture, event);\n        if (terminal) agentSoundHandleTerminal(terminal);\n      },\n      keys: () => [...agentSoundTerminalKeys]\n    };`,
  'sound harness terminal functions'
);
soundTest = replaceOnce(
  soundTest,
  `  const observe = productionFunctionSource('agentSoundObserveTerminal');`,
  `  const observe = productionFunctionSource('agentSoundHandleTerminal');`,
  'sound diagnostic observer source'
);
soundTest = replaceOnce(
  soundTest,
  `/streamTailApplyEvent\\(capture, parsed\\);[\\s\\S]*agentSoundObserveTerminal\\(capture, parsed\\)/`,
  `/streamTailApplyEvent\\(capture, parsed\\);[\\s\\S]*agentTerminalObserve\\(capture, parsed\\)/`,
  'sound structured SSE parsed wiring assertion'
);
soundTest = replaceOnce(
  soundTest,
  `/data === '\\[DONE\\]'[\\s\\S]*agentSoundObserveTerminal\\(capture, null\\)/`,
  `/data === '\\[DONE\\]'[\\s\\S]*agentTerminalObserve\\(capture, null\\)/`,
  'sound structured SSE DONE wiring assertion'
);
fs.writeFileSync(soundTestPath, soundTest);

let stopwatchTest = fs.readFileSync(stopwatchTestPath, 'utf8');
stopwatchTest = replaceOnce(
  stopwatchTest,
  `    \${productionFunctionSource('agentStopwatchSuccessfulFinal')}\n    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentStopwatchObserveTerminal')}\n    \${productionFunctionSource('agentStopwatchObserveStreamEvent')}`,
  `    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentTerminalSuccessfulFinal')}\n    \${productionFunctionSource('agentTerminalExchangeId')}\n    \${productionFunctionSource('agentTerminalKey')}\n    \${productionFunctionSource('agentTerminalClassifyKind')}\n    \${productionFunctionSource('agentTerminalNormalize')}\n    \${productionFunctionSource('agentStopwatchHandleTerminal')}\n    \${productionFunctionSource('agentStopwatchObserveStreamEvent')}`,
  'stopwatch harness terminal functions'
);
stopwatchTest = replaceOnce(
  stopwatchTest,
  `      terminal: agentStopwatchObserveTerminal,`,
  `      terminal(capture, event = null) {\n        const terminal = agentTerminalNormalize(capture, event);\n        if (terminal) agentStopwatchHandleTerminal(terminal);\n      },`,
  'stopwatch harness terminal API'
);
stopwatchTest = replaceOnce(
  stopwatchTest,
  `  const terminal = productionFunctionSource('agentStopwatchSuccessfulFinal');`,
  `  const terminal = productionFunctionSource('agentTerminalSuccessfulFinal');`,
  'stopwatch successful final source assertion'
);
fs.writeFileSync(stopwatchTestPath, stopwatchTest);

let streamTest = fs.readFileSync(stopwatchStreamTestPath, 'utf8');
streamTest = replaceOnce(
  streamTest,
  `    function streamTailPersistCapture() { return true; }\n    function agentSoundObserveTerminal() {}`,
  `    function streamTailPersistCapture() { return true; }\n    function agentSoundHandleTerminal() {}`,
  'stream harness sound terminal stub'
);
streamTest = replaceOnce(
  streamTest,
  `    \${productionFunctionSource('agentStopwatchSuccessfulFinal')}\n    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentStopwatchObserveTerminal')}\n    \${productionFunctionSource('agentStopwatchObserveStreamEvent')}`,
  `    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentTerminalSuccessfulFinal')}\n    \${productionFunctionSource('agentTerminalExchangeId')}\n    \${productionFunctionSource('agentTerminalKey')}\n    \${productionFunctionSource('agentTerminalClassifyKind')}\n    \${productionFunctionSource('agentTerminalNormalize')}\n    \${productionFunctionSource('agentStopwatchHandleTerminal')}\n    const agentTerminalHandlers = Object.freeze([agentSoundHandleTerminal, agentStopwatchHandleTerminal]);\n    \${productionFunctionSource('agentTerminalObserve')}\n    \${productionFunctionSource('agentStopwatchObserveStreamEvent')}`,
  'stream harness shared terminal functions'
);
fs.writeFileSync(stopwatchStreamTestPath, streamTest);

let timeoutTest = fs.readFileSync(timeoutTestPath, 'utf8');
timeoutTest = replaceOnce(
  timeoutTest,
  `    diagnostics: []\n  };`,
  `    diagnostics: [],\n    performance: { now: () => 1000 }\n  };`,
  'timeout sound harness performance clock'
);
timeoutTest = replaceOnce(
  timeoutTest,
  `    \${productionFunctionSource('agentSoundTerminalKey')}\n    \${productionFunctionSource('agentSoundRememberTerminalKey')}\n    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentSoundClassifyTerminal')}\n    \${productionFunctionSource('agentSoundObserveTerminal')}\n    this.api = {\n      classify: agentSoundClassifyTerminal,\n      observe: agentSoundObserveTerminal,\n      keys: () => [...agentSoundTerminalKeys]\n    };`,
  `    \${productionFunctionSource('agentSoundRememberTerminalKey')}\n    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentTerminalSuccessfulFinal')}\n    \${productionFunctionSource('agentTerminalExchangeId')}\n    \${productionFunctionSource('agentTerminalKey')}\n    \${productionFunctionSource('agentTerminalClassifyKind')}\n    \${productionFunctionSource('agentTerminalNormalize')}\n    \${productionFunctionSource('agentSoundHandleTerminal')}\n    this.api = {\n      classify(capture, event) { return agentTerminalNormalize(capture, event)?.kind ?? null; },\n      observe(capture, event) {\n        const terminal = agentTerminalNormalize(capture, event);\n        if (terminal) agentSoundHandleTerminal(terminal);\n      },\n      keys: () => [...agentSoundTerminalKeys]\n    };`,
  'timeout sound harness shared terminal functions'
);
timeoutTest = replaceOnce(
  timeoutTest,
  `    \${productionFunctionSource('agentStopwatchSuccessfulFinal')}\n    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentStopwatchObserveTerminal')}\n    this.api = {`,
  `    \${productionFunctionSource('agentTerminalIsPollingTimeout')}\n    \${productionFunctionSource('agentTerminalSuccessfulFinal')}\n    \${productionFunctionSource('agentTerminalExchangeId')}\n    \${productionFunctionSource('agentTerminalKey')}\n    \${productionFunctionSource('agentTerminalClassifyKind')}\n    \${productionFunctionSource('agentTerminalNormalize')}\n    \${productionFunctionSource('agentStopwatchHandleTerminal')}\n    this.api = {`,
  'timeout stopwatch harness shared terminal functions'
);
timeoutTest = replaceOnce(
  timeoutTest,
  `      terminal: agentStopwatchObserveTerminal,`,
  `      terminal(capture, event = null) {\n        const terminal = agentTerminalNormalize(capture, event);\n        if (terminal) agentStopwatchHandleTerminal(terminal);\n      },`,
  'timeout stopwatch terminal API'
);
fs.writeFileSync(timeoutTestPath, timeoutTest);

let design = fs.readFileSync(designPath, 'utf8');
const heading = '## Shared agent terminal dispatch';
if (!design.includes(heading)) {
  design = design.replace(/\s*$/, '') + `\n\n${heading}\n\n` +
    'Structured terminal state is normalized exactly once before any terminal side effect. The normalizer determines terminal kind, conversation identity, exchange identity, terminal de-duplication key, and one monotonic completion timestamp. Successful-final exchange identity prefers the final Assistant message metadata; structured capture/request identity is used only by the same shared normalizer when needed. The normalized immutable terminal object is then dispatched to the sound and stopwatch handlers. Neither consumer independently classifies terminal state or reconstructs terminal identity. The stopwatch still rejects a normalized terminal whose exchange identity does not match the active stopwatch session. Rendered text and DOM error strings are not terminal detectors.\n';
}
fs.writeFileSync(designPath, design);
