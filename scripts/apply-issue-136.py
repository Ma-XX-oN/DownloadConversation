from pathlib import Path


def replace_once(path, old, new):
  file_path = Path(path)
  text = file_path.read_text(encoding="utf-8")
  count = text.count(old)
  assert count == 1, f"{path}: expected one anchor, found {count}"
  file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


SOURCE = "chatgpt-conversation-markdown-export.user.js"
DESIGN = "DESIGN.md"
CI = ".github/workflows/ci.yml"

replace_once(
  SOURCE,
  "// @version      1.2.0-issue.135.1",
  "// @version      1.2.0-issue.136.1"
)

replace_once(
  SOURCE,
  "  /** Local-storage key for audible agent terminal-state notifications. */\n"
  "  const AGENT_SOUNDS_STORAGE_KEY = 'tm-conversation-recorder-agent-sounds';\n",
  "  /** Local-storage key for audible agent terminal-state notifications. */\n"
  "  const AGENT_SOUNDS_STORAGE_KEY = 'tm-conversation-recorder-agent-sounds';\n"
  "  /** DOM id of the fixed agent-turn stopwatch display. */\n"
  "  const AGENT_STOPWATCH_ID = 'tm-agent-turn-stopwatch';\n"
  "  /** Refresh cadence for the live agent-turn stopwatch display. */\n"
  "  const AGENT_STOPWATCH_REFRESH_MS = 250;\n"
)

replace_once(
  SOURCE,
  "  /** Maximum number of emitted terminal turn identities retained for de-duplication. */\n"
  "  const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;\n",
  "  /** Maximum number of emitted terminal turn identities retained for de-duplication. */\n"
  "  const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;\n"
  "  /** Current agent-turn stopwatch session, including completed lap durations. */\n"
  "  let agentStopwatchState = null;\n"
  "  /** Interval handle refreshing the live agent-turn stopwatch, or null while stopped. */\n"
  "  let agentStopwatchTimer = null;\n"
)

