from pathlib import Path


def replace_once(path, old, new):
  file_path = Path(path)
  text = file_path.read_text(encoding='utf-8')
  count = text.count(old)
  assert count == 1, f'{path}: expected one anchor, found {count}'
  file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


SOURCE = 'chatgpt-conversation-markdown-export.user.js'
UNIT = 'tests/agent-turn-stopwatch.test.mjs'
STREAM = 'tests/agent-turn-stopwatch-stream.test.mjs'
DESIGN = 'DESIGN.md'

replace_once(
  SOURCE,
  '// @version      1.2.0-issue.136.2',
  '// @version      1.2.0-issue.136.3'
)

old_generation_url = '''  function isGenerationStreamUrl(url) {
    try {
      const parsed = new URL(url, `${location.origin}/`);
      return parsed.origin === location.origin && parsed.pathname === '/backend-api/f/conversation';
    } catch {
      return false;
    }
  }
'''
new_generation_url = old_generation_url + '''
  /**
   * Tests whether a URL is the stock same-turn User steering endpoint.
   *
   * @param {string} url - Candidate request URL.
   * @returns {boolean} True only for this origin's exact /backend-api/f/steer_turn path.
   */
  function isSteerTurnUrl(url) {
    try {
      const parsed = new URL(url, `${location.origin}/`);
      return parsed.origin === location.origin && parsed.pathname === '/backend-api/f/steer_turn';
    } catch {
      return false;
    }
  }
'''
replace_once(SOURCE, old_generation_url, new_generation_url)

old_request = '''  function agentStopwatchObserveRequest(capture) {
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
'''
new_request = old_request + '''
  /**
   * Records a User follow-up submitted through ChatGPT's same-turn steering endpoint.
   *
   * `/backend-api/f/steer_turn` is the submission boundary for a User follow-up while the
   * current working exchange remains active. Record the lap at the pre-transmission local
   * timestamp; later streamed User metadata must not create a second lap for this submission.
   *
   * @param {number} submittedAtMs - Monotonic timestamp captured before request transmission.
   * @returns {void} No value is returned.
   */
  function agentStopwatchObserveSteerTurn(submittedAtMs) {
    if (!agentStopwatchState?.active || !Number.isFinite(submittedAtMs)) return;
    agentStopwatchRecordLap(submittedAtMs);
    agentStopwatchState.pending_submission_at_ms = null;
    agentStopwatchState.pending_message_id = null;
    agentStopwatchRender(performance.now());
  }
'''
replace_once(SOURCE, old_request, new_request)

old_wiring = '''        const generationRequest = isGenerationStreamUrl(requestUrl) &&
          String(request?.method ?? init.method ?? 'GET').toUpperCase() === 'POST';
        const generationSubmittedAtMs = generationRequest ? performance.now() : null;
        const capturePromise = generationRequest && request
          ? captureGenerationStreamRequest(request, generationSubmittedAtMs)
          : null;
'''
new_wiring = '''        const requestMethod = String(request?.method ?? init.method ?? 'GET').toUpperCase();
        const generationRequest = isGenerationStreamUrl(requestUrl) && requestMethod === 'POST';
        const steerTurnRequest = isSteerTurnUrl(requestUrl) && requestMethod === 'POST';
        const generationSubmittedAtMs = generationRequest ? performance.now() : null;
        if (steerTurnRequest) agentStopwatchObserveSteerTurn(performance.now());
        const capturePromise = generationRequest && request
          ? captureGenerationStreamRequest(request, generationSubmittedAtMs)
          : null;
'''
replace_once(SOURCE, old_wiring, new_wiring)

replace_once(
  UNIT,
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.136\.2/);",
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.136\.3/);"
)

