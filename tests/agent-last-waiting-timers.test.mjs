import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const timingSource = await readFile(
  new URL('../src/userscript/03-agent-lifecycle/12-last-waiting-timers.js', import.meta.url),
  'utf8'
);

function timingHarness() {
  const context = vm.createContext({});
  const script = new vm.Script(`
    let now = 0;
    let intervalCallback = null;
    const control = { textContent: '' };
    let agentStopwatchTimer = null;
    let agentStopwatchState = {
      active: true,
      started_at_ms: 0,
      lap_started_at_ms: 0,
      laps_ms: [],
      total_ms: null,
      exchange_id: 'exchange-1',
      pending_submission_at_ms: null,
      pending_message_id: null
    };

    function assert(condition, message) {
      if (!condition) throw new Error(message);
    }

    const performance = { now: () => now };

    function setInterval(callback) {
      intervalCallback = callback;
      return 1;
    }

    function clearInterval() {
      intervalCallback = null;
    }

    function agentStopwatchFormatDuration(ms) {
      const seconds = Math.floor(Math.max(0, ms) / 1000);
      return \`0 m \${seconds} s\`;
    }

    function ensureAgentStopwatchControl() {
      return control;
    }

    function agentStopwatchRender(nowMs = performance.now()) {
      if (!agentStopwatchState) return;
      const totalMs = agentStopwatchState.active
        ? nowMs - agentStopwatchState.started_at_ms
        : agentStopwatchState.total_ms;
      control.textContent = \`Total: \${agentStopwatchFormatDuration(totalMs ?? 0)}\`;
    }

    function agentStopwatchStartTimer() {
      if (agentStopwatchTimer !== null) return;
      agentStopwatchTimer = setInterval(
        () => agentStopwatchRender(performance.now()),
        250
      );
    }

    function agentStopwatchStopTimer() {
      if (agentStopwatchTimer === null) return;
      clearInterval(agentStopwatchTimer);
      agentStopwatchTimer = null;
    }

    function agentStopwatchObserveStreamEvent() {}

    function agentTerminalNormalize(capture, event) {
      return event?.terminal ?? null;
    }

    function agentTerminalObserve(capture, event = null) {
      const terminal = agentTerminalNormalize(capture, event);
      if (!terminal) return;
      if (terminal.kind !== 'success' || !agentStopwatchState?.active) return;
      agentStopwatchState.active = false;
      agentStopwatchState.total_ms = terminal.total_ms;
      agentStopwatchStopTimer();
      agentStopwatchRender(performance.now());
    }

    function agentStopwatchObserveRequest(capture) {
      const submittedAtMs = capture?.stopwatch_submitted_at_ms;
      if (!Number.isFinite(submittedAtMs)) return;
      if (!agentStopwatchState?.active) {
        agentStopwatchState = {
          active: true,
          started_at_ms: submittedAtMs,
          lap_started_at_ms: submittedAtMs,
          laps_ms: [],
          total_ms: null,
          exchange_id: null,
          pending_submission_at_ms: submittedAtMs,
          pending_message_id: null
        };
      }
      agentStopwatchRender(submittedAtMs);
    }

    function agentStopwatchObserveSteerTurn(submittedAtMs) {
      if (!agentStopwatchState?.active || !Number.isFinite(submittedAtMs)) return;
      agentStopwatchRender(submittedAtMs);
    }

    function agentStopwatchApplyRecovery(recovery, isStreaming, wallNowMs, monotonicNowMs) {
      if (!recovery?.ready || !recovery?.exchange_id || !recovery?.user_messages?.length) return;
      const startedWallMs = Number(recovery.user_messages[0].create_time) * 1000;
      const finalWallMs = Number(recovery.final_message?.create_time) * 1000;
      const startedAtMs = monotonicNowMs - (wallNowMs - startedWallMs);
      agentStopwatchState = {
        active: isStreaming,
        started_at_ms: startedAtMs,
        lap_started_at_ms: startedAtMs,
        laps_ms: [],
        total_ms: isStreaming ? null : finalWallMs - startedWallMs,
        exchange_id: recovery.exchange_id,
        pending_submission_at_ms: null,
        pending_message_id: null
      };
      agentStopwatchRender(monotonicNowMs);
    }

    ${timingSource}

    globalThis.api = {
      setNow(value) { now = value; },
      network(event) { return agentStopwatchObserveStreamEvent({}, event); },
      terminal(terminal) { return agentTerminalObserve({}, { terminal }); },
      submit(atMs) {
        return agentStopwatchObserveRequest({ stopwatch_submitted_at_ms: atMs });
      },
      steer(atMs) { return agentStopwatchObserveSteerTurn(atMs); },
      render(atMs) {
        agentStopwatchRender(atMs);
        return control.textContent;
      },
      text() { return control.textContent; },
      tick() { intervalCallback?.(); },
      timerActive() { return agentStopwatchTimer !== null; },
      snapshot(atMs) { return agentTimingSnapshot(atMs); },
      subscribe(listener) { return agentTimingSubscribe(listener); },
      recovery(recovery, wallNowMs, monotonicNowMs) {
        return agentStopwatchApplyRecovery(recovery, false, wallNowMs, monotonicNowMs);
      },
      state() { return agentStopwatchState; }
    };
  `);
  script.runInContext(context);
  return context.api;
}