stopwatch_functions = r'''
  /**
   * Formats one non-negative stopwatch duration as whole minutes and seconds.
   *
   * @param {number} milliseconds - Monotonic elapsed milliseconds.
   * @returns {string} Human-readable `X m Y s` duration.
   */
  function agentStopwatchFormatDuration(milliseconds) {
    assert(Number.isFinite(milliseconds) && milliseconds >= 0,
      'Agent stopwatch duration must be finite and non-negative.');
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)} m ${seconds % 60} s`;
  }

  /**
   * Returns the provider working-exchange identity carried by one message.
   *
   * @param {Object|null} message - Structured provider message.
   * @returns {string|null} Stable exchange id, or null when the message has none.
   */
  function agentStopwatchExchangeId(message) {
    const metadata = message?.metadata ?? {};
    return metadata.turn_exchange_id || metadata.working_turn_id || null;
  }

  /**
   * Returns the fixed viewport control used to display agent-turn stopwatch state.
   *
   * @returns {HTMLElement} Existing or newly created stopwatch element.
   */
  function ensureAgentStopwatchControl() {
    let control = document.getElementById(AGENT_STOPWATCH_ID);
    if (control) return control;
    control = document.createElement('div');
    control.id = AGENT_STOPWATCH_ID;
    control.style.position = 'fixed';
    control.style.top = '56px';
    control.style.right = '16px';
    control.style.zIndex = '2147483646';
    control.style.padding = '8px 10px';
    control.style.border = '1px solid rgba(127, 127, 127, 0.35)';
    control.style.borderRadius = '8px';
    control.style.background = 'rgba(32, 32, 32, 0.92)';
    control.style.color = '#f5f5f5';
    control.style.font = '12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    control.style.whiteSpace = 'pre';
    control.style.pointerEvents = 'none';
    control.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.25)';
    (document.body || document.documentElement).append(control);
    return control;
  }

  /**
   * Renders the current completed and live lap state into the fixed stopwatch control.
   *
   * @param {number} nowMs - Current monotonic timestamp.
   * @returns {void} No value is returned.
   */
  function agentStopwatchRender(nowMs = performance.now()) {
    if (!agentStopwatchState) return;
    assert(Number.isFinite(nowMs), 'Agent stopwatch render timestamp must be finite.');
    const lines = agentStopwatchState.laps_ms.map((duration, index) =>
      `Lap ${index + 1}: ${agentStopwatchFormatDuration(duration)}`
    );
    if (agentStopwatchState.active) {
      const current = Math.max(0, nowMs - agentStopwatchState.lap_started_at_ms);
      lines.push(`Lap ${agentStopwatchState.laps_ms.length + 1}: ${agentStopwatchFormatDuration(current)}`);
    } else {
      assert(Number.isFinite(agentStopwatchState.total_ms),
        'Completed agent stopwatch must have a total duration.');
      lines.push(`Total: ${agentStopwatchFormatDuration(agentStopwatchState.total_ms)}`);
    }
    ensureAgentStopwatchControl().textContent = lines.join('\n');
  }

  /**
   * Starts periodic live rendering for the active agent-turn stopwatch.
   *
   * @returns {void} No value is returned.
   */
  function agentStopwatchStartTimer() {
    if (agentStopwatchTimer !== null) return;
    agentStopwatchTimer = setInterval(
      () => agentStopwatchRender(performance.now()),
      AGENT_STOPWATCH_REFRESH_MS
    );
  }

  /**
   * Stops periodic stopwatch rendering while preserving the completed display.
   *
   * @returns {void} No value is returned.
   */
  function agentStopwatchStopTimer() {
    if (agentStopwatchTimer === null) return;
    clearInterval(agentStopwatchTimer);
    agentStopwatchTimer = null;
  }

  /**
   * Starts a fresh agent-turn stopwatch at one local user-submission boundary.
   *
   * @param {number} submittedAtMs - Monotonic timestamp captured before request transmission.
   * @returns {void} No value is returned.
   */
  function agentStopwatchStartNew(submittedAtMs) {
    assert(Number.isFinite(submittedAtMs), 'Agent stopwatch submission timestamp must be finite.');
    agentStopwatchStopTimer();
    agentStopwatchState = {
      active: true,
      started_at_ms: submittedAtMs,
      lap_started_at_ms: submittedAtMs,
      laps_ms: [],
      total_ms: null,
      exchange_id: null,
      pending_submission_at_ms: null,
      pending_message_id: null
    };
    agentStopwatchRender(submittedAtMs);
    agentStopwatchStartTimer();
  }

  /**
   * Freezes the current lap at an exact local user-submission or final-completion boundary.
   *
   * @param {number} boundaryMs - Monotonic boundary timestamp.
   * @returns {void} No value is returned.
   */
  function agentStopwatchRecordLap(boundaryMs) {
    assert(agentStopwatchState?.active, 'Cannot record a lap without an active agent stopwatch.');
    assert(Number.isFinite(boundaryMs) && boundaryMs >= agentStopwatchState.lap_started_at_ms,
      'Agent stopwatch lap boundary precedes the active lap.');
    agentStopwatchState.laps_ms.push(boundaryMs - agentStopwatchState.lap_started_at_ms);
    agentStopwatchState.lap_started_at_ms = boundaryMs;
  }

  /**
   * Registers one local ChatGPT generation submission before enriched stream metadata arrives.
   *
   * @param {Object} capture - Mutable streamed-turn capture for the submitted request.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveRequest(capture) {
    const submittedAtMs = capture?.stopwatch_submitted_at_ms;
    if (!Number.isFinite(submittedAtMs)) return;
    const userMessage = [...(capture?.request_messages ?? [])]
      .reverse()
      .find(message => message?.author?.role === 'user' && typeof message?.id === 'string');
    if (!agentStopwatchState?.active) agentStopwatchStartNew(submittedAtMs);
    agentStopwatchState.pending_submission_at_ms = submittedAtMs;
    agentStopwatchState.pending_message_id = userMessage?.id ?? null;
    agentStopwatchRender(performance.now());
  }

  /**
   * Classifies one enriched streamed User input as the initial prompt, a follow-up, or a new exchange.
   *
   * @param {Object} capture - Mutable streamed-turn capture associated with the input.
   * @param {Object} message - Enriched provider User input_message.
   * @param {boolean} isFollowUp - Whether provider metadata explicitly marks `message_type: next`.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveInputMessage(capture, message, isFollowUp) {
    if (message?.author?.role !== 'user' || !agentStopwatchState?.active) return;
    const pendingId = agentStopwatchState.pending_message_id;
    if (pendingId && message?.id && message.id !== pendingId) return;
    const submittedAtMs = agentStopwatchState.pending_submission_at_ms ??
      capture?.stopwatch_submitted_at_ms;
    if (!Number.isFinite(submittedAtMs)) return;
    const exchangeId = agentStopwatchExchangeId(message);
    if (!agentStopwatchState.exchange_id) {
      agentStopwatchState.exchange_id = exchangeId;
    } else if (exchangeId && exchangeId !== agentStopwatchState.exchange_id) {
      agentStopwatchStartNew(submittedAtMs);
      agentStopwatchState.exchange_id = exchangeId;
    } else if (isFollowUp && exchangeId === agentStopwatchState.exchange_id) {
      agentStopwatchRecordLap(submittedAtMs);
    }
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchRender(performance.now());
  }

  /**
   * Returns the successful final Assistant message that terminates one working exchange.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @returns {Object|null} Matching final Assistant message, or null while work remains open.
   */
  function agentStopwatchSuccessfulFinal(capture) {
    return [...(capture?.stream_messages ?? [])].reverse().find(message =>
      message?.author?.role === 'assistant' &&
      message?.channel === 'final' &&
      message?.status === 'finished_successfully' &&
      message?.end_turn === true
    ) ?? null;
  }

  /**
   * Stops the active stopwatch only for a successful final Assistant in the same working exchange.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveTerminal(capture) {
    if (!agentStopwatchState?.active) return;
    const finalMessage = agentStopwatchSuccessfulFinal(capture);
    if (!finalMessage) return;
    const exchangeId = agentStopwatchExchangeId(finalMessage);
    if (agentStopwatchState.exchange_id && exchangeId !== agentStopwatchState.exchange_id) return;
    if (!agentStopwatchState.exchange_id) agentStopwatchState.exchange_id = exchangeId;
    const completedAtMs = performance.now();
    agentStopwatchRecordLap(completedAtMs);
    agentStopwatchState.active = false;
    agentStopwatchState.total_ms = completedAtMs - agentStopwatchState.started_at_ms;
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchStopTimer();
    agentStopwatchRender(completedAtMs);
  }

  /**
   * Observes one parsed generation stream event for User follow-up identity and terminal completion.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object} event - Parsed provider stream event.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveStreamEvent(capture, event) {
    if (event?.type === 'input_message' && event?.input_message?.author?.role === 'user') {
      const isFollowUp = event.input_message?.metadata?.message_type === 'next';
      agentStopwatchObserveInputMessage(capture, event.input_message, isFollowUp);
    }
    agentStopwatchObserveTerminal(capture);
  }

'''

