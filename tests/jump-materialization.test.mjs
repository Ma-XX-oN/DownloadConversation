import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

function jumpProductionSource() {
  const start = userscript.indexOf('function jumpTocIndexControl(');
  const end = userscript.indexOf('async function runJump()', start);
  assert.ok(start >= 0, 'Jump TOC lookup function must exist in production source.');
  assert.ok(end > start, 'Jump materialization functions must precede runJump().');
  return userscript.slice(start, end);
}

function makeHarness({ onScroll = null, onSettle = null, tocForSelector = null } = {}) {
  class FakeElement {
    constructor(name) {
      this.name = name;
      this.scrollCalls = [];
    }

    scrollIntoView(options) {
      this.scrollCalls.push(options);
    }

    getAttribute(name) {
      if (name === 'data-turn') return this.name === 'target' ? 'user' : null;
      if (name === 'data-turn-id') return this.name === 'target' ? 'fake-turn-id' : null;
      return null;
    }
  }

  const targetSection = new FakeElement('target');
  const tocElement = new FakeElement('toc');
  const state = {
    mounted: false,
    tocAvailable: false,
    diagnostics: [],
    settleCount: 0
  };
  tocElement.click = () => {
    state.mounted = true;
  };
  const scrollRoot = {
    scrollTop: 500,
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTo({ top }) {
      this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
      onScroll?.({ kind: 'to', root: this, state });
    },
    scrollBy({ top }) {
      const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight);
      this.scrollTop = Math.max(0, Math.min(maxScrollTop, this.scrollTop + top));
      onScroll?.({ kind: 'by', root: this, state });
    }
  };

  const context = vm.createContext({
    HTMLElement: FakeElement,
    document: {
      querySelector(selector) {
        if (tocForSelector?.(selector, state)) return tocElement;
        return state.tocAvailable ? tocElement : null;
      },
      querySelectorAll() {
        return [];
      }
    },
    conversationScrollRoot: () => scrollRoot,
    mountedTurnSection: () => (state.mounted ? targetSection : null),
    jumpUserRecords: () => [],
    waitForJumpTarget: async () => (state.mounted ? targetSection : null),
    logDiagnostic: (level, event, details) => {
      state.diagnostics.push({ level, event, details });
    },
    assert: (condition, message) => {
      if (!condition) throw new Error(message);
    },
    performance,
    Promise,
    setTimeout(callback) {
      state.settleCount += 1;
      onSettle?.({ root: scrollRoot, state });
      callback();
      return state.settleCount;
    },
    clearTimeout() {}
  });

  vm.runInContext(jumpProductionSource(), context);
  return { context, state, scrollRoot, targetSection, tocElement };
}

test('Jump 0 succeeds when moving to the top directly mounts the requested message without a TOC control', async () => {
  const harness = makeHarness({
    onScroll({ kind, root, state }) {
      if (kind === 'to' && root.scrollTop === 0) state.mounted = true;
    }
  });

  const target = {
    uap_index: 0,
    role: 'user',
    message_id: 'cd0739ce-4cf6-4279-a31e-9ce7656d0970',
    spine: { records: [] }
  };

  const section = await harness.context.jumpToResolvedTarget(target);
  assert.equal(section, harness.targetSection);
  assert.equal(harness.targetSection.scrollCalls.length, 1,
    'The directly materialized target should receive the final Jump scroll.');
});

test('Jump 0 re-pins the top after prepend pagination scroll anchoring moves the viewport', async () => {
  let topScrolls = 0;
  let prepended = false;
  const harness = makeHarness({
    onScroll({ kind, root, state }) {
      if (kind !== 'to' || root.scrollTop !== 0) return;
      topScrolls += 1;
      if (topScrolls >= 2 && prepended) state.mounted = true;
    },
    onSettle({ root, state }) {
      if (prepended || topScrolls !== 1 || state.settleCount !== 1) return;
      root.scrollHeight += 4000;
      root.scrollTop += 4000;
      prepended = true;
    }
  });

  const target = {
    uap_index: 0,
    role: 'user',
    message_id: 'fb3c34bb-46be-475a-bd68-bcb2722a1262',
    spine: { records: [] }
  };

  const section = await harness.context.jumpToResolvedTarget(target);
  assert.equal(section, harness.targetSection);
  assert.ok(topScrolls >= 2,
    'Historical materialization must return to scrollTop 0 after prepended content anchors the viewport forward.');
});

