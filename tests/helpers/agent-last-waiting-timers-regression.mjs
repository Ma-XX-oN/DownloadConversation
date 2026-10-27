import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { coreBundle } from './core-pin.mjs';
import { readFile } from 'node:fs/promises';

const timingSource = await readFile(
  new URL('../../src/userscript/03-agent-lifecycle/12-last-waiting-timers.js', import.meta.url),
  'utf8'
);

function timingHarness() {
  const context = vm.createContext({});
  const script = new vm.Script(`
    let now = 0;
    let epochNow = 100000;
    let intervalCallback = null;
    let paintCount = 0;
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
      paintCount += 1;
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
      return { ...terminal, completed_at_ms: performance.now() };
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


    function createFakeCore() {
      const agent = Object.freeze({});
      let snapshot = Object.freeze({
        apiVersion: 1,
        clockDomain: 'unix-epoch-ms',
        latestIncomingAtMs: null
      });
      const callbacks = new Set();
      let lastCallback = null;
      let disposed = false;
      const registry = {
        activityState(subject) {
          return !disposed && subject === agent ? snapshot : null;
        },
        observeActivity(subject, callback) {
          if (disposed || subject !== agent) throw new Error('unregistered');
          callbacks.add(callback);
          lastCallback = callback;
          callback(snapshot);
          return () => callbacks.delete(callback);
        }
      };
      return {
        agent, registry,
        publish(stamp) {
          if (disposed || !Number.isSafeInteger(stamp) || stamp < 0 ||
              stamp > epochNow || (snapshot.latestIncomingAtMs !== null &&
              stamp <= snapshot.latestIncomingAtMs)) return false;
          snapshot = Object.freeze({
            apiVersion: 1,
            clockDomain: 'unix-epoch-ms',
            latestIncomingAtMs: stamp
          });
          for (const callback of [...callbacks]) callback(snapshot);
          return true;
        },
        delayed(stamp) {
          lastCallback?.(Object.freeze({
            apiVersion: 1,
            clockDomain: 'unix-epoch-ms',
            latestIncomingAtMs: stamp
          }));
        },
        dispose() {
          disposed = true;
          callbacks.clear();
        },
        observers() { return callbacks.size; }
      };
    }
    const coreOne = createFakeCore();

    ${timingSource}

    globalThis.api = {
      setNow(value) { now = value; epochNow = 100000 + value; },
      makeCore() { return createFakeCore(); },
      coreOne,
      bind(core = coreOne) {
        return agentTimingBindActivityObserver(core.registry, core.agent,
          { now: () => epochNow });
      },
      unbind() { agentTimingUnbindActivityObserver(); },
      hideStopwatch() { agentStopwatchState = null; },
      bindExternal(registry, agent, nowFn) {
        return agentTimingBindActivityObserver(registry, agent, { now: nowFn });
      },
      incoming(stamp = epochNow) { return coreOne.publish(stamp); },
      terminal(terminal) { return agentTerminalObserve({}, { terminal }); },
      submit(atMs) {
        return agentStopwatchObserveRequest({ stopwatch_submitted_at_ms: atMs });
      },
      steer(atMs) { return agentStopwatchObserveSteerTurn(atMs); },
      render(atMs) {
        now = atMs;
        epochNow = 100000 + atMs;
        agentStopwatchRender(atMs);
        return control.textContent;
      },
      text() { return control.textContent; },
      tick() { intervalCallback?.(); },
      timerActive() { return agentStopwatchTimer !== null; },
      paints() { return paintCount; },
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

test('initial AICC V1 unknown is visibly unresolved, with no fabricated reset', () => {
  const h = timingHarness();
  assert.equal(h.bind(), true);
  assert.equal(h.render(4000), 'Last: —\nTotal: 0 m 4 s');
  assert.equal(h.snapshot(4000).latest_incoming_at_ms, null);
  assert.equal(h.bind(), false);
  assert.equal(h.coreOne.observers(), 1);
});

test('Last uses only retained Core timestamp; idle and outgoing do not reset', () => {
  const h = timingHarness();
  h.bind();
  h.setNow(1000);
  assert.equal(h.incoming(), true);
  assert.equal(h.snapshot(1000).latest_incoming_at_ms, 101000);
  assert.equal(h.render(4000), 'Last: 0 m 3 s\nTotal: 0 m 4 s');
  h.setNow(4500);
  assert.equal(h.incoming(), true);
  assert.equal(h.render(6500), 'Last: 0 m 2 s\nTotal: 0 m 6 s');
  // No public AICC subscription receives an outgoing event.
  assert.equal(h.render(7000), 'Last: 0 m 2 s\nTotal: 0 m 7 s');
  assert.equal(h.render(60000), 'Last: 0 m 55 s\nTotal: 1 m 0 s'.replace('1 m 0 s','0 m 60 s'));
});

test('AICC drops older, duplicate, invalid and future stamps', () => {
  const h = timingHarness();
  h.bind();
  h.setNow(10000);
  assert.equal(h.incoming(108000), true);
  assert.equal(h.incoming(108000), false);
  assert.equal(h.incoming(107999), false);
  assert.equal(h.incoming(999999), false);
  assert.equal(h.incoming(-1), false);
  assert.equal(h.render(12000), 'Last: 0 m 4 s\nTotal: 0 m 12 s');
});

test('Waiting retains terminal lifecycle, Total freeze and Last order', () => {
  const h = timingHarness();
  h.bind();
  h.setNow(5000);
  h.incoming();
  h.setNow(8000);
  h.terminal({ kind: 'success', exchange_id: 'exchange-1', total_ms: 8000 });
  assert.equal(h.snapshot(8000).waiting_since_ms, 8000);
  assert.equal(h.text(), 'Last: 0 m 3 s\nTotal: 0 m 8 s\nWaiting: 0 m 0 s');
  assert.equal(h.timerActive(), true);
  h.setNow(12000);
  h.tick();
  assert.equal(h.text(), 'Last: 0 m 7 s\nTotal: 0 m 8 s\nWaiting: 0 m 4 s');
  assert.equal(h.state().total_ms, 8000);
  h.submit(13000);
  assert.equal(h.snapshot(13000).waiting_since_ms, null);
  assert.equal(h.render(13000), 'Last: 0 m 8 s\nTotal: 0 m 0 s');
});

test('consecutive exchanges and recovered Waiting remain independent of Last', () => {
  const h = timingHarness();
  h.bind();
  h.setNow(3000);
  h.terminal({ kind: 'success', exchange_id: 'exchange-1', total_ms: 3000 });
  h.submit(5000);
  h.setNow(9000);
  h.terminal({ kind: 'success', exchange_id: null, total_ms: 4000 });
  assert.equal(h.render(11000), 'Last: —\nTotal: 0 m 4 s\nWaiting: 0 m 2 s');

  const fresh = timingHarness();
  fresh.bind();
  fresh.recovery({
    ready: true,
    exchange_id: 'retained',
    user_messages: [{ create_time: 90 }],
    final_message: { create_time: 100 }
  }, 105000, 20000);
  assert.equal(fresh.snapshot(20000).waiting_since_ms, 15000);
  assert.equal(fresh.text(), 'Last: —\nTotal: 0 m 10 s\nWaiting: 0 m 5 s');
});

test('agent replacement and delayed old callback cannot revive stale Last', () => {
  const h = timingHarness();
  h.bind();
  h.setNow(9000);
  h.incoming();
  const second = h.makeCore();
  assert.equal(h.bind(second), true);
  assert.equal(h.coreOne.observers(), 0);
  assert.equal(h.render(11000), 'Last: —\nTotal: 0 m 11 s');
  h.coreOne.delayed(108000);
  assert.equal(h.snapshot(11000).latest_incoming_at_ms, null);
  second.publish(110000);
  assert.equal(h.render(12000), 'Last: 0 m 2 s\nTotal: 0 m 12 s');
  second.dispose();
  h.unbind();
  assert.equal(h.render(13000), 'Last: —\nTotal: 0 m 13 s');
  second.delayed(110000);
  assert.equal(h.snapshot(13000).latest_incoming_at_ms, null);
});

test('shared timing notifications report Core activity and Waiting only', () => {
  const h = timingHarness();
  const events = [];
  const stop = h.subscribe(event => events.push(event));
  h.bind();
  h.setNow(2500);
  h.incoming();
  h.setNow(6000);
  h.terminal({ kind: 'success', exchange_id: 'exchange-1', total_ms: 6000 });
  h.submit(7500);
  stop();
  assert.deepEqual(events.map(event => event.type), [
    'last-activity-snapshot', 'last-activity-snapshot',
    'agent-finished', 'user-submitted'
  ]);
});

test('fast Core updates do not install more listeners or parse network data', () => {
  const h = timingHarness();
  h.bind();
  h.setNow(30000);
  const paintsBefore = h.paints();
  for (let stamp = 100001; stamp <= 120000; stamp++) {
    assert.equal(h.incoming(stamp), true);
  }
  assert.equal(h.coreOne.observers(), 1);
  assert.ok(h.paints() - paintsBefore <= 1, 'activity must reuse the 250ms paint timer');
  assert.equal(h.snapshot(30000).latest_incoming_at_ms, 120000);
  h.unbind();
  assert.equal(h.coreOne.observers(), 0);
});


test('pinned AICC registered Core drives identical Last consumer through public V1 API', () => {
  const coreContext = { URL, setTimeout, clearTimeout };
  coreContext.globalThis = coreContext;
  vm.runInNewContext(coreBundle, coreContext, {
    filename: 'aiconversationcore.chatgpt.browser.js'
  });
  const core = coreContext.AIConversationCore;
  assert.equal(core.getVersion(), '1.1.2-issue.132.5');
  assert.equal(typeof core.createAgent, 'function');
  let publishActivity = null;
  core.registerAgentPlugin({
    id: 'last', name: 'Last', iconUrl: 'https://example.org/last.png',
    apiVersion: 1,
    create(context) {
      publishActivity = context.core.publishActivityTimestamp;
      return {
        sendMessage() {}, getResponse() {}, getTurns() { return []; },
        currentState() { return {}; }, observeState() { return () => {}; },
        commTraffic() {},
        version() { return { plugin: 'last', apiVersion: 1 }; }
      };
    }
  });
  const loaded = core.createAgent('last');
  assert.ok(loaded.agent);
  assert.ok(loaded.session);
  assert.equal(typeof core.activityState, 'function');
  assert.equal(typeof core.observeActivity, 'function');
  assert.equal(typeof publishActivity, 'function');
  const h = timingHarness();
  let epochNow = Date.now();
  const unknown = core.activityState(loaded.agent);
  assert.equal(unknown.latestIncomingAtMs, null);
  assert.equal(Object.isFrozen(unknown), true);
  assert.equal(h.bindExternal(core, loaded.agent, () => epochNow), true);
  assert.equal(h.render(5000), 'Last: —\nTotal: 0 m 5 s');
  const stampedAtReceipt = epochNow - 2500;
  assert.equal(publishActivity(stampedAtReceipt), true);
  assert.equal(h.render(5000), 'Last: 0 m 2 s\nTotal: 0 m 5 s');
  assert.equal(publishActivity(stampedAtReceipt), false);
  assert.equal(publishActivity(stampedAtReceipt - 1000), false);
  assert.equal(publishActivity(epochNow + 600000), false);
  epochNow += 10000;
  assert.equal(h.render(6000), 'Last: 0 m 12 s\nTotal: 0 m 6 s');
  assert.equal(h.snapshot(6000).latest_incoming_at_ms, stampedAtReceipt);
  assert.equal(core.disposeActivity(loaded.agent), true);
  assert.equal(publishActivity(stampedAtReceipt + 500), false);
  assert.equal(core.activityState(loaded.agent), null);
  h.unbind();
  assert.equal(h.render(7000), 'Last: —\nTotal: 0 m 7 s');
});

test('two public AICC agent instances interchange without changing view source', () => {
  const ctx = { URL, setTimeout, clearTimeout };
  ctx.globalThis = ctx;
  vm.runInNewContext(coreBundle, ctx);
  const registry = new ctx.AIConversationCore.AgentPluginRegistry();
  let send = null;
  registry.register({
    id: 'fixture',
    apiVersion: 1,
    create(context) {
      send = context.core.publishActivityTimestamp;
      return {
        sendMessage() {}, getResponse() {}, getTurns() {},
        currentState() {}, observeState() {},
        commTraffic() {},
        version() { return {plugin: 'fixture', apiVersion: 1}; }
      };
    }
  });
  const h = timingHarness();
  const first = registry.create('fixture');
  let epochNow = Date.now();
  h.bindExternal(registry, first, () => epochNow);
  assert.equal(send(epochNow - 1000), true);
  assert.equal(h.render(3000), 'Last: 0 m 1 s\nTotal: 0 m 3 s');
  const previousPublisher = send;
  const second = registry.create('fixture');
  assert.equal(h.bindExternal(registry, second, () => epochNow), true);
  assert.equal(h.render(3000), 'Last: —\nTotal: 0 m 3 s');
  assert.equal(previousPublisher(epochNow - 200), true);
  assert.equal(h.render(3000), 'Last: —\nTotal: 0 m 3 s');
  assert.equal(send(epochNow - 500), true);
  assert.equal(h.render(3000), 'Last: 0 m 0 s\nTotal: 0 m 3 s');
  h.unbind();
  registry.disposeActivity(first);
  registry.disposeActivity(second);
});


test('late AICC subscription immediately replays retained activity, without new ingress', () => {
  const h = timingHarness();
  h.setNow(1000);
  assert.equal(h.incoming(), true);
  assert.equal(h.bind(), true);
  assert.equal(h.render(6000), 'Last: 0 m 5 s\nTotal: 0 m 6 s');
  h.unbind();
  h.unbind();
  assert.equal(h.coreOne.observers(), 0);
});

test('incoming updates without an installed stopwatch do not start idle polling', () => {
  const h = timingHarness();
  h.hideStopwatch();
  h.bind();
  h.setNow(1000);
  assert.equal(h.incoming(), true);
  assert.equal(h.timerActive(), false);
  h.unbind();
  assert.equal(h.timerActive(), false);
});