replace_once(
  SOURCE,
  "  document.addEventListener('pointerdown', agentSoundHandleUserGesture, true);\n"
  "  document.addEventListener('keydown', agentSoundHandleUserGesture, true);\n\n"
  "  // BEGIN Issue #123 streamed-tail recovery\n",
  "  document.addEventListener('pointerdown', agentSoundHandleUserGesture, true);\n"
  "  document.addEventListener('keydown', agentSoundHandleUserGesture, true);\n\n" +
  stopwatch_functions +
  "  // BEGIN Issue #123 streamed-tail recovery\n"
)

replace_once(
  SOURCE,
  "      streamTailApplyEvent(capture, parsed);\n"
  "      agentSoundObserveTerminal(capture, parsed);\n",
  "      streamTailApplyEvent(capture, parsed);\n"
  "      agentStopwatchObserveStreamEvent(capture, parsed);\n"
  "      agentSoundObserveTerminal(capture, parsed);\n"
)

replace_once(
  SOURCE,
  "   * @param {Request} request - Page-owned request cloned before transmission.\n"
  "   * @returns {Promise<Object|null>} Capture associated with this request, or null when unreadable.\n"
  "   */\n"
  "  async function captureGenerationStreamRequest(request) {\n",
  "   * @param {Request} request - Page-owned request cloned before transmission.\n"
  "   * @param {number} submittedAtMs - Monotonic timestamp captured before request transmission.\n"
  "   * @returns {Promise<Object|null>} Capture associated with this request, or null when unreadable.\n"
  "   */\n"
  "  async function captureGenerationStreamRequest(request, submittedAtMs) {\n"
)

