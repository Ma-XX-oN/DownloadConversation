import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../src/userscript/05-live-navigation/03-live-tail-input.js', import.meta.url),
  'utf8'
);
const start = source.indexOf('  /** Selector taken from the stock ChatGPT connection-recovery notice.');
const end = source.indexOf('  /**\n   * Installs the passive bounded high-water tracker', start);
assert.ok(start >= 0 && end > start, 'recovery observer source must be present');
const observerSource = source.slice(start, end);

test('recovery warning transitions, de-duplication, teardown and narrow observation', () => {
  const events = [];
  const observers = [];
  let clock = 100;
  let root = null;
  class Element {
    constructor(kind) {
      this.kind = kind;
      this.isConnected = true;
    }
    querySelector(selector) {
      assert.equal(selector, '[role="status"] > .text-chatgpt-recovery');
      return this.notice ?? null;
    }
    contains(node) {
      return Boolean(node && this.notice === node);
    }
    matches(selector) {
      return selector === '[role="status"] > .text-chatgpt-recovery' && this.kind === 'notice';
    }
    closest(selector) {
      assert.equal(selector, '[data-turn-key]');
      return { getAttribute: () => 'turn-1' };
    }
  }
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const context = {
    Element,
    MutationObserver,
    document: {
      querySelector(selector) {
        assert.equal(selector, '[data-chatgpt-conversation-selection-target="true"]');
        return root;
      }
    },
    performance: { now: () => clock },
    currentConversationId: () => 'conversation-1',
    logDiagnostic: (level, message, data) => events.push({ level, message, data })
  };
  vm.createContext(context);
  vm.runInContext(observerSource + '\nthis.bind = bindConnectionRecoveryRoot; this.release = releaseConnectionRecoveryObserver;', context);
  root = new Element('root');
  context.bind();
  assert.equal(observers.length, 1);
  assert.equal(observers[0].target, root);
  assert.equal(observers[0].options.childList, true);
  assert.equal(observers[0].options.subtree, true);
  assert.equal(observers[0].options.characterData, undefined);
  assert.equal(observers[0].options.attributes, undefined);

  let selectorScans = 0;
  const originalQuery = root.querySelector.bind(root);
  root.querySelector = selector => {
    selectorScans += 1;
    return originalQuery(selector);
  };
  for (let index = 0; index < 1000; index += 1) {
    observers[0].callback([{
      type: 'childList',
      addedNodes: [new Element('unrelated')],
      removedNodes: []
    }]);
  }
  assert.equal(selectorScans, 0, 'unrelated mutations must not rescan conversation subtree');
  assert.equal(events.length, 0, 'unrelated mutations must not emit recovery events');

  const notice = new Element('notice');
  root.notice = notice;
  observers[0].callback([{ type: 'childList', addedNodes: [notice], removedNodes: [] }]);
  assert.deepEqual(events.map(event => event.message), ['connection_interrupted']);
  assert.equal(events[0].data.dom_turn_id, 'turn-1');
  observers[0].callback([{ type: 'childList', addedNodes: [notice], removedNodes: [] }]);
  assert.equal(events.length, 1, 'duplicate warning must not create extra events');

  clock = 350;
  root.notice = null;
  observers[0].callback([{ type: 'childList', addedNodes: [], removedNodes: [notice] }]);
  assert.deepEqual(events.map(event => event.message), ['connection_interrupted', 'connection_restored']);
  assert.equal(events[1].data.duration_ms, 250);
  context.release();
  assert.equal(observers[0].disconnected, true);
});

test('existing root observer reuses the connection observer', () => {
  assert.match(source, /if \(!connectionRecoveryRoot\?\.isConnected\) bindConnectionRecoveryRoot\(\)/);
  assert.match(source, /window\.addEventListener\('pagehide', releaseConnectionRecoveryObserver/);
  assert.doesNotMatch(observerSource, /setInterval|setTimeout|characterData:\s*true|attributes:\s*true/);
});
