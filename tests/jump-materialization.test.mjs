import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8');

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
  }

  const targetSection = new FakeElement('target');
  const tocElement = new FakeElement('toc');
  const state = {
    mounted: false,
    tocAvailable: false,
    diagnostics: [],
    settleCount: 0
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

  await harness.context.jumpToResolvedTarget(target);
  assert.equal(expanded, true, 'The harness must expose a later virtualized scroll extent.');
  assert.equal(harness.state.tocAvailable, true,
    'Jump must keep traversing until the later TOC materialization becomes available.');
}