test('Jump traversal does not treat the first current scroll extent as whole-conversation convergence', async () => {
  let boundarySettles = 0;
  let expanded = false;
  const harness = makeHarness({
    onSettle({ root, state }) {
      const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
      if (root.scrollTop < maxScrollTop - 1) return;
      boundarySettles += 1;
      if (!expanded && boundarySettles >= 2) {
        root.scrollHeight = 1500;
        expanded = true;
        boundarySettles = 0;
        return;
      }
      if (expanded && root.scrollTop >= 1000 && boundarySettles >= 2) {
        state.tocAvailable = true;
      }
    }
  });

  const target = {
    uap_index: 174,
    role: 'user',
    message_id: '410a4586-994a-417c-9316-90cd2445ca87',
    spine: { records: [] }
  };

  const section = await harness.context.jumpToResolvedTarget(target);
  assert.equal(section, harness.targetSection);
  assert.equal(expanded, true, 'The harness must expose a later virtualized scroll extent.');
  assert.equal(harness.state.tocAvailable, true,
    'Jump must keep traversing until the later TOC materialization becomes available.');
});

test('Jump accepts the requested message itself after a later virtualized extent mounts it without a TOC control', async () => {
  let boundarySettles = 0;
  let expanded = false;
  const harness = makeHarness({
    onSettle({ root, state }) {
      const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
      if (root.scrollTop < maxScrollTop - 1) return;
      boundarySettles += 1;
      if (!expanded && boundarySettles >= 2) {
        root.scrollHeight = 1500;
        expanded = true;
        boundarySettles = 0;
        return;
      }
      if (expanded && root.scrollTop >= 1000 && boundarySettles >= 2) {
        state.mounted = true;
      }
    }
  });

  const target = {
    uap_index: 174,
    role: 'user',
    message_id: '410a4586-994a-417c-9316-90cd2445ca87',
    spine: { records: [] }
  };

  const section = await harness.context.jumpToResolvedTarget(target);
  assert.equal(section, harness.targetSection);
  assert.equal(expanded, true);
  assert.equal(harness.state.tocAvailable, false,
    'The requested message itself must be sufficient; a TOC control is not required.');
});

test('numeric Jump primes safe navigation before Conversation API resolution completes', async () => {
  for (const requested of ['0', '174', '-1', '-2']) {
    const order = [];
    let resolveFetch = null;
    const fetchPromise = new Promise(resolve => { resolveFetch = resolve; });
    const context = vm.createContext({
      exportInProgress: false,
      testInProgress: false,
      jumpInProgress: false,
      window: { prompt: () => requested },
      currentConversationId: () => 'conversation-id',
      markLiveTailHistoricalNavigation() {},
      assert: (condition, message) => {
        if (!condition) throw new Error(message);
      },
      updateUi() {},
      setStatus() {},
      boundedDiagnosticText: value => String(value),
      errorMessage: error => error instanceof Error ? error.message : String(error),
      logDiagnostic() {},
      primeNumericJumpMaterialization: value => { order.push(`prime:${value}`); },
      fetchConversationPages: async () => {
        order.push('fetch-start');
        return fetchPromise;
      },
      conversationSpineFromPages: () => ({ records: [] }),
      resolveJumpIdentifier: () => ({
        uap_index: Number(requested) >= 0 ? Number(requested) : 3,
        role: 'user',
        message_id: 'target-message'
      }),
      jumpToResolvedTarget: async () => { order.push('resolved-jump'); }
    });
    vm.runInContext(productionFunctionSource('runJump'), context);

    const operation = context.runJump();
    await Promise.resolve();

    assert.equal(order[0], `prime:${Number(requested)}`,
      `Numeric Jump ${requested} did not prime navigation before API resolution.`);
    assert.equal(order[1], 'fetch-start',
      `Numeric Jump ${requested} did not start API resolution after priming navigation.`);

    resolveFetch({ pages: [] });
    await operation;
    assert.equal(order.at(-1), 'resolved-jump');
  }
});