stream_path = Path(STREAM)
stream_text = stream_path.read_text(encoding='utf-8')
replace_once(
  STREAM,
  "    ${productionFunctionSource('agentStopwatchObserveRequest')}\n",
  "    ${productionFunctionSource('agentStopwatchObserveRequest')}\n    ${productionFunctionSource('agentStopwatchObserveSteerTurn')}\n"
)
replace_once(
  STREAM,
  "    ${productionFunctionSource('isGenerationStreamUrl')}\n",
  "    ${productionFunctionSource('isGenerationStreamUrl')}\n    ${productionFunctionSource('isSteerTurnUrl')}\n"
)
replace_once(
  STREAM,
  "      request: agentStopwatchObserveRequest,\n      consume: consumeStreamTailSseChunk,\n      isGeneration: isGenerationStreamUrl,\n",
  "      request: agentStopwatchObserveRequest,\n      steer: agentStopwatchObserveSteerTurn,\n      consume: consumeStreamTailSseChunk,\n      isGeneration: isGenerationStreamUrl,\n      isSteer: isSteerTurnUrl,\n"
)
old_steer_test = '''test('live follow-up endpoint /backend-api/f/steer_turn is recognized as a stopwatch submission boundary', () => {
  const harness = streamHarness();
  assert.equal(harness.api.isGeneration('https://chatgpt.com/backend-api/f/conversation'), true);
  assert.equal(harness.api.isGeneration('https://chatgpt.com/backend-api/f/steer_turn'), true);
});
'''
new_steer_test = '''test('live steer_turn follow-up records one lap at the POST boundary without double-counting later stream input', () => {
  const harness = streamHarness();

  assert.equal(harness.api.isGeneration('https://chatgpt.com/backend-api/f/conversation'), true);
  assert.equal(harness.api.isGeneration('https://chatgpt.com/backend-api/f/steer_turn'), false);
  assert.equal(harness.api.isSteer('https://chatgpt.com/backend-api/f/steer_turn'), true);
  assert.equal(harness.api.isSteer('https://chatgpt.com/backend-api/f/conversation'), false);
  assert.equal(harness.api.isSteer('https://example.com/backend-api/f/steer_turn'), false);

  harness.setNow(1000);
  const initial = requestCapture(harness, 'user-1', 1000);
  harness.api.consume(initial, inputMessageSse('user-1', 'exchange-A'));

  harness.setNow(71000);
  harness.api.steer(71000);
  assert.deepEqual(Array.from(harness.api.state().laps_ms), [70000]);
  assert.equal(harness.api.state().lap_started_at_ms, 71000);

  harness.api.consume(initial, inputMessageSse('user-2', 'exchange-A'));
  assert.deepEqual(Array.from(harness.api.state().laps_ms), [70000]);

  const install = productionFunctionSource('installNetworkCapture');
  assert.match(install, /isSteerTurnUrl\(requestUrl\)/);
  assert.match(install, /agentStopwatchObserveSteerTurn\(performance\.now\(\)\)/);
});
'''
replace_once(STREAM, old_steer_test, new_steer_test)

path = Path(DESIGN)
text = path.read_text(encoding='utf-8')
marker = '## Agent-turn stopwatch steer-turn boundary'
assert marker not in text, f'{DESIGN}: steer-turn design note already present'
text += '''\n\n## Agent-turn stopwatch steer-turn boundary\n\nLive browser diagnostics establish that a User follow-up submitted while the current working turn remains active is sent through `POST /backend-api/f/steer_turn`, not through the `/backend-api/f/conversation` generation endpoint. The stopwatch treats that exact same-origin POST as the follow-up submission boundary and records the lap immediately using the local monotonic pre-transmission timestamp.\n\n`/backend-api/f/steer_turn` is not treated as another generation stream. The existing `/backend-api/f/conversation` capture remains authoritative for streamed turn identity and terminal completion. Because a steer-turn lap is recorded directly at the steering POST boundary, later streamed User metadata has no pending stopwatch submission and therefore cannot double-count the same follow-up.\n'''
path.write_text(text, encoding='utf-8')