test('Last uses the newest Assistant network receipt boundary', () => {
  const harness = timingHarness();
  harness.setNow(1000);
  harness.network({ message: { id: 'a1', author: { role: 'assistant' } } });
  assert.equal(harness.snapshot(1000).last_network_at_ms, 1000);
  assert.equal(harness.render(4000), 'Last: 0 m 3 s\nTotal: 0 m 4 s');

  harness.setNow(4500);
  harness.network({ message: { id: 'a2', author: { role: 'assistant' } } });
  assert.equal(harness.snapshot(4500).last_network_at_ms, 4500);
  assert.equal(harness.render(6500), 'Last: 0 m 2 s\nTotal: 0 m 6 s');

  harness.setNow(7000);
  harness.network({ message: { id: 'u1', author: { role: 'user' } } });
  assert.equal(harness.snapshot(7000).last_network_at_ms, 4500);
});

test('Waiting starts from the shared successful terminal boundary without changing Total', () => {
  const harness = timingHarness();
  harness.setNow(5000);
  harness.network({ message: { id: 'a1', author: { role: 'assistant' } } });

  harness.setNow(8000);
  harness.terminal({ kind: 'success', exchange_id: 'exchange-1', total_ms: 8000 });
  assert.equal(harness.snapshot(8000).waiting_since_ms, 8000);
  assert.equal(harness.text(), 'Last: 0 m 3 s\nTotal: 0 m 8 s\nWaiting: 0 m 0 s');
  assert.equal(harness.timerActive(), true);

  harness.setNow(12000);
  harness.tick();
  assert.equal(harness.text(), 'Last: 0 m 7 s\nTotal: 0 m 8 s\nWaiting: 0 m 4 s');
  assert.equal(harness.state().total_ms, 8000);
});

test('next User submission resets Waiting while preserving Last', () => {
  const harness = timingHarness();
  harness.setNow(1000);
  harness.network({ message: { id: 'a1', author: { role: 'assistant' } } });
  harness.setNow(5000);
  harness.terminal({ kind: 'success', exchange_id: 'exchange-1', total_ms: 5000 });
  assert.equal(harness.render(7000), 'Last: 0 m 6 s\nTotal: 0 m 5 s\nWaiting: 0 m 2 s');

  harness.submit(8000);
  assert.equal(harness.snapshot(8000).waiting_since_ms, null);
  assert.equal(harness.text(), 'Last: 0 m 7 s\nTotal: 0 m 0 s');
});

test('consecutive exchanges establish a fresh Waiting boundary', () => {
  const harness = timingHarness();
  harness.setNow(3000);
  harness.terminal({ kind: 'success', exchange_id: 'exchange-1', total_ms: 3000 });
  assert.equal(harness.snapshot(3000).waiting_since_ms, 3000);

  harness.submit(5000);
  harness.setNow(7000);
  harness.network({ message: { id: 'a2', author: { role: 'assistant' } } });
  harness.setNow(9000);
  harness.terminal({ kind: 'success', exchange_id: null, total_ms: 4000 });
  assert.equal(harness.snapshot(9000).waiting_since_ms, 9000);
  assert.equal(harness.render(11000), 'Last: 0 m 4 s\nTotal: 0 m 4 s\nWaiting: 0 m 2 s');
});

test('reload recovery restores Waiting from the retained final-message timestamp', () => {
  const harness = timingHarness();
  const recovery = {
    ready: true,
    exchange_id: 'exchange-retained',
    user_messages: [{ create_time: 90 }],
    final_message: { create_time: 100 }
  };

  harness.recovery(recovery, 105000, 20000);
  assert.equal(harness.snapshot(20000).waiting_since_ms, 15000);
  assert.equal(harness.text(), 'Total: 0 m 10 s\nWaiting: 0 m 5 s');
  assert.equal(harness.timerActive(), true);
});

test('shared timing subscription publishes authoritative transition timestamps', () => {
  const harness = timingHarness();
  const events = [];
  const unsubscribe = harness.subscribe(event => events.push(event));

  harness.setNow(2500);
  harness.network({ message: { id: 'a1', author: { role: 'assistant' } } });
  harness.setNow(6000);
  harness.terminal({ kind: 'success', exchange_id: 'exchange-1', total_ms: 6000 });
  harness.submit(7500);
  unsubscribe();

  assert.deepEqual(
    events.map(event => [event.type, event.at_ms]),
    [
      ['last-network-message', 2500],
      ['agent-finished', 6000],
      ['user-submitted', 7500]
    ]
  );
});