replace_once(
  SOURCE,
  "      const capture = createStreamTailCapture(conversationId);\n"
  "      streamTailCaptureRequest(capture, body);\n"
  "      streamTailCapture = capture;\n",
  "      const capture = createStreamTailCapture(conversationId);\n"
  "      streamTailCaptureRequest(capture, body);\n"
  "      capture.stopwatch_submitted_at_ms = submittedAtMs;\n"
  "      agentStopwatchObserveRequest(capture);\n"
  "      streamTailCapture = capture;\n"
)

replace_once(
  SOURCE,
  "        const generationRequest = isGenerationStreamUrl(requestUrl) &&\n"
  "          String(request?.method ?? init.method ?? 'GET').toUpperCase() === 'POST';\n"
  "        const capturePromise = generationRequest && request\n"
  "          ? captureGenerationStreamRequest(request)\n"
  "          : null;\n",
  "        const generationRequest = isGenerationStreamUrl(requestUrl) &&\n"
  "          String(request?.method ?? init.method ?? 'GET').toUpperCase() === 'POST';\n"
  "        const generationSubmittedAtMs = generationRequest ? performance.now() : null;\n"
  "        const capturePromise = generationRequest && request\n"
  "          ? captureGenerationStreamRequest(request, generationSubmittedAtMs)\n"
  "          : null;\n"
)

replace_once(
  CI,
  "      - name: Agent completion sound regression\n"
  "        run: node --test tests/agent-completion-sounds.test.mjs\n",
  "      - name: Agent completion sound regression\n"
  "        run: node --test tests/agent-completion-sounds.test.mjs\n"
  "      - name: Agent turn stopwatch regression\n"
  "        run: node --test tests/agent-turn-stopwatch.test.mjs\n"
)

stopwatch_design = r'''

## Agent-turn stopwatch

Issue #136 adds a display-only stopwatch for one working agent exchange.  The clock
starts from a monotonic local timestamp captured immediately before the stock
`POST /backend-api/f/conversation` request is transmitted.  Request bodies do not
reliably contain the enriched working-exchange metadata, so the response stream's
structured User `input_message` is the authority for classifying the submission.

An initial User input binds the active stopwatch to its `turn_exchange_id` (falling
back only to `working_turn_id`).  A later User input records a lap only when provider
metadata explicitly marks `message_type: "next"` and the working-exchange identity
matches.  The lap boundary remains the earlier local submission timestamp, not the
time at which the enriched stream record arrives.  Returning composer control to the
User, whether normally, because input is required, after interruption, or after an
error, is not a terminal stopwatch event by itself.

The stopwatch stops only when the captured structured stream contains an Assistant
message for the same exchange with `channel: "final"`,
`status: "finished_successfully"`, and `end_turn: true`.  At that boundary the final
lap and total elapsed time are frozen.  A later independent User exchange replaces
the completed session with a new stopwatch.

The UI is a fixed, pointer-transparent top-right viewport control below the ChatGPT
header controls.  It is not part of transcript chronology, does not move with the
conversation scroll, and does not alter requests, exports, communication recording,
streamed-tail reconciliation, or AIConversationCore semantics.  Elapsed time uses
`performance.now()`; wall-clock timestamps are not used for duration measurement.
'''

Path(DESIGN).write_text(
  Path(DESIGN).read_text(encoding="utf-8") + stopwatch_design,
  encoding="utf-8"
)